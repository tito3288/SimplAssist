-- Phase 8: A2P use-case screening + manual review guardrails.
--
-- Risk screening is a pre-submission gate only. Accounts where Telnyx
-- registration has already started remain in carrier review and are not
-- retroactively pulled back into onboarding by this migration.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS a2p_risk_review_status text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_input_hash text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_message text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_reason text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_findings jsonb,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_customer_answer text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_customer_selections text[],
  ADD COLUMN IF NOT EXISTS a2p_risk_review_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_notified_at timestamptz,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_reviewed_by text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_override_note text,
  ADD COLUMN IF NOT EXISTS a2p_risk_review_updated_at timestamptz;

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_a2p_risk_review_status_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_a2p_risk_review_status_check
  CHECK (
    a2p_risk_review_status IS NULL
    OR a2p_risk_review_status IN (
      'not_started',
      'pending_review',
      'blocked',
      'passed',
      'admin_approved'
    )
  );

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_a2p_risk_review_customer_answer_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_a2p_risk_review_customer_answer_check
  CHECK (
    a2p_risk_review_customer_answer IS NULL
    OR a2p_risk_review_customer_answer IN (
      'none',
      'restricted',
      'not_sure'
    )
  );

COMMENT ON COLUMN businesses.a2p_risk_review_status IS
  'Phase 8 pre-submission A2P screening status. Null is allowed for legacy submitted accounts; app code treats null as not_started only when registration has not started.';

COMMENT ON COLUMN businesses.a2p_risk_review_input_hash IS
  'SHA-256 hash of the current A2P screening inputs. Edits to website, services, FAQs, use-case copy, or checklist produce a new hash and reset effective clearance before registration starts.';

COMMENT ON COLUMN businesses.a2p_risk_review_findings IS
  'Sanitized support-visible findings only. Do not store EIN, SSN, representative data, or raw website content here.';

CREATE TABLE IF NOT EXISTS a2p_risk_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text,
  input_hash text,
  message text,
  findings jsonb,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE a2p_risk_review_events IS
  'Service-role audit log for Phase 8 A2P risk screening, review notifications, and admin overrides. No customer PII or raw website dumps.';

CREATE INDEX IF NOT EXISTS idx_a2p_risk_review_events_business_created
  ON a2p_risk_review_events (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_a2p_risk_review_events_hash_status
  ON a2p_risk_review_events (business_id, input_hash, status);

ALTER TABLE a2p_risk_review_events ENABLE ROW LEVEL SECURITY;

-- No RLS policies on purpose: regular customers should not read or write
-- support review audit rows. Server/service-role code bypasses RLS.

-- Backfill decision:
-- - Alpha Dog and any already-submitted account keep NULL risk status and stay
--   in carrier review because registration-started precedence is checked before
--   the risk gate.
-- - Bryan Develops and Engivations are not submitted; if they have reached
--   review_submit they are explicitly moved back to sms_use_case and must pass
--   the Phase 8 pre-submission gate.
UPDATE businesses
SET
  a2p_risk_review_status = 'not_started',
  a2p_risk_review_updated_at = COALESCE(a2p_risk_review_updated_at, now()),
  onboarding_step = CASE
    WHEN onboarding_step IN ('phone_number', 'review_submit') THEN 'sms_use_case'
    ELSE onboarding_step
  END,
  onboarding_last_saved_at = COALESCE(onboarding_last_saved_at, now())
WHERE a2p_risk_review_status IS NULL
  AND COALESCE(onboarding_registration_status, 'not_started') = 'not_started'
  AND telnyx_brand_id IS NULL
  AND brand_status IS NULL
  AND campaign_status IS NULL;

ALTER TABLE businesses
  ALTER COLUMN a2p_risk_review_status SET DEFAULT 'not_started';
