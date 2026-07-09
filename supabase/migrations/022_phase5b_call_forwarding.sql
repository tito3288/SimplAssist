-- Phase 5b: programmatic Telnyx call forwarding.
-- Adds per-business forwarding settings and a service-role-only attempt table
-- for once-only missed-call fallback handling across voice webhook events.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS call_forwarding_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS forward_to_number text;

ALTER TABLE businesses
  DROP CONSTRAINT IF EXISTS businesses_forward_to_number_e164_check;

ALTER TABLE businesses
  ADD CONSTRAINT businesses_forward_to_number_e164_check
  CHECK (
    forward_to_number IS NULL
    OR forward_to_number ~ '^\+[1-9][0-9]{7,14}$'
  );

COMMENT ON COLUMN businesses.call_forwarding_enabled IS
  'When true, inbound voice calls are programmatically forwarded to forward_to_number before falling back to missed-call SMS.';

COMMENT ON COLUMN businesses.forward_to_number IS
  'E.164 phone number that receives forwarded calls for this business.';

CREATE TABLE IF NOT EXISTS call_forwarding_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  inbound_call_control_id text NOT NULL,
  outbound_call_control_id text,
  inbound_call_leg_id text,
  outbound_call_leg_id text,
  call_session_id text NOT NULL,
  caller_phone text NOT NULL,
  forward_to_number text NOT NULL,
  status text NOT NULL DEFAULT 'dialing'
    CHECK (status IN ('dialing', 'connected', 'abandoned', 'fallback_triggered', 'ended', 'error')),
  fallback_triggered_at timestamptz,
  abandoned_at timestamptz,
  connected_at timestamptz,
  ended_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (call_session_id)
);

CREATE INDEX IF NOT EXISTS idx_call_forwarding_attempts_business_id
  ON call_forwarding_attempts (business_id);

CREATE INDEX IF NOT EXISTS idx_call_forwarding_attempts_inbound_call_control_id
  ON call_forwarding_attempts (inbound_call_control_id);

CREATE INDEX IF NOT EXISTS idx_call_forwarding_attempts_outbound_call_control_id
  ON call_forwarding_attempts (outbound_call_control_id)
  WHERE outbound_call_control_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_forwarding_attempts_open
  ON call_forwarding_attempts (status, created_at)
  WHERE status IN ('dialing', 'connected');

DROP TRIGGER IF EXISTS set_updated_at_call_forwarding_attempts ON call_forwarding_attempts;

CREATE TRIGGER set_updated_at_call_forwarding_attempts
  BEFORE UPDATE ON call_forwarding_attempts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE call_forwarding_attempts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE call_forwarding_attempts IS
  'Internal Telnyx voice call-forwarding state. No customer RLS policies; service role only.';

COMMENT ON COLUMN call_forwarding_attempts.fallback_triggered_at IS
  'Set atomically before missed-call SMS fallback so multiple webhook events cannot send duplicate missed-call texts.';
