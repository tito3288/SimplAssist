import { telnyx } from "./client";
import { getOutboundSendContext } from "./lookup";
import { isE164PhoneNumber } from "@/lib/phone/e164";
import { insertPausedSystemMessageIfNeeded } from "./pausedNotice";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateContact } from "@/lib/ai/contacts";
import { getOrCreateConversation, addMessage } from "@/lib/ai/conversations";
import { renderMissedCallSms } from "@/lib/messaging/complianceCopy";
import type { Language, SmsBlockReason } from "@/types/database";
import {
  preflightOutboundSms,
  recordOutboundSmsUsage,
  type UsageBlockReason,
} from "@/lib/billing/usage";

export async function sendMissedCallSMS(
  callerPhone: string,
  businessId: string
): Promise<void> {
  // PERMANENT conditions return without throwing — a webhook retry can
  // never fix them, and throwing would 500-loop the caller's event across
  // the provider's whole retry schedule:
  // - anonymous/withheld caller ID (nothing to text)
  // - missing business / active number / messaging profile (provisioning
  //   state; fixes take longer than any retry window)
  // TRANSIENT conditions (DB read errors, Telnyx API failures) throw so the
  // caller can record-and-let-retry.
  if (!isE164PhoneNumber(callerPhone)) {
    console.warn(
      `[missed-call] caller phone is not textable (anonymous/withheld): ${callerPhone}`
    );
    return;
  }

  try {
    const [
      { data: business, error: businessError },
      { data: aiSettings },
      { data: phoneNumberRow, error: phoneError },
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("name, email, phone_number")
        .eq("id", businessId)
        .single(),
      supabaseAdmin
        .from("ai_settings")
        .select("language")
        .eq("business_id", businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("phone_numbers")
        .select("phone_number")
        .eq("business_id", businessId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

    // Distinguish transient read errors (throw → retry) from genuine
    // not-found (permanent → ack): collapsing an error into "not found"
    // silently loses the SMS on a DB blip.
    if (businessError) {
      throw new Error(
        `[missed-call] business read failed for ${businessId}: ${businessError.message}`
      );
    }
    if (phoneError) {
      throw new Error(
        `[missed-call] phone number read failed for ${businessId}: ${phoneError.message}`
      );
    }

    if (!business) {
      console.warn(`[missed-call] Business not found: ${businessId}`);
      return;
    }

    if (!phoneNumberRow) {
      console.warn(
        `[missed-call] No active phone number for business: ${businessId}`
      );
      return;
    }

    const language: Language = (aiSettings?.language as Language) ?? "en";
    const smsBody = renderMissedCallSms({
      business,
      smsPhoneNumber: phoneNumberRow.phone_number,
      language,
    });

    const sendContext = await getOutboundSendContext(phoneNumberRow.phone_number);

    // Ensure a contact + conversation exist so the dashboard can show the
    // missed-call SMS in the conversation thread for that caller. We add
    // ONLY the outbound assistant message — never a synthetic "customer"
    // row, since the customer didn't actually send anything (they called).
    const contact = await findOrCreateContact(
      businessId,
      callerPhone,
      null,
      "sms"
    );
    const conversation = await getOrCreateConversation(
      businessId,
      contact.id,
      "sms"
    );

    if (!sendContext.smsReady) {
      console.warn(
        `[missed-call] send blocked: reason=${sendContext.blockReason} campaign_status=${sendContext.campaignStatus} assignment_status=${sendContext.assignmentStatus} for business ${businessId}`
      );
      await insertPausedSystemMessageIfNeeded({
        conversationId: conversation.id,
        businessId,
        channel: "sms",
        context: "missed_call",
        reason: toPausedReason(sendContext.blockReason),
      });
      return;
    }

    if (!sendContext.messagingProfileId) {
      // Permanent for retry purposes: a missing profile is a provisioning
      // problem measured in days, not a transient blip — throwing would
      // 500-loop every missed call for this business across the provider's
      // retry schedule with no chance of success.
      console.error(
        `[missed-call] Missing messaging profile for business ${businessId} — SMS skipped (provisioning problem, not retryable)`
      );
      return;
    }

    const usage = await preflightOutboundSms({ businessId, text: smsBody });
    if (!usage.allowed) {
      console.warn(
        `[missed-call] send blocked by usage gate: reason=${usage.reason} for business ${businessId}`
      );
      await insertPausedSystemMessageIfNeeded({
        conversationId: conversation.id,
        businessId,
        channel: "sms",
        context: "missed_call",
        reason: usageToPausedReason(usage.reason),
      });
      return;
    }

    const result = await telnyx.messages.send({
      from: phoneNumberRow.phone_number,
      to: callerPhone,
      text: smsBody,
      messaging_profile_id: sendContext.messagingProfileId,
      type: "SMS",
    });

    console.log(
      `[missed-call] SMS sent to ${callerPhone} for business ${businessId} (lang=${language}, telnyxId=${result.data?.id})`
    );

    // Decoupled from the send: a logging failure here must not look like an
    // SMS failure in the outer catch. The customer already got the text.
    try {
      await addMessage(conversation.id, businessId, "assistant", smsBody, "sms");
      await recordOutboundSmsUsage({
        businessId,
        text: smsBody,
        source: "missed_call_sms",
        providerMessageId: result.data?.id ?? null,
        idempotencyKey: result.data?.id
          ? `outbound:missed_call:${result.data.id}`
          : undefined,
        metadata: { to: callerPhone, from: phoneNumberRow.phone_number },
      });
    } catch (logErr) {
      console.error(
        `[missed-call] SMS sent (telnyxId=${result.data?.id}) but failed to persist to messages table — manual reconciliation may be needed:`,
        logErr
      );
    }
  } catch (error) {
    // Rethrow so callers can record-and-let-retry: a swallowed send failure
    // silently loses the product's core deliverable. This throws ONLY for
    // genuine send-path failures — a usage-gate block returns normally above
    // (retry can't help until the customer upgrades), and a post-send
    // persistence failure is deliberately not rethrown (the customer got
    // the text; a retry would double-send).
    console.error("[missed-call] Error sending missed call SMS:", error);
    throw error;
  }
}

function toPausedReason(
  reason: SmsBlockReason | null
): "campaign_not_approved" | "assignment_pending" | "assignment_failed" {
  if (reason === "assignment_failed") return "assignment_failed";
  if (reason === "assignment_pending") return "assignment_pending";
  return "campaign_not_approved";
}

function usageToPausedReason(
  reason: UsageBlockReason
): "usage_limit_reached" | "billing_paused" | "submission_disabled" {
  if (reason === "usage_limit_reached") return "usage_limit_reached";
  if (reason === "telnyx_submission_disabled") return "submission_disabled";
  return "billing_paused";
}
