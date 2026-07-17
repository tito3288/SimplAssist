-- Support tickets submitted from the public /support page.
--
-- The form works logged-in and logged-out: user_id/business_id are derived
-- server-side when a session exists and are NULL otherwise. name/email are
-- the submitter's own typed values, deliberately denormalized so the ticket
-- remains actionable even when the account is later deleted (ON DELETE SET
-- NULL keeps the row — tickets are the operator's record, not the user's).
--
-- `notified` records whether the owner-notification email actually sent:
-- the Resend send is fire-and-forget (never fails the request), so the admin
-- tickets page flags rows whose notification silently failed.
--
-- Access model (hardened, 029-style): RLS enabled with ZERO policies and no
-- client-role grants — every write goes through the validated /api/support
-- route and every read through the requireAdminUser()-gated admin page, both
-- using the service role.

CREATE TABLE support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL CHECK (
    category IN ('billing', 'number_registration', 'bug', 'other')
  ),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  name text NOT NULL CHECK (char_length(name) <= 200),
  email text NOT NULL CHECK (char_length(email) <= 320),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new' CHECK (
    status IN ('new', 'in_progress', 'closed')
  ),
  notified boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_support_requests_created_at
  ON support_requests (created_at DESC);
CREATE INDEX idx_support_requests_open
  ON support_requests (status) WHERE status <> 'closed';
CREATE INDEX idx_support_requests_business
  ON support_requests (business_id) WHERE business_id IS NOT NULL;

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- No policies on purpose: no client role ever reads or writes this table.

-- Explicit grants (new tables get no auto-grants to Data API roles; see the
-- migration 025 note). Service role only — anon/authenticated get nothing.
REVOKE ALL ON support_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON support_requests TO service_role;
