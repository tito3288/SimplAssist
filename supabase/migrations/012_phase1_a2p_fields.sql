-- Phase 1 of per-customer A2P 10DLC registration: onboarding data collection.
-- See project_post_isv_roadmap.md (Phase 1) for full scope.
--
-- This migration only adds columns to capture the data Telnyx's 10DLC brand
-- API will need at registration time (Phase 3). No API calls or registration
-- logic land in this migration -- pure "collect and persist."
--
-- All columns are nullable so the auto-created businesses row at signup
-- (handle_new_user trigger, see migration 001) remains valid. The new
-- Brand Verification onboarding step writes these fields after the user
-- completes Step 1 (Business Info) and reaches the inserted Step 5.
--
-- Sole-Proprietor placeholder columns (last_4_ssn, registrant_mobile, plus
-- the 'sole_proprietor' / 'ssn_last_4' enum values) are added now to avoid a
-- second migration in Phase 11. They remain unwritten until Phase 11 wires
-- the EIN-vs-SSN branching UX and the Telnyx OTP API trio.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS legal_business_name text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_entity_type text
  CHECK (business_entity_type IN ('llc', 'c_corp', 's_corp', 'nonprofit', 'partnership', 'sole_proprietor'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_registration_state text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS tax_id_type text
  CHECK (tax_id_type IN ('ein', 'ssn_last_4'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ein text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_4_ssn text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS registrant_mobile text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS authorized_rep_name text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS authorized_rep_title text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS authorized_rep_email text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS authorized_rep_phone text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS use_case_description text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS sample_messages text[];
-- estimated_monthly_volume: no CHECK constraint in Phase 1. Phase 3 will verify
-- canonical band values against the Telnyx 10DLC brand API and add the CHECK in
-- a separate migration. Retrofitting CHECK constraints onto populated columns
-- is painful; defer.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS estimated_monthly_volume text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS opt_in_description text;
-- Set ONCE on first submission of the Brand Verification step. Phase 3 reads
-- this as a "has completed compliance step" boolean flag, not a last-modified
-- marker. The form layer enforces set-once semantics; do not add an
-- on-update trigger.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS compliance_info_completed_at timestamptz;

COMMENT ON COLUMN businesses.last_4_ssn IS
  'PII: last 4 digits of SSN, written only on the Sole-Proprietor brand registration path (Phase 11). Must NOT be returned by standard businesses queries -- Phase 11 will introduce a dedicated access helper for the Telnyx OTP flow. Standard select() callers should explicitly project columns rather than using select(*).';

COMMENT ON COLUMN businesses.ein IS
  'PII: federal Employer Identification Number, format XX-XXXXXXX. Used for TCR brand registration on the EIN path.';

COMMENT ON COLUMN businesses.compliance_info_completed_at IS
  'Set once on first completion of the Brand Verification onboarding step. Phase 3 uses this as a gate for triggering Telnyx brand registration. Do not overwrite on subsequent edits.';
