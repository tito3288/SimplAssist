import { telnyx } from "./client";
import { getOutboundSendContext } from "./lookup";
import { insertPausedSystemMessageIfNeeded } from "./pausedNotice";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateContact } from "@/lib/ai/contacts";
import { getOrCreateConversation, addMessage } from "@/lib/ai/conversations";
import type { Language, SmsBlockReason } from "@/types/database";

// Static templates indexed by ai_settings.language. Missed-call SMS is a
// transactional, time-sensitive, near-identical-every-time message — using
// the AI for it isn't earning its cost, and routing through the customer
// conversation engine caused two bugs:
//   (1) the LLM occasionally leaked reasoning text into the SMS body
//       ("I appreciate the request, but I need to let you know that...")
//   (2) the prompt-instruction string got persisted as a role:"customer"
//       row in the messages table, polluting conversation history.
// Static templates eliminate both. Bilingual subsequent turns (when the
// customer replies via SMS) are still handled by the conversation engine
// based on ai_settings.language.
const MISSED_CALL_TEMPLATES = {
  en: (businessName: string) =>
    `Hi! This is ${businessName}. We missed your call — how can we help? Reply STOP to opt out.`,
  es: (businessName: string) =>
    `¡Hola! Somos ${businessName}. No pudimos contestar — ¿en qué le ayudamos? Responda STOP para cancelar.`,
};

// "both" defaults to English on first contact since we don't yet know the
// caller's preferred language. The conversation engine adapts on subsequent
// turns once the customer replies.
function renderTemplate(businessName: string, language: Language): string {
  if (language === "es") return MISSED_CALL_TEMPLATES.es(businessName);
  return MISSED_CALL_TEMPLATES.en(businessName);
}

export async function sendMissedCallSMS(
  callerPhone: string,
  businessId: string
): Promise<void> {
  try {
    const [
      { data: business },
      { data: aiSettings },
      { data: phoneNumberRow },
    ] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("name")
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
    const smsBody = renderTemplate(business.name, language);

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
      throw new Error(
        `[missed-call] Missing messaging profile for business ${businessId}`
      );
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
    } catch (logErr) {
      console.error(
        `[missed-call] SMS sent (telnyxId=${result.data?.id}) but failed to persist to messages table — manual reconciliation may be needed:`,
        logErr
      );
    }
  } catch (error) {
    console.error("[missed-call] Error sending missed call SMS:", error);
  }
}

function toPausedReason(
  reason: SmsBlockReason | null
): "campaign_not_approved" | "assignment_pending" | "assignment_failed" {
  if (reason === "assignment_failed") return "assignment_failed";
  if (reason === "assignment_pending") return "assignment_pending";
  return "campaign_not_approved";
}
