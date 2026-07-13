-- Close the remaining tombstone-scrub gap found by the delta re-verify of
-- migration 027: privacy_url_override and terms_url_override (migration 015)
-- are customer-supplied URLs on the customer's own domain — they identify
-- the deleted business exactly as website_url does, which the scrub already
-- nulls. billing_admin_notes (migration 019) is admin free text that can
-- embed identity, the analog of a2p_risk_review_override_note which 027
-- scrubs for the same reason.
--
-- Return type and signature are unchanged, so CREATE OR REPLACE is safe and
-- existing grants persist. The function body is 027's with three columns
-- added to the tombstone UPDATE; the backfill mirrors 027's predicate.

CREATE OR REPLACE FUNCTION public.cleanup_expired_business(
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
      -- customer-supplied compliance URLs on the customer's own domain
      -- (028: the self-hosted analog of website_url and the slug)
      privacy_url_override = NULL, terms_url_override = NULL,
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
      -- admin free text that can embed identity (028)
      billing_admin_notes = NULL,
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

-- Backfill the three columns on already-processed tombstones (same predicate
-- as 027's backfill; idempotent).
UPDATE businesses
SET privacy_url_override = NULL,
    terms_url_override = NULL,
    billing_admin_notes = NULL
WHERE deleted_at IS NOT NULL
  AND owner_id IS NULL
  AND name = '[deleted]';
