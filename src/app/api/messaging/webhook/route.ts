import { NextRequest, NextResponse } from "next/server";
import { telnyx } from "@/lib/messaging/client";
import { getOutboundSendContext } from "@/lib/messaging/lookup";
import { insertPausedSystemMessageIfNeeded } from "@/lib/messaging/pausedNotice";
import { markProcessedOnce } from "@/lib/messaging/idempotency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processIncomingMessage } from "@/lib/ai/engine";
import { findOrCreateContact } from "@/lib/ai/contacts";
import { getOrCreateConversation, addMessage } from "@/lib/ai/conversations";
import type { SmsBlockReason } from "@/types/database";

const MMS_FALLBACK_MESSAGE =
  "I can't process images yet — please describe what you need in text and I'll help.";

// Telnyx posts every messaging webhook (received, sent, finalized, etc.) to the
// same URL. We only act on message.received; other event types are acked and ignored.
//
// Critical invariants:
// - Always return 200 to avoid Telnyx's retry loop. Errors during AI/send go to logs.
// - Verify the Ed25519 signature first (telnyx.webhooks.unwrap throws on bad sig).
// - Dedup on event.data.id before doing AI work, so retries don't duplicate replies.
// - Ack the webhook BEFORE doing slow AI work (Telnyx's ack budget is ~10s).
//   On Railway's long-lived Node runtime, a detached promise survives the response.
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k] = v;
  });

  let event: unknown;
  try {
    event = await telnyx.webhooks.unwrap(rawBody, { headers });
  } catch (err) {
    console.warn("[messaging:webhook] Signature verification failed:", err);
    return new NextResponse("Forbidden", { status: 403 });
  }

  const eventData = (event as { data?: { id?: string; event_type?: string; payload?: unknown } }).data;
  const eventType = eventData?.event_type;
  const eventId = eventData?.id;
  console.log(`[messaging:webhook] event_type=${eventType} event_id=${eventId}`);

  if (eventType !== "message.received") {
    console.log(`[messaging:webhook] Ignoring non-inbound event: ${eventType}`);
    return new NextResponse("OK", { status: 200 });
  }

  if (eventId) {
    const isFirstTime = await markProcessedOnce(eventId);
    if (!isFirstTime) {
      console.log(`[messaging:webhook] Idempotency: event ${eventId} already processed, skipping`);
      return new NextResponse("OK", { status: 200 });
    }
  } else {
    console.warn("[messaging:webhook] Missing event.data.id, skipping idempotency check");
  }

  const payload = eventData?.payload as
    | {
        from?: { phone_number?: string };
        to?: Array<{ phone_number?: string }>;
        text?: string;
        media?: unknown[];
      }
    | undefined;
  if (!payload) {
    console.warn("[messaging:webhook] Missing payload on message.received event");
    return new NextResponse("OK", { status: 200 });
  }

  const from = payload.from?.phone_number;
  const to = payload.to?.[0]?.phone_number;
  const text = payload.text ?? "";
  const media = payload.media ?? [];

  if (!from || !to) {
    console.warn(`[messaging:webhook] Missing from or to: from=${from} to=${to}`);
    return new NextResponse("OK", { status: 200 });
  }

  console.log(
    `[messaging:webhook] message.received from=${from} to=${to} text.length=${text.length} media.count=${media.length}`
  );

  // MMS fallback: media without substantive text gets a canned reply, no AI call.
  // Threshold of 5 chars treats one-emoji or one-word captions as "no text".
  if (media.length > 0 && text.trim().length < 5) {
    console.log("[messaging:webhook] MMS without substantive text, sending fallback");
    sendFallbackReply(to, from).catch((err) => {
      console.error("[messaging:webhook] Failed to send MMS fallback:", err);
    });
    return new NextResponse("OK", { status: 200 });
  }

  const { data: phoneNumberRow, error: lookupError } = await supabaseAdmin
    .from("phone_numbers")
    .select("business_id")
    .eq("phone_number", to)
    .eq("is_active", true)
    .single();

  if (lookupError || !phoneNumberRow) {
    console.warn(
      `[messaging:webhook] No active business found for to=${to}`,
      lookupError
    );
    return new NextResponse("OK", { status: 200 });
  }

  const businessId = phoneNumberRow.business_id;
  console.log(`[messaging:webhook] Resolved businessId=${businessId}, dispatching AI reply`);

  // Detached background work: ack now, do AI + reply send in the background.
  processAndReply(businessId, from, to, text).catch((err) => {
    console.error("[messaging:webhook] Background processing error:", err);
  });

  return new NextResponse("OK", { status: 200 });
}

// `from` here is the business's own number (the webhook's `to`); `to` is the
// customer who sent the MMS (the webhook's `from`). See call site line 86
// where the args are intentionally swapped.
async function sendFallbackReply(from: string, to: string) {
  const sendContext = await getOutboundSendContext(from);

  if (!sendContext.smsReady) {
    console.warn(
      `[messaging:webhook] MMS fallback blocked: reason=${sendContext.blockReason} campaign_status=${sendContext.campaignStatus} assignment_status=${sendContext.assignmentStatus} for business ${sendContext.businessId}`
    );
    const contact = await findOrCreateContact(
      sendContext.businessId,
      to,
      null,
      "sms"
    );
    const conversation = await getOrCreateConversation(
      sendContext.businessId,
      contact.id,
      "sms"
    );
    await insertPausedSystemMessageIfNeeded({
      conversationId: conversation.id,
      businessId: sendContext.businessId,
      channel: "sms",
      context: "mms_fallback",
      reason: toPausedReason(sendContext.blockReason),
    });
    return;
  }

  if (!sendContext.messagingProfileId) {
    throw new Error(
      `[messaging:webhook] Missing messaging profile for ${from}`
    );
  }

  const result = await telnyx.messages.send({
    from,
    to,
    text: MMS_FALLBACK_MESSAGE,
    messaging_profile_id: sendContext.messagingProfileId,
    type: "SMS",
  });
  console.log(`[messaging:webhook] MMS fallback sent, telnyxId=${result.data?.id}`);
}

async function processAndReply(
  businessId: string,
  from: string,
  to: string,
  text: string
) {
  // Resolve the outbound context FIRST so we can gate the AI call on campaign
  // approval. Same single-join query that the merged helper exposes — net DB
  // cost vs. pre-Phase-5 is neutral (replaces a later getMessagingProfileForOutbound call).
  const sendContext = await getOutboundSendContext(to);

  if (!sendContext.smsReady) {
    console.warn(
      `[messaging:webhook] AI reply blocked: reason=${sendContext.blockReason} campaign_status=${sendContext.campaignStatus} assignment_status=${sendContext.assignmentStatus} for business ${businessId}`
    );
    // The AI engine normally owns customer-message persistence — replicate
    // just enough here so the inbound is still visible in the dashboard,
    // followed by a dedupe-aware paused notice.
    const contact = await findOrCreateContact(businessId, from, null, "sms");
    const conversation = await getOrCreateConversation(
      businessId,
      contact.id,
      "sms"
    );
    await addMessage(conversation.id, businessId, "customer", text, "sms");
    await insertPausedSystemMessageIfNeeded({
      conversationId: conversation.id,
      businessId,
      channel: "sms",
      context: "ai_reply",
      reason: toPausedReason(sendContext.blockReason),
    });
    return;
  }

  if (!sendContext.messagingProfileId) {
    throw new Error(
      `[messaging:webhook] Missing messaging profile for ${to}`
    );
  }

  const { data: existingContact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("business_id", businessId)
    .eq("phone_number", from)
    .maybeSingle();
  const isFirstContact = !existingContact;

  console.log(
    `[messaging:webhook] Generating AI reply (firstContact=${isFirstContact})`
  );
  const aiResponse = await processIncomingMessage(
    businessId,
    from,
    null,
    text,
    "sms"
  );
  console.log(`[messaging:webhook] AI reply generated (length=${aiResponse.length})`);

  const { data: aiSettings } = await supabaseAdmin
    .from("ai_settings")
    .select("sms_response_delay_seconds")
    .eq("business_id", businessId)
    .single();

  const delayMs = (aiSettings?.sms_response_delay_seconds ?? 0) * 1000;
  if (delayMs > 0) {
    console.log(`[messaging:webhook] Applying delay: ${delayMs}ms`);
    await new Promise((r) => setTimeout(r, delayMs));
  }

  const finalReply = isFirstContact
    ? `${aiResponse}\n\nReply STOP to opt out.`
    : aiResponse;

  console.log(`[messaging:webhook] Sending reply via Telnyx`);
  const result = await telnyx.messages.send({
    from: to,
    to: from,
    text: finalReply,
    messaging_profile_id: sendContext.messagingProfileId,
    type: "SMS",
  });
  console.log(`[messaging:webhook] Reply sent, telnyxId=${result.data?.id}`);
}

function toPausedReason(
  reason: SmsBlockReason | null
): "campaign_not_approved" | "assignment_pending" | "assignment_failed" {
  if (reason === "assignment_failed") return "assignment_failed";
  if (reason === "assignment_pending") return "assignment_pending";
  return "campaign_not_approved";
}
