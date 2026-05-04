-- Idempotency table for Telnyx webhook event dedup.
-- Telnyx retries inbound webhooks on non-2xx, so handlers must dedup on
-- event.data.id to avoid duplicate AI replies / duplicate state changes.

CREATE TABLE processed_webhook_events (
  event_id text PRIMARY KEY,
  processed_at timestamptz DEFAULT now()
);

CREATE INDEX idx_processed_webhook_events_processed_at
  ON processed_webhook_events(processed_at);

-- Enable RLS for defense-in-depth. No policies = deny by default for non-service-role.
-- Webhook handlers and pg_cron both bypass RLS (service-role and postgres respectively).
ALTER TABLE processed_webhook_events ENABLE ROW LEVEL SECURITY;

-- TTL cleanup: delete rows older than 7 days. Telnyx retries finish within minutes,
-- so 7 days is generous and keeps the table small even at high message volume.
SELECT cron.schedule(
  'cleanup_processed_webhook_events',
  '0 3 * * *',  -- daily at 03:00 UTC
  $$DELETE FROM processed_webhook_events WHERE processed_at < now() - interval '7 days'$$
);
