-- Durable Stripe-side account-deletion work.
--
-- Stripe mutations cannot participate in the database transaction that marks
-- an account deleted or scrubs it. This table is the durable side of that
-- boundary: the business state change and the requested Stripe action commit
-- together, while a service-role reconciler claims and applies the external
-- mutation afterward.
--
-- Migration-first compatibility matters here. Production will run this
-- migration before the application routes change, so two structural guards
-- also protect the old code during that interval:
--   * any soft-delete update snapshots a local Stripe subscription as `pause`;
--   * subscription writes serialize with business deletion and no-op for a
--     deleted business, preventing webhook-created zombie rows.
-- Direct cleanup completion is rejected while cancellation is unapplied.

CREATE TABLE IF NOT EXISTS public.account_deletion_stripe_actions (
  business_id uuid PRIMARY KEY
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL,
  desired_action text NOT NULL
    CHECK (desired_action IN ('pause', 'resume', 'cancel')),
  applied_action text
    CHECK (applied_action IS NULL OR applied_action IN ('pause', 'resume', 'cancel')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'applied', 'blocked')),
  generation bigint NOT NULL DEFAULT 1
    CHECK (generation > 0),
  idempotency_key text NOT NULL DEFAULT gen_random_uuid()::text UNIQUE,
  lease_token uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  last_attempted_at timestamptz,
  applied_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    status <> 'applied'
    OR (applied_action IS NOT NULL AND applied_at IS NOT NULL)
  ),
  CHECK (
    status <> 'applied'
    OR applied_action = desired_action
    OR applied_action = 'cancel'
  ),
  CHECK (
    (lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.account_deletion_stripe_actions IS
  'Service-role-only durable outbox for pause, resume, and final Stripe cancellation during account deletion.';
COMMENT ON COLUMN public.account_deletion_stripe_actions.generation IS
  'Monotonic per-business desired-state generation; identical scheduling retries do not increment it.';
COMMENT ON COLUMN public.account_deletion_stripe_actions.idempotency_key IS
  'Stable Stripe idempotency key for this generation; replaced only when desired state changes.';
COMMENT ON COLUMN public.account_deletion_stripe_actions.applied_action IS
  'Last Stripe state proven by the reconciler. It can differ from desired_action while work is pending, or be cancel for a terminal missing/canceled subscription.';

CREATE INDEX IF NOT EXISTS idx_account_deletion_stripe_actions_reconcile
  ON public.account_deletion_stripe_actions (status, lease_expires_at, updated_at)
  WHERE status = 'pending';

ALTER TABLE public.account_deletion_stripe_actions ENABLE ROW LEVEL SECURITY;

-- Queue a new desired Stripe state while preserving idempotency for exact
-- retries. This is also used by the business-state trigger below, so it is a
-- narrowly scoped SECURITY DEFINER helper with no caller-derived SQL.
CREATE OR REPLACE FUNCTION public.queue_account_deletion_stripe_action(
  p_business_id uuid,
  p_stripe_subscription_id text,
  p_desired_action text
) RETURNS public.account_deletion_stripe_actions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  IF p_stripe_subscription_id IS NULL OR btrim(p_stripe_subscription_id) = '' THEN
    RAISE EXCEPTION 'stripe subscription id is required'
      USING ERRCODE = '22004';
  END IF;

  IF p_desired_action IS NULL
     OR p_desired_action NOT IN ('pause', 'resume', 'cancel') THEN
    RAISE EXCEPTION 'invalid Stripe account-deletion action: %', p_desired_action
      USING ERRCODE = '22023';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_action.stripe_subscription_id <> p_stripe_subscription_id THEN
      RAISE EXCEPTION
        'Stripe subscription linkage mismatch for business %: durable %, local %',
        p_business_id,
        v_action.stripe_subscription_id,
        p_stripe_subscription_id
        USING ERRCODE = '23514';
    END IF;

    -- An exact retry retains generation, idempotency key, claim, attempts,
    -- and result. It must not resurrect already-applied or blocked work.
    IF v_action.desired_action = p_desired_action THEN
      RETURN v_action;
    END IF;

    UPDATE public.account_deletion_stripe_actions AS action
    SET desired_action = p_desired_action,
        status = 'pending',
        generation = action.generation + 1,
        idempotency_key = gen_random_uuid()::text,
        lease_token = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        attempt_count = 0,
        last_attempted_at = NULL,
        last_error_code = NULL,
        last_error_message = NULL,
        updated_at = now()
    WHERE action.business_id = p_business_id
    RETURNING action.* INTO v_action;

    RETURN v_action;
  END IF;

  INSERT INTO public.account_deletion_stripe_actions (
    business_id,
    stripe_subscription_id,
    desired_action
  ) VALUES (
    p_business_id,
    p_stripe_subscription_id,
    p_desired_action
  )
  RETURNING * INTO v_action;

  RETURN v_action;
END;
$$;

-- Migration-first business-state guard. The old delete route updates the
-- business directly, so queue the pause in the same statement transaction.
-- The old reactivation path may discard only a never-attempted pause; once
-- Stripe work may have run, reactivation must use the guarded RPC below.
-- The old cleanup route may clear its marker only after cancel is proven.
CREATE OR REPLACE FUNCTION public.guard_account_deletion_business_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
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
        -- Safe compatibility path for the old application during the
        -- migration-first deployment window: Stripe was never contacted.
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

    IF FOUND THEN
      IF v_action.desired_action = 'cancel'
         AND v_action.status = 'applied'
         AND v_action.applied_action = 'cancel' THEN
        DELETE FROM public.account_deletion_stripe_actions
        WHERE business_id = NEW.id;
      ELSE
        RAISE EXCEPTION
          'business % cleanup cannot complete before Stripe cancellation generation %',
          NEW.id,
          v_action.generation
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_account_deletion_business_transition
  ON public.businesses;
CREATE TRIGGER guard_account_deletion_business_transition
BEFORE UPDATE OF deleted_at, deletion_scheduled_for ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_account_deletion_business_transition();

-- Serialize every subscription INSERT/UPDATE against business deletion. The
-- guarded webhook RPC below reports a skip explicitly, while this trigger is
-- defense in depth and protects the old webhook code during migration-first
-- rollout. Returning NULL makes the attempted row write a no-op.
CREATE OR REPLACE FUNCTION public.guard_subscription_write_for_active_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted_at timestamptz;
BEGIN
  SELECT business.deleted_at
  INTO v_deleted_at
  FROM public.businesses AS business
  WHERE business.id = NEW.business_id
  FOR SHARE;

  IF NOT FOUND THEN
    -- Let the foreign key produce the canonical missing-business error.
    RETURN NEW;
  END IF;

  IF v_deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_subscription_write_for_active_business
  ON public.subscriptions;
CREATE TRIGGER guard_subscription_write_for_active_business
BEFORE INSERT OR UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.guard_subscription_write_for_active_business();

-- Atomic soft deletion plus durable pause scheduling. The trigger above is
-- the structural linkage; the explicit queue call also repairs a missing
-- action on an idempotent retry.
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
BEGIN
  IF p_deleted_at IS NULL
     OR p_deletion_scheduled_for IS NULL
     OR p_deletion_scheduled_for <> p_deleted_at + interval '60 days' THEN
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
    RAISE EXCEPTION 'business % is not owned by user %', p_business_id, p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
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
    RAISE EXCEPTION 'business % is no longer reactivatable', p_business_id
      USING ERRCODE = '55000';
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

-- Queue a reversible resume, but keep the business deleted until Stripe has
-- been proven resumed (or terminally absent/canceled).
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
  v_stripe_subscription_id text;
  v_local_stripe_subscription_id text;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % is not owned by user %', p_business_id, p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
    RETURN jsonb_build_object(
      'business_id', p_business_id,
      'already_active', true,
      'stripe_action', NULL
    );
  END IF;

  IF v_business.deletion_scheduled_for IS NULL
     OR v_business.deletion_scheduled_for <= now() THEN
    RAISE EXCEPTION 'business % is outside the reactivation grace period', p_business_id
      USING ERRCODE = '55000';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_stripe_subscription_id := v_action.stripe_subscription_id;
  END IF;

  SELECT subscription.stripe_subscription_id
  INTO v_local_stripe_subscription_id
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

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
      'resume'
    );
  END IF;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'already_active', false,
    'deletion_scheduled_for', v_business.deletion_scheduled_for,
    'stripe_action', CASE
      WHEN v_stripe_subscription_id IS NULL THEN NULL
      ELSE to_jsonb(v_action)
    END
  );
END;
$$;

-- Clear deletion state only after the exact resume generation is applied.
-- A terminally missing/already-canceled Stripe subscription is represented by
-- applied_action=cancel and is also safe to reactivate without billing.
CREATE OR REPLACE FUNCTION public.complete_account_reactivation(
  p_business_id uuid,
  p_owner_id uuid,
  p_generation bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % is not owned by user %', p_business_id, p_owner_id
      USING ERRCODE = '42501';
  END IF;

  IF v_business.deleted_at IS NULL THEN
    RETURN true;
  END IF;

  IF v_business.deletion_scheduled_for IS NULL
     OR v_business.deletion_scheduled_for <= now() THEN
    RAISE EXCEPTION 'business % is outside the reactivation grace period', p_business_id
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
       OR v_action.desired_action <> 'resume'
       OR v_action.status <> 'applied'
       OR v_action.applied_action NOT IN ('resume', 'cancel') THEN
      RAISE EXCEPTION
        'business % reactivation generation % is not applied',
        p_business_id,
        COALESCE(p_generation, -1)
        USING ERRCODE = '55000';
    END IF;

    IF v_action.applied_action = 'cancel' THEN
      DELETE FROM public.subscriptions
      WHERE business_id = p_business_id;
    END IF;

    DELETE FROM public.account_deletion_stripe_actions
    WHERE business_id = p_business_id;
  ELSIF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'business % has a subscription without a resume action', p_business_id
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.businesses
  SET deleted_at = NULL,
      deletion_scheduled_for = NULL,
      cleanup_auth_user_id = NULL,
      cleanup_attempted_at = NULL,
      updated_at = now()
  WHERE id = p_business_id;

  RETURN true;
END;
$$;

-- CAS lease used by the external Stripe reconciler. Only pending work can be
-- claimed; blocked work requires an explicit new desired generation or an
-- operator decision.
CREATE OR REPLACE FUNCTION public.claim_account_deletion_stripe_action(
  p_business_id uuid,
  p_generation bigint,
  p_lease_owner text,
  p_lease_seconds integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  IF p_lease_owner IS NULL OR btrim(p_lease_owner) = '' THEN
    RAISE EXCEPTION 'lease owner is required'
      USING ERRCODE = '22004';
  END IF;

  IF p_lease_seconds IS NULL
     OR p_lease_seconds < 1
     OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION 'lease seconds must be between 1 and 300'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_stripe_actions AS action
  SET lease_token = gen_random_uuid(),
      lease_owner = p_lease_owner,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = action.attempt_count + 1,
      last_attempted_at = now(),
      updated_at = now()
  WHERE action.business_id = p_business_id
    AND action.generation = p_generation
    AND action.status = 'pending'
    AND (action.lease_token IS NULL OR action.lease_expires_at <= now())
  RETURNING action.* INTO v_action;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_action);
END;
$$;

-- Complete, release for transient retry, or block the exact claimed
-- generation. The lease token is the CAS value; an expired worker cannot
-- overwrite a newer claimant because the newer claim replaces the token.
CREATE OR REPLACE FUNCTION public.finish_account_deletion_stripe_action(
  p_business_id uuid,
  p_generation bigint,
  p_lease_token uuid,
  p_status text,
  p_applied_action text,
  p_error_code text,
  p_error_message text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_business_id uuid;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('pending', 'applied', 'blocked') THEN
    RAISE EXCEPTION 'invalid Stripe action result status: %', p_status
      USING ERRCODE = '22023';
  END IF;

  IF p_status = 'applied'
     AND (
       p_applied_action IS NULL
       OR p_applied_action NOT IN ('pause', 'resume', 'cancel')
     ) THEN
    RAISE EXCEPTION 'applied Stripe action is required for applied status'
      USING ERRCODE = '22023';
  END IF;

  IF p_status <> 'applied' AND p_applied_action IS NOT NULL THEN
    RAISE EXCEPTION 'applied Stripe action is only valid for applied status'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_stripe_actions AS action
  SET status = p_status,
      applied_action = CASE
        WHEN p_status = 'applied' THEN p_applied_action
        ELSE action.applied_action
      END,
      applied_at = CASE
        WHEN p_status = 'applied' THEN now()
        ELSE action.applied_at
      END,
      lease_token = NULL,
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = CASE
        WHEN p_status = 'applied' THEN NULL
        ELSE p_error_code
      END,
      last_error_message = CASE
        WHEN p_status = 'applied' THEN NULL
        ELSE p_error_message
      END,
      updated_at = now()
  WHERE action.business_id = p_business_id
    AND action.generation = p_generation
    AND action.lease_token = p_lease_token
    AND action.status = 'pending'
    AND (
      p_status <> 'applied'
      OR p_applied_action = action.desired_action
      OR p_applied_action = 'cancel'
    )
  RETURNING action.business_id INTO v_updated_business_id;

  IF FOUND THEN
    RETURN true;
  END IF;

  -- An identical completion retry is successful; stale generations and
  -- displaced lease holders remain false.
  RETURN EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions AS action
    WHERE action.business_id = p_business_id
      AND action.generation = p_generation
      AND action.lease_token IS NULL
      AND action.status = p_status
      AND (
        p_status <> 'applied'
        OR action.applied_action = p_applied_action
      )
  );
END;
$$;

-- Migration 028's full scrub, extended so the Stripe cancellation linkage is
-- queued before the local subscription row is deleted. The business row lock
-- serializes this transaction with guarded webhook writes.
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
  v_local_stripe_subscription_id text;
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  SELECT business.owner_id, business.cleanup_auth_user_id
  INTO v_owner_id, v_existing_auth_user
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

  -- Hard delete config tables (the business row is kept as a tombstone).
  DELETE FROM public.ai_settings            WHERE business_id = p_business_id;
  DELETE FROM public.services               WHERE business_id = p_business_id;
  DELETE FROM public.faqs                   WHERE business_id = p_business_id;
  DELETE FROM public.business_hours         WHERE business_id = p_business_id;
  DELETE FROM public.phone_numbers          WHERE business_id = p_business_id;
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
      telnyx_brand_id = NULL, telnyx_campaign_id = NULL,
      telnyx_messaging_profile_id = NULL, telnyx_voice_application_id = NULL,
      brand_status = NULL, brand_rejection_reason = NULL,
      campaign_status = NULL, campaign_rejection_reason = NULL,
      owner_id = NULL
  WHERE id = p_business_id;

  RETURN v_auth_user;
END;
$$;

-- Final completion marker. The Stripe cancellation and local scrub must both
-- be proven before the schedule/auth linkage is removed.
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
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % does not exist', p_business_id
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
     OR v_business.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'business % is not ready to complete cleanup', p_business_id
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'business % still has a local subscription row', p_business_id
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

  UPDATE public.businesses
  SET deletion_scheduled_for = NULL,
      cleanup_auth_user_id = NULL,
      cleanup_attempted_at = NULL,
      updated_at = now()
  WHERE id = p_business_id;

  RETURN true;
END;
$$;

-- Atomic Stripe webhook sync. The business row lock makes the active check
-- and subscription upsert one serialization unit with soft delete/cleanup.
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

-- invoice.payment_failed uses the same active-business lock/guard and never
-- mutates a deleted tenant's local subscription state.
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
    AND business.deleted_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count > 0;
END;
$$;

-- Existing soft-deleted accounts need a durable action as soon as the
-- migration lands. Completed tombstones (schedule already NULL) are left for
-- the separately reviewed orphan audit because no safe cleanup retry remains.
INSERT INTO public.account_deletion_stripe_actions (
  business_id,
  stripe_subscription_id,
  desired_action
)
SELECT business.id,
       subscription.stripe_subscription_id,
       CASE
         WHEN business.deletion_scheduled_for <= now() THEN 'cancel'
         ELSE 'pause'
       END
FROM public.businesses AS business
JOIN public.subscriptions AS subscription
  ON subscription.business_id = business.id
WHERE business.deleted_at IS NOT NULL
  AND business.deletion_scheduled_for IS NOT NULL
ON CONFLICT (business_id) DO NOTHING;

-- Explicit service-role-only privileges. RLS has no customer policies, and
-- table/function grants are stripped even though service_role normally
-- bypasses RLS.
REVOKE ALL ON TABLE public.account_deletion_stripe_actions FROM PUBLIC;
REVOKE ALL ON TABLE public.account_deletion_stripe_actions FROM anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_stripe_actions FROM service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.account_deletion_stripe_actions TO service_role;

REVOKE ALL ON FUNCTION public.queue_account_deletion_stripe_action(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_account_deletion_business_transition()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_subscription_write_for_active_business()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.schedule_account_deletion(uuid, uuid, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prepare_account_reactivation(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_account_reactivation(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_account_deletion_stripe_action(uuid, bigint, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_account_deletion_stripe_action(uuid, bigint, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_expired_business_cleanup(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_stripe_subscription_if_business_active(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_stripe_subscription_past_due_if_business_active(text, timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.queue_account_deletion_stripe_action(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_account_deletion(uuid, uuid, timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_reactivation(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_reactivation(uuid, uuid, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_stripe_action(uuid, bigint, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_account_deletion_stripe_action(uuid, bigint, uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_business(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_expired_business_cleanup(uuid, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_stripe_subscription_if_business_active(uuid, text, text, text, text, timestamptz, timestamptz, text, text, text, timestamptz, boolean, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_stripe_subscription_past_due_if_business_active(text, timestamptz)
  TO service_role;
