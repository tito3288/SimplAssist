import { supabaseAdmin } from "@/lib/supabase/admin";

// Telnyx retries inbound webhooks on non-2xx (and occasionally on successful
// responses if the network blips). Without dedup, a slow handler could trigger
// duplicate AI replies. markProcessedOnce records the event ID atomically and
// returns true only on first observation; callers should skip on false.
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
