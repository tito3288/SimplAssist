-- Hardening of the atomic account-cleanup pipeline (fixes adversarial-review
-- findings on migration 026 + its route):
--
-- 1. FULL PII scrub. 026 ported the route's 001-era column list; businesses
--    has since grown identity/A2P PII (EIN, rep contacts, forwarding number,
--    use-case content — migrations 012/015/018/019/022) that survived on the
--    tombstone while the run reported success. The rewritten function scrubs
--    all of it, rewrites the slug (kills the hosted /c/[slug] page and frees
--    the namespace), and nulls the Telnyx resource pointers so late carrier
--    webhooks can no longer resolve the tombstone.
-- 2. Durable auth-user linkage. 026 nulled owner_id transactionally, and the
--    route inferred "owner_id NULL means the auth user was already deleted" —
--    unsound after a crash between the RPC and deleteUser. owner_id is now
--    copied to cleanup_auth_user_id in the same transaction and RETURNED;
--    the route deletes that user and clears the column only on success, so
--    a crash anywhere retries soundly and no restore path is needed.
-- 3. Claim column. cleanup_attempted_at lets the route claim each business
--    (conditional UPDATE, stale after 10 minutes) so overlapping cron runs
--    cannot interleave on one business.
-- 4. Index-friendly messages anonymization. The 026 predicate
--    (business_id = X OR conversation_id IN (...)) is structurally
--    unindexable and seq-scanned the whole table per business; it is split
--    into two statements that use idx_messages_business_id and
--    idx_messages_conversation_id.
--
-- The return type changes (void -> uuid), which CREATE OR REPLACE forbids —
-- hence DROP + CREATE, with grants re-established (function ACLs reset on
-- CREATE).

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cleanup_auth_user_id uuid;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS cleanup_attempted_at timestamptz;

DROP FUNCTION IF EXISTS public.cleanup_expired_business(uuid);

-- Returns the auth user id that still needs deletion at GoTrue (NULL when no
-- user remains to delete). The caller deletes that user, then clears
-- cleanup_auth_user_id together with deletion_scheduled_for as the
-- completion marker.
CREATE FUNCTION public.cleanup_expired_business(
  p_business_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth_user uuid;
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

  -- Durable linkage to the auth user BEFORE owner_id is nulled. COALESCE
  -- keeps the value across re-runs (owner_id is already NULL on a retry).
  UPDATE businesses
  SET cleanup_auth_user_id = COALESCE(owner_id, cleanup_auth_user_id)
  WHERE id = p_business_id
  RETURNING cleanup_auth_user_id INTO v_auth_user;

  -- Anonymize messages: two statements so each uses its index — the OR form
  -- is structurally unindexable. content guard keeps re-runs cheap.
  UPDATE messages SET content = '[deleted]'
  WHERE business_id = p_business_id AND content <> '[deleted]';
  UPDATE messages SET content = '[deleted]'
  WHERE conversation_id IN (
      SELECT id FROM conversations WHERE business_id = p_business_id
    )
    AND content <> '[deleted]';

  -- Anonymize contacts: strip PII, keep lead_score and timestamps.
  UPDATE contacts
  SET name = NULL, email = NULL, phone_number = NULL, notes = NULL
  WHERE business_id = p_business_id;

  -- Hard delete config tables (the business row is kept as a tombstone).
  DELETE FROM ai_settings            WHERE business_id = p_business_id;
  DELETE FROM services               WHERE business_id = p_business_id;
  DELETE FROM faqs                   WHERE business_id = p_business_id;
  DELETE FROM business_hours         WHERE business_id = p_business_id;
  DELETE FROM phone_numbers          WHERE business_id = p_business_id;
  DELETE FROM widget_configs         WHERE business_id = p_business_id;
  DELETE FROM google_calendar_tokens WHERE business_id = p_business_id;
  DELETE FROM subscriptions          WHERE business_id = p_business_id;

  -- Full tombstone scrub. Kept for analytics: business_type, timezone,
  -- billing flags, created_at, lead_score on contacts, message volumes.
  UPDATE businesses
  SET name = '[deleted]',
      slug = 'deleted-' || p_business_id,
      email = NULL, phone_number = NULL, website_url = NULL,
      address = NULL, city = NULL, state = NULL, zip = NULL,
      -- legal identity / A2P registration PII (012/015/019/021/022)
      legal_business_name = NULL, business_entity_type = NULL,
      business_registration_state = NULL, tax_id_type = NULL,
      ein = NULL, last_4_ssn = NULL, registrant_mobile = NULL,
      authorized_rep_name = NULL, authorized_rep_title = NULL,
      authorized_rep_email = NULL, authorized_rep_phone = NULL,
      business_type_other = NULL,
      forward_to_number = NULL,
      pending_phone_number = NULL, pending_phone_number_area_code = NULL,
      pending_phone_number_failure_reason = NULL,
      -- customer-authored SMS content and risk-screen output (may embed
      -- identity and website-derived text)
      use_case_description = NULL, sample_messages = NULL,
      opt_in_description = NULL, estimated_monthly_volume = NULL,
      a2p_risk_review_message = NULL, a2p_risk_review_reason = NULL,
      a2p_risk_review_findings = NULL,
      a2p_risk_review_customer_answer = NULL,
      a2p_risk_review_customer_selections = NULL,
      a2p_risk_review_input_hash = NULL,
      a2p_risk_review_override_note = NULL,
      onboarding_registration_error = NULL,
      -- carrier resource pointers: late Telnyx webhooks must not resolve a
      -- tombstone (lookup is by these ids), and rejection reasons can embed
      -- carrier-supplied identity text
      telnyx_brand_id = NULL, telnyx_campaign_id = NULL,
      telnyx_messaging_profile_id = NULL, telnyx_voice_application_id = NULL,
      brand_status = NULL, brand_rejection_reason = NULL,
      campaign_status = NULL, campaign_rejection_reason = NULL,
      owner_id = NULL
  WHERE id = p_business_id;

  RETURN v_auth_user;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_business(uuid) TO service_role;

-- Backfill: tombstones already processed by the pre-027 pipeline (old route
-- or 026) retain the post-001 PII columns — scrub them identically.
-- Processed tombstones are identified by owner_id IS NULL + the scrubbed
-- name; accounts still inside their grace period (owner_id set) are
-- untouched. Idempotent: re-running sets the same values.
UPDATE businesses
SET slug = 'deleted-' || id,
    legal_business_name = NULL, business_entity_type = NULL,
    business_registration_state = NULL, tax_id_type = NULL,
    ein = NULL, last_4_ssn = NULL, registrant_mobile = NULL,
    authorized_rep_name = NULL, authorized_rep_title = NULL,
    authorized_rep_email = NULL, authorized_rep_phone = NULL,
    business_type_other = NULL,
    forward_to_number = NULL,
    pending_phone_number = NULL, pending_phone_number_area_code = NULL,
    pending_phone_number_failure_reason = NULL,
    use_case_description = NULL, sample_messages = NULL,
    opt_in_description = NULL, estimated_monthly_volume = NULL,
    a2p_risk_review_message = NULL, a2p_risk_review_reason = NULL,
    a2p_risk_review_findings = NULL,
    a2p_risk_review_customer_answer = NULL,
    a2p_risk_review_customer_selections = NULL,
    a2p_risk_review_input_hash = NULL,
    a2p_risk_review_override_note = NULL,
    onboarding_registration_error = NULL,
    telnyx_brand_id = NULL, telnyx_campaign_id = NULL,
    telnyx_messaging_profile_id = NULL, telnyx_voice_application_id = NULL,
    brand_status = NULL, brand_rejection_reason = NULL,
    campaign_status = NULL, campaign_rejection_reason = NULL
WHERE deleted_at IS NOT NULL
  AND owner_id IS NULL
  AND name = '[deleted]';
