-- Migration 034: durable Telnyx resource parking, protection, and release state.
--
-- IMPORTANT:
--   * This migration performs no Telnyx or Stripe API calls.
--   * Remote Telnyx release starts disabled.
--   * Existing provider pointers backfill as unverified_hold.
--   * No existing pointer becomes releaseable merely because it exists locally.
--   * Bryan Develops and the known production resources are fail-closed.
--   * Shared production messaging-profile and voice-application protections
--     must be added through later reviewed SQL before release can be enabled.

-- ============================================================================
-- A. Fail-closed migration validation
-- ============================================================================

DO $migration_034_validation$
DECLARE
  v_bryan_business_id CONSTANT uuid :=
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb';
  v_bryan_phone_digits CONSTANT text := '15742133931';
  v_bryan_exact_count bigint;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers
    GROUP BY regexp_replace(phone_number, '[^0-9]', '', 'g')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'migration_034_duplicate_normalized_phone_numbers'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers
    WHERE phone_number !~ '^\+[1-9][0-9]{7,14}$'
  ) THEN
    RAISE EXCEPTION 'migration_034_noncanonical_e164'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers
    WHERE is_active IS TRUE
    GROUP BY business_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'migration_034_multiple_active_numbers'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers
    WHERE telnyx_phone_number_id IS NOT NULL
    GROUP BY lower(btrim(telnyx_phone_number_id))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'migration_034_duplicate_telnyx_phone_ids'
      USING ERRCODE = '23505';
  END IF;

  -- Telnyx phone-number IDs are UUIDs. The exact Bryan row is the only
  -- approved exception. Its stale value is retained but never trusted,
  -- normalized, copied into a managed provider pointer, or sent to Telnyx.
  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers AS pn
    WHERE pn.telnyx_phone_number_id IS NOT NULL
      AND pn.telnyx_phone_number_id !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND NOT (
        pn.business_id = v_bryan_business_id
        AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g')
          = v_bryan_phone_digits
      )
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_telnyx_phone_id'
      USING ERRCODE = '23514';
  END IF;

  -- Messaging-profile IDs are UUIDs.
  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE telnyx_messaging_profile_id IS NOT NULL
      AND telnyx_messaging_profile_id !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_messaging_profile_id'
      USING ERRCODE = '23514';
  END IF;

  -- Corrected A6: Telnyx Call Control Application/connection IDs are
  -- decimal strings, not UUIDs. Do not impose a fixed digit length.
  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE telnyx_voice_application_id IS NOT NULL
      AND telnyx_voice_application_id !~ '^[0-9]+$'
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_voice_application_id'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE telnyx_brand_id IS NOT NULL
      AND telnyx_brand_id !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_internal_brand_id'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE telnyx_campaign_id IS NOT NULL
      AND btrim(telnyx_campaign_id) !~* '^[a-z0-9_-]{1,64}$'
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_campaign_id'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE (telnyx_brand_id IS NULL) <> (telnyx_brand_source IS NULL)
  ) THEN
    RAISE EXCEPTION 'migration_034_invalid_brand_provenance'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.phone_numbers AS pn
    JOIN public.businesses AS b ON b.id = pn.business_id
    WHERE pn.telnyx_campaign_assignment_campaign_id IS NOT NULL
      AND (
        b.telnyx_campaign_id IS NULL
        OR lower(pn.telnyx_campaign_assignment_campaign_id)
           <> lower(b.telnyx_campaign_id)
      )
      AND NOT (
        pn.business_id = v_bryan_business_id
        AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g')
          = v_bryan_phone_digits
      )
  ) THEN
    RAISE EXCEPTION 'migration_034_cross_campaign_assignment'
      USING ERRCODE = '23514';
  END IF;

  -- Portable protection check: a fresh/test database may contain neither
  -- production identifier. If either exists, the exact relationship is
  -- required and no other business may own that E.164.
  IF EXISTS (
    SELECT 1 FROM public.businesses WHERE id = v_bryan_business_id
  ) OR EXISTS (
    SELECT 1
    FROM public.phone_numbers
    WHERE regexp_replace(phone_number, '[^0-9]', '', 'g')
      = v_bryan_phone_digits
  ) THEN
    SELECT count(*)
    INTO v_bryan_exact_count
    FROM public.businesses AS b
    JOIN public.phone_numbers AS pn ON pn.business_id = b.id
    WHERE b.id = v_bryan_business_id
      AND b.deleted_at IS NOT NULL
      AND b.deletion_scheduled_for IS NOT NULL
      AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g')
        = v_bryan_phone_digits;

    IF v_bryan_exact_count <> 1 THEN
      RAISE EXCEPTION 'migration_034_bryan_protection_shape_mismatch'
        USING ERRCODE = '23514';
    END IF;
  END IF;
END;
$migration_034_validation$;

-- ============================================================================
-- B. Existing-table lifecycle columns
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS telnyx_resource_state text
    NOT NULL DEFAULT 'provisioning',
  ADD COLUMN IF NOT EXISTS telnyx_resource_state_updated_at timestamptz
    NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS active_telnyx_release_run_id uuid,
  ADD COLUMN IF NOT EXISTS cleanup_pii_scrubbed_at timestamptz,
  ADD COLUMN IF NOT EXISTS telnyx_unique_claims_released_at timestamptz;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_telnyx_resource_state_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_telnyx_resource_state_check
  CHECK (
    telnyx_resource_state IN (
      'provisioning',
      'active',
      'parked',
      'release_pending',
      'releasing',
      'released',
      'blocked',
      'protected_hold'
    )
  );

ALTER TABLE public.phone_numbers
  ALTER COLUMN telnyx_phone_number_id DROP NOT NULL;

ALTER TABLE public.phone_numbers
  ADD COLUMN IF NOT EXISTS resource_status text
    NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS parked_at timestamptz,
  ADD COLUMN IF NOT EXISTS release_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_at timestamptz;

ALTER TABLE public.phone_numbers
  DROP CONSTRAINT IF EXISTS phone_numbers_resource_status_check,
  DROP CONSTRAINT IF EXISTS phone_numbers_release_state_check;

ALTER TABLE public.phone_numbers
  ADD CONSTRAINT phone_numbers_resource_status_check
  CHECK (
    resource_status IN (
      'active',
      'parked',
      'releasing',
      'released',
      'blocked',
      'protected_hold'
    )
  ),
  ADD CONSTRAINT phone_numbers_release_state_check
  CHECK (
    (
      resource_status = 'released'
      AND telnyx_phone_number_id IS NULL
      AND is_active IS FALSE
      AND released_at IS NOT NULL
    )
    OR (
      resource_status <> 'released'
      AND telnyx_phone_number_id IS NOT NULL
      AND released_at IS NULL
    )
  );

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS stripe_subscription_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_last_event_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_generation bigint
    NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_stripe_generation_check;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_stripe_generation_check
  CHECK (stripe_subscription_generation > 0);

UPDATE public.businesses AS b
SET telnyx_resource_state = CASE
      WHEN b.id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
        THEN 'protected_hold'
      WHEN b.telnyx_brand_id IS NOT NULL
        OR b.telnyx_campaign_id IS NOT NULL
        OR b.telnyx_messaging_profile_id IS NOT NULL
        OR b.telnyx_voice_application_id IS NOT NULL
        OR EXISTS (
          SELECT 1
          FROM public.phone_numbers AS pn
          WHERE pn.business_id = b.id
        )
        THEN 'active'
      ELSE 'provisioning'
    END,
    telnyx_resource_state_updated_at = now();

UPDATE public.phone_numbers AS pn
SET resource_status = 'protected_hold',
    parked_at = COALESCE(pn.parked_at, now())
WHERE pn.business_id =
        'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
  AND pn.phone_number = '+15742133931';

CREATE UNIQUE INDEX IF NOT EXISTS
  phone_numbers_unreleased_normalized_e164_unique
ON public.phone_numbers (
  regexp_replace(phone_number, '[^0-9]', '', 'g')
)
WHERE is_active IS TRUE
  AND resource_status <> 'released';

CREATE UNIQUE INDEX IF NOT EXISTS
  phone_numbers_telnyx_id_lower_unique
ON public.phone_numbers (lower(telnyx_phone_number_id))
WHERE telnyx_phone_number_id IS NOT NULL
  AND is_active IS TRUE;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_telnyx_brand_id_key,
  DROP CONSTRAINT IF EXISTS businesses_telnyx_campaign_id_key,
  DROP CONSTRAINT IF EXISTS businesses_telnyx_messaging_profile_id_key,
  DROP CONSTRAINT IF EXISTS businesses_telnyx_voice_application_id_key;

DROP INDEX IF EXISTS public.businesses_telnyx_brand_id_lower_unique;

CREATE UNIQUE INDEX IF NOT EXISTS
  businesses_live_telnyx_brand_id_lower_unique
ON public.businesses (lower(btrim(telnyx_brand_id)))
WHERE telnyx_brand_id IS NOT NULL
  AND telnyx_unique_claims_released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  businesses_live_telnyx_campaign_id_lower_unique
ON public.businesses (lower(btrim(telnyx_campaign_id)))
WHERE telnyx_campaign_id IS NOT NULL
  AND telnyx_unique_claims_released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  businesses_live_telnyx_messaging_profile_id_lower_unique
ON public.businesses (lower(btrim(telnyx_messaging_profile_id)))
WHERE telnyx_messaging_profile_id IS NOT NULL
  AND telnyx_unique_claims_released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS
  businesses_live_telnyx_voice_application_id_unique
ON public.businesses (btrim(telnyx_voice_application_id))
WHERE telnyx_voice_application_id IS NOT NULL
  AND telnyx_unique_claims_released_at IS NULL;

-- Reissue the three brand-link transitions from migration 033 with one narrow
-- change: a terminal tombstone whose Telnyx uniqueness claims were explicitly
-- released no longer prevents a supported future attachment. Tombstones still
-- inside either retention window continue to reserve their provider brand.

CREATE OR REPLACE FUNCTION public.stage_existing_telnyx_brand_link(
  p_business_id uuid,
  p_tcr_brand_id text,
  p_telnyx_brand_id text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_telnyx_brand_id));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF v_request.id IS NOT NULL AND v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.id IS NOT NULL AND v_request.status = 'approved' THEN
    RAISE EXCEPTION 'existing_brand_link_already_approved_reset_first'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND attached_business.telnyx_unique_claims_released_at IS NULL
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  IF v_business.onboarding_registration_status NOT IN (
    'not_started',
    'failed'
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_registration_already_submitted'
      USING ERRCODE = '55000';
  END IF;

  v_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'existing_brand_link_identity_incomplete'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    IF v_request.id IS NULL THEN
      INSERT INTO public.telnyx_brand_link_requests (
        business_id,
        tcr_brand_id,
        telnyx_brand_id,
        status,
        identity_fingerprint,
        inspected_at,
        inspected_by,
        approved_at,
        approved_by,
        consumed_at,
        last_error_code
      ) VALUES (
        p_business_id,
        v_tcr_brand_id,
        v_telnyx_brand_id,
        'pending_admin',
        v_fingerprint,
        now(),
        p_actor_user_id,
        NULL,
        NULL,
        NULL,
        NULL
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.telnyx_brand_link_requests
      SET tcr_brand_id = v_tcr_brand_id,
          telnyx_brand_id = v_telnyx_brand_id,
          status = 'pending_admin',
          identity_fingerprint = v_fingerprint,
          inspected_at = now(),
          inspected_by = p_actor_user_id,
          approved_at = NULL,
          approved_by = NULL,
          consumed_at = NULL,
          last_error_code = NULL,
          updated_at = now()
      WHERE id = v_request.id
      RETURNING * INTO v_request;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'existing_brand_link_brand_already_reserved'
        USING ERRCODE = '23505';
  END;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_staged',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_existing_telnyx_brand_link(
  p_business_id uuid,
  p_expected_tcr_brand_id text,
  p_expected_telnyx_brand_id text,
  p_expected_identity_fingerprint text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_current_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_expected_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_expected_telnyx_brand_id));
  v_expected_fingerprint text := lower(btrim(p_expected_identity_fingerprint));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_fingerprint IS NULL
     OR v_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_identity_fingerprint'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status NOT IN ('pending_admin', 'approved') THEN
    RAISE EXCEPTION 'existing_brand_link_not_ready_for_approval'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.tcr_brand_id IS DISTINCT FROM v_tcr_brand_id
     OR v_request.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id THEN
    RAISE EXCEPTION 'existing_brand_link_provider_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND attached_business.telnyx_unique_claims_released_at IS NULL
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  IF v_business.onboarding_registration_status NOT IN (
    'not_started',
    'failed'
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_registration_already_submitted'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.a2p_risk_review_status IS NULL
     OR v_business.a2p_risk_review_status NOT IN (
       'passed',
       'admin_approved'
     ) THEN
    RAISE EXCEPTION 'existing_brand_link_risk_review_not_cleared'
      USING ERRCODE = '55000';
  END IF;

  v_current_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_current_fingerprint IS NULL
     OR v_request.identity_fingerprint IS DISTINCT FROM v_expected_fingerprint
     OR v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'existing_brand_link_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  IF v_request.status = 'approved' THEN
    RETURN v_request;
  END IF;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'approved',
      approved_at = now(),
      approved_by = p_actor_user_id,
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_approved',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_existing_telnyx_brand_link(
  p_business_id uuid,
  p_expected_tcr_brand_id text,
  p_expected_telnyx_brand_id text,
  p_expected_identity_fingerprint text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_current_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_expected_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_expected_telnyx_brand_id));
  v_expected_fingerprint text := lower(btrim(p_expected_identity_fingerprint));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_fingerprint IS NULL
     OR v_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_identity_fingerprint'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.tcr_brand_id IS DISTINCT FROM v_tcr_brand_id
     OR v_request.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id THEN
    RAISE EXCEPTION 'existing_brand_link_provider_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  v_current_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_current_fingerprint IS NULL
     OR v_request.identity_fingerprint IS DISTINCT FROM v_expected_fingerprint
     OR v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'existing_brand_link_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  -- Recheck the mutable safety gates for both first consumption and an
  -- idempotent consumed retry. Consumed retries may legitimately run after
  -- registration advances beyond 'submitting', but a newly applied kill
  -- switch or risk hold must still stop provider work.
  IF v_business.a2p_risk_review_status IS NULL
     OR v_business.a2p_risk_review_status NOT IN (
       'passed',
       'admin_approved'
     ) THEN
    RAISE EXCEPTION 'existing_brand_link_risk_review_not_cleared'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_submission_disabled THEN
    RAISE EXCEPTION 'existing_brand_link_telnyx_submission_disabled'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status = 'consumed' THEN
    IF v_business.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id
       OR v_business.telnyx_brand_source IS DISTINCT FROM 'linked_existing'
       OR v_business.brand_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'existing_brand_link_consumed_state_mismatch'
        USING ERRCODE = '23514';
    END IF;

    RETURN v_request;
  END IF;

  IF v_business.onboarding_registration_status <> 'submitting' THEN
    RAISE EXCEPTION 'existing_brand_link_launch_not_claimed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'existing_brand_link_not_approved'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND attached_business.telnyx_unique_claims_released_at IS NULL
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE public.businesses
    SET telnyx_brand_id = v_telnyx_brand_id,
        telnyx_brand_source = 'linked_existing',
        brand_status = 'approved',
        brand_status_updated_at = now(),
        brand_rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_business_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
        USING ERRCODE = '23505';
  END;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'consumed',
      consumed_at = now(),
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_consumed',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

-- ============================================================================
-- C. Managed-resource registry
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telnyx_managed_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  phone_number_id uuid
    REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  resource_type text NOT NULL
    CHECK (
      resource_type IN (
        'phone_number',
        'campaign',
        'messaging_profile',
        'voice_application',
        'brand'
      )
    ),
  provider_id text,
  canonical_e164 text,
  public_tcr_id text,
  provider_origin text
    CHECK (
      provider_origin IS NULL
      OR provider_origin IN (
        'created_by_simplassist',
        'linked_existing',
        'manually_attested'
      )
    ),
  ownership_state text NOT NULL DEFAULT 'unverified_hold'
    CHECK (
      ownership_state IN (
        'unverified_hold',
        'managed_releaseable',
        'released'
      )
    ),
  local_claim_active boolean NOT NULL DEFAULT true,
  verified_by text,
  verified_at timestamptz,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (id, business_id),

  CHECK (
    provider_id IS NOT NULL
    OR canonical_e164 IS NOT NULL
    OR public_tcr_id IS NOT NULL
  ),
  CHECK (
    canonical_e164 IS NULL
    OR canonical_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CHECK (
    public_tcr_id IS NULL
    OR public_tcr_id = upper(btrim(public_tcr_id))
  ),
  CHECK (
    resource_type <> 'brand'
    OR provider_id IS NULL
    OR provider_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CHECK (
    resource_type <> 'campaign'
    OR provider_id IS NULL
    OR provider_id ~* '^[a-z0-9_-]{1,64}$'
  ),
  CHECK (
    resource_type <> 'messaging_profile'
    OR provider_id IS NULL
    OR provider_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CHECK (
    resource_type <> 'voice_application'
    OR provider_id IS NULL
    OR provider_id ~ '^[0-9]+$'
  ),
  CHECK (
    resource_type <> 'phone_number'
    OR provider_id IS NULL
    OR provider_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CHECK (
    ownership_state <> 'managed_releaseable'
    OR (
      provider_id IS NOT NULL
      AND provider_origin IN (
        'created_by_simplassist',
        'manually_attested'
      )
      AND verified_by IS NOT NULL
      AND verified_at IS NOT NULL
    )
  ),
  CHECK (
    NOT (
      resource_type = 'brand'
      AND provider_origin = 'linked_existing'
      AND ownership_state = 'managed_releaseable'
    )
  ),
  CHECK (
    ownership_state <> 'released'
    OR released_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_managed_resources_provider_unique
ON public.telnyx_managed_resources (
  resource_type,
  lower(provider_id)
)
WHERE provider_id IS NOT NULL
  AND local_claim_active IS TRUE
  AND ownership_state <> 'released';

CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_managed_resources_e164_unique
ON public.telnyx_managed_resources (canonical_e164)
WHERE canonical_e164 IS NOT NULL
  AND local_claim_active IS TRUE
  AND ownership_state <> 'released';

CREATE INDEX IF NOT EXISTS
  telnyx_managed_resources_business_state
ON public.telnyx_managed_resources (
  business_id,
  ownership_state,
  resource_type
);

-- ============================================================================
-- D. Immutable protection manifest
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telnyx_release_protections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protection_key text NOT NULL UNIQUE
    CHECK (
      protection_key = lower(btrim(protection_key))
      AND protection_key ~ '^[a-z0-9_]{1,96}$'
    ),
  scope text NOT NULL
    CHECK (scope IN ('business_all', 'resource')),
  business_id uuid
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  resource_type text
    CHECK (
      resource_type IS NULL
      OR resource_type IN (
        'phone_number',
        'campaign',
        'messaging_profile',
        'voice_application',
        'brand'
      )
    ),
  provider_id text,
  canonical_e164 text,
  public_tcr_id text,
  reason_code text NOT NULL
    CHECK (reason_code ~ '^[a-z0-9_]{1,96}$'),
  reviewed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (
    canonical_e164 IS NULL
    OR canonical_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CHECK (
    public_tcr_id IS NULL
    OR public_tcr_id = upper(btrim(public_tcr_id))
  ),
  CHECK (
    (
      scope = 'business_all'
      AND business_id IS NOT NULL
      AND resource_type IS NULL
      AND provider_id IS NULL
      AND canonical_e164 IS NULL
      AND public_tcr_id IS NULL
    )
    OR (
      scope = 'resource'
      AND resource_type IS NOT NULL
      AND (
        provider_id IS NOT NULL
        OR canonical_e164 IS NOT NULL
        OR public_tcr_id IS NOT NULL
      )
    )
  )
);

CREATE INDEX IF NOT EXISTS
  telnyx_release_protections_business
ON public.telnyx_release_protections (business_id)
WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  telnyx_release_protections_provider
ON public.telnyx_release_protections (
  resource_type,
  lower(provider_id)
)
WHERE provider_id IS NOT NULL;

INSERT INTO public.telnyx_release_protections (
  protection_key,
  scope,
  business_id,
  reason_code,
  reviewed_by
)
SELECT
  'bryan_develops_retain_all',
  'business_all',
  b.id,
  'known_live_production_resource_relationship',
  'migration_034_review'
FROM public.businesses AS b
WHERE b.id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
ON CONFLICT (protection_key) DO NOTHING;

INSERT INTO public.telnyx_release_protections (
  protection_key,
  scope,
  resource_type,
  canonical_e164,
  reason_code,
  reviewed_by
) VALUES (
  'simplassist_live_phone',
  'resource',
  'phone_number',
  '+15742133931',
  'known_live_production_number',
  'migration_034_review'
)
ON CONFLICT (protection_key) DO NOTHING;

INSERT INTO public.telnyx_release_protections (
  protection_key,
  scope,
  resource_type,
  provider_id,
  public_tcr_id,
  reason_code,
  reviewed_by
) VALUES
  (
    'simplassist_live_campaign',
    'resource',
    'campaign',
    'CYLIGTZ',
    'CYLIGTZ',
    'known_live_production_campaign',
    'migration_034_review'
  ),
  (
    'simplassist_shared_brand',
    'resource',
    'brand',
    NULL,
    'BL69PDP',
    'known_shared_production_brand',
    'migration_034_review'
  )
ON CONFLICT (protection_key) DO NOTHING;

-- Capture the internal UUID paired with BL69PDP, when that consumed link exists.
INSERT INTO public.telnyx_release_protections (
  protection_key,
  scope,
  resource_type,
  provider_id,
  public_tcr_id,
  reason_code,
  reviewed_by
)
SELECT
  'simplassist_shared_brand_internal',
  'resource',
  'brand',
  request.telnyx_brand_id,
  request.tcr_brand_id,
  'known_shared_production_brand',
  'migration_034_review'
FROM public.telnyx_brand_link_requests AS request
WHERE request.tcr_brand_id = 'BL69PDP'
ORDER BY request.consumed_at DESC NULLS LAST, request.id::text
LIMIT 1
ON CONFLICT (protection_key) DO NOTHING;

-- ============================================================================
-- E. Runs, reasons, actions, events, and disabled release configuration
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telnyx_resource_release_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  generation bigint NOT NULL CHECK (generation > 0),
  previous_resource_state text NOT NULL
    CHECK (
      previous_resource_state IN (
        'provisioning',
        'active',
        'parked',
        'release_pending',
        'releasing',
        'released',
        'blocked',
        'protected_hold'
      )
    ),
  status text NOT NULL DEFAULT 'parked'
    CHECK (
      status IN (
        'parked',
        'release_pending',
        'releasing',
        'released',
        'blocked',
        'protected_hold',
        'canceled'
      )
    ),
  effective_release_at timestamptz NOT NULL,
  checkout_reservation_token uuid,
  checkout_reservation_expires_at timestamptz,
  point_of_no_return_at timestamptz,
  last_error_code text,
  last_error_message text,
  support_required_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (business_id, generation),
  UNIQUE (id, business_id),

  CHECK (
    (
      checkout_reservation_token IS NULL
      AND checkout_reservation_expires_at IS NULL
    )
    OR (
      checkout_reservation_token IS NOT NULL
      AND checkout_reservation_expires_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_resource_release_runs_one_open
ON public.telnyx_resource_release_runs (business_id)
WHERE status NOT IN ('released', 'protected_hold', 'canceled');

CREATE INDEX IF NOT EXISTS
  telnyx_resource_release_runs_due
ON public.telnyx_resource_release_runs (
  status,
  effective_release_at
)
WHERE status IN (
  'parked',
  'release_pending',
  'releasing',
  'blocked'
);

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_active_telnyx_release_run_fkey;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_active_telnyx_release_run_fkey
  FOREIGN KEY (active_telnyx_release_run_id)
  REFERENCES public.telnyx_resource_release_runs(id)
  ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS public.telnyx_resource_release_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  business_id uuid NOT NULL,
  reason_type text NOT NULL
    CHECK (
      reason_type IN ('subscription_ended', 'account_deletion')
    ),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'canceled', 'consumed')),
  triggered_at timestamptz NOT NULL,
  release_at timestamptz NOT NULL,
  source_subscription_id text,
  source_event_id text,
  actor text NOT NULL,
  canceled_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (run_id, business_id)
    REFERENCES public.telnyx_resource_release_runs(id, business_id)
    ON DELETE RESTRICT,

  CHECK (release_at >= triggered_at),
  CHECK (
    status <> 'canceled'
    OR canceled_at IS NOT NULL
  ),
  CHECK (
    status <> 'consumed'
    OR consumed_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_resource_release_reasons_one_active
ON public.telnyx_resource_release_reasons (
  run_id,
  reason_type
)
WHERE status = 'active';

CREATE INDEX IF NOT EXISTS
  telnyx_resource_release_reasons_business_status
ON public.telnyx_resource_release_reasons (
  business_id,
  status,
  release_at
);

CREATE TABLE IF NOT EXISTS public.telnyx_resource_release_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  business_id uuid NOT NULL,
  managed_resource_id uuid,
  phone_number_id uuid
    REFERENCES public.phone_numbers(id) ON DELETE SET NULL,
  protection_id uuid
    REFERENCES public.telnyx_release_protections(id) ON DELETE SET NULL,
  resource_type text NOT NULL
    CHECK (
      resource_type IN (
        'phone_number_assignment',
        'phone_number',
        'campaign',
        'messaging_profile',
        'voice_application',
        'brand'
      )
    ),
  provider_id text,
  canonical_e164 text,
  public_tcr_id text,
  expected_parent_brand_id text,
  expected_parent_campaign_id text,
  previous_resource_status text,
  classification text NOT NULL
    CHECK (
      classification IN (
        'managed_releaseable',
        'policy_retain',
        'protected_retain',
        'unverified_hold'
      )
    ),
  desired_action text NOT NULL
    CHECK (
      desired_action IN (
        'unassign',
        'release',
        'deactivate',
        'delete',
        'retain',
        'hold'
      )
    ),
  state text NOT NULL
    CHECK (
      state IN (
        'pending',
        'leased',
        'retryable',
        'blocked',
        'succeeded',
        'retained',
        'held'
      )
    ),
  action_order smallint NOT NULL CHECK (action_order > 0),
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  lease_authorization_epoch bigint,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at timestamptz,
  provider_confirmed_at timestamptz,
  provider_confirmation_code text,
  last_error_code text,
  last_error_message text,
  support_required_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (run_id, business_id)
    REFERENCES public.telnyx_resource_release_runs(id, business_id)
    ON DELETE RESTRICT,

  FOREIGN KEY (managed_resource_id, business_id)
    REFERENCES public.telnyx_managed_resources(id, business_id)
    ON DELETE RESTRICT,

  CHECK (
    canonical_e164 IS NULL
    OR canonical_e164 ~ '^\+[1-9][0-9]{7,14}$'
  ),
  CHECK (
    (
      resource_type IN ('phone_number_assignment', 'phone_number')
      AND previous_resource_status IN (
        'active',
        'parked',
        'releasing',
        'released',
        'blocked',
        'protected_hold'
      )
    )
    OR (
      resource_type NOT IN (
        'phone_number_assignment',
        'phone_number'
      )
      AND previous_resource_status IS NULL
    )
  ),
  CHECK (
    (
      state = 'leased'
      AND lease_token IS NOT NULL
      AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_authorization_epoch IS NOT NULL
    )
    OR (
      state <> 'leased'
      AND lease_token IS NULL
      AND lease_owner IS NULL
      AND lease_expires_at IS NULL
      AND lease_authorization_epoch IS NULL
    )
  ),
  CHECK (
    state <> 'succeeded'
    OR (
      provider_confirmed_at IS NOT NULL
      AND provider_confirmation_code IS NOT NULL
    )
  ),
  CHECK (
    classification <> 'managed_releaseable'
    OR desired_action IN ('unassign', 'release', 'deactivate', 'delete')
  ),
  CHECK (
    classification <> 'policy_retain'
    OR (desired_action = 'retain' AND state = 'retained')
  ),
  CHECK (
    classification <> 'protected_retain'
    OR (desired_action = 'retain' AND state = 'retained')
  ),
  CHECK (
    classification <> 'unverified_hold'
    OR (desired_action = 'hold' AND state IN ('held', 'blocked'))
  ),
  CHECK (
    state <> 'blocked'
    OR support_required_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS
  telnyx_resource_release_actions_deterministic
ON public.telnyx_resource_release_actions (
  run_id,
  resource_type,
  COALESCE(managed_resource_id::text, ''),
  COALESCE(phone_number_id::text, ''),
  COALESCE(provider_id, ''),
  COALESCE(canonical_e164, ''),
  COALESCE(public_tcr_id, '')
);

CREATE INDEX IF NOT EXISTS
  telnyx_resource_release_actions_claim
ON public.telnyx_resource_release_actions (
  state,
  next_retry_at,
  lease_expires_at,
  action_order
)
WHERE state IN ('pending', 'retryable', 'leased');

CREATE TABLE IF NOT EXISTS public.telnyx_resource_release_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL
    REFERENCES public.telnyx_resource_release_runs(id) ON DELETE RESTRICT,
  action_id uuid
    REFERENCES public.telnyx_resource_release_actions(id) ON DELETE SET NULL,
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  event_type text NOT NULL
    CHECK (event_type ~ '^[a-z0-9_]{1,96}$'),
  previous_state text,
  new_state text,
  reason_code text,
  actor text NOT NULL,
  attempt_number integer CHECK (
    attempt_number IS NULL OR attempt_number >= 0
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS
  telnyx_resource_release_events_run_created
ON public.telnyx_resource_release_events (run_id, created_at, id);

CREATE TABLE IF NOT EXISTS public.telnyx_resource_release_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'disabled'
    CHECK (mode IN ('disabled', 'single_business', 'enabled')),
  single_business_id uuid
    REFERENCES public.businesses(id) ON DELETE RESTRICT,
  expected_shared_messaging_profile_id text,
  expected_shared_voice_application_id text,
  protection_manifest_fingerprint text,
  authorization_epoch bigint NOT NULL DEFAULT 1
    CHECK (authorization_epoch > 0),
  protection_manifest_verified_at timestamptz,
  protection_manifest_verified_by text,
  dry_run_completed_at timestamptz,
  dry_run_completed_by text,
  single_business_test_completed_at timestamptz,
  single_business_test_completed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,

  CHECK (
    expected_shared_messaging_profile_id IS NULL
    OR expected_shared_messaging_profile_id ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  CHECK (
    expected_shared_voice_application_id IS NULL
    OR expected_shared_voice_application_id ~ '^[0-9]+$'
  ),
  CHECK (
    protection_manifest_fingerprint IS NULL
    OR protection_manifest_fingerprint ~ '^[0-9a-f]{64}$'
  ),

  CHECK (
    (
      mode = 'single_business'
      AND single_business_id IS NOT NULL
    )
    OR (
      mode <> 'single_business'
      AND single_business_id IS NULL
    )
  ),
  CHECK (
    (
      protection_manifest_verified_at IS NULL
      AND protection_manifest_verified_by IS NULL
    )
    OR (
      protection_manifest_verified_at IS NOT NULL
      AND protection_manifest_verified_by IS NOT NULL
    )
  ),
  CHECK (
    (
      dry_run_completed_at IS NULL
      AND dry_run_completed_by IS NULL
    )
    OR (
      dry_run_completed_at IS NOT NULL
      AND dry_run_completed_by IS NOT NULL
    )
  ),
  CHECK (
    (
      single_business_test_completed_at IS NULL
      AND single_business_test_completed_by IS NULL
    )
    OR (
      single_business_test_completed_at IS NOT NULL
      AND single_business_test_completed_by IS NOT NULL
    )
  )
);

INSERT INTO public.telnyx_resource_release_config (id, mode)
VALUES (1, 'disabled')
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.telnyx_release_manifest_fingerprint(
  p_expected_shared_messaging_profile_id text,
  p_expected_shared_voice_application_id text
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_fingerprint text;
BEGIN
  IF p_expected_shared_messaging_profile_id IS NULL
     OR p_expected_shared_messaging_profile_id !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_expected_shared_voice_application_id IS NULL
     OR p_expected_shared_voice_application_id !~ '^[0-9]+$' THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'bryan_develops_retain_all'
      AND scope = 'business_all'
      AND business_id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
      AND resource_type IS NULL
      AND provider_id IS NULL
      AND canonical_e164 IS NULL
      AND public_tcr_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_live_phone'
      AND scope = 'resource'
      AND business_id IS NULL
      AND resource_type = 'phone_number'
      AND provider_id IS NULL
      AND canonical_e164 = '+15742133931'
      AND public_tcr_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_live_campaign'
      AND scope = 'resource'
      AND business_id IS NULL
      AND resource_type = 'campaign'
      AND provider_id = 'CYLIGTZ'
      AND canonical_e164 IS NULL
      AND public_tcr_id = 'CYLIGTZ'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_shared_brand'
      AND scope = 'resource'
      AND business_id IS NULL
      AND resource_type = 'brand'
      AND provider_id IS NULL
      AND canonical_e164 IS NULL
      AND public_tcr_id = 'BL69PDP'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_shared_messaging_profile'
      AND scope = 'resource'
      AND business_id IS NULL
      AND resource_type = 'messaging_profile'
      AND provider_id = lower(btrim(
        p_expected_shared_messaging_profile_id
      ))
      AND canonical_e164 IS NULL
      AND public_tcr_id IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_shared_voice_application'
      AND scope = 'resource'
      AND business_id IS NULL
      AND resource_type = 'voice_application'
      AND provider_id = btrim(
        p_expected_shared_voice_application_id
      )
      AND canonical_e164 IS NULL
      AND public_tcr_id IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_agg(
          jsonb_build_array(
            protection.protection_key,
            protection.scope,
            protection.business_id,
            protection.resource_type,
            protection.provider_id,
            protection.canonical_e164,
            protection.public_tcr_id,
            protection.reason_code,
            protection.reviewed_by
          ) ORDER BY protection.protection_key
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  INTO v_fingerprint
  FROM public.telnyx_release_protections AS protection
  WHERE protection.protection_key IN (
    'bryan_develops_retain_all',
    'simplassist_live_phone',
    'simplassist_live_campaign',
    'simplassist_shared_brand',
    'simplassist_shared_messaging_profile',
    'simplassist_shared_voice_application'
  );

  RETURN v_fingerprint;
END;
$$;

-- ============================================================================
-- F. Disabled-mode and direct-client guards
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_telnyx_release_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_fingerprint text;
BEGIN
  IF TG_OP = 'UPDATE' AND ROW(
    NEW.mode,
    NEW.single_business_id,
    NEW.expected_shared_messaging_profile_id,
    NEW.expected_shared_voice_application_id,
    NEW.protection_manifest_fingerprint,
    NEW.protection_manifest_verified_at,
    NEW.protection_manifest_verified_by,
    NEW.dry_run_completed_at,
    NEW.dry_run_completed_by,
    NEW.single_business_test_completed_at,
    NEW.single_business_test_completed_by
  ) IS DISTINCT FROM ROW(
    OLD.mode,
    OLD.single_business_id,
    OLD.expected_shared_messaging_profile_id,
    OLD.expected_shared_voice_application_id,
    OLD.protection_manifest_fingerprint,
    OLD.protection_manifest_verified_at,
    OLD.protection_manifest_verified_by,
    OLD.dry_run_completed_at,
    OLD.dry_run_completed_by,
    OLD.single_business_test_completed_at,
    OLD.single_business_test_completed_by
  ) THEN
    NEW.authorization_epoch := OLD.authorization_epoch + 1;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.authorization_epoch := OLD.authorization_epoch;
  END IF;

  IF NEW.mode <> 'disabled' THEN
    v_current_fingerprint :=
      public.telnyx_release_manifest_fingerprint(
        NEW.expected_shared_messaging_profile_id,
        NEW.expected_shared_voice_application_id
      );

    IF v_current_fingerprint IS NULL
       OR NEW.protection_manifest_fingerprint IS DISTINCT FROM
            v_current_fingerprint THEN
      RAISE EXCEPTION
        'telnyx_release_protection_manifest_mismatch'
        USING ERRCODE = '55000';
    END IF;

    IF NEW.protection_manifest_verified_at IS NULL
       OR NEW.protection_manifest_verified_by IS NULL
       OR NEW.dry_run_completed_at IS NULL
       OR NEW.dry_run_completed_by IS NULL THEN
      RAISE EXCEPTION
        'telnyx_release_rollout_prerequisites_missing'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.mode = 'enabled'
     AND (
       NEW.single_business_test_completed_at IS NULL
       OR NEW.single_business_test_completed_by IS NULL
     ) THEN
    RAISE EXCEPTION
      'telnyx_release_single_business_test_missing'
      USING ERRCODE = '55000';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_telnyx_release_configuration
  ON public.telnyx_resource_release_config;

CREATE TRIGGER guard_telnyx_release_configuration
BEFORE INSERT OR UPDATE ON public.telnyx_resource_release_config
FOR EACH ROW
EXECUTE FUNCTION public.guard_telnyx_release_configuration();

CREATE OR REPLACE FUNCTION public.invalidate_telnyx_release_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.telnyx_resource_release_config
  SET mode = 'disabled',
      single_business_id = NULL,
      protection_manifest_fingerprint = NULL,
      protection_manifest_verified_at = NULL,
      protection_manifest_verified_by = NULL,
      dry_run_completed_at = NULL,
      dry_run_completed_by = NULL,
      single_business_test_completed_at = NULL,
      single_business_test_completed_by = NULL,
      updated_by = 'protection_manifest_changed'
  WHERE id = 1;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_telnyx_release_configuration
  ON public.telnyx_release_protections;

CREATE TRIGGER invalidate_telnyx_release_configuration
AFTER INSERT OR UPDATE OR DELETE ON public.telnyx_release_protections
FOR EACH STATEMENT
EXECUTE FUNCTION public.invalidate_telnyx_release_configuration();

CREATE OR REPLACE FUNCTION public.guard_business_telnyx_lifecycle_fields()
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
    IF NEW.telnyx_resource_state <> 'provisioning'
       OR NEW.active_telnyx_release_run_id IS NOT NULL
       OR NEW.cleanup_pii_scrubbed_at IS NOT NULL
       OR NEW.telnyx_unique_claims_released_at IS NOT NULL THEN
      RAISE EXCEPTION
        'customer writes cannot set Telnyx lifecycle fields'
        USING ERRCODE = '42501';
    END IF;
  ELSIF ROW(
    NEW.telnyx_resource_state,
    NEW.telnyx_resource_state_updated_at,
    NEW.active_telnyx_release_run_id,
    NEW.cleanup_pii_scrubbed_at,
    NEW.telnyx_unique_claims_released_at
  ) IS DISTINCT FROM ROW(
    OLD.telnyx_resource_state,
    OLD.telnyx_resource_state_updated_at,
    OLD.active_telnyx_release_run_id,
    OLD.cleanup_pii_scrubbed_at,
    OLD.telnyx_unique_claims_released_at
  ) THEN
    RAISE EXCEPTION
      'customer writes cannot change Telnyx lifecycle fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_telnyx_lifecycle_fields
  ON public.businesses;

CREATE TRIGGER guard_business_telnyx_lifecycle_fields
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_telnyx_lifecycle_fields();

CREATE OR REPLACE FUNCTION public.guard_phone_number_telnyx_lifecycle_fields()
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
    IF NEW.resource_status <> 'active'
       OR NEW.parked_at IS NOT NULL
       OR NEW.release_started_at IS NOT NULL
       OR NEW.released_at IS NOT NULL THEN
      RAISE EXCEPTION
        'customer writes cannot set phone lifecycle fields'
        USING ERRCODE = '42501';
    END IF;
  ELSIF ROW(
    NEW.resource_status,
    NEW.parked_at,
    NEW.release_started_at,
    NEW.released_at
  ) IS DISTINCT FROM ROW(
    OLD.resource_status,
    OLD.parked_at,
    OLD.release_started_at,
    OLD.released_at
  ) THEN
    RAISE EXCEPTION
      'customer writes cannot change phone lifecycle fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_phone_number_telnyx_lifecycle_fields
  ON public.phone_numbers;

CREATE TRIGGER guard_phone_number_telnyx_lifecycle_fields
BEFORE INSERT OR UPDATE ON public.phone_numbers
FOR EACH ROW
EXECUTE FUNCTION public.guard_phone_number_telnyx_lifecycle_fields();

-- ============================================================================
-- G. Existing-resource backfill: always unverified_hold
-- ============================================================================

INSERT INTO public.telnyx_managed_resources (
  business_id,
  resource_type,
  provider_id,
  public_tcr_id,
  provider_origin,
  ownership_state
)
SELECT
  b.id,
  'brand',
  lower(btrim(b.telnyx_brand_id)),
  (
    SELECT request.tcr_brand_id
    FROM public.telnyx_brand_link_requests AS request
    WHERE request.business_id = b.id
      AND lower(request.telnyx_brand_id)
        = lower(b.telnyx_brand_id)
    ORDER BY request.consumed_at DESC NULLS LAST, request.id::text
    LIMIT 1
  ),
  b.telnyx_brand_source,
  'unverified_hold'
FROM public.businesses AS b
WHERE b.telnyx_brand_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.resource_type = 'brand'
      AND lower(resource.provider_id)
        = lower(b.telnyx_brand_id)
  );

INSERT INTO public.telnyx_managed_resources (
  business_id,
  resource_type,
  provider_id,
  public_tcr_id,
  ownership_state
)
SELECT
  b.id,
  'campaign',
  upper(btrim(b.telnyx_campaign_id)),
  upper(btrim(b.telnyx_campaign_id)),
  'unverified_hold'
FROM public.businesses AS b
WHERE b.telnyx_campaign_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.resource_type = 'campaign'
      AND lower(resource.provider_id)
        = lower(b.telnyx_campaign_id)
  );

INSERT INTO public.telnyx_managed_resources (
  business_id,
  resource_type,
  provider_id,
  ownership_state
)
SELECT
  b.id,
  'messaging_profile',
  lower(btrim(b.telnyx_messaging_profile_id)),
  'unverified_hold'
FROM public.businesses AS b
WHERE b.telnyx_messaging_profile_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.resource_type = 'messaging_profile'
      AND lower(resource.provider_id)
        = lower(b.telnyx_messaging_profile_id)
  );

INSERT INTO public.telnyx_managed_resources (
  business_id,
  resource_type,
  provider_id,
  ownership_state
)
SELECT
  b.id,
  'voice_application',
  btrim(b.telnyx_voice_application_id),
  'unverified_hold'
FROM public.businesses AS b
WHERE b.telnyx_voice_application_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.resource_type = 'voice_application'
      AND resource.provider_id = b.telnyx_voice_application_id
  );

INSERT INTO public.telnyx_managed_resources (
  business_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  ownership_state
)
SELECT
  pn.business_id,
  pn.id,
  'phone_number',
  CASE
    WHEN pn.business_id =
           'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
     AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g')
           = '15742133931'
      THEN NULL
    ELSE lower(btrim(pn.telnyx_phone_number_id))
  END,
  pn.phone_number,
  'unverified_hold'
FROM public.phone_numbers AS pn
WHERE NOT EXISTS (
  SELECT 1
  FROM public.telnyx_managed_resources AS resource
  WHERE resource.resource_type = 'phone_number'
    AND resource.business_id = pn.business_id
    AND resource.phone_number_id = pn.id
);

-- ============================================================================
-- H. Protection lookup and lifecycle helpers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.telnyx_release_protection_id(
  p_business_id uuid,
  p_resource_type text,
  p_provider_id text,
  p_canonical_e164 text,
  p_public_tcr_id text,
  p_expected_campaign_id text
) RETURNS uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT protection.id
  FROM public.telnyx_release_protections AS protection
  WHERE (
    protection.scope = 'business_all'
    AND protection.business_id = p_business_id
  ) OR (
    protection.scope = 'resource'
    AND (
      protection.business_id IS NULL
      OR protection.business_id = p_business_id
    )
    AND (
      protection.resource_type = p_resource_type
      OR (
        p_resource_type = 'phone_number_assignment'
        AND protection.resource_type IN ('phone_number', 'campaign')
      )
    )
    AND (
      (
        protection.provider_id IS NOT NULL
        AND p_provider_id IS NOT NULL
        AND lower(protection.provider_id) = lower(p_provider_id)
      )
      OR (
        protection.canonical_e164 IS NOT NULL
        AND protection.canonical_e164 = p_canonical_e164
      )
      OR (
        protection.public_tcr_id IS NOT NULL
        AND (
          upper(protection.public_tcr_id)
            = upper(COALESCE(p_public_tcr_id, ''))
          OR upper(protection.public_tcr_id)
            = upper(COALESCE(p_expected_campaign_id, ''))
          OR upper(protection.public_tcr_id)
            = upper(COALESCE(p_provider_id, ''))
        )
      )
    )
  )
  ORDER BY
    CASE protection.scope WHEN 'business_all' THEN 0 ELSE 1 END,
    protection.protection_key
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.account_reactivation_stripe_in_progress(
  p_business_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions AS stripe_action
    WHERE stripe_action.business_id = p_business_id
      AND stripe_action.desired_action = 'resume'
      AND (
        stripe_action.status = 'pending'
        OR (
          stripe_action.status = 'applied'
          AND stripe_action.applied_action IN ('resume', 'cancel')
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.refresh_telnyx_release_run(
  p_run_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_business_id uuid;
  v_release_at timestamptz;
  v_consumed_reason_count bigint;
  v_action_count bigint;
  v_nonterminal_count bigint;
  v_managed_count bigint;
  v_blocked_or_held_count bigint;
  v_retained_count bigint;
  v_new_status text;
BEGIN
  SELECT run.business_id
  INTO v_business_id
  FROM public.telnyx_resource_release_runs AS run
  WHERE run.id = p_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_release_run_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  SELECT run.*
  INTO v_run
  FROM public.telnyx_resource_release_runs AS run
  WHERE run.id = p_run_id
    AND run.business_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_release_run_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT
    min(reason.release_at) FILTER (WHERE reason.status = 'active'),
    count(*) FILTER (WHERE reason.status = 'consumed')
  INTO v_release_at, v_consumed_reason_count
  FROM public.telnyx_resource_release_reasons AS reason
  WHERE reason.run_id = p_run_id;

  SELECT
    count(*),
    count(*) FILTER (
      WHERE action.state NOT IN (
        'succeeded',
        'retained',
        'held',
        'blocked'
      )
    ),
    count(*) FILTER (
      WHERE action.classification = 'managed_releaseable'
    ),
    count(*) FILTER (
      WHERE action.state IN ('blocked', 'held')
    ),
    count(*) FILTER (
      WHERE action.state = 'retained'
    )
  INTO
    v_action_count,
    v_nonterminal_count,
    v_managed_count,
    v_blocked_or_held_count,
    v_retained_count
  FROM public.telnyx_resource_release_actions AS action
  WHERE action.run_id = p_run_id;

  IF v_release_at IS NULL THEN
    IF v_consumed_reason_count > 0
       AND v_run.status IN (
         'released',
         'protected_hold',
         'blocked'
       ) THEN
      v_new_status := v_run.status;
    ELSE
      v_new_status := 'canceled';
    END IF;
  ELSIF (
          v_release_at > now()
          OR (
            v_run.checkout_reservation_token IS NOT NULL
            AND v_run.checkout_reservation_expires_at > now()
          )
          OR public.account_reactivation_stripe_in_progress(
            v_run.business_id
          )
        )
        AND v_run.point_of_no_return_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.telnyx_resource_release_actions AS action
          WHERE action.run_id = p_run_id
            AND action.state IN ('leased', 'succeeded')
        ) THEN
    v_new_status := 'parked';
  ELSIF v_action_count = 0 THEN
    v_new_status := 'released';
  ELSIF v_nonterminal_count = 0 THEN
    IF v_blocked_or_held_count > 0 THEN
      v_new_status := 'blocked';
    ELSIF v_managed_count = 0 AND v_retained_count = v_action_count THEN
      v_new_status := 'protected_hold';
    ELSE
      v_new_status := 'released';
    END IF;
  ELSIF EXISTS (
    SELECT 1
    FROM public.telnyx_resource_release_actions AS action
    WHERE action.run_id = p_run_id
      AND action.state = 'leased'
  ) OR v_run.point_of_no_return_at IS NOT NULL THEN
    v_new_status := 'releasing';
  ELSIF v_blocked_or_held_count > 0 THEN
    v_new_status := 'blocked';
  ELSE
    v_new_status := 'release_pending';
  END IF;

  UPDATE public.telnyx_resource_release_runs
  SET status = v_new_status,
      effective_release_at = COALESCE(
        v_release_at,
        effective_release_at
      ),
      completed_at = CASE
        WHEN v_new_status IN (
          'released',
          'protected_hold',
          'canceled'
        ) THEN COALESCE(completed_at, now())
        ELSE completed_at
      END,
      support_required_at = CASE
        WHEN v_new_status = 'blocked'
          THEN COALESCE(support_required_at, now())
        ELSE support_required_at
      END,
      updated_at = now()
  WHERE id = p_run_id;

  UPDATE public.businesses
  SET telnyx_resource_state = CASE v_new_status
        WHEN 'parked' THEN 'parked'
        WHEN 'release_pending' THEN 'release_pending'
        WHEN 'releasing' THEN 'releasing'
        WHEN 'released' THEN 'released'
        WHEN 'blocked' THEN 'blocked'
        WHEN 'protected_hold' THEN 'protected_hold'
        WHEN 'canceled' THEN v_run.previous_resource_state
      END,
      telnyx_resource_state_updated_at = now(),
      active_telnyx_release_run_id = CASE
        WHEN v_new_status = 'canceled'
         AND active_telnyx_release_run_id = p_run_id
          THEN NULL
        ELSE active_telnyx_release_run_id
      END
  WHERE id = v_run.business_id;

  IF v_new_status = 'canceled' THEN
    UPDATE public.phone_numbers AS pn
    SET resource_status = action.previous_resource_status,
        parked_at = CASE
          WHEN action.previous_resource_status IN (
            'parked',
            'blocked',
            'protected_hold'
          ) THEN pn.parked_at
          ELSE NULL
        END,
        release_started_at = CASE
          WHEN action.previous_resource_status = 'releasing'
            THEN pn.release_started_at
          ELSE NULL
        END
    FROM public.telnyx_resource_release_actions AS action
    WHERE action.run_id = p_run_id
      AND action.business_id = v_run.business_id
      AND action.resource_type = 'phone_number'
      AND action.phone_number_id = pn.id
      AND pn.business_id = v_run.business_id
      AND pn.resource_status <> 'released';
  ELSE
    UPDATE public.phone_numbers
    SET resource_status = CASE v_new_status
          WHEN 'parked' THEN 'parked'
          WHEN 'release_pending' THEN 'parked'
          WHEN 'releasing' THEN 'releasing'
          WHEN 'blocked' THEN 'blocked'
          WHEN 'protected_hold' THEN 'protected_hold'
          ELSE resource_status
        END,
        parked_at = CASE
          WHEN v_new_status IN (
            'parked',
            'release_pending',
            'blocked',
            'protected_hold'
          ) THEN COALESCE(parked_at, now())
          ELSE parked_at
        END,
        release_started_at = CASE
          WHEN v_new_status = 'releasing'
            THEN COALESCE(release_started_at, now())
          ELSE release_started_at
        END
    WHERE business_id = v_run.business_id
      AND resource_status <> 'released';
  END IF;

  RETURN v_new_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_telnyx_release_actions(
  p_run_id uuid,
  p_business_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate record;
  v_protection_id uuid;
  v_hard_protected boolean;
  v_classification text;
  v_desired_action text;
  v_state text;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_release_business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM 1
  FROM public.telnyx_resource_release_runs
  WHERE id = p_run_id
    AND business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_release_run_business_mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Migration-first capture: resources created before later application
  -- chunks deploy are still snapshotted as unverified_hold.
  INSERT INTO public.telnyx_managed_resources (
    business_id,
    resource_type,
    provider_id,
    public_tcr_id,
    provider_origin,
    ownership_state
  )
  SELECT
    b.id,
    'brand',
    lower(btrim(b.telnyx_brand_id)),
    (
      SELECT request.tcr_brand_id
      FROM public.telnyx_brand_link_requests AS request
      WHERE request.business_id = b.id
        AND lower(request.telnyx_brand_id)
          = lower(b.telnyx_brand_id)
      ORDER BY request.consumed_at DESC NULLS LAST, request.id::text
      LIMIT 1
    ),
    b.telnyx_brand_source,
    'unverified_hold'
  FROM public.businesses AS b
  WHERE b.id = p_business_id
    AND b.telnyx_brand_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = b.id
        AND resource.resource_type = 'brand'
        AND lower(resource.provider_id)
          = lower(b.telnyx_brand_id)
    );

  INSERT INTO public.telnyx_managed_resources (
    business_id,
    resource_type,
    provider_id,
    public_tcr_id,
    ownership_state
  )
  SELECT
    b.id,
    'campaign',
    upper(btrim(b.telnyx_campaign_id)),
    upper(btrim(b.telnyx_campaign_id)),
    'unverified_hold'
  FROM public.businesses AS b
  WHERE b.id = p_business_id
    AND b.telnyx_campaign_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = b.id
        AND resource.resource_type = 'campaign'
        AND lower(resource.provider_id)
          = lower(b.telnyx_campaign_id)
    );

  INSERT INTO public.telnyx_managed_resources (
    business_id,
    resource_type,
    provider_id,
    ownership_state
  )
  SELECT
    b.id,
    'messaging_profile',
    lower(btrim(b.telnyx_messaging_profile_id)),
    'unverified_hold'
  FROM public.businesses AS b
  WHERE b.id = p_business_id
    AND b.telnyx_messaging_profile_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = b.id
        AND resource.resource_type = 'messaging_profile'
        AND lower(resource.provider_id)
          = lower(b.telnyx_messaging_profile_id)
    );

  INSERT INTO public.telnyx_managed_resources (
    business_id,
    resource_type,
    provider_id,
    ownership_state
  )
  SELECT
    b.id,
    'voice_application',
    btrim(b.telnyx_voice_application_id),
    'unverified_hold'
  FROM public.businesses AS b
  WHERE b.id = p_business_id
    AND b.telnyx_voice_application_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = b.id
        AND resource.resource_type = 'voice_application'
        AND resource.provider_id = b.telnyx_voice_application_id
    );

  INSERT INTO public.telnyx_managed_resources (
    business_id,
    phone_number_id,
    resource_type,
    provider_id,
    canonical_e164,
    ownership_state
  )
  SELECT
    pn.business_id,
    pn.id,
    'phone_number',
    CASE
      WHEN pn.business_id =
             'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
       AND regexp_replace(pn.phone_number, '[^0-9]', '', 'g')
             = '15742133931'
        THEN NULL
      WHEN pn.telnyx_phone_number_id ~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN lower(btrim(pn.telnyx_phone_number_id))
      ELSE NULL
    END,
    pn.phone_number,
    'unverified_hold'
  FROM public.phone_numbers AS pn
  WHERE pn.business_id = p_business_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.resource_type = 'phone_number'
        AND resource.business_id = pn.business_id
        AND resource.phone_number_id = pn.id
    );

  FOR v_candidate IN
    WITH candidates AS (
      SELECT
        resource.id AS managed_resource_id,
        pn.id AS phone_number_id,
        'phone_number_assignment'::text AS resource_type,
        resource.provider_id,
        resource.canonical_e164,
        pn.telnyx_campaign_assignment_campaign_id AS public_tcr_id,
        NULL::text AS expected_parent_brand_id,
        pn.telnyx_campaign_assignment_campaign_id
          AS expected_parent_campaign_id,
        pn.resource_status AS previous_resource_status,
        resource.ownership_state,
        10::smallint AS action_order,
        'unassign'::text AS ordinary_action
      FROM public.phone_numbers AS pn
      JOIN public.telnyx_managed_resources AS resource
        ON resource.phone_number_id = pn.id
       AND resource.business_id = pn.business_id
       AND resource.resource_type = 'phone_number'
      WHERE pn.business_id = p_business_id
        AND pn.telnyx_campaign_assignment_campaign_id IS NOT NULL
        AND pn.telnyx_campaign_assignment_status <> 'unassigned'

      UNION ALL

      SELECT
        resource.id,
        resource.phone_number_id,
        'phone_number',
        resource.provider_id,
        resource.canonical_e164,
        NULL,
        NULL,
        NULL,
        pn.resource_status,
        resource.ownership_state,
        20::smallint,
        'release'
      FROM public.telnyx_managed_resources AS resource
      JOIN public.phone_numbers AS pn
        ON pn.id = resource.phone_number_id
       AND pn.business_id = resource.business_id
      WHERE resource.business_id = p_business_id
        AND resource.resource_type = 'phone_number'
        AND resource.ownership_state <> 'released'

      UNION ALL

      SELECT
        resource.id,
        NULL,
        'campaign',
        resource.provider_id,
        NULL,
        resource.public_tcr_id,
        (
          SELECT b.telnyx_brand_id
          FROM public.businesses AS b
          WHERE b.id = p_business_id
        ),
        NULL,
        NULL::text,
        resource.ownership_state,
        30::smallint,
        'deactivate'
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.resource_type = 'campaign'
        AND resource.ownership_state <> 'released'

      UNION ALL

      SELECT
        resource.id,
        NULL,
        'messaging_profile',
        resource.provider_id,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL::text,
        resource.ownership_state,
        40::smallint,
        'delete'
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.resource_type = 'messaging_profile'
        AND resource.ownership_state <> 'released'

      UNION ALL

      SELECT
        resource.id,
        NULL,
        'voice_application',
        resource.provider_id,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL::text,
        resource.ownership_state,
        50::smallint,
        'delete'
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.resource_type = 'voice_application'
        AND resource.ownership_state <> 'released'

      UNION ALL

      SELECT
        resource.id,
        NULL,
        'brand',
        resource.provider_id,
        NULL,
        resource.public_tcr_id,
        NULL,
        NULL,
        NULL::text,
        resource.ownership_state,
        60::smallint,
        'retain'
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.resource_type = 'brand'
        AND resource.ownership_state <> 'released'
    )
    SELECT *
    FROM candidates
    ORDER BY action_order, resource_type, managed_resource_id::text
  LOOP
    v_protection_id := public.telnyx_release_protection_id(
      p_business_id,
      v_candidate.resource_type,
      v_candidate.provider_id,
      v_candidate.canonical_e164,
      v_candidate.public_tcr_id,
      v_candidate.expected_parent_campaign_id
    );

    v_hard_protected :=
      p_business_id =
        'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
      OR v_candidate.canonical_e164 = '+15742133931'
      OR upper(COALESCE(v_candidate.provider_id, ''))
           IN ('CYLIGTZ', 'BL69PDP')
      OR upper(COALESCE(v_candidate.public_tcr_id, ''))
           IN ('CYLIGTZ', 'BL69PDP')
      OR upper(COALESCE(
           v_candidate.expected_parent_campaign_id,
           ''
         )) = 'CYLIGTZ';

    IF v_hard_protected OR v_protection_id IS NOT NULL THEN
      v_classification := 'protected_retain';
      v_desired_action := 'retain';
      v_state := 'retained';
    ELSIF v_candidate.resource_type = 'brand' THEN
      -- Brands are retained in v1, including created_by_simplassist brands.
      v_classification := 'policy_retain';
      v_desired_action := 'retain';
      v_state := 'retained';
    ELSIF v_candidate.ownership_state = 'managed_releaseable' THEN
      v_classification := 'managed_releaseable';
      v_desired_action := v_candidate.ordinary_action;
      v_state := 'pending';
    ELSE
      v_classification := 'unverified_hold';
      v_desired_action := 'hold';
      v_state := 'held';
    END IF;

    INSERT INTO public.telnyx_resource_release_actions (
      run_id,
      business_id,
      managed_resource_id,
      phone_number_id,
      protection_id,
      resource_type,
      provider_id,
      canonical_e164,
      public_tcr_id,
      expected_parent_brand_id,
      expected_parent_campaign_id,
      previous_resource_status,
      classification,
      desired_action,
      state,
      action_order,
      support_required_at,
      last_error_code
    )
    SELECT
      p_run_id,
      p_business_id,
      v_candidate.managed_resource_id,
      v_candidate.phone_number_id,
      v_protection_id,
      v_candidate.resource_type,
      v_candidate.provider_id,
      v_candidate.canonical_e164,
      v_candidate.public_tcr_id,
      v_candidate.expected_parent_brand_id,
      v_candidate.expected_parent_campaign_id,
      v_candidate.previous_resource_status,
      v_classification,
      v_desired_action,
      v_state,
      v_candidate.action_order,
      CASE
        WHEN v_state = 'held' THEN now()
        ELSE NULL
      END,
      CASE
        WHEN v_state = 'held' THEN 'ownership_unverified'
        ELSE NULL
      END
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.telnyx_resource_release_actions AS existing
      WHERE existing.run_id = p_run_id
        AND existing.resource_type = v_candidate.resource_type
        AND existing.managed_resource_id
          IS NOT DISTINCT FROM v_candidate.managed_resource_id
        AND existing.phone_number_id
          IS NOT DISTINCT FROM v_candidate.phone_number_id
        AND existing.canonical_e164
          IS NOT DISTINCT FROM v_candidate.canonical_e164
        AND existing.public_tcr_id
          IS NOT DISTINCT FROM v_candidate.public_tcr_id
    );
  END LOOP;

  PERFORM public.refresh_telnyx_release_run(p_run_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_telnyx_release_reason(
  p_business_id uuid,
  p_reason_type text,
  p_triggered_at timestamptz,
  p_release_at timestamptz,
  p_source_subscription_id text,
  p_source_event_id text,
  p_actor text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_reason public.telnyx_resource_release_reasons%ROWTYPE;
  v_reason_run record;
  v_generation bigint;
BEGIN
  IF p_reason_type IS NULL
     OR p_reason_type NOT IN (
       'subscription_ended',
       'account_deletion'
     ) THEN
    RAISE EXCEPTION 'invalid_telnyx_release_reason'
      USING ERRCODE = '22023';
  END IF;

  IF p_triggered_at IS NULL OR p_release_at IS NULL THEN
    RAISE EXCEPTION 'telnyx_release_timestamps_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_reason_type = 'subscription_ended'
     AND p_release_at <> p_triggered_at + interval '30 days' THEN
    RAISE EXCEPTION 'invalid_subscription_release_deadline'
      USING ERRCODE = '22007';
  END IF;

  IF p_reason_type = 'account_deletion'
     AND p_release_at <> p_triggered_at + interval '60 days' THEN
    RAISE EXCEPTION 'invalid_account_deletion_release_deadline'
      USING ERRCODE = '22007';
  END IF;

  IF p_actor IS NULL
     OR btrim(p_actor) = ''
     OR length(p_actor) > 128 THEN
    RAISE EXCEPTION 'telnyx_release_actor_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'telnyx_release_business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  -- cleanup_expired_business calls this before its first mutation. Serialize
  -- with prepare/complete reactivation on the business row and defer cleanup
  -- while an already-started checkout owns an unexpired reservation.
  IF p_reason_type = 'account_deletion'
     AND p_actor = 'account_cleanup'
     AND (
       EXISTS (
         SELECT 1
         FROM public.telnyx_resource_release_runs AS reserved_run
         WHERE reserved_run.id =
                 v_business.active_telnyx_release_run_id
           AND reserved_run.business_id = p_business_id
           AND reserved_run.checkout_reservation_token IS NOT NULL
           AND reserved_run.checkout_reservation_expires_at > now()
           AND reserved_run.point_of_no_return_at IS NULL
       )
       OR public.account_reactivation_stripe_in_progress(
         p_business_id
       )
     ) THEN
    RAISE EXCEPTION
      'business % has an active reactivation reservation',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT reason AS reason_row, run AS run_row
  INTO v_reason_run
  FROM public.telnyx_resource_release_reasons AS reason
  JOIN public.telnyx_resource_release_runs AS run
    ON run.id = reason.run_id
  WHERE reason.business_id = p_business_id
    AND reason.reason_type = p_reason_type
    AND reason.status = 'active'
  ORDER BY reason.created_at, reason.id::text
  LIMIT 1
  FOR UPDATE OF reason, run;

  IF FOUND THEN
    v_reason := v_reason_run.reason_row;
    v_run := v_reason_run.run_row;

    IF v_reason.triggered_at IS DISTINCT FROM p_triggered_at
       OR v_reason.release_at IS DISTINCT FROM p_release_at
       OR v_reason.source_subscription_id
            IS DISTINCT FROM p_source_subscription_id
       OR v_reason.source_event_id
            IS DISTINCT FROM p_source_event_id THEN
      RAISE EXCEPTION 'telnyx_release_reason_identity_mismatch'
        USING ERRCODE = '23514';
    END IF;

    PERFORM public.snapshot_telnyx_release_actions(
      v_reason.run_id,
      p_business_id
    );
    RETURN v_reason.run_id;
  END IF;

  IF v_business.active_telnyx_release_run_id IS NOT NULL THEN
    SELECT run.*
    INTO v_run
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.id = v_business.active_telnyx_release_run_id
      AND run.business_id = p_business_id
      AND run.status NOT IN ('released', 'canceled')
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    SELECT COALESCE(max(run.generation), 0) + 1
    INTO v_generation
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.business_id = p_business_id;

    INSERT INTO public.telnyx_resource_release_runs (
      business_id,
      generation,
      previous_resource_state,
      status,
      effective_release_at
    ) VALUES (
      p_business_id,
      v_generation,
      v_business.telnyx_resource_state,
      'parked',
      p_release_at
    )
    RETURNING * INTO v_run;

    UPDATE public.businesses
    SET active_telnyx_release_run_id = v_run.id,
        telnyx_resource_state = 'parked',
        telnyx_resource_state_updated_at = now()
    WHERE id = p_business_id;
  END IF;

  INSERT INTO public.telnyx_resource_release_reasons (
    run_id,
    business_id,
    reason_type,
    status,
    triggered_at,
    release_at,
    source_subscription_id,
    source_event_id,
    actor
  ) VALUES (
    v_run.id,
    p_business_id,
    p_reason_type,
    'active',
    p_triggered_at,
    p_release_at,
    p_source_subscription_id,
    p_source_event_id,
    p_actor
  )
  RETURNING * INTO v_reason;

  PERFORM public.snapshot_telnyx_release_actions(
    v_run.id,
    p_business_id
  );

  INSERT INTO public.telnyx_resource_release_events (
    run_id,
    business_id,
    event_type,
    new_state,
    reason_code,
    actor
  ) VALUES (
    v_run.id,
    p_business_id,
    'reason_added',
    'active',
    p_reason_type,
    p_actor
  );

  RETURN v_run.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_telnyx_release_reason(
  p_business_id uuid,
  p_reason_type text,
  p_actor text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reason public.telnyx_resource_release_reasons%ROWTYPE;
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_reason_run record;
BEGIN
  IF p_reason_type IS NULL
     OR p_reason_type NOT IN (
       'subscription_ended',
       'account_deletion'
     ) THEN
    RAISE EXCEPTION 'invalid_telnyx_release_reason'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT reason AS reason_row, run AS run_row
  INTO v_reason_run
  FROM public.telnyx_resource_release_reasons AS reason
  JOIN public.telnyx_resource_release_runs AS run
    ON run.id = reason.run_id
  WHERE reason.business_id = p_business_id
    AND reason.reason_type = p_reason_type
    AND reason.status = 'active'
  ORDER BY reason.created_at, reason.id::text
  LIMIT 1
  FOR UPDATE OF reason, run;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_reason := v_reason_run.reason_row;
  v_run := v_reason_run.run_row;

  IF v_run.point_of_no_return_at IS NOT NULL
     OR (
       v_run.effective_release_at <= now()
       AND NOT (
         (
           v_run.checkout_reservation_token IS NOT NULL
           AND v_run.checkout_reservation_expires_at > now()
         )
         OR EXISTS (
           SELECT 1
           FROM public.account_deletion_stripe_actions AS stripe_action
           WHERE stripe_action.business_id = p_business_id
             AND stripe_action.desired_action = 'resume'
             AND stripe_action.status = 'applied'
             AND stripe_action.applied_action IN ('resume', 'cancel')
         )
       )
     )
     OR v_run.status IN (
       'releasing',
       'released',
       'blocked',
       'protected_hold'
     )
     OR EXISTS (
       SELECT 1
       FROM public.telnyx_resource_release_actions AS action
       WHERE action.run_id = v_run.id
         AND action.state IN ('leased', 'succeeded')
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.telnyx_resource_release_reasons
  SET status = 'canceled',
      canceled_at = now(),
      updated_at = now()
  WHERE id = v_reason.id;

  INSERT INTO public.telnyx_resource_release_events (
    run_id,
    business_id,
    event_type,
    previous_state,
    new_state,
    reason_code,
    actor
  ) VALUES (
    v_run.id,
    p_business_id,
    'reason_canceled',
    'active',
    'canceled',
    p_reason_type,
    p_actor
  );

  PERFORM public.refresh_telnyx_release_run(v_run.id);
  RETURN true;
END;
$$;

-- ============================================================================
-- I. Remote-action claim and completion RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_telnyx_release_action(
  p_worker text,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config public.telnyx_resource_release_config%ROWTYPE;
  v_action public.telnyx_resource_release_actions%ROWTYPE;
  v_protection_id uuid;
  v_due_run record;
  v_current_fingerprint text;
  v_previous_action_state text;
  v_candidate_action_id uuid;
  v_candidate_business_id uuid;
BEGIN
  IF p_worker IS NULL OR btrim(p_worker) = '' THEN
    RAISE EXCEPTION 'telnyx_release_worker_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_lease_seconds IS NULL
     OR p_lease_seconds < 1
     OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'telnyx_release_lease_out_of_range'
      USING ERRCODE = '22023';
  END IF;

  SELECT config.*
  INTO v_config
  FROM public.telnyx_resource_release_config AS config
  WHERE config.id = 1;

  IF NOT FOUND OR v_config.mode = 'disabled' THEN
    RETURN NULL;
  END IF;

  v_current_fingerprint :=
    public.telnyx_release_manifest_fingerprint(
      v_config.expected_shared_messaging_profile_id,
      v_config.expected_shared_voice_application_id
    );

  IF v_current_fingerprint IS NULL
     OR v_config.protection_manifest_fingerprint IS DISTINCT FROM
          v_current_fingerprint
     OR v_config.protection_manifest_verified_at IS NULL
     OR v_config.protection_manifest_verified_by IS NULL
     OR v_config.dry_run_completed_at IS NULL
     OR v_config.dry_run_completed_by IS NULL
     OR (
       v_config.mode = 'enabled'
       AND (
         v_config.single_business_test_completed_at IS NULL
         OR v_config.single_business_test_completed_by IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'telnyx_release_configuration_not_ready'
      USING ERRCODE = '55000';
  END IF;

  FOR v_due_run IN
    SELECT run.id
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.effective_release_at <= now()
      AND run.status IN ('parked', 'release_pending')
      AND (
        run.checkout_reservation_token IS NULL
        OR run.checkout_reservation_expires_at <= now()
      )
      AND NOT public.account_reactivation_stripe_in_progress(
        run.business_id
      )
    ORDER BY run.effective_release_at, run.id::text
    LIMIT 100
  LOOP
    PERFORM public.refresh_telnyx_release_run(v_due_run.id);
  END LOOP;

  LOOP
    SELECT action.id, action.business_id
    INTO v_candidate_action_id, v_candidate_business_id
    FROM public.telnyx_resource_release_actions AS action
    JOIN public.telnyx_resource_release_runs AS run
      ON run.id = action.run_id
     AND run.business_id = action.business_id
    JOIN public.telnyx_managed_resources AS resource
      ON resource.id = action.managed_resource_id
     AND resource.business_id = action.business_id
     AND resource.resource_type = CASE
       WHEN action.resource_type = 'phone_number_assignment'
         THEN 'phone_number'
       ELSE action.resource_type
     END
     AND resource.provider_id IS NOT DISTINCT FROM action.provider_id
     AND resource.canonical_e164 IS NOT DISTINCT FROM action.canonical_e164
     AND (
       action.resource_type = 'phone_number_assignment'
       OR resource.public_tcr_id IS NOT DISTINCT FROM action.public_tcr_id
     )
    WHERE action.classification = 'managed_releaseable'
      AND resource.ownership_state = 'managed_releaseable'
      AND resource.local_claim_active IS TRUE
      AND action.state IN ('pending', 'retryable', 'leased')
      AND (
        action.state <> 'retryable'
        OR action.next_retry_at IS NULL
        OR action.next_retry_at <= now()
      )
      AND (
        action.state <> 'leased'
        OR action.lease_expires_at <= now()
      )
      AND run.status IN ('release_pending', 'releasing')
      AND run.effective_release_at <= now()
      AND EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_reasons AS reason
        WHERE reason.run_id = run.id
          AND reason.business_id = run.business_id
          AND reason.status = 'active'
          AND reason.release_at <= now()
      )
      AND (
        run.checkout_reservation_token IS NULL
        OR run.checkout_reservation_expires_at <= now()
      )
      AND NOT public.account_reactivation_stripe_in_progress(
        run.business_id
      )
      AND (
        v_config.mode <> 'single_business'
        OR run.business_id = v_config.single_business_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS unsafe
        WHERE unsafe.run_id = run.id
          AND (
            unsafe.classification = 'unverified_hold'
            OR unsafe.state = 'blocked'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS earlier
        WHERE earlier.run_id = action.run_id
          AND earlier.action_order < action.action_order
          AND earlier.state NOT IN ('succeeded', 'retained')
      )
    ORDER BY
      run.effective_release_at,
      action.action_order,
      action.id::text
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    PERFORM 1
    FROM public.businesses AS business
    WHERE business.id = v_candidate_business_id
    FOR UPDATE;

    SELECT action.*
    INTO v_action
    FROM public.telnyx_resource_release_actions AS action
    JOIN public.telnyx_resource_release_runs AS run
      ON run.id = action.run_id
     AND run.business_id = action.business_id
    JOIN public.telnyx_managed_resources AS resource
      ON resource.id = action.managed_resource_id
     AND resource.business_id = action.business_id
     AND resource.resource_type = CASE
       WHEN action.resource_type = 'phone_number_assignment'
         THEN 'phone_number'
       ELSE action.resource_type
     END
     AND resource.provider_id IS NOT DISTINCT FROM action.provider_id
     AND resource.canonical_e164 IS NOT DISTINCT FROM action.canonical_e164
     AND (
       action.resource_type = 'phone_number_assignment'
       OR resource.public_tcr_id IS NOT DISTINCT FROM action.public_tcr_id
     )
    WHERE action.id = v_candidate_action_id
      AND action.classification = 'managed_releaseable'
      AND resource.ownership_state = 'managed_releaseable'
      AND resource.local_claim_active IS TRUE
      AND action.state IN ('pending', 'retryable', 'leased')
      AND (
        action.state <> 'retryable'
        OR action.next_retry_at IS NULL
        OR action.next_retry_at <= now()
      )
      AND (
        action.state <> 'leased'
        OR action.lease_expires_at <= now()
      )
      AND run.status IN ('release_pending', 'releasing')
      AND run.effective_release_at <= now()
      AND EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_reasons AS reason
        WHERE reason.run_id = run.id
          AND reason.business_id = run.business_id
          AND reason.status = 'active'
          AND reason.release_at <= now()
      )
      AND (
        run.checkout_reservation_token IS NULL
        OR run.checkout_reservation_expires_at <= now()
      )
      AND NOT public.account_reactivation_stripe_in_progress(
        run.business_id
      )
      AND (
        v_config.mode <> 'single_business'
        OR run.business_id = v_config.single_business_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS unsafe
        WHERE unsafe.run_id = run.id
          AND (
            unsafe.classification = 'unverified_hold'
            OR unsafe.state = 'blocked'
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS earlier
        WHERE earlier.run_id = action.run_id
          AND earlier.action_order < action.action_order
          AND earlier.state NOT IN ('succeeded', 'retained')
      )
    ORDER BY
      run.effective_release_at,
      action.action_order,
      action.id::text
    LIMIT 1
    FOR UPDATE OF run, action SKIP LOCKED;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    v_protection_id := public.telnyx_release_protection_id(
      v_action.business_id,
      v_action.resource_type,
      v_action.provider_id,
      v_action.canonical_e164,
      v_action.public_tcr_id,
      v_action.expected_parent_campaign_id
    );

    IF v_action.business_id =
         'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
       OR v_action.canonical_e164 = '+15742133931'
       OR upper(COALESCE(v_action.provider_id, ''))
            IN ('CYLIGTZ', 'BL69PDP')
       OR upper(COALESCE(v_action.public_tcr_id, ''))
            IN ('CYLIGTZ', 'BL69PDP')
       OR upper(COALESCE(
            v_action.expected_parent_campaign_id,
            ''
          )) = 'CYLIGTZ'
       OR v_protection_id IS NOT NULL THEN
      UPDATE public.telnyx_resource_release_actions
      SET classification = 'protected_retain',
          desired_action = 'retain',
          state = 'retained',
          protection_id = v_protection_id,
          lease_token = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          lease_authorization_epoch = NULL,
          updated_at = now()
      WHERE id = v_action.id;

      PERFORM public.refresh_telnyx_release_run(v_action.run_id);
      CONTINUE;
    END IF;

    v_previous_action_state := v_action.state;

    UPDATE public.telnyx_resource_release_actions
    SET state = 'leased',
        lease_token = gen_random_uuid(),
        lease_owner = p_worker,
        lease_expires_at =
          now() + make_interval(secs => p_lease_seconds),
        lease_authorization_epoch = v_config.authorization_epoch,
        attempt_count = attempt_count + 1,
        next_retry_at = NULL,
        updated_at = now()
    WHERE id = v_action.id
    RETURNING * INTO v_action;

    UPDATE public.telnyx_resource_release_runs
    SET status = 'releasing',
        point_of_no_return_at =
          COALESCE(point_of_no_return_at, now()),
        updated_at = now()
    WHERE id = v_action.run_id;

    UPDATE public.businesses
    SET telnyx_resource_state = 'releasing',
        telnyx_resource_state_updated_at = now()
    WHERE id = v_action.business_id;

    IF v_action.phone_number_id IS NOT NULL THEN
      UPDATE public.phone_numbers
      SET resource_status = 'releasing',
          release_started_at =
            COALESCE(release_started_at, now())
      WHERE id = v_action.phone_number_id
        AND resource_status <> 'released';
    END IF;

    INSERT INTO public.telnyx_resource_release_events (
      run_id,
      action_id,
      business_id,
      event_type,
      previous_state,
      new_state,
      actor,
      attempt_number
    ) VALUES (
      v_action.run_id,
      v_action.id,
      v_action.business_id,
      'action_claimed',
      v_previous_action_state,
      'leased',
      p_worker,
      v_action.attempt_count
    );

    RETURN to_jsonb(v_action);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.authorize_telnyx_remote_mutation(
  p_business_id uuid,
  p_context text,
  p_operation text,
  p_provider_id text,
  p_action_id uuid,
  p_lease_token uuid,
  p_expected_shared_messaging_profile_id text,
  p_expected_shared_voice_application_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_config public.telnyx_resource_release_config%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_action public.telnyx_resource_release_actions%ROWTYPE;
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_action_run record;
  v_resource public.telnyx_managed_resources%ROWTYPE;
  v_phone public.phone_numbers%ROWTYPE;
  v_current_fingerprint text;
  v_protection_id uuid;
  v_provider_id text;
  v_canonical_e164 text;
  v_public_tcr_id text;
  v_expected_parent_campaign_id text;
  v_resource_type text;
  v_expected_operation text;
  v_has_account_deletion_reason boolean;
BEGIN
  IF p_context IS NULL
     OR p_context NOT IN ('release_worker', 'rejection_recovery')
     OR p_operation IS NULL
     OR p_operation NOT IN (
       'release_phone_number',
       'unassign_phone_number_campaign',
       'deactivate_campaign',
       'delete_brand',
       'delete_messaging_profile',
       'delete_voice_application'
     ) THEN
    RAISE EXCEPTION 'invalid_telnyx_remote_mutation_request'
      USING ERRCODE = '22023';
  END IF;

  SELECT config.*
  INTO v_config
  FROM public.telnyx_resource_release_config AS config
  WHERE config.id = 1
  FOR SHARE;

  IF FOUND THEN
    v_current_fingerprint :=
      public.telnyx_release_manifest_fingerprint(
        v_config.expected_shared_messaging_profile_id,
        v_config.expected_shared_voice_application_id
      );
  END IF;

  IF NOT FOUND
     OR v_config.mode = 'disabled'
     OR lower(btrim(COALESCE(
          v_config.expected_shared_messaging_profile_id,
          ''
        ))) <> lower(btrim(COALESCE(
          p_expected_shared_messaging_profile_id,
          ''
        )))
     OR btrim(COALESCE(
          v_config.expected_shared_voice_application_id,
          ''
        )) <> btrim(COALESCE(
          p_expected_shared_voice_application_id,
          ''
        ))
     OR v_current_fingerprint IS NULL
     OR v_config.protection_manifest_fingerprint IS DISTINCT FROM
          v_current_fingerprint
     OR v_config.protection_manifest_verified_at IS NULL
     OR v_config.protection_manifest_verified_by IS NULL
     OR v_config.dry_run_completed_at IS NULL
     OR v_config.dry_run_completed_by IS NULL
     OR (
       v_config.mode = 'enabled'
       AND (
         v_config.single_business_test_completed_at IS NULL
         OR v_config.single_business_test_completed_by IS NULL
       )
     )
     OR (
       v_config.mode = 'single_business'
       AND v_config.single_business_id IS DISTINCT FROM p_business_id
     ) THEN
    IF p_context = 'release_worker'
       AND p_action_id IS NOT NULL
       AND p_lease_token IS NOT NULL THEN
      UPDATE public.telnyx_resource_release_actions
      SET state = 'pending',
          lease_token = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          lease_authorization_epoch = NULL,
          updated_at = now()
      WHERE id = p_action_id
        AND business_id = p_business_id
        AND state = 'leased'
        AND lease_token = p_lease_token;
    END IF;

    RETURN NULL;
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR SHARE;

  IF NOT FOUND
     OR v_business.id =
          'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
     OR v_business.telnyx_unique_claims_released_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF p_context = 'release_worker' THEN
    IF p_action_id IS NULL OR p_lease_token IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT action AS action_row, run AS run_row
    INTO v_action_run
    FROM public.telnyx_resource_release_actions AS action
    JOIN public.telnyx_resource_release_runs AS run
      ON run.id = action.run_id
     AND run.business_id = action.business_id
    WHERE action.id = p_action_id
      AND action.business_id = p_business_id
    FOR UPDATE OF action, run;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    v_action := v_action_run.action_row;
    v_run := v_action_run.run_row;

    IF v_action.state <> 'leased'
       OR v_action.lease_token IS DISTINCT FROM p_lease_token
       OR v_action.lease_expires_at <= now()
       OR v_action.lease_authorization_epoch IS DISTINCT FROM
            v_config.authorization_epoch
       OR v_action.classification <> 'managed_releaseable'
       OR v_run.status <> 'releasing'
       OR v_run.effective_release_at > now()
       OR v_run.point_of_no_return_at IS NULL
       OR v_business.active_telnyx_release_run_id IS DISTINCT FROM
            v_run.id
       OR v_business.telnyx_resource_state <> 'releasing'
       OR public.account_reactivation_stripe_in_progress(
         p_business_id
       )
       OR NOT EXISTS (
         SELECT 1
         FROM public.telnyx_resource_release_reasons AS reason
         WHERE reason.run_id = v_run.id
           AND reason.business_id = p_business_id
           AND reason.status = 'active'
           AND reason.release_at <= now()
       ) THEN
      RETURN NULL;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.telnyx_resource_release_reasons AS reason
      WHERE reason.run_id = v_run.id
        AND reason.business_id = p_business_id
        AND reason.reason_type = 'account_deletion'
        AND reason.status = 'active'
    )
    INTO v_has_account_deletion_reason;

    IF (v_has_account_deletion_reason AND v_business.deleted_at IS NULL)
       OR (
         NOT v_has_account_deletion_reason
         AND v_business.deleted_at IS NOT NULL
       ) THEN
      RETURN NULL;
    END IF;

    SELECT resource.*
    INTO v_resource
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.id = v_action.managed_resource_id
      AND resource.business_id = p_business_id
      AND resource.resource_type = CASE
        WHEN v_action.resource_type = 'phone_number_assignment'
          THEN 'phone_number'
        ELSE v_action.resource_type
      END
      AND resource.provider_id IS NOT DISTINCT FROM
            v_action.provider_id
      AND resource.canonical_e164 IS NOT DISTINCT FROM
            v_action.canonical_e164
      AND (
        v_action.resource_type = 'phone_number_assignment'
        OR resource.public_tcr_id IS NOT DISTINCT FROM
             v_action.public_tcr_id
      )
      AND resource.ownership_state = 'managed_releaseable'
      AND resource.local_claim_active IS TRUE
    FOR SHARE;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    v_resource_type := v_action.resource_type;
    v_provider_id := v_action.provider_id;
    v_canonical_e164 := v_action.canonical_e164;
    v_public_tcr_id := v_action.public_tcr_id;
    v_expected_parent_campaign_id :=
      v_action.expected_parent_campaign_id;

    v_expected_operation := CASE v_action.resource_type
      WHEN 'phone_number_assignment'
        THEN 'unassign_phone_number_campaign'
      WHEN 'phone_number' THEN 'release_phone_number'
      WHEN 'campaign' THEN 'deactivate_campaign'
      WHEN 'messaging_profile' THEN 'delete_messaging_profile'
      WHEN 'voice_application' THEN 'delete_voice_application'
      ELSE NULL
    END;

    IF v_expected_operation IS DISTINCT FROM p_operation
       OR v_provider_id IS DISTINCT FROM p_provider_id THEN
      RETURN NULL;
    END IF;

    IF v_action.resource_type IN (
      'phone_number_assignment',
      'phone_number'
    ) THEN
      SELECT pn.*
      INTO v_phone
      FROM public.phone_numbers AS pn
      WHERE pn.id = v_action.phone_number_id
        AND pn.business_id = p_business_id
        AND pn.phone_number = v_action.canonical_e164
        AND pn.telnyx_phone_number_id IS NOT DISTINCT FROM
              v_action.provider_id
        AND pn.is_active IS TRUE
        AND pn.resource_status = 'releasing'
      FOR SHARE;

      IF NOT FOUND
         OR (
           v_action.resource_type = 'phone_number_assignment'
           AND v_phone.telnyx_campaign_assignment_campaign_id
                 IS DISTINCT FROM
                 v_action.expected_parent_campaign_id
         ) THEN
        RETURN NULL;
      END IF;
    ELSIF v_action.resource_type = 'campaign' THEN
      IF v_business.telnyx_campaign_id IS DISTINCT FROM
           v_action.provider_id THEN
        RETURN NULL;
      END IF;
    ELSIF v_action.resource_type = 'messaging_profile' THEN
      IF v_business.telnyx_messaging_profile_id IS DISTINCT FROM
           v_action.provider_id THEN
        RETURN NULL;
      END IF;
    ELSIF v_action.resource_type = 'voice_application' THEN
      IF v_business.telnyx_voice_application_id IS DISTINCT FROM
           v_action.provider_id THEN
        RETURN NULL;
      END IF;
    ELSE
      RETURN NULL;
    END IF;
  ELSE
    IF p_action_id IS NOT NULL
       OR p_lease_token IS NOT NULL
       OR v_business.deleted_at IS NOT NULL
       OR v_business.active_telnyx_release_run_id IS NOT NULL
       OR v_business.telnyx_resource_state NOT IN (
         'provisioning',
         'active'
       ) THEN
      RETURN NULL;
    END IF;

    IF p_operation = 'deactivate_campaign'
       AND v_business.telnyx_campaign_id IS NOT NULL
       AND v_business.telnyx_campaign_id = p_provider_id
       AND (
         v_business.campaign_status = 'rejected'
         OR v_business.brand_status = 'rejected'
       ) THEN
      v_resource_type := 'campaign';
      v_provider_id := v_business.telnyx_campaign_id;
      v_public_tcr_id := upper(btrim(
        v_business.telnyx_campaign_id
      ));
    ELSIF p_operation = 'delete_brand'
          AND v_business.telnyx_brand_source =
                'created_by_simplassist'
          AND v_business.brand_status = 'rejected'
          AND v_business.telnyx_brand_id IS NOT NULL
          AND v_business.telnyx_brand_id = p_provider_id THEN
      v_resource_type := 'brand';
      v_provider_id := v_business.telnyx_brand_id;

      SELECT request.tcr_brand_id
      INTO v_public_tcr_id
      FROM public.telnyx_brand_link_requests AS request
      WHERE request.business_id = p_business_id
        AND lower(request.telnyx_brand_id) =
              lower(v_business.telnyx_brand_id)
      ORDER BY request.consumed_at DESC NULLS LAST,
               request.id::text
      LIMIT 1;

      IF v_public_tcr_id IS NULL THEN
        SELECT resource.public_tcr_id
        INTO v_public_tcr_id
        FROM public.telnyx_managed_resources AS resource
        WHERE resource.business_id = p_business_id
          AND resource.resource_type = 'brand'
          AND lower(resource.provider_id) =
                lower(v_business.telnyx_brand_id)
        ORDER BY resource.created_at DESC, resource.id::text
        LIMIT 1;
      END IF;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  v_protection_id := public.telnyx_release_protection_id(
    p_business_id,
    v_resource_type,
    v_provider_id,
    v_canonical_e164,
    v_public_tcr_id,
    v_expected_parent_campaign_id
  );

  IF v_canonical_e164 = '+15742133931'
     OR upper(COALESCE(v_provider_id, '')) IN (
       'CYLIGTZ',
       'BL69PDP'
     )
     OR upper(COALESCE(v_public_tcr_id, '')) IN (
       'CYLIGTZ',
       'BL69PDP'
     )
     OR upper(COALESCE(
          v_expected_parent_campaign_id,
          ''
        )) = 'CYLIGTZ'
     OR lower(COALESCE(v_provider_id, '')) = lower(
          v_config.expected_shared_messaging_profile_id
        )
     OR COALESCE(v_provider_id, '') =
          v_config.expected_shared_voice_application_id
     OR v_protection_id IS NOT NULL THEN
    IF p_context = 'release_worker' THEN
      UPDATE public.telnyx_resource_release_actions
      SET classification = 'protected_retain',
          desired_action = 'retain',
          state = 'retained',
          protection_id = v_protection_id,
          lease_token = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          lease_authorization_epoch = NULL,
          updated_at = now()
      WHERE id = v_action.id
        AND state = 'leased'
        AND lease_token = p_lease_token;

      PERFORM public.refresh_telnyx_release_run(v_action.run_id);
    END IF;

    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'authorized', true,
    'business_id', p_business_id,
    'context', p_context,
    'operation', p_operation,
    'action_id', p_action_id,
    'provider_id', v_provider_id,
    'canonical_e164', v_canonical_e164,
    'public_tcr_id', v_public_tcr_id,
    'config_updated_at', v_config.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_telnyx_release_action(
  p_action_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_provider_confirmation_code text,
  p_error_code text,
  p_error_message text,
  p_retry_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action public.telnyx_resource_release_actions%ROWTYPE;
  v_business_id uuid;
  v_changed integer;
  v_local_ok boolean := true;
  v_new_state text;
BEGIN
  IF p_outcome IS NULL
     OR p_outcome NOT IN ('succeeded', 'retryable', 'blocked') THEN
    RAISE EXCEPTION 'invalid_telnyx_release_outcome'
      USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'succeeded'
     AND (
       p_provider_confirmation_code IS NULL
       OR btrim(p_provider_confirmation_code) = ''
     ) THEN
    RAISE EXCEPTION 'provider_confirmation_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_outcome = 'retryable'
     AND p_retry_at IS NULL THEN
    RAISE EXCEPTION 'retry_timestamp_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT action.business_id
  INTO v_business_id
  FROM public.telnyx_resource_release_actions AS action
  WHERE action.id = p_action_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  SELECT action.*
  INTO v_action
  FROM public.telnyx_resource_release_actions AS action
  WHERE action.id = p_action_id
    AND action.business_id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_new_state := p_outcome;

  IF v_action.state = v_new_state
     AND (
       p_outcome <> 'succeeded'
       OR v_action.provider_confirmation_code
            = p_provider_confirmation_code
     ) THEN
    RETURN true;
  END IF;

  IF v_action.state <> 'leased'
     OR v_action.lease_token IS DISTINCT FROM p_lease_token THEN
    RETURN false;
  END IF;

  IF p_outcome = 'succeeded' THEN
    IF v_action.classification <> 'managed_releaseable' THEN
      RAISE EXCEPTION 'nonreleaseable_action_cannot_succeed'
        USING ERRCODE = '55000';
    END IF;

    v_changed := 0;

    IF v_action.resource_type = 'phone_number_assignment' THEN
      UPDATE public.phone_numbers
      SET telnyx_campaign_assignment_status = 'unassigned',
          telnyx_campaign_assignment_task_id = NULL,
          telnyx_campaign_assignment_campaign_id = NULL,
          telnyx_campaign_assignment_failure_reason = NULL,
          telnyx_campaign_assignment_updated_at = now(),
          telnyx_campaign_assigned_at = NULL
      WHERE id = v_action.phone_number_id
        AND business_id = v_action.business_id
        AND telnyx_campaign_assignment_campaign_id
          IS NOT DISTINCT FROM
          v_action.expected_parent_campaign_id;

      GET DIAGNOSTICS v_changed = ROW_COUNT;

      IF v_changed = 0 AND EXISTS (
        SELECT 1
        FROM public.phone_numbers
        WHERE id = v_action.phone_number_id
          AND telnyx_campaign_assignment_campaign_id IS NOT NULL
      ) THEN
        v_local_ok := false;
      END IF;

    ELSIF v_action.resource_type = 'phone_number' THEN
      UPDATE public.phone_numbers
      SET telnyx_phone_number_id = NULL,
          is_active = false,
          resource_status = 'released',
          released_at = now()
      WHERE id = v_action.phone_number_id
        AND business_id = v_action.business_id
        AND telnyx_phone_number_id
          IS NOT DISTINCT FROM v_action.provider_id;

      GET DIAGNOSTICS v_changed = ROW_COUNT;

      IF v_changed = 0 AND EXISTS (
        SELECT 1
        FROM public.phone_numbers
        WHERE id = v_action.phone_number_id
          AND telnyx_phone_number_id IS NOT NULL
      ) THEN
        v_local_ok := false;
      END IF;

    ELSIF v_action.resource_type = 'campaign' THEN
      UPDATE public.businesses
      SET telnyx_campaign_id = NULL,
          campaign_status = NULL,
          campaign_status_updated_at = now(),
          campaign_rejection_reason = NULL,
          updated_at = now()
      WHERE id = v_action.business_id
        AND telnyx_campaign_id
          IS NOT DISTINCT FROM v_action.provider_id;

      GET DIAGNOSTICS v_changed = ROW_COUNT;

      IF v_changed = 0 AND EXISTS (
        SELECT 1
        FROM public.businesses
        WHERE id = v_action.business_id
          AND telnyx_campaign_id IS NOT NULL
      ) THEN
        v_local_ok := false;
      END IF;

    ELSIF v_action.resource_type = 'messaging_profile' THEN
      UPDATE public.businesses
      SET telnyx_messaging_profile_id = NULL,
          updated_at = now()
      WHERE id = v_action.business_id
        AND telnyx_messaging_profile_id
          IS NOT DISTINCT FROM v_action.provider_id;

      GET DIAGNOSTICS v_changed = ROW_COUNT;

      IF v_changed = 0 AND EXISTS (
        SELECT 1
        FROM public.businesses
        WHERE id = v_action.business_id
          AND telnyx_messaging_profile_id IS NOT NULL
      ) THEN
        v_local_ok := false;
      END IF;

    ELSIF v_action.resource_type = 'voice_application' THEN
      UPDATE public.businesses
      SET telnyx_voice_application_id = NULL,
          updated_at = now()
      WHERE id = v_action.business_id
        AND telnyx_voice_application_id
          IS NOT DISTINCT FROM v_action.provider_id;

      GET DIAGNOSTICS v_changed = ROW_COUNT;

      IF v_changed = 0 AND EXISTS (
        SELECT 1
        FROM public.businesses
        WHERE id = v_action.business_id
          AND telnyx_voice_application_id IS NOT NULL
      ) THEN
        v_local_ok := false;
      END IF;

    ELSE
      RAISE EXCEPTION 'unsupported_release_action_type'
        USING ERRCODE = '22023';
    END IF;

    IF NOT v_local_ok THEN
      UPDATE public.telnyx_resource_release_actions
      SET state = 'blocked',
          lease_token = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL,
          lease_authorization_epoch = NULL,
          provider_confirmed_at = now(),
          provider_confirmation_code =
            p_provider_confirmation_code,
          last_error_code =
            'local_pointer_mismatch_after_provider_confirmation',
          last_error_message =
            'Provider success was confirmed but the exact local pointer no longer matched.',
          support_required_at = now(),
          updated_at = now()
      WHERE id = v_action.id;

      PERFORM public.refresh_telnyx_release_run(v_action.run_id);
      RETURN false;
    END IF;

    IF v_action.resource_type <> 'phone_number_assignment'
       AND v_action.managed_resource_id IS NOT NULL THEN
      UPDATE public.telnyx_managed_resources
      SET ownership_state = 'released',
          local_claim_active = false,
          released_at = now(),
          updated_at = now()
      WHERE id = v_action.managed_resource_id
        AND business_id = v_action.business_id;
    END IF;

    UPDATE public.telnyx_resource_release_actions
    SET state = 'succeeded',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        lease_authorization_epoch = NULL,
        provider_confirmed_at = now(),
        provider_confirmation_code =
          p_provider_confirmation_code,
        last_error_code = NULL,
        last_error_message = NULL,
        next_retry_at = NULL,
        updated_at = now()
    WHERE id = v_action.id;

  ELSIF p_outcome = 'retryable' THEN
    UPDATE public.telnyx_resource_release_actions
    SET state = 'retryable',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        lease_authorization_epoch = NULL,
        next_retry_at = p_retry_at,
        last_error_code = NULLIF(btrim(p_error_code), ''),
        last_error_message =
          left(NULLIF(btrim(p_error_message), ''), 500),
        updated_at = now()
    WHERE id = v_action.id;

  ELSE
    UPDATE public.telnyx_resource_release_actions
    SET state = 'blocked',
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        lease_authorization_epoch = NULL,
        next_retry_at = NULL,
        last_error_code = COALESCE(
          NULLIF(btrim(p_error_code), ''),
          'release_blocked'
        ),
        last_error_message =
          left(NULLIF(btrim(p_error_message), ''), 500),
        support_required_at = now(),
        updated_at = now()
    WHERE id = v_action.id;
  END IF;

  INSERT INTO public.telnyx_resource_release_events (
    run_id,
    action_id,
    business_id,
    event_type,
    previous_state,
    new_state,
    reason_code,
    actor,
    attempt_number
  ) VALUES (
    v_action.run_id,
    v_action.id,
    v_action.business_id,
    'action_finished',
    'leased',
    p_outcome,
    CASE
      WHEN p_outcome = 'succeeded'
        THEN p_provider_confirmation_code
      ELSE p_error_code
    END,
    COALESCE(v_action.lease_owner, 'release_worker'),
    v_action.attempt_count
  );

  PERFORM public.refresh_telnyx_release_run(v_action.run_id);
  RETURN true;
END;
$$;

-- ============================================================================
-- J. Backfill active account-deletion reasons for current tombstones
-- ============================================================================

DO $migration_034_deleted_backfill$
DECLARE
  v_business record;
BEGIN
  FOR v_business IN
    SELECT
      id,
      deleted_at,
      deletion_scheduled_for
    FROM public.businesses
    WHERE deleted_at IS NOT NULL
      AND deletion_scheduled_for IS NOT NULL
    ORDER BY deletion_scheduled_for, id::text
  LOOP
    PERFORM public.ensure_telnyx_release_reason(
      v_business.id,
      'account_deletion',
      v_business.deleted_at,
      v_business.deletion_scheduled_for,
      NULL,
      NULL,
      'migration_034_backfill'
    );
  END LOOP;
END;
$migration_034_deleted_backfill$;

-- ============================================================================
-- K. Account-deletion and reactivation compatibility
-- ============================================================================

CREATE OR REPLACE FUNCTION public.schedule_account_deletion(
  p_business_id uuid,
  p_owner_id uuid,
  p_deleted_at timestamptz,
  p_deletion_scheduled_for timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_stripe_subscription_id text;
  v_release_run_id uuid;
BEGIN
  IF p_deleted_at IS NULL
     OR p_deletion_scheduled_for IS NULL
     OR p_deletion_scheduled_for
          <> p_deleted_at + interval '60 days' THEN
    RAISE EXCEPTION 'invalid account deletion timestamps'
      USING ERRCODE = '22007';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'business % is not owned by user %',
      p_business_id,
      p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
    v_release_run_id := public.ensure_telnyx_release_reason(
      p_business_id,
      'account_deletion',
      p_deleted_at,
      p_deletion_scheduled_for,
      NULL,
      NULL,
      'account_deletion'
    );

    UPDATE public.businesses
    SET deleted_at = p_deleted_at,
        deletion_scheduled_for = p_deletion_scheduled_for,
        cleanup_auth_user_id = NULL,
        cleanup_attempted_at = NULL,
        updated_at = now()
    WHERE id = p_business_id
    RETURNING * INTO v_business;
  ELSIF v_business.deletion_scheduled_for IS NULL
        OR v_business.deletion_scheduled_for <= now() THEN
    RAISE EXCEPTION
      'business % is no longer reactivatable',
      p_business_id
      USING ERRCODE = '55000';
  ELSE
    v_release_run_id := public.ensure_telnyx_release_reason(
      p_business_id,
      'account_deletion',
      v_business.deleted_at,
      v_business.deletion_scheduled_for,
      NULL,
      NULL,
      'account_deletion'
    );
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_stripe_subscription_id := v_action.stripe_subscription_id;
  ELSE
    SELECT subscription.stripe_subscription_id
    INTO v_stripe_subscription_id
    FROM public.subscriptions AS subscription
    WHERE subscription.business_id = p_business_id;
  END IF;

  IF v_stripe_subscription_id IS NOT NULL THEN
    v_action := public.queue_account_deletion_stripe_action(
      p_business_id,
      v_stripe_subscription_id,
      'pause'
    );
  END IF;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'deleted_at', v_business.deleted_at,
    'deletion_scheduled_for', v_business.deletion_scheduled_for,
    'stripe_action', CASE
      WHEN v_stripe_subscription_id IS NULL THEN NULL
      ELSE to_jsonb(v_action)
    END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.prepare_account_reactivation(
  p_business_id uuid,
  p_owner_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_stripe_subscription_id text;
  v_local_stripe_subscription_id text;
  v_reservation_token uuid;
  v_reservation_expires_at timestamptz;
  v_reactivation_in_progress boolean := false;
  v_run_found boolean;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'business % is not owned by user %',
      p_business_id,
      p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
    RETURN jsonb_build_object(
      'business_id', p_business_id,
      'already_active', true,
      'stripe_action', NULL
    );
  END IF;

  IF v_business.deletion_scheduled_for IS NULL THEN
    RAISE EXCEPTION
      'business % is outside the reactivation grace period',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.telnyx_resource_release_runs AS run
  WHERE run.id = v_business.active_telnyx_release_run_id
    AND run.business_id = p_business_id
  FOR UPDATE;

  v_run_found := FOUND;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_stripe_subscription_id := v_action.stripe_subscription_id;
    v_reactivation_in_progress :=
      v_action.desired_action = 'resume'
      AND (
        v_action.status = 'pending'
        OR (
          v_action.status = 'applied'
          AND v_action.applied_action IN ('resume', 'cancel')
        )
      );
  END IF;

  IF v_reactivation_in_progress
     AND v_run_found
     AND v_run.point_of_no_return_at IS NULL
     AND v_run.status IN ('release_pending', 'blocked') THEN
    PERFORM public.refresh_telnyx_release_run(v_run.id);

    SELECT run.*
    INTO v_run
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.id = v_business.active_telnyx_release_run_id
      AND run.business_id = p_business_id
    FOR UPDATE;
  END IF;

  IF NOT v_run_found
     OR v_run.point_of_no_return_at IS NOT NULL
     OR v_run.status <> 'parked'
     OR (
       v_run.effective_release_at <= now()
       AND NOT (
         (
           v_run.checkout_reservation_token IS NOT NULL
           AND v_run.checkout_reservation_expires_at > now()
         )
         OR v_reactivation_in_progress
       )
     ) THEN
    RAISE EXCEPTION
      'business % Telnyx resources can no longer be automatically reactivated',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF v_run.checkout_reservation_token IS NOT NULL
     AND v_run.checkout_reservation_expires_at > now() THEN
    v_reservation_token := v_run.checkout_reservation_token;
    v_reservation_expires_at :=
      v_run.checkout_reservation_expires_at;
  ELSIF v_reactivation_in_progress THEN
    v_reservation_token := COALESCE(
      v_run.checkout_reservation_token,
      gen_random_uuid()
    );
    v_reservation_expires_at := now() + interval '30 minutes';

    UPDATE public.telnyx_resource_release_runs
    SET checkout_reservation_token = v_reservation_token,
        checkout_reservation_expires_at =
          v_reservation_expires_at,
        updated_at = now()
    WHERE id = v_run.id;
  ELSE
    IF v_business.deletion_scheduled_for <= now() THEN
      RAISE EXCEPTION
        'business % is outside the reactivation grace period',
        p_business_id
        USING ERRCODE = '55000';
    END IF;

    v_reservation_token := gen_random_uuid();
    v_reservation_expires_at := now() + interval '30 minutes';

    UPDATE public.telnyx_resource_release_runs
    SET checkout_reservation_token = v_reservation_token,
        checkout_reservation_expires_at =
          v_reservation_expires_at,
        updated_at = now()
    WHERE id = v_run.id;
  END IF;

  SELECT subscription.stripe_subscription_id
  INTO v_local_stripe_subscription_id
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  IF v_stripe_subscription_id IS NOT NULL
     AND v_local_stripe_subscription_id IS NOT NULL
     AND v_stripe_subscription_id
          <> v_local_stripe_subscription_id THEN
    RAISE EXCEPTION
      'Stripe subscription linkage mismatch for business %: durable %, local %',
      p_business_id,
      v_stripe_subscription_id,
      v_local_stripe_subscription_id
      USING ERRCODE = '23514';
  END IF;

  v_stripe_subscription_id := COALESCE(
    v_stripe_subscription_id,
    v_local_stripe_subscription_id
  );

  IF v_stripe_subscription_id IS NOT NULL THEN
    v_action := public.queue_account_deletion_stripe_action(
      p_business_id,
      v_stripe_subscription_id,
      'resume'
    );
  END IF;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'already_active', false,
    'deletion_scheduled_for',
      v_business.deletion_scheduled_for,
    'reactivation_reservation_token', v_reservation_token,
    'reactivation_reservation_expires_at',
      v_reservation_expires_at,
    'stripe_action', CASE
      WHEN v_stripe_subscription_id IS NULL THEN NULL
      ELSE to_jsonb(v_action)
    END
  );
END;
$$;

DROP FUNCTION public.complete_account_reactivation(uuid, uuid, bigint);

CREATE FUNCTION public.complete_account_reactivation(
  p_business_id uuid,
  p_owner_id uuid,
  p_generation bigint,
  p_reactivation_reservation_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_run public.telnyx_resource_release_runs%ROWTYPE;
  v_applied_action text;
  v_had_action boolean := false;
  v_run_found boolean;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'business % is not owned by user %',
      p_business_id,
      p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
    RETURN true;
  END IF;

  IF v_business.deletion_scheduled_for IS NULL THEN
    RAISE EXCEPTION
      'business % is outside the reactivation grace period',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT run.*
  INTO v_run
  FROM public.telnyx_resource_release_runs AS run
  WHERE run.id = v_business.active_telnyx_release_run_id
    AND run.business_id = p_business_id
  FOR UPDATE;

  v_run_found := FOUND;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  v_had_action := FOUND;

  IF NOT v_run_found
     OR p_reactivation_reservation_token IS NULL
     OR v_run.checkout_reservation_token IS NULL
     OR v_run.checkout_reservation_token
          IS DISTINCT FROM p_reactivation_reservation_token
     OR (
       v_run.checkout_reservation_expires_at <= now()
       AND NOT (
         v_had_action
         AND p_generation IS NOT NULL
         AND v_action.generation = p_generation
         AND v_action.desired_action = 'resume'
         AND v_action.status = 'applied'
         AND v_action.applied_action IN ('resume', 'cancel')
       )
     )
     OR v_run.point_of_no_return_at IS NOT NULL
     OR v_run.status <> 'parked' THEN
    RAISE EXCEPTION
      'business % has no active reactivation reservation',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF v_had_action THEN
    IF p_generation IS NULL
       OR v_action.generation <> p_generation
       OR v_action.desired_action <> 'resume'
       OR v_action.status <> 'applied'
       OR v_action.applied_action NOT IN ('resume', 'cancel') THEN
      RAISE EXCEPTION
        'business % reactivation generation % is not applied',
        p_business_id,
        COALESCE(p_generation, -1)
        USING ERRCODE = '55000';
    END IF;

    v_applied_action := v_action.applied_action;
  ELSIF EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE business_id = p_business_id
  ) THEN
    RAISE EXCEPTION
      'business % has a subscription without a resume action',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF NOT public.cancel_telnyx_release_reason(
    p_business_id,
    'account_deletion',
    'account_reactivation'
  ) THEN
    RAISE EXCEPTION
      'business % has no cancellable account-deletion Telnyx release reason',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.telnyx_resource_release_runs
  SET checkout_reservation_token = NULL,
      checkout_reservation_expires_at = NULL,
      updated_at = now()
  WHERE id = v_run.id
    AND checkout_reservation_token =
          p_reactivation_reservation_token;

  IF v_had_action THEN
    DELETE FROM public.account_deletion_stripe_actions
    WHERE business_id = p_business_id;
  END IF;

  UPDATE public.businesses
  SET deleted_at = NULL,
      deletion_scheduled_for = NULL,
      cleanup_auth_user_id = NULL,
      cleanup_attempted_at = NULL,
      updated_at = now()
  WHERE id = p_business_id;

  -- Preserve the subscription row. If Stripe is terminally canceled, mark the
  -- local row canceled after the business is active again rather than deleting
  -- the linkage needed by Billing/resubscription.
  IF v_applied_action = 'cancel' THEN
    UPDATE public.subscriptions
    SET status = 'canceled',
        cancel_at_period_end = false,
        ended_at = COALESCE(ended_at, now()),
        updated_at = now()
    WHERE business_id = p_business_id;
  END IF;

  RETURN true;
END;
$$;

-- Migration-first rollout compatibility: the deployed application may call
-- the migration-029 three-argument RPC until its matching release is live.
-- The wrapper can only reuse the server-held reservation while its checkout
-- is live or its durable resume is still in progress; the four-argument
-- function re-locks the run and validates the exact token and generation.
CREATE FUNCTION public.complete_account_reactivation(
  p_business_id uuid,
  p_owner_id uuid,
  p_generation bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reactivation_reservation_token uuid;
BEGIN
  SELECT run.checkout_reservation_token
  INTO v_reactivation_reservation_token
  FROM public.businesses AS business
  JOIN public.telnyx_resource_release_runs AS run
    ON run.id = business.active_telnyx_release_run_id
   AND run.business_id = business.id
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
    AND run.checkout_reservation_token IS NOT NULL
    AND (
      run.checkout_reservation_expires_at > now()
      OR public.account_reactivation_stripe_in_progress(
        p_business_id
      )
    );

  RETURN public.complete_account_reactivation(
    p_business_id,
    p_owner_id,
    p_generation,
    v_reactivation_reservation_token
  );
END;
$$;

-- ============================================================================
-- L. Exact migration-033 cleanup replacement with lifecycle preservation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_expired_business(
  p_business_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id uuid;
  v_auth_user uuid;
  v_existing_auth_user uuid;
  v_deleted_at timestamptz;
  v_deletion_scheduled_for timestamptz;
  v_local_stripe_subscription_id text;
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_release_run_id uuid;
BEGIN
  SELECT business.owner_id, business.cleanup_auth_user_id,
         business.deleted_at, business.deletion_scheduled_for
  INTO v_owner_id, v_existing_auth_user,
       v_deleted_at, v_deletion_scheduled_for
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NOT NULL
    AND business.deletion_scheduled_for < now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % is not an expired deleted account', p_business_id
      USING ERRCODE = '42501';
  END IF;

  v_auth_user := COALESCE(v_owner_id, v_existing_auth_user);

  -- Snapshot Telnyx release work before legal, link, or config data is scrubbed.
  v_release_run_id := public.ensure_telnyx_release_reason(
    p_business_id,
    'account_deletion',
    v_deleted_at,
    v_deletion_scheduled_for,
    NULL,
    NULL,
    'account_cleanup'
  );
  PERFORM public.snapshot_telnyx_release_actions(
    v_release_run_id,
    p_business_id
  );
  PERFORM public.refresh_telnyx_release_run(v_release_run_id);

  -- Durable linkage to the auth user BEFORE owner_id is nulled. COALESCE
  -- keeps the value across re-runs (owner_id is already NULL on a retry).
  UPDATE public.businesses
  SET cleanup_auth_user_id = COALESCE(owner_id, cleanup_auth_user_id)
  WHERE id = p_business_id
  RETURNING cleanup_auth_user_id INTO v_auth_user;

  SELECT subscription.stripe_subscription_id
  INTO v_local_stripe_subscription_id
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_stripe_subscription_id := v_action.stripe_subscription_id;
  END IF;

  IF v_stripe_subscription_id IS NOT NULL
     AND v_local_stripe_subscription_id IS NOT NULL
     AND v_stripe_subscription_id <> v_local_stripe_subscription_id THEN
    RAISE EXCEPTION
      'Stripe subscription linkage mismatch for business %: durable %, local %',
      p_business_id,
      v_stripe_subscription_id,
      v_local_stripe_subscription_id
      USING ERRCODE = '23514';
  END IF;

  v_stripe_subscription_id := COALESCE(
    v_stripe_subscription_id,
    v_local_stripe_subscription_id
  );

  IF v_stripe_subscription_id IS NOT NULL THEN
    v_action := public.queue_account_deletion_stripe_action(
      p_business_id,
      v_stripe_subscription_id,
      'cancel'
    );
  END IF;

  -- Anonymize messages: two statements so each uses its index — the OR form
  -- is structurally unindexable. content guard keeps re-runs cheap.
  UPDATE public.messages SET content = '[deleted]'
  WHERE business_id = p_business_id AND content <> '[deleted]';
  UPDATE public.messages SET content = '[deleted]'
  WHERE conversation_id IN (
      SELECT id FROM public.conversations WHERE business_id = p_business_id
    )
    AND content <> '[deleted]';

  -- Anonymize contacts: strip PII, keep lead_score and timestamps.
  UPDATE public.contacts
  SET name = NULL, email = NULL, phone_number = NULL, notes = NULL
  WHERE business_id = p_business_id;

  -- Link state must be removed before the legal-identity scrub. A consumed
  -- link intentionally rejects identity drift while it exists.
  DELETE FROM public.telnyx_brand_link_events
  WHERE business_id = p_business_id;
  DELETE FROM public.telnyx_brand_link_requests
  WHERE business_id = p_business_id;

  -- Hard delete config tables (the business row is kept as a tombstone).
  DELETE FROM public.ai_settings            WHERE business_id = p_business_id;
  DELETE FROM public.services               WHERE business_id = p_business_id;
  DELETE FROM public.faqs                   WHERE business_id = p_business_id;
  DELETE FROM public.business_hours         WHERE business_id = p_business_id;
  -- phone_numbers remain until provider-confirmed action finalization.
  DELETE FROM public.widget_configs         WHERE business_id = p_business_id;
  DELETE FROM public.google_calendar_tokens WHERE business_id = p_business_id;
  DELETE FROM public.subscriptions          WHERE business_id = p_business_id;

  -- Full tombstone scrub. Kept for analytics: business_type, timezone,
  -- billing flags, created_at, lead_score on contacts, message volumes.
  UPDATE public.businesses
  SET name = '[deleted]',
      slug = 'deleted-' || p_business_id,
      email = NULL, phone_number = NULL, website_url = NULL,
      address = NULL, city = NULL, state = NULL, zip = NULL,
      -- legal identity / A2P registration PII (012/015/019/021/022)
      legal_business_name = NULL, business_entity_type = NULL,
      business_registration_state = NULL, tax_id_type = NULL,
      ein = NULL, last_4_ssn = NULL, registrant_mobile = NULL,
      authorized_rep_name = NULL, authorized_rep_title = NULL,
      authorized_rep_email = NULL, authorized_rep_phone = NULL,
      business_type_other = NULL,
      forward_to_number = NULL,
      pending_phone_number = NULL, pending_phone_number_area_code = NULL,
      pending_phone_number_failure_reason = NULL,
      -- customer-supplied compliance URLs on the customer's own domain
      privacy_url_override = NULL, terms_url_override = NULL,
      -- customer-authored SMS content and risk-screen output (may embed
      -- identity and website-derived text)
      use_case_description = NULL, sample_messages = NULL,
      opt_in_description = NULL, estimated_monthly_volume = NULL,
      a2p_risk_review_message = NULL, a2p_risk_review_reason = NULL,
      a2p_risk_review_findings = NULL,
      a2p_risk_review_customer_answer = NULL,
      a2p_risk_review_customer_selections = NULL,
      a2p_risk_review_input_hash = NULL,
      a2p_risk_review_override_note = NULL,
      onboarding_registration_error = NULL,
      -- admin free text that can embed identity
      billing_admin_notes = NULL,
      -- carrier resource pointers: late Telnyx webhooks must not resolve a
      -- tombstone, and rejection reasons can embed carrier identity text
      -- Migration 034 retains those pointers until provider-confirmed action
      -- finalization; webhook resolution now excludes tombstones explicitly.
      brand_status = NULL, brand_rejection_reason = NULL,
      campaign_status = NULL, campaign_rejection_reason = NULL,
      cleanup_pii_scrubbed_at = COALESCE(cleanup_pii_scrubbed_at, now()),
      owner_id = NULL
  WHERE id = p_business_id;

  RETURN v_auth_user;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_expired_business_cleanup(
  p_business_id uuid,
  p_generation bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_release_run_id uuid;
  v_release_run_status text;
  v_checkout_reservation_token uuid;
  v_checkout_reservation_expires_at timestamptz;
  v_consumed_reason_count integer;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'business % does not exist',
      p_business_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_business.deleted_at IS NOT NULL
     AND v_business.deletion_scheduled_for IS NULL
     AND v_business.owner_id IS NULL THEN
    RETURN true;
  END IF;

  IF v_business.deleted_at IS NULL
     OR v_business.deletion_scheduled_for IS NULL
     OR v_business.deletion_scheduled_for >= now()
     OR v_business.owner_id IS NOT NULL
     OR v_business.cleanup_pii_scrubbed_at IS NULL THEN
    RAISE EXCEPTION
      'business % is not ready to complete cleanup',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE business_id = p_business_id
  ) THEN
    RAISE EXCEPTION
      'business % still has a local subscription row',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF public.account_reactivation_stripe_in_progress(
    p_business_id
  ) THEN
    RAISE EXCEPTION
      'business % has a reactivation awaiting completion',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  v_release_run_id := v_business.active_telnyx_release_run_id;

  IF v_release_run_id IS NULL THEN
    RAISE EXCEPTION
      'business % has no durable Telnyx release run',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT
    run.status,
    run.checkout_reservation_token,
    run.checkout_reservation_expires_at
  INTO
    v_release_run_status,
    v_checkout_reservation_token,
    v_checkout_reservation_expires_at
  FROM public.telnyx_resource_release_runs AS run
  WHERE run.id = v_release_run_id
    AND run.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_release_run_status NOT IN (
       'released',
       'protected_hold',
       'blocked'
     ) THEN
    RAISE EXCEPTION
      'business % Telnyx release run is not terminal',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF v_checkout_reservation_token IS NOT NULL
     AND v_checkout_reservation_expires_at > now() THEN
    RAISE EXCEPTION
      'business % has an active reactivation reservation',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.telnyx_resource_release_actions AS release_action
    WHERE release_action.run_id = v_release_run_id
      AND release_action.business_id = p_business_id
      AND release_action.state NOT IN (
        'succeeded',
        'retained',
        'held',
        'blocked'
      )
  ) THEN
    RAISE EXCEPTION
      'business % still has nonterminal Telnyx release actions',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    IF p_generation IS NULL
       OR v_action.generation <> p_generation
       OR v_action.desired_action <> 'cancel'
       OR v_action.status <> 'applied'
       OR v_action.applied_action <> 'cancel' THEN
      RAISE EXCEPTION
        'business % Stripe cancellation generation % is not applied',
        p_business_id,
        COALESCE(p_generation, -1)
        USING ERRCODE = '55000';
    END IF;

    DELETE FROM public.account_deletion_stripe_actions
    WHERE business_id = p_business_id;
  END IF;

  UPDATE public.telnyx_resource_release_reasons AS reason
  SET status = 'consumed',
      consumed_at = COALESCE(reason.consumed_at, now()),
      updated_at = now()
  WHERE reason.run_id = v_release_run_id
    AND reason.reason_type = 'account_deletion'
    AND reason.status = 'active';

  GET DIAGNOSTICS v_consumed_reason_count = ROW_COUNT;

  IF v_consumed_reason_count <> 1 THEN
    RAISE EXCEPTION
      'business % does not have exactly one active account-deletion release reason',
      p_business_id
      USING ERRCODE = '55000';
  END IF;

  PERFORM public.refresh_telnyx_release_run(v_release_run_id);

  IF v_release_run_status IN ('released', 'protected_hold')
     AND p_business_id <>
          'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb' THEN
    IF EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.local_claim_active IS TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM public.telnyx_resource_release_actions AS release_action
          WHERE release_action.run_id = v_release_run_id
            AND release_action.business_id = p_business_id
            AND release_action.managed_resource_id = resource.id
            AND release_action.state IN ('succeeded', 'retained')
        )
    ) THEN
      RAISE EXCEPTION
        'business % has managed resources without a terminal release disposition',
        p_business_id
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.telnyx_managed_resources AS resource
    SET local_claim_active = false,
        updated_at = now()
    WHERE resource.business_id = p_business_id
      AND resource.local_claim_active IS TRUE
      AND EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS release_action
        WHERE release_action.run_id = v_release_run_id
          AND release_action.business_id = p_business_id
          AND release_action.managed_resource_id = resource.id
          AND release_action.state IN ('succeeded', 'retained')
      );

    UPDATE public.phone_numbers AS pn
    SET is_active = false
    WHERE pn.business_id = p_business_id
      AND pn.is_active IS TRUE
      AND pn.phone_number <> '+15742133931'
      AND EXISTS (
        SELECT 1
        FROM public.telnyx_resource_release_actions AS release_action
        WHERE release_action.run_id = v_release_run_id
          AND release_action.business_id = p_business_id
          AND release_action.phone_number_id = pn.id
          AND release_action.resource_type = 'phone_number'
          AND release_action.state IN ('succeeded', 'retained')
      );
  END IF;

  UPDATE public.businesses
  SET deletion_scheduled_for = NULL,
      cleanup_auth_user_id = NULL,
      cleanup_attempted_at = NULL,
      telnyx_unique_claims_released_at = CASE
        WHEN v_release_run_status IN ('released', 'protected_hold')
         AND p_business_id <>
              'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
          THEN COALESCE(telnyx_unique_claims_released_at, now())
        ELSE telnyx_unique_claims_released_at
      END,
      updated_at = now()
  WHERE id = p_business_id;

  RETURN true;
END;
$$;

-- ============================================================================
-- M. Structural account-transition guard
-- ============================================================================

CREATE OR REPLACE FUNCTION public.guard_account_deletion_business_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_run_status text;
  v_reason_status text;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.ensure_telnyx_release_reason(
      NEW.id,
      'account_deletion',
      NEW.deleted_at,
      NEW.deletion_scheduled_for,
      NULL,
      NULL,
      'account_deletion_transition_guard'
    );

    SELECT subscription.stripe_subscription_id
    INTO v_stripe_subscription_id
    FROM public.subscriptions AS subscription
    WHERE subscription.business_id = NEW.id;

    IF v_stripe_subscription_id IS NOT NULL THEN
      PERFORM public.queue_account_deletion_stripe_action(
        NEW.id,
        v_stripe_subscription_id,
        'pause'
      );
    END IF;
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    SELECT action.*
    INTO v_action
    FROM public.account_deletion_stripe_actions AS action
    WHERE action.business_id = NEW.id
    FOR UPDATE;

    IF FOUND THEN
      IF v_action.desired_action = 'pause'
         AND v_action.applied_action IS NULL
         AND v_action.attempt_count = 0 THEN
        DELETE FROM public.account_deletion_stripe_actions
        WHERE business_id = NEW.id;
      ELSE
        RAISE EXCEPTION
          'business % reactivation requires completed Stripe generation %',
          NEW.id,
          v_action.generation
          USING ERRCODE = '55000';
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.telnyx_resource_release_reasons AS reason
      WHERE reason.business_id = NEW.id
        AND reason.reason_type = 'account_deletion'
        AND reason.status = 'active'
    ) AND NOT public.cancel_telnyx_release_reason(
      NEW.id,
      'account_deletion',
      'account_deletion_transition_guard'
    ) THEN
      RAISE EXCEPTION
        'business % Telnyx release can no longer be reactivated',
        NEW.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF OLD.deleted_at IS NOT NULL
     AND NEW.deleted_at IS NOT NULL
     AND OLD.deletion_scheduled_for IS NOT NULL
     AND NEW.deletion_scheduled_for IS NULL THEN
    SELECT action.*
    INTO v_action
    FROM public.account_deletion_stripe_actions AS action
    WHERE action.business_id = NEW.id
    FOR UPDATE;

    IF FOUND AND NOT (
      v_action.desired_action = 'cancel'
      AND v_action.status = 'applied'
      AND v_action.applied_action = 'cancel'
    ) THEN
      RAISE EXCEPTION
        'business % cleanup cannot complete before Stripe cancellation generation %',
        NEW.id,
        v_action.generation
        USING ERRCODE = '55000';
    END IF;

    SELECT run.status
    INTO v_run_status
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.id = NEW.active_telnyx_release_run_id
      AND run.business_id = NEW.id;

    IF v_run_status IS NULL
       OR v_run_status NOT IN (
      'released',
      'protected_hold',
      'blocked'
    ) THEN
      RAISE EXCEPTION
        'business % cleanup cannot complete before Telnyx release disposition',
        NEW.id
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.telnyx_resource_release_actions AS release_action
      WHERE release_action.run_id =
              NEW.active_telnyx_release_run_id
        AND release_action.state NOT IN (
          'succeeded',
          'retained',
          'held',
          'blocked'
        )
    ) THEN
      RAISE EXCEPTION
        'business % cleanup has nonterminal Telnyx actions',
        NEW.id
        USING ERRCODE = '55000';
    END IF;

    SELECT reason.status
    INTO v_reason_status
    FROM public.telnyx_resource_release_reasons AS reason
    WHERE reason.run_id = NEW.active_telnyx_release_run_id
      AND reason.reason_type = 'account_deletion'
    ORDER BY reason.created_at DESC, reason.id::text DESC
    LIMIT 1;

    IF v_reason_status IS DISTINCT FROM 'consumed' THEN
      RAISE EXCEPTION
        'business % account-deletion release reason is not consumed',
        NEW.id
        USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_account_deletion_business_transition
  ON public.businesses;

CREATE TRIGGER guard_account_deletion_business_transition
AFTER UPDATE OF deleted_at, deletion_scheduled_for
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_account_deletion_business_transition();

-- ============================================================================
-- N. RLS and exact grants
-- ============================================================================

ALTER TABLE public.telnyx_managed_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_release_protections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_resource_release_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_resource_release_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_resource_release_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_resource_release_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_resource_release_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.telnyx_managed_resources
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_release_protections
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_resource_release_runs
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_resource_release_reasons
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_resource_release_actions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_resource_release_events
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_resource_release_config
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.telnyx_managed_resources
  TO service_role;

GRANT SELECT
  ON TABLE public.telnyx_release_protections
  TO service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.telnyx_resource_release_runs
  TO service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.telnyx_resource_release_reasons
  TO service_role;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.telnyx_resource_release_actions
  TO service_role;

GRANT SELECT, INSERT
  ON TABLE public.telnyx_resource_release_events
  TO service_role;

GRANT SELECT
  ON TABLE public.telnyx_resource_release_config
  TO service_role;

REVOKE ALL ON FUNCTION
  public.guard_telnyx_release_configuration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.invalidate_telnyx_release_configuration()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.telnyx_release_manifest_fingerprint(text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_business_telnyx_lifecycle_fields()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_phone_number_telnyx_lifecycle_fields()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_account_deletion_business_transition()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.telnyx_release_protection_id(
    uuid, text, text, text, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.account_reactivation_stripe_in_progress(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.refresh_telnyx_release_run(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.snapshot_telnyx_release_actions(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.ensure_telnyx_release_reason(
    uuid, text, timestamptz, timestamptz,
    text, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.cancel_telnyx_release_reason(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.claim_telnyx_release_action(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.authorize_telnyx_remote_mutation(
    uuid, text, text, text, uuid, uuid, text, text
  )
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.finish_telnyx_release_action(
    uuid, uuid, text, text, text, text, timestamptz
  )
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.telnyx_release_protection_id(
    uuid, text, text, text, text, text
  )
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.account_reactivation_stripe_in_progress(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.telnyx_release_manifest_fingerprint(text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.refresh_telnyx_release_run(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.snapshot_telnyx_release_actions(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.ensure_telnyx_release_reason(
    uuid, text, timestamptz, timestamptz,
    text, text, text
  )
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.cancel_telnyx_release_reason(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.claim_telnyx_release_action(text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.authorize_telnyx_remote_mutation(
    uuid, text, text, text, uuid, uuid, text, text
  )
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.finish_telnyx_release_action(
    uuid, uuid, text, text, text, text, timestamptz
  )
  TO service_role;

REVOKE ALL ON FUNCTION
  public.schedule_account_deletion(
    uuid, uuid, timestamptz, timestamptz
  )
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.prepare_account_reactivation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.complete_account_reactivation(uuid, uuid, bigint, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.complete_account_reactivation(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.cleanup_expired_business(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.complete_expired_business_cleanup(uuid, bigint)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.schedule_account_deletion(
    uuid, uuid, timestamptz, timestamptz
  )
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.prepare_account_reactivation(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_account_reactivation(uuid, uuid, bigint, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_account_reactivation(uuid, uuid, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.cleanup_expired_business(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION
  public.complete_expired_business_cleanup(uuid, bigint)
  TO service_role;

COMMENT ON TABLE public.telnyx_managed_resources IS
  'Private ownership registry. Existing local pointers backfill as unverified_hold and are never automatically treated as releaseable.';

COMMENT ON TABLE public.telnyx_release_protections IS
  'Reviewed immutable protection manifest for shared, linked-existing, or otherwise retained production resources.';

COMMENT ON TABLE public.telnyx_resource_release_runs IS
  'Durable per-business Telnyx parking/release generation.';

COMMENT ON TABLE public.telnyx_resource_release_reasons IS
  'Independent subscription-ended and account-deletion reasons whose earliest active deadline controls release.';

COMMENT ON TABLE public.telnyx_resource_release_actions IS
  'Idempotent, leased, provider-confirmed Telnyx release actions.';

COMMENT ON TABLE public.telnyx_resource_release_events IS
  'Append-only PII-free lifecycle audit events; raw Telnyx payloads are prohibited.';

COMMENT ON TABLE public.telnyx_resource_release_config IS
  'Reviewed singleton rollout gate. Remote release defaults disabled and cannot be enabled without protection, dry-run, and single-business evidence.';
