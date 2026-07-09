-- Phase 9: billing launch gate, Stripe webhook dedupe, pending number selection,
-- and internal billing/account flags used by Phase 8.5 admin.

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS pending_phone_number text,
  ADD COLUMN IF NOT EXISTS pending_phone_number_area_code text,
  ADD COLUMN IF NOT EXISTS pending_phone_number_selected_at timestamptz,
  ADD COLUMN IF NOT EXISTS pending_phone_number_failure_reason text,
  ADD COLUMN IF NOT EXISTS billing_pilot boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_comped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_exempt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS telnyx_submission_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_admin_notes text,
  ADD COLUMN IF NOT EXISTS billing_flags_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS billing_flags_updated_by text;

COMMENT ON COLUMN businesses.pending_phone_number IS
  'Phase 9 selected phone number preference. This is not a reservation; Telnyx purchase happens only after paid checkout and campaign submit.';

COMMENT ON COLUMN businesses.pending_phone_number_failure_reason IS
  'Customer-safe reason why paid launch could not purchase the selected pending number. Customer can reselect without a second charge.';

COMMENT ON COLUMN businesses.billing_pilot IS
  'Internal Phase 9 flag for free/pilot accounts that should not look like broken subscriptions.';

COMMENT ON COLUMN businesses.billing_comped IS
  'Internal Phase 9 flag for accounts intentionally comped by SimplAssist.';

COMMENT ON COLUMN businesses.billing_exempt IS
  'Internal Phase 9 flag for accounts exempt from normal billing gates while still recording usage.';

COMMENT ON COLUMN businesses.telnyx_submission_disabled IS
  'Defense-in-depth kill switch: when true, no paid Telnyx/TCR submission or number purchase should run for this business.';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_setup_fee_price_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS setup_fee_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_plan text CHECK (
    pending_plan IS NULL OR pending_plan IN ('sms_only','sms_and_chat','full')
  ),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

COMMENT ON COLUMN subscriptions.stripe_price_id IS
  'Stripe recurring plan Price ID observed from checkout/subscription webhooks.';

COMMENT ON COLUMN subscriptions.stripe_setup_fee_price_id IS
  'Stripe one-time setup fee Price ID charged at initial onboarding checkout.';

COMMENT ON COLUMN subscriptions.stripe_checkout_session_id IS
  'Initial onboarding Checkout Session ID, used for finalize/webhook idempotency and support lookup.';

COMMENT ON COLUMN subscriptions.setup_fee_paid_at IS
  'Set when the onboarding Checkout Session with setup fee completes.';

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text
);

COMMENT ON TABLE stripe_webhook_events IS
  'Idempotency table for Stripe webhook events. Insert event.id before processing; duplicate ids are ignored.';

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription
  ON subscriptions (stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_businesses_pending_phone_number
  ON businesses (pending_phone_number)
  WHERE pending_phone_number IS NOT NULL;

-- Best-effort fixture backfill. Exact names are intentionally used only for
-- local/internal launch safety; real customer controls live in /admin.
UPDATE businesses
SET
  billing_pilot = true,
  billing_exempt = true,
  billing_flags_updated_at = COALESCE(billing_flags_updated_at, now()),
  billing_admin_notes = COALESCE(
    billing_admin_notes,
    'Phase 9 backfill: Alpha Dog pilot/billing-exempt until paid conversion.'
  )
WHERE lower(name) LIKE '%alpha dog%';

UPDATE businesses
SET
  telnyx_submission_disabled = true,
  billing_flags_updated_at = COALESCE(billing_flags_updated_at, now()),
  billing_admin_notes = COALESCE(
    billing_admin_notes,
    'Phase 9 backfill: fake-EIN/internal test fixture; never submit to Telnyx/TCR.'
  )
WHERE lower(name) LIKE '%bryan develops%';

UPDATE businesses
SET
  billing_admin_notes = COALESCE(
    billing_admin_notes,
    'Phase 9 backfill: unpaid/not-submitted fixture; require Phase 8 clearance and checkout before Telnyx submission.'
  ),
  billing_flags_updated_at = COALESCE(billing_flags_updated_at, now())
WHERE lower(name) LIKE '%engivations%';
