BEGIN;

-- Partner presentation is private configuration. Public request handlers read
-- it only through trusted server code; customer roles receive no table policy
-- or privilege.
CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL
    CHECK (btrim(name) <> ''),

  slug text NOT NULL UNIQUE
    CHECK (
      length(slug) BETWEEN 1 AND 63
      AND slug = lower(slug)
      AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
    ),

  custom_domain text UNIQUE,

  domain_status text NOT NULL DEFAULT 'pending'
    CHECK (domain_status IN ('pending', 'connected')),

  logo_light_url text,
  logo_dark_url text,
  favicon_url text,

  brand_primary text NOT NULL DEFAULT '#ea580c',
  brand_primary_hover text NOT NULL DEFAULT '#c2410c',
  brand_primary_active text NOT NULL DEFAULT '#9a3412',
  brand_accent text NOT NULL DEFAULT '#c2410c',

  brand_primary_dark text NOT NULL DEFAULT '#ff914d',
  brand_primary_hover_dark text NOT NULL DEFAULT '#f57f33',
  brand_primary_active_dark text NOT NULL DEFAULT '#e8752c',
  brand_accent_dark text NOT NULL DEFAULT '#ff914d',

  email_from text,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partners_connected_domain_required
    CHECK (domain_status <> 'connected' OR custom_domain IS NOT NULL),

  CONSTRAINT partners_custom_domain_canonical
    CHECK (
      custom_domain IS NULL OR (
        custom_domain = lower(custom_domain)
        AND length(custom_domain) <= 253
        AND custom_domain ~
          '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      )
    ),

  CONSTRAINT partners_brand_colors_hex
    CHECK (
      brand_primary ~* '^#[0-9a-f]{6}$'
      AND brand_primary_hover ~* '^#[0-9a-f]{6}$'
      AND brand_primary_active ~* '^#[0-9a-f]{6}$'
      AND brand_accent ~* '^#[0-9a-f]{6}$'
      AND brand_primary_dark ~* '^#[0-9a-f]{6}$'
      AND brand_primary_hover_dark ~* '^#[0-9a-f]{6}$'
      AND brand_primary_active_dark ~* '^#[0-9a-f]{6}$'
      AND brand_accent_dark ~* '^#[0-9a-f]{6}$'
    )
);

COMMENT ON TABLE public.partners IS
  'Service-role-only partner presentation, hostname, and attribution configuration.';

COMMENT ON COLUMN public.partners.custom_domain IS
  'Canonical lowercase hostname only. Connection state is tracked separately.';

CREATE TRIGGER set_updated_at_partners
BEFORE UPDATE ON public.partners
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

-- Deliberately no anon/authenticated policies.
REVOKE ALL ON TABLE public.partners
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.partners
  TO service_role;

-- The assignment RPC is SECURITY INVOKER, so its sole executable role needs
-- only the business access used by the locked read and atomic update. Existing
-- customer grants and RLS policies are left unchanged.
GRANT SELECT, UPDATE ON TABLE public.businesses
  TO service_role;

ALTER TABLE public.businesses
  ADD COLUMN partner_id uuid
    REFERENCES public.partners(id) ON DELETE SET NULL,
  ADD COLUMN billing_mode text NOT NULL DEFAULT 'stripe'
    CHECK (billing_mode IN ('stripe', 'invoiced', 'comped'));

CREATE INDEX businesses_partner_id_idx
  ON public.businesses (partner_id);

COMMENT ON COLUMN public.businesses.partner_id IS
  'Partner responsible for business billing attribution and widget attribution, when assigned.';

COMMENT ON COLUMN public.businesses.billing_mode IS
  'Billing authority: SimplAssist Stripe, partner invoice, or partner comp.';

-- Preserve the complete migration-031 authorization boundary and add the two
-- new assignment fields. Trusted migration/admin/service-role writes bypass
-- this trigger; customer Data API roles cannot self-assign or change modes.
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
       OR NEW.billing_mode IS DISTINCT FROM 'stripe' THEN
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
     OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode THEN
    RAISE EXCEPTION 'customer writes cannot change protected business billing fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_business_billing_authorization_fields()
  FROM PUBLIC, anon, authenticated, service_role;

-- Atomically transition partner assignment and its temporary billing bridge.
-- The business row lock serializes admin transitions for one tenant. Any
-- subscription row, including a canceled row, makes non-Stripe assignment an
-- explicit conflict rather than allowing subscription precedence to hide it.
CREATE OR REPLACE FUNCTION public.assign_business_partner_billing(
  p_business_id uuid,
  p_partner_id uuid,
  p_billing_mode text,
  p_actor_user_id uuid
) RETURNS TABLE (
  business_id uuid,
  partner_id uuid,
  billing_mode text,
  billing_comped boolean
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_partner_status text;
BEGIN
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

  IF p_partner_id IS NOT NULL THEN
    -- Keep the approved business-first transition lock. NOWAIT prevents a
    -- reverse FK-delete cycle (partner delete -> business SET NULL) from
    -- deadlocking with any business -> partner assignment, including the
    -- orthogonal partner + Stripe state reserved for later phases. Any partner
    -- mutation already in flight therefore fails this assignment closed.
    BEGIN
      SELECT partner.status
      INTO v_partner_status
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

    IF v_partner_status <> 'active' THEN
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
  END IF;

  UPDATE public.businesses AS business
  SET partner_id = p_partner_id,
      billing_mode = p_billing_mode,
      billing_comped = CASE
        WHEN p_billing_mode IN ('invoiced', 'comped') THEN true
        WHEN v_business.billing_mode IN ('invoiced', 'comped')
          OR (
            v_business.partner_id IS NOT NULL
            AND p_partner_id IS NULL
          ) THEN false
        ELSE v_business.billing_comped
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
    v_business.billing_comped;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.assign_business_partner_billing(
  uuid, uuid, text, uuid
) IS
  'Service-role-only atomic partner assignment, billing-mode transition, and temporary comp bridge.';

COMMIT;
