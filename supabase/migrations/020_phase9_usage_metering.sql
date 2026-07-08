-- Phase 9: usage metering and SMS cap gates.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS sms_overage_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_overage_opted_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS sms_overage_opted_in_by text;

COMMENT ON COLUMN businesses.sms_overage_opt_in IS
  'When true, outbound SMS may continue beyond included parts and usage is billed at the configured overage rate.';

CREATE TABLE IF NOT EXISTS billing_usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  plan text NOT NULL DEFAULT 'sms_only' CHECK (plan IN ('sms_only','sms_and_chat','full')),
  included_sms_parts integer NOT NULL DEFAULT 0 CHECK (included_sms_parts >= 0),
  inbound_sms_parts integer NOT NULL DEFAULT 0 CHECK (inbound_sms_parts >= 0),
  outbound_sms_parts integer NOT NULL DEFAULT 0 CHECK (outbound_sms_parts >= 0),
  inbound_mms_events integer NOT NULL DEFAULT 0 CHECK (inbound_mms_events >= 0),
  outbound_mms_events integer NOT NULL DEFAULT 0 CHECK (outbound_mms_events >= 0),
  ai_input_tokens integer NOT NULL DEFAULT 0 CHECK (ai_input_tokens >= 0),
  ai_output_tokens integer NOT NULL DEFAULT 0 CHECK (ai_output_tokens >= 0),
  warning_80_sent_at timestamptz,
  hard_limit_reached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, period_start)
);

COMMENT ON TABLE billing_usage_periods IS
  'Per-business billing-period usage summary. SMS caps use inbound + outbound billable SMS parts.';

CREATE TABLE IF NOT EXISTS billing_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  usage_period_id uuid NOT NULL REFERENCES billing_usage_periods(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  channel text NOT NULL CHECK (channel IN ('sms','mms')),
  source text NOT NULL,
  sms_parts integer NOT NULL DEFAULT 0 CHECK (sms_parts >= 0),
  mms_events integer NOT NULL DEFAULT 0 CHECK (mms_events >= 0),
  provider_message_id text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE billing_usage_events IS
  'Idempotent usage ledger for billable SMS parts and MMS events. Use provider ids or deterministic source keys.';

CREATE INDEX IF NOT EXISTS idx_billing_usage_periods_business_period
  ON billing_usage_periods (business_id, period_start DESC);

CREATE INDEX IF NOT EXISTS idx_billing_usage_events_business_created
  ON billing_usage_events (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_usage_events_period
  ON billing_usage_events (usage_period_id);

ALTER TABLE billing_usage_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_usage_periods_select ON billing_usage_periods
  FOR SELECT USING (
    business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())
  );

-- No customer insert/update/delete policies. Service-role code writes usage.

CREATE OR REPLACE FUNCTION increment_billing_usage_period(
  p_usage_period_id uuid,
  p_direction text,
  p_channel text,
  p_sms_parts integer,
  p_mms_events integer
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE billing_usage_periods
  SET
    inbound_sms_parts = inbound_sms_parts + CASE WHEN p_direction = 'inbound' THEN p_sms_parts ELSE 0 END,
    outbound_sms_parts = outbound_sms_parts + CASE WHEN p_direction = 'outbound' THEN p_sms_parts ELSE 0 END,
    inbound_mms_events = inbound_mms_events + CASE WHEN p_direction = 'inbound' AND p_channel = 'mms' THEN p_mms_events ELSE 0 END,
    outbound_mms_events = outbound_mms_events + CASE WHEN p_direction = 'outbound' AND p_channel = 'mms' THEN p_mms_events ELSE 0 END,
    updated_at = now()
  WHERE id = p_usage_period_id;
END;
$$;
