-- Atomic teardown of an expired soft-deleted account.
--
-- The cron cleanup route (/api/account/cleanup) previously ran ~11 unchecked
-- statements per business: a mid-sequence failure left a half-deleted account
-- and the route reported success regardless (supabase-js returns errors, it
-- does not throw). This function performs every DB mutation in one
-- transaction — any failure rolls back all of it, so a partially-scrubbed
-- account cannot exist.
--
-- Deliberately NOT in this function:
--   - auth user deletion (GoTrue admin API; the route calls it after this
--     succeeds — owner_id is nulled here first because businesses.owner_id
--     is ON DELETE CASCADE and deleting the user first would cascade away
--     the tombstone row);
--   - the completion marker (deletion_scheduled_for = NULL; the route sets
--     it only after the auth user is gone, so any failure leaves the row
--     matching the cron query and the next run retries from the top —
--     this function is idempotent on an already-scrubbed account).
--
-- Guard: refuses any business that is not an expired soft-deleted account,
-- so a stray call can never scrub a live customer.
--
-- Execution is service-role only: functions default to EXECUTE for PUBLIC,
-- which would let any authenticated user scrub their own account early via
-- PostgREST RPC — revoked below.

-- Drift repair: the soft-delete columns were added to prod out-of-band when
-- the account-deletion feature shipped and never landed in a migration, so
-- fresh environments built from migrations alone were missing columns that
-- live code (account routes, layouts, the cleanup cron) depends on.
-- IF NOT EXISTS makes this a no-op on prod.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS deletion_scheduled_for timestamptz;

CREATE OR REPLACE FUNCTION public.cleanup_expired_business(
  p_business_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM businesses
    WHERE id = p_business_id
      AND deleted_at IS NOT NULL
      AND deletion_scheduled_for < now()
  ) THEN
    RAISE EXCEPTION 'business % is not an expired deleted account', p_business_id
      USING ERRCODE = '42501';
  END IF;

  -- Anonymize messages: replace content but keep role/channel/timestamps for
  -- analytics. Matched by direct business_id AND via the conversation join,
  -- so rows with either linkage are covered.
  UPDATE messages SET content = '[deleted]'
  WHERE business_id = p_business_id
     OR conversation_id IN (
       SELECT id FROM conversations WHERE business_id = p_business_id
     );

  -- Anonymize contacts: strip PII, keep lead_score and timestamps.
  UPDATE contacts
  SET name = NULL, email = NULL, phone_number = NULL, notes = NULL
  WHERE business_id = p_business_id;

  -- Hard delete config tables (the business row is kept as a tombstone, so
  -- ON DELETE CASCADE never fires for these).
  DELETE FROM ai_settings            WHERE business_id = p_business_id;
  DELETE FROM services               WHERE business_id = p_business_id;
  DELETE FROM faqs                   WHERE business_id = p_business_id;
  DELETE FROM business_hours         WHERE business_id = p_business_id;
  DELETE FROM phone_numbers          WHERE business_id = p_business_id;
  DELETE FROM widget_configs         WHERE business_id = p_business_id;
  DELETE FROM google_calendar_tokens WHERE business_id = p_business_id;
  DELETE FROM subscriptions          WHERE business_id = p_business_id;

  -- Scrub PII from the business row but keep it as a tombstone for analytics
  -- FKs. owner_id is nulled so the subsequent auth-user delete cannot
  -- cascade-delete the tombstone.
  UPDATE businesses
  SET name = '[deleted]',
      email = NULL,
      phone_number = NULL,
      website_url = NULL,
      address = NULL,
      city = NULL,
      state = NULL,
      zip = NULL,
      owner_id = NULL
  WHERE id = p_business_id;
END;
$$;

-- Service-role only: strip the default PUBLIC execute grant so authenticated
-- users cannot invoke this through the exposed RPC surface.
REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_business(uuid) TO service_role;
