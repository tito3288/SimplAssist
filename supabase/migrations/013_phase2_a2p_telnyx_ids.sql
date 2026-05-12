-- Phase 2 of per-customer A2P 10DLC registration: Telnyx resource IDs + status.
-- See project_post_isv_roadmap.md (Phase 2) and plan
-- starting-phase-2-of-wiggly-waffle.md for full scope.
--
-- Pure schema migration. No API calls. No business logic. Phase 3 will
-- populate the resource ID columns after Telnyx 10DLC API calls succeed;
-- Phase 4's status webhook will update the *_status columns and append to
-- telnyx_registration_events as carriers approve/reject.
--
-- All columns nullable so existing businesses rows remain valid. NULL on a
-- *_id or *_status column means "not yet registered."

-- ============================================================================
-- A. Telnyx resource IDs on businesses
-- ============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telnyx_brand_id text UNIQUE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telnyx_campaign_id text UNIQUE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telnyx_messaging_profile_id text UNIQUE;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS telnyx_voice_application_id text UNIQUE;

COMMENT ON COLUMN businesses.telnyx_brand_id IS
  'TCR brand ID returned by POST /v2/10dlc/brand. Written once by Phase 3 after successful registration. Used by Phase 4 webhook handler to map incoming Telnyx events back to this business.';

COMMENT ON COLUMN businesses.telnyx_campaign_id IS
  'TCR campaign ID returned by POST /v2/10dlc/campaign. Written once by Phase 3 after the campaign is created under telnyx_brand_id. Customer-facing SMS sends are gated on campaign_status = ''approved''.';

COMMENT ON COLUMN businesses.telnyx_messaging_profile_id IS
  'Per-customer Telnyx messaging profile UUID. Distinct from the shared SimplAssist env var TELNYX_MESSAGING_PROFILE_ID (40019df3-...), which is reserved for SimplAssist''s own outbound. Phase 3 send-path refactor: every customer-to-end-consumer telnyx.messages.send() must look up this column via phone_numbers -> businesses and pass it as messaging_profile_id.';

COMMENT ON COLUMN businesses.telnyx_voice_application_id IS
  'Per-customer Telnyx Voice API Application / Connection ID. Telnyx terminology drifts between "Voice API Application", "Call Control Application", and "Connection ID" -- store whatever the create-application API returns. Voice has no TCR compliance requirement; per-customer isolation is for routing/reporting symmetry.';

-- ============================================================================
-- B. Async approval state (brand + campaign only -- profile + voice creation
--    are synchronous on Telnyx, so no status needed for those)
-- ============================================================================
-- Three-value enum: pending/approved/rejected. Telnyx brand lifecycle is
-- PENDING -> VERIFIED/UNVERIFIED; campaign is PENDING -> APPROVED/REJECTED.
-- Phase 4 webhook handler maps Telnyx-native states into these buckets. If a
-- meaningful intermediate state surfaces in real traffic, a follow-up
-- migration can extend the CHECK.

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_status text
  CHECK (brand_status IN ('pending','approved','rejected'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_status_updated_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS brand_rejection_reason text;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS campaign_status text
  CHECK (campaign_status IN ('pending','approved','rejected'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS campaign_status_updated_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS campaign_rejection_reason text;

COMMENT ON COLUMN businesses.brand_status IS
  'NULL = not submitted yet. Phase 3 transitions NULL -> pending on first registerBrand() call. Phase 4 webhook updates to approved/rejected based on Telnyx callbacks.';

COMMENT ON COLUMN businesses.campaign_status IS
  'NULL = not submitted yet. Customer-facing SMS sends should be gated on campaign_status = ''approved''. AT&T / T-Mobile / Verizon individually review and approval typically takes 1-5 days.';

-- ============================================================================
-- C. Audit table: telnyx_registration_events
-- ============================================================================
-- Persistent log of every Telnyx 10DLC interaction (Phase 3 API calls and
-- Phase 4 webhook deliveries). Without this, debugging a customer's failed
-- brand registration requires scraping Railway logs.
--
-- event_type is intentionally unconstrained text (no CHECK) so Phase 4/11 can
-- introduce new event types without an ALTER. App-side discipline lives in
-- src/types/database.ts via the TELNYX_EVENT_TYPES const + TelnyxEventType
-- union -- write through that constant to keep audit logs typo-free.

CREATE TABLE IF NOT EXISTS telnyx_registration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  telnyx_resource_type text
    CHECK (telnyx_resource_type IN ('brand','campaign','messaging_profile','voice_application')),
  telnyx_resource_id text,
  status text,
  rejection_reason text,
  raw_payload jsonb,
  created_at timestamptz DEFAULT now()
);

COMMENT ON TABLE telnyx_registration_events IS
  'Audit log of Telnyx 10DLC API requests/responses and incoming status webhooks. Service-role writes only.';

COMMENT ON COLUMN telnyx_registration_events.event_type IS
  'See TELNYX_EVENT_TYPES in src/types/database.ts for the canonical app-side enum. DB stays unconstrained so future phases can add types without a migration.';

COMMENT ON COLUMN telnyx_registration_events.raw_payload IS
  'Full Telnyx API response body or webhook payload. PII-bearing fields may be present -- restrict UI exposure to support staff only.';

CREATE INDEX IF NOT EXISTS idx_telnyx_events_business_created
  ON telnyx_registration_events (business_id, created_at DESC);

-- ============================================================================
-- D. Row Level Security on telnyx_registration_events
-- ============================================================================
-- SELECT: business owner can read events for their own business.
-- INSERT/UPDATE/DELETE: no policy -- service-role (Phase 3/4 server code)
-- bypasses RLS. Regular users cannot write audit events.

ALTER TABLE telnyx_registration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view their telnyx registration events"
  ON telnyx_registration_events FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
