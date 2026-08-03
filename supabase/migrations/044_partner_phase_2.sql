BEGIN;

-- Partner sender identity is private configuration. email_from is deliberately
-- one canonical mailbox address, never an untrusted RFC 5322 display header.
ALTER TABLE public.partners
  ADD COLUMN email_from_status text NOT NULL DEFAULT 'unconfigured'
    CHECK (email_from_status IN ('unconfigured', 'pending', 'verified')),
  ADD COLUMN email_from_verified_at timestamptz,
  ADD COLUMN email_from_verified_by uuid;

UPDATE public.partners
SET email_from = lower(btrim(email_from)),
    email_from_status = 'pending',
    email_from_verified_at = NULL,
    email_from_verified_by = NULL
WHERE email_from IS NOT NULL;

ALTER TABLE public.partners
  ADD CONSTRAINT partners_email_from_mailbox
    CHECK (
      email_from IS NULL OR (
        email_from = lower(btrim(email_from))
        AND length(email_from) <= 254
        AND email_from !~ '[[:cntrl:][:space:],<>]'
        AND email_from ~
          '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      )
    ),
  ADD CONSTRAINT partners_email_from_state
    CHECK (
      (
        email_from IS NULL
        AND email_from_status = 'unconfigured'
        AND email_from_verified_at IS NULL
        AND email_from_verified_by IS NULL
      )
      OR
      (
        email_from IS NOT NULL
        AND email_from_status = 'pending'
        AND email_from_verified_at IS NULL
        AND email_from_verified_by IS NULL
      )
      OR
      (
        email_from IS NOT NULL
        AND email_from_status = 'verified'
        AND email_from_verified_at IS NOT NULL
        AND email_from_verified_by IS NOT NULL
      )
    );

COMMENT ON COLUMN public.partners.email_from IS
  'Canonical lowercase mailbox used only after sender verification; no display name or mail header syntax.';
COMMENT ON COLUMN public.partners.email_from_status IS
  'Manual Resend sender-verification state: unconfigured, pending, or verified.';
COMMENT ON COLUMN public.partners.email_from_verified_at IS
  'Timestamp when an administrator manually confirmed the current sender address.';
COMMENT ON COLUMN public.partners.email_from_verified_by IS
  'Administrator auth user that manually confirmed the current sender address.';

ALTER TABLE public.businesses
  ADD COLUMN partner_plan text;

-- Refuse to migrate an impossible authority split. Any subscription row,
-- including a canceled row, remains Stripe authority and must be reconciled
-- before a business can be partner-managed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    JOIN public.subscriptions AS subscription
      ON subscription.business_id = business.id
    WHERE business.billing_mode IN ('invoiced', 'comped')
  ) THEN
    RAISE EXCEPTION
      'Migration 044 found a subscription row on a non-Stripe business';
  END IF;
END;
$$;

-- Clean only Phase 1 non-Stripe assignments. Stripe-mode pilot, comped, and
-- exempt flags (including migration-019 Alpha Dog fixtures) are deliberately
-- outside this mutation and retain their existing entitlement behavior.
UPDATE public.businesses
SET partner_plan = 'sms_and_chat',
    billing_comped = false,
    billing_pilot = false,
    billing_exempt = false,
    updated_at = now()
WHERE billing_mode IN ('invoiced', 'comped');

-- The active usage row is a snapshot of the selected plan. Limit this
-- backfill to the same non-Stripe authority boundary as the business cleanup.
UPDATE public.billing_usage_periods AS period
SET plan = 'sms_and_chat',
    included_sms_parts = 1500,
    updated_at = now()
FROM public.businesses AS business
WHERE period.business_id = business.id
  AND business.billing_mode IN ('invoiced', 'comped')
  AND period.period_start <= now()
  AND period.period_end > now();

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_partner_plan_valid
    CHECK (
      partner_plan IS NULL
      OR partner_plan IN ('sms_only', 'sms_and_chat', 'full')
    ),
  ADD CONSTRAINT businesses_partner_plan_matches_mode
    CHECK (
      (
        billing_mode = 'stripe'
        AND partner_plan IS NULL
      )
      OR
      (
        billing_mode IN ('invoiced', 'comped')
        AND partner_plan IS NOT NULL
      )
    );

COMMENT ON COLUMN public.businesses.partner_plan IS
  'Plan entitlement selected by a partner for invoiced or comped billing; NULL in Stripe mode.';

-- Preserve the complete migration-043 customer authorization boundary and add
-- partner_plan. Trusted migration/admin/service-role writes bypass this
-- trigger; customer Data API roles cannot grant or alter plan authority.
CREATE OR REPLACE FUNCTION public.guard_business_billing_authorization_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.billing_pilot IS DISTINCT FROM false
       OR NEW.billing_comped IS DISTINCT FROM false
       OR NEW.billing_exempt IS DISTINCT FROM false
       OR NEW.sms_overage_opt_in IS DISTINCT FROM false
       OR NEW.sms_overage_opted_in_at IS NOT NULL
       OR NEW.sms_overage_opted_in_by IS NOT NULL
       OR NEW.telnyx_submission_disabled IS DISTINCT FROM false
       OR NEW.billing_admin_notes IS NOT NULL
       OR NEW.billing_flags_updated_at IS NOT NULL
       OR NEW.billing_flags_updated_by IS NOT NULL
       OR NEW.partner_id IS NOT NULL
       OR NEW.billing_mode IS DISTINCT FROM 'stripe'
       OR NEW.partner_plan IS NOT NULL THEN
      RAISE EXCEPTION 'customer writes cannot set protected business billing fields'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.billing_pilot IS DISTINCT FROM OLD.billing_pilot
     OR NEW.billing_comped IS DISTINCT FROM OLD.billing_comped
     OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
     OR NEW.sms_overage_opt_in IS DISTINCT FROM OLD.sms_overage_opt_in
     OR NEW.sms_overage_opted_in_at IS DISTINCT FROM OLD.sms_overage_opted_in_at
     OR NEW.sms_overage_opted_in_by IS DISTINCT FROM OLD.sms_overage_opted_in_by
     OR NEW.telnyx_submission_disabled IS DISTINCT FROM OLD.telnyx_submission_disabled
     OR NEW.billing_admin_notes IS DISTINCT FROM OLD.billing_admin_notes
     OR NEW.billing_flags_updated_at IS DISTINCT FROM OLD.billing_flags_updated_at
     OR NEW.billing_flags_updated_by IS DISTINCT FROM OLD.billing_flags_updated_by
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
     OR NEW.partner_plan IS DISTINCT FROM OLD.partner_plan THEN
    RAISE EXCEPTION 'customer writes cannot change protected business billing fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_business_billing_authorization_fields()
  FROM PUBLIC, anon, authenticated, service_role;

-- Replace the Phase 1 four-argument identity with a default-compatible fifth
-- plan argument. PostgreSQL/PostgREST callers may continue omitting the final
-- argument while new callers select an explicit partner plan.
DROP FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid
);

CREATE FUNCTION public.assign_business_partner_billing(
  p_business_id uuid,
  p_partner_id uuid,
  p_billing_mode text,
  p_actor_user_id uuid,
  p_partner_plan text DEFAULT NULL
) RETURNS TABLE (
  business_id uuid,
  partner_id uuid,
  billing_mode text,
  partner_plan text,
  billing_comped boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_partner_status text;
  v_partner_domain_status text;
  v_partner_custom_domain text;
  v_resolved_partner_plan text;
BEGIN
  -- Keep the approved business-first transition lock. It serializes partner
  -- assignment with Stripe synchronization for one tenant.
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_billing_mode IS NULL
     OR p_billing_mode NOT IN ('stripe', 'invoiced', 'comped') THEN
    RAISE EXCEPTION 'invalid_billing_mode'
      USING ERRCODE = '22023';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_partner_plan IS NOT NULL
     AND p_partner_plan NOT IN ('sms_only', 'sms_and_chat', 'full') THEN
    RAISE EXCEPTION 'invalid_partner_plan'
      USING ERRCODE = '22023';
  END IF;

  IF p_billing_mode = 'stripe' AND p_partner_plan IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_partner_plan'
      USING ERRCODE = '22023';
  END IF;

  IF p_partner_id IS NOT NULL THEN
    -- NOWAIT preserves migration 043's deadlock avoidance: partner deletion
    -- locks partner then applies business ON DELETE SET NULL, whereas this RPC
    -- has already locked business. Contention fails closed instead of reversing
    -- that lock order.
    BEGIN
      SELECT
        partner.status,
        partner.domain_status,
        partner.custom_domain
      INTO
        v_partner_status,
        v_partner_domain_status,
        v_partner_custom_domain
      FROM public.partners AS partner
      WHERE partner.id = p_partner_id
      FOR SHARE NOWAIT;
    EXCEPTION
      WHEN lock_not_available THEN
        RAISE EXCEPTION 'partner_inactive'
          USING ERRCODE = '55000';
    END;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'partner_inactive'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF p_billing_mode IN ('invoiced', 'comped') THEN
    IF p_partner_id IS NULL THEN
      RAISE EXCEPTION 'partner_required'
        USING ERRCODE = '22004';
    END IF;

    IF v_partner_status <> 'active'
       OR v_partner_domain_status <> 'connected'
       OR v_partner_custom_domain IS NULL
       OR v_partner_custom_domain <> lower(v_partner_custom_domain)
       OR length(v_partner_custom_domain) > 253
       OR v_partner_custom_domain !~
         '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' THEN
      RAISE EXCEPTION 'partner_inactive'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.subscriptions AS subscription
      WHERE subscription.business_id = v_business.id
    ) THEN
      RAISE EXCEPTION 'subscription_exists'
        USING ERRCODE = '55000';
    END IF;

    v_resolved_partner_plan := CASE
      WHEN p_partner_plan IS NOT NULL THEN p_partner_plan
      WHEN v_business.billing_mode IN ('invoiced', 'comped')
        AND v_business.partner_id = p_partner_id
        AND v_business.partner_plan IN ('sms_only', 'sms_and_chat', 'full')
        THEN v_business.partner_plan
      ELSE 'sms_and_chat'
    END;
  ELSE
    v_resolved_partner_plan := NULL;
  END IF;

  UPDATE public.businesses AS business
  SET partner_id = p_partner_id,
      billing_mode = p_billing_mode,
      partner_plan = v_resolved_partner_plan,
      billing_pilot = CASE
        WHEN p_billing_mode IN ('invoiced', 'comped')
          OR v_business.billing_mode IN ('invoiced', 'comped') THEN false
        ELSE v_business.billing_pilot
      END,
      billing_comped = CASE
        WHEN p_billing_mode IN ('invoiced', 'comped')
          OR v_business.billing_mode IN ('invoiced', 'comped') THEN false
        ELSE v_business.billing_comped
      END,
      billing_exempt = CASE
        WHEN p_billing_mode IN ('invoiced', 'comped')
          OR v_business.billing_mode IN ('invoiced', 'comped') THEN false
        ELSE v_business.billing_exempt
      END,
      billing_flags_updated_at = now(),
      billing_flags_updated_by = p_actor_user_id::text
  WHERE business.id = v_business.id
  RETURNING business.* INTO v_business;

  RETURN QUERY
  SELECT
    v_business.id,
    v_business.partner_id,
    v_business.billing_mode,
    v_business.partner_plan,
    v_business.billing_comped;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid, text
) TO service_role;

COMMENT ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid, text
) IS
  'Service-role-only atomic partner, billing-mode, and partner-plan transition without legacy entitlement bridges.';

-- Preserve migration 029's complete Stripe upsert behavior. The shared
-- business lock makes the Stripe-mode check serialize with the assignment RPC.
CREATE OR REPLACE FUNCTION public.sync_stripe_subscription_if_business_active(
  p_business_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_plan text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_stripe_price_id text,
  p_stripe_setup_fee_price_id text,
  p_stripe_checkout_session_id text,
  p_setup_fee_paid_at timestamptz,
  p_cancel_at_period_end boolean,
  p_updated_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_subscription_id uuid;
BEGIN
  IF p_stripe_customer_id IS NULL OR btrim(p_stripe_customer_id) = ''
     OR p_stripe_subscription_id IS NULL OR btrim(p_stripe_subscription_id) = ''
     OR p_plan IS NULL
     OR p_plan NOT IN ('sms_only', 'sms_and_chat', 'full')
     OR p_status IS NULL
     OR p_status NOT IN ('active', 'past_due', 'canceled', 'trialing') THEN
    RAISE EXCEPTION 'invalid Stripe subscription sync payload'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
    AND business.billing_mode = 'stripe'
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.subscriptions (
    business_id,
    stripe_customer_id,
    stripe_subscription_id,
    plan,
    status,
    current_period_start,
    current_period_end,
    stripe_price_id,
    stripe_setup_fee_price_id,
    stripe_checkout_session_id,
    setup_fee_paid_at,
    cancel_at_period_end,
    pending_plan,
    updated_at
  ) VALUES (
    p_business_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_plan,
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_stripe_price_id,
    p_stripe_setup_fee_price_id,
    p_stripe_checkout_session_id,
    p_setup_fee_paid_at,
    COALESCE(p_cancel_at_period_end, false),
    NULL,
    COALESCE(p_updated_at, now())
  )
  ON CONFLICT (business_id) DO UPDATE
  SET stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_subscription_id = EXCLUDED.stripe_subscription_id,
      plan = EXCLUDED.plan,
      status = EXCLUDED.status,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      stripe_price_id = EXCLUDED.stripe_price_id,
      stripe_setup_fee_price_id = COALESCE(
        EXCLUDED.stripe_setup_fee_price_id,
        subscriptions.stripe_setup_fee_price_id
      ),
      stripe_checkout_session_id = COALESCE(
        EXCLUDED.stripe_checkout_session_id,
        subscriptions.stripe_checkout_session_id
      ),
      setup_fee_paid_at = COALESCE(
        EXCLUDED.setup_fee_paid_at,
        subscriptions.setup_fee_paid_at
      ),
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      pending_plan = NULL,
      updated_at = EXCLUDED.updated_at
  RETURNING id INTO v_subscription_id;

  RETURN v_subscription_id IS NOT NULL;
END;
$$;

-- Preserve migration 029's past-due behavior while refusing to mutate a
-- non-Stripe tenant. Repeat the mode predicate in the UPDATE as a final guard.
CREATE OR REPLACE FUNCTION public.mark_stripe_subscription_past_due_if_business_active(
  p_stripe_customer_id text,
  p_updated_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  IF p_stripe_customer_id IS NULL OR btrim(p_stripe_customer_id) = '' THEN
    RAISE EXCEPTION 'Stripe customer id is required'
      USING ERRCODE = '22004';
  END IF;

  PERFORM business.id
  FROM public.businesses AS business
  JOIN public.subscriptions AS subscription
    ON subscription.business_id = business.id
  WHERE subscription.stripe_customer_id = p_stripe_customer_id
    AND business.deleted_at IS NULL
    AND business.billing_mode = 'stripe'
  FOR SHARE OF business;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE public.subscriptions AS subscription
  SET status = 'past_due',
      updated_at = COALESCE(p_updated_at, now())
  FROM public.businesses AS business
  WHERE subscription.business_id = business.id
    AND subscription.stripe_customer_id = p_stripe_customer_id
    AND business.deleted_at IS NULL
    AND business.billing_mode = 'stripe';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_stripe_subscription_if_business_active(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text,
  timestamptz, boolean, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.mark_stripe_subscription_past_due_if_business_active(
  text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_stripe_subscription_if_business_active(
  uuid, text, text, text, text, timestamptz, timestamptz, text, text, text,
  timestamptz, boolean, timestamptz
) TO service_role;

GRANT EXECUTE ON FUNCTION public.mark_stripe_subscription_past_due_if_business_active(
  text, timestamptz
) TO service_role;

-- Durable, resumable concierge provisioning state. This is operational data,
-- not a customer-visible resource, and therefore has no anon/auth policies.
CREATE TABLE public.partner_client_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  requested_business_name text NOT NULL
    CHECK (btrim(requested_business_name) <> ''),
  partner_id uuid NOT NULL
    REFERENCES public.partners(id) ON DELETE RESTRICT,
  billing_mode text NOT NULL
    CHECK (billing_mode IN ('invoiced', 'comped')),
  partner_plan text NOT NULL DEFAULT 'sms_and_chat'
    CHECK (partner_plan IN ('sms_only', 'sms_and_chat', 'full')),

  auth_user_id uuid UNIQUE
    REFERENCES auth.users(id) ON DELETE SET NULL,
  business_id uuid UNIQUE
    REFERENCES public.businesses(id) ON DELETE SET NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (
      status IN (
        'pending',
        'admin_setup',
        'auth_created',
        'business_prepared',
        'assigned',
        'invite_pending',
        'setup_email_sent',
        'needs_attention'
      )
    ),
  last_error_code text,
  setup_email_sent_at timestamptz,
  invite_attempt_count integer NOT NULL DEFAULT 0
    CHECK (invite_attempt_count >= 0),
  created_by_admin_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT provisioning_email_canonical
    CHECK (
      email = lower(btrim(email))
      AND length(email) <= 254
      AND email !~ '[[:cntrl:][:space:],<>]'
      AND email ~
        '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
);

CREATE INDEX partner_client_provisioning_jobs_status_idx
  ON public.partner_client_provisioning_jobs (status, updated_at);

CREATE TRIGGER set_updated_at_partner_client_provisioning_jobs
BEFORE UPDATE ON public.partner_client_provisioning_jobs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.partner_client_provisioning_jobs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.partner_client_provisioning_jobs
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.partner_client_provisioning_jobs
  TO service_role;

COMMENT ON TABLE public.partner_client_provisioning_jobs IS
  'Service-role-only resumable state for admin-created partner client accounts.';

COMMIT;
