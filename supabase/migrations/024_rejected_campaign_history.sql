-- History of Telnyx campaigns archived after carrier rejection.
--
-- When a retry replaces a rejected campaign, the old campaign's ID and
-- rejection details are preserved here before businesses.telnyx_campaign_id
-- is repointed, and the Telnyx-side deactivation outcome is recorded
-- (deactivation is best-effort; failures are logged for manual cleanup).
--
-- Writes are service-role only (RLS enabled, no INSERT/UPDATE/DELETE
-- policies). Owners may read their own history.

CREATE TABLE rejected_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  telnyx_campaign_id text NOT NULL,
  rejection_reason text,
  telnyx_deactivated boolean DEFAULT false,
  deactivation_error text,
  archived_at timestamptz DEFAULT now()
);

-- Unique: a campaign is archived at most once per business (re-runs of the
-- recovery helper reuse the row); the composite index also serves
-- business_id-prefix lookups.
CREATE UNIQUE INDEX idx_rejected_campaigns_business_campaign
  ON rejected_campaigns(business_id, telnyx_campaign_id);

ALTER TABLE rejected_campaigns ENABLE ROW LEVEL SECURITY;

-- Owners can read their own history; all client-role writes are denied
-- (no insert/update/delete policies — the retry pipeline writes via the
-- service role, which bypasses RLS).
CREATE POLICY rejected_campaigns_select ON rejected_campaigns
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );
