-- Phase 11 Option B: EIN-only launch branching.
--
-- This migration adds the minimum durable state needed to ask whether a
-- customer has an EIN, hold No-EIN customers before paid launch, and leave
-- future Sole Proprietor/OTP work as a separate migration.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS has_ein boolean,
  ADD COLUMN IF NOT EXISTS a2p_brand_tier text,
  ADD COLUMN IF NOT EXISTS no_ein_hold_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS no_ein_waitlist_requested_at timestamptz;

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_a2p_brand_tier_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_a2p_brand_tier_check
  CHECK (
    a2p_brand_tier IS NULL OR
    a2p_brand_tier IN ('low_volume_standard', 'sole_proprietor')
  );

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_no_ein_hold_status_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_no_ein_hold_status_check
  CHECK (
    no_ein_hold_status IN (
      'none',
      'ein_encouraged',
      'waitlisted',
      'converted_to_ein'
    )
  );

UPDATE businesses
SET has_ein = true
WHERE ein IS NOT NULL
  AND has_ein IS NULL;

UPDATE businesses
SET a2p_brand_tier = 'low_volume_standard'
WHERE telnyx_brand_id IS NOT NULL
  AND a2p_brand_tier IS NULL;

COMMENT ON COLUMN businesses.has_ein IS
  'Phase 11 EIN branch answer. Runtime launch gates fail closed unless this is explicitly true.';

COMMENT ON COLUMN businesses.a2p_brand_tier IS
  'TCR/A2P brand classification, not SimplAssist subscription tier. Sole Proprietor remains orthogonal to $25/$45/$65 plans.';

COMMENT ON COLUMN businesses.no_ein_hold_status IS
  'Phase 11 Option B No-EIN hold state. No Sole Proprietor registration or OTP code ships with this migration.';

COMMENT ON COLUMN businesses.no_ein_waitlist_requested_at IS
  'Timestamp for customer-initiated No-EIN waitlist/notify-me confirmation. On-screen confirmation only in Phase 11 Option B.';

COMMENT ON COLUMN businesses.last_4_ssn IS
  'PII: last 4 digits of SSN, written only on the future Sole-Proprietor brand registration path. Must NOT be returned by standard businesses queries.';

COMMENT ON COLUMN businesses.registrant_mobile IS
  'PII: Sole Proprietor registrant mobile number for future SMS OTP verification. Must NOT be returned by standard businesses queries.';
