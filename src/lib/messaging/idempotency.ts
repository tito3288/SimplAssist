import { supabaseAdmin } from "@/lib/supabase/admin";

// Legacy voice/registration webhook deduplication. Messaging webhooks use the
// explicit claim lifecycle below so an in-progress duplicate is retried rather
// than incorrectly acknowledged as already complete.
//
// Claim/release contract: markProcessedOnce CLAIMS the event before the
// handler runs. A caller whose processing then fails must call
// releaseProcessedEvent and return non-2xx so Telnyx's retry redelivers and
// reprocesses — otherwise the claimed row permanently dead-letters the event
// (the retry dedups to a no-op while the failure was never handled). Callers
// that swallow handler errors on purpose (real-time call-control verbs where
// a delayed retry is useless) keep the claim and ack 2xx.
export async function markProcessedOnce(eventId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("processed_webhook_events")
    .upsert(
      { event_id: eventId },
      { onConflict: "event_id", ignoreDuplicates: true }
    )
    .select();

  if (error) throw error;
  return data !== null && data.length > 0;
}

// Throw this (from any handler, any event type) to force release-claim +
// 500: durability is a property of the SIDE EFFECT, not the outer event
// type — e.g. the missed-call SMS can fail under call.answered (forwarding
// dial error), which no static event-type list covers.
export class RetryableWebhookError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RetryableWebhookError";
  }
}

// Release a legacy voice/registration claim after a retryable failure. These
// handlers retain the original bare seen-set behavior; only inbound messaging
// needs the stronger in-progress/completed contract implemented below.
export async function releaseProcessedEvent(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("processed_webhook_events")
    .delete()
    .eq("event_id", eventId);

  if (error) {
    throw new Error(
      `[messaging:idempotency] Failed to release claim for event ${eventId}: ${error.message}`
    );
  }
}

export type MessagingWebhookClaim =
  | { outcome: "claimed"; claimToken: string }
  | { outcome: "in_progress" | "completed"; claimToken: null };

/**
 * Atomically claim a Telnyx messaging event.
 *
 * `completed` is safe to acknowledge. `in_progress` is deliberately different:
 * the caller must return a retryable response because the current holder could
 * still fail and release its claim.
 */
export async function claimMessagingWebhookEvent(
  eventId: string
): Promise<MessagingWebhookClaim> {
  const { data, error } = await supabaseAdmin.rpc(
    "claim_messaging_webhook_event",
    { p_event_id: eventId }
  );

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(
      `[messaging:idempotency] Claim RPC returned no result for event ${eventId}.`
    );
  }

  const outcome = (row as { outcome?: unknown }).outcome;
  const token = (row as { token?: unknown }).token;

  if (outcome === "claimed" && typeof token === "string" && token !== "") {
    return { outcome, claimToken: token };
  }
  if (outcome === "in_progress" || outcome === "completed") {
    return { outcome, claimToken: null };
  }

  throw new Error(
    `[messaging:idempotency] Claim RPC returned an invalid result for event ${eventId}.`
  );
}

/** Mark a messaging event complete, but only for the process that owns it. */
export async function completeMessagingWebhookEvent(
  eventId: string,
  claimToken: string
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "complete_messaging_webhook_event",
    { p_event_id: eventId, p_claim_token: claimToken }
  );

  if (error) throw error;
  if (data !== true) {
    throw new Error(
      `[messaging:idempotency] Lost completion claim for event ${eventId}.`
    );
  }
}

/** Release a failed messaging event, but only for the process that owns it. */
export async function releaseMessagingWebhookClaim(
  eventId: string,
  claimToken: string
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "release_messaging_webhook_claim",
    { p_event_id: eventId, p_claim_token: claimToken }
  );

  if (error) throw error;
  if (data !== true) {
    throw new Error(
      `[messaging:idempotency] Lost release claim for event ${eventId}.`
    );
  }
}
