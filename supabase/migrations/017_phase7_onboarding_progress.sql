-- Phase 7: durable onboarding progress + retryable registration attempts.
--
-- This migration gives onboarding an explicit state machine instead of using
-- incidental facts like "ai_settings exists" or "telnyx_campaign_id exists" as
-- completion signals. It also separates registration attempt locking from the
-- success marker so a failed Telnyx call can be retried safely.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS onboarding_step text NOT NULL DEFAULT 'business_info',
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_last_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_registration_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS onboarding_registration_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_registration_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_registration_error text;

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_onboarding_step_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_onboarding_step_check
  CHECK (
    onboarding_step IN (
      'business_info',
      'business_hours',
      'services_faqs',
      'ai_settings',
      'legal_verification',
      'sms_use_case',
      'phone_number',
      'review_submit',
      'carrier_review',
      'complete'
    )
  );

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_onboarding_registration_status_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_onboarding_registration_status_check
  CHECK (
    onboarding_registration_status IN (
      'not_started',
      'submitting',
      'failed',
      'submitted'
    )
  );

-- Phase 7 closes the known vertical-mapping gap by adding common industries
-- that map cleanly to Telnyx's supported verticals.
ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_business_type_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_business_type_check
  CHECK (
    business_type IN (
      'plumber',
      'dentist',
      'restaurant',
      'car_wash',
      'salon',
      'hvac',
      'auto_shop',
      'real_estate',
      'legal',
      'financial',
      'insurance',
      'retail',
      'general',
      'other'
    )
  );

COMMENT ON COLUMN businesses.onboarding_step IS
  'Phase 7 explicit onboarding step. This is advisory/resumable state; server code also derives progress from persisted setup facts.';

COMMENT ON COLUMN businesses.onboarding_completed_at IS
  'Set only when onboarding is truly complete: active phone number, approved campaign, assigned number, and SMS ready.';

COMMENT ON COLUMN businesses.onboarding_registration_status IS
  'Retryable final registration attempt state. submitted means Telnyx registration submission succeeded; failed can be retried.';

COMMENT ON COLUMN businesses.onboarding_registration_submitted_at IS
  'Success marker for the final Telnyx registration submit. Do not set before Telnyx calls complete successfully.';

COMMENT ON COLUMN businesses.onboarding_registration_error IS
  'Customer-safe summary of the last registration attempt failure. Detailed provider payloads belong in telnyx_registration_events.';

-- Existing Telnyx-submitted accounts should not look like registration has not
-- started. This includes partially approved/pending accounts.
UPDATE businesses
SET
  onboarding_registration_status = 'submitted',
  onboarding_registration_submitted_at = COALESCE(
    onboarding_registration_submitted_at,
    campaign_status_updated_at,
    brand_status_updated_at,
    updated_at,
    created_at,
    now()
  ),
  onboarding_registration_error = NULL
WHERE telnyx_brand_id IS NOT NULL;

-- Approved + assigned accounts are truly complete and must not be shoved back
-- into onboarding during the Phase 7 rollout.
WITH sms_ready_businesses AS (
  SELECT DISTINCT b.id
  FROM businesses b
  JOIN phone_numbers pn
    ON pn.business_id = b.id
   AND pn.is_active = true
  WHERE b.campaign_status = 'approved'
    AND b.telnyx_campaign_id IS NOT NULL
    AND b.telnyx_messaging_profile_id IS NOT NULL
    AND pn.telnyx_campaign_assignment_status = 'assigned'
    AND pn.telnyx_campaign_assignment_campaign_id = b.telnyx_campaign_id
)
UPDATE businesses b
SET
  onboarding_step = 'complete',
  onboarding_completed_at = COALESCE(b.onboarding_completed_at, now()),
  onboarding_last_saved_at = COALESCE(b.onboarding_last_saved_at, now()),
  onboarding_registration_status = 'submitted',
  onboarding_registration_submitted_at = COALESCE(
    b.onboarding_registration_submitted_at,
    b.campaign_status_updated_at,
    b.brand_status_updated_at,
    b.updated_at,
    b.created_at,
    now()
  ),
  onboarding_registration_error = NULL
FROM sms_ready_businesses ready
WHERE b.id = ready.id;

-- Best-effort step backfill for incomplete accounts. The app resolver will
-- continue to derive progress from real setup data after rollout.
UPDATE businesses b
SET onboarding_step =
  CASE
    WHEN b.onboarding_completed_at IS NOT NULL THEN 'complete'
    WHEN b.telnyx_brand_id IS NOT NULL
      OR b.brand_status IS NOT NULL
      OR b.campaign_status IS NOT NULL
      OR b.onboarding_registration_status = 'submitted'
      THEN 'carrier_review'
    WHEN EXISTS (
      SELECT 1 FROM phone_numbers pn
      WHERE pn.business_id = b.id AND pn.is_active = true
    ) THEN 'review_submit'
    WHEN b.compliance_info_completed_at IS NOT NULL THEN 'phone_number'
    WHEN b.legal_business_name IS NOT NULL
      AND b.business_entity_type IS NOT NULL
      AND b.ein IS NOT NULL
      AND b.authorized_rep_name IS NOT NULL
      THEN 'sms_use_case'
    WHEN EXISTS (
      SELECT 1 FROM ai_settings ai
      WHERE ai.business_id = b.id
    ) THEN 'legal_verification'
    WHEN EXISTS (
      SELECT 1 FROM services s
      WHERE s.business_id = b.id
    ) THEN 'ai_settings'
    WHEN EXISTS (
      SELECT 1 FROM business_hours h
      WHERE h.business_id = b.id
    ) THEN 'services_faqs'
    WHEN b.name IS NOT NULL
      AND b.name <> 'My Business'
      AND b.phone_number IS NOT NULL
      AND b.email IS NOT NULL
      AND b.address IS NOT NULL
      AND b.city IS NOT NULL
      AND b.state IS NOT NULL
      AND b.zip IS NOT NULL
      THEN 'business_hours'
    ELSE 'business_info'
  END,
  onboarding_last_saved_at = COALESCE(b.onboarding_last_saved_at, b.updated_at, b.created_at)
WHERE b.onboarding_step = 'business_info'
  AND b.onboarding_completed_at IS NULL;
