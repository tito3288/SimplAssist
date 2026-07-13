-- History of Telnyx brands archived after carrier rejection.
--
-- When a retry replaces a rejected brand, the old brand's ID and
-- rejection details are preserved here before businesses.telnyx_brand_id
-- is repointed, and the Telnyx-side deletion outcome is recorded
-- (deletion is best-effort; failures are logged for manual cleanup).
-- Brands are deleted at Telnyx — there is no brand deactivate API, and
-- deletion requires the brand's campaigns to be deactivated first, so
-- the recovery helper archives the child campaign before attempting it.
--
-- Writes are service-role only (RLS enabled, no INSERT/UPDATE/DELETE
-- policies). Owners may read their own history.

CREATE TABLE rejected_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  telnyx_brand_id text NOT NULL,
  rejection_reason text,
  telnyx_deleted boolean DEFAULT false,
  deletion_error text,
  archived_at timestamptz DEFAULT now()
);

-- Unique: a brand is archived at most once per business (re-runs of the
-- recovery helper reuse the row); the composite index also serves
-- business_id-prefix lookups.
CREATE UNIQUE INDEX idx_rejected_brands_business_brand
  ON rejected_brands(business_id, telnyx_brand_id);

ALTER TABLE rejected_brands ENABLE ROW LEVEL SECURITY;

-- Owners can read their own history; all client-role writes are denied
-- (no insert/update/delete policies — the retry pipeline writes via the
-- service role, which bypasses RLS).
CREATE POLICY rejected_brands_select ON rejected_brands
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

-- Explicit grants: new tables are no longer auto-exposed to the Data API
-- roles (the pre-2026 auto-grant default is removed; earlier tables like
-- rejected_campaigns still carry legacy auto-grants). authenticated gets
-- SELECT only — client writes are denied at the grant level as well as by
-- RLS. anon gets nothing. The service role performs all writes.
GRANT SELECT ON rejected_brands TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rejected_brands TO service_role;
