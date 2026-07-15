import { supabaseAdmin } from "@/lib/supabase/admin";

// Telnyx retries inbound webhooks on non-2xx (and occasionally on successful
// responses if the network blips). Without dedup, a slow handler could trigger
// duplicate AI replies. markProcessedOnce records the event ID atomically and
// returns true only on first observation; callers should skip on false.
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

// Release OUR claim after a processing failure so the provider's retry can
// re-insert and reprocess. Mutual exclusion is sound for this bare seen-set
// (while our row exists every duplicate dedups WITHOUT processing, so only
// the claim holder — after its processing concluded — reaches this delete;
// no interleaving yields two concurrent processors).
//
// HONEST LIMITS of release-and-500 on this schema (no claimed_at, no
// stored payload; migration 009's 7-day TTL cron deletes stale rows
// WITHOUT replay):
// - Ack race: a timeout-triggered duplicate that dedup-acked 200 during
//   the holder's window likely terminates the provider's retry sequence
//   (standard per-event semantics; not locally provable) — the holder's
//   later release+500 then recovers nothing. Loss shrinks from
//   "every failure" to "failure racing a timeout-duplicate", not to zero.
// - Crash or failed release: the row dead-letters permanently; no reaper
//   can exist on this schema (nothing to measure staleness against, no
//   payload to replay). Cure is the §5 schema extension.
// Throws on error so the caller still returns non-2xx.
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
