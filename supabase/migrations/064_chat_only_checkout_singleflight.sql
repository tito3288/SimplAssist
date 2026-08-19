BEGIN;

-- A Chat Only Checkout Session is an externally payable resource. Keep one
-- durable, service-owned attempt identity before the first Stripe mutation so
-- retries, process crashes, and ambiguous provider responses cannot create a
-- second live Session for the same business.
CREATE TABLE public.chat_only_checkout_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'chat_only'
    CHECK (plan = 'chat_only'),
  checkout_mode text NOT NULL DEFAULT 'onboarding'
    CHECK (checkout_mode = 'onboarding'),
  stripe_price_id text NOT NULL
    CHECK (
      char_length(stripe_price_id) BETWEEN 3 AND 255
      AND stripe_price_id = btrim(stripe_price_id)
      AND stripe_price_id !~ '[[:cntrl:]]'
    ),
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'creating'
    CHECK (state IN ('creating', 'open', 'completed', 'expired')),
  claim_token uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_expires_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1
    CHECK (attempt_count > 0),
  stripe_checkout_session_id text UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  -- Checkout URLs are bearer-like payment links. The table is private and the
  -- value is never returned by a database read available to a customer role.
  checkout_url text,
  checkout_session_expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (id, business_id),
  CONSTRAINT chat_only_checkout_attempt_state_shape CHECK (
    (
      state = 'creating'
      AND stripe_checkout_session_id IS NULL
      AND checkout_url IS NULL
      AND completed_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      state = 'open'
      AND stripe_checkout_session_id IS NOT NULL
      AND checkout_url IS NOT NULL
      AND completed_at IS NULL
      AND expired_at IS NULL
    )
    OR (
      state = 'completed'
      AND stripe_checkout_session_id IS NOT NULL
      AND stripe_customer_id IS NOT NULL
      AND stripe_subscription_id IS NOT NULL
      AND completed_at IS NOT NULL
      AND expired_at IS NULL
    )
    OR (
      state = 'expired'
      AND stripe_checkout_session_id IS NOT NULL
      AND stripe_subscription_id IS NULL
      AND completed_at IS NULL
      AND expired_at IS NOT NULL
    )
  ),
  CONSTRAINT chat_only_checkout_attempt_session_id_shape CHECK (
    stripe_checkout_session_id IS NULL
    OR (
      char_length(stripe_checkout_session_id) BETWEEN 4 AND 255
      AND stripe_checkout_session_id = btrim(stripe_checkout_session_id)
      AND stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
    )
  ),
  CONSTRAINT chat_only_checkout_attempt_customer_id_shape CHECK (
    stripe_customer_id IS NULL
    OR (
      char_length(stripe_customer_id) BETWEEN 5 AND 255
      AND stripe_customer_id = btrim(stripe_customer_id)
      AND stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    )
  ),
  CONSTRAINT chat_only_checkout_attempt_subscription_id_shape CHECK (
    stripe_subscription_id IS NULL
    OR (
      char_length(stripe_subscription_id) BETWEEN 5 AND 255
      AND stripe_subscription_id = btrim(stripe_subscription_id)
      AND stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'
    )
  ),
  CONSTRAINT chat_only_checkout_attempt_url_shape CHECK (
    checkout_url IS NULL
    OR (
      char_length(checkout_url) BETWEEN 1 AND 4096
      AND checkout_url = btrim(checkout_url)
      AND checkout_url ~ '^https://'
      AND checkout_url !~ '[[:cntrl:]]'
    )
  ),
  CONSTRAINT chat_only_checkout_attempt_time_shape CHECK (
    claim_expires_at >= claimed_at
    AND checkout_session_expires_at > created_at
  )
);

CREATE UNIQUE INDEX chat_only_checkout_attempts_one_live_per_business
  ON public.chat_only_checkout_attempts (business_id)
  WHERE state IN ('creating', 'open');

CREATE UNIQUE INDEX chat_only_checkout_attempts_subscription_unique
  ON public.chat_only_checkout_attempts (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX chat_only_checkout_attempts_state_expiry_idx
  ON public.chat_only_checkout_attempts (
    state,
    checkout_session_expires_at,
    business_id
  );

ALTER TABLE public.chat_only_checkout_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_only_checkout_attempts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.chat_only_checkout_attempts TO service_role;

-- Permanent account cleanup keeps the business row as an analytics tombstone,
-- so the attempt FK cannot provide retention by cascading. Remove bearer-like
-- Checkout URLs and Stripe identifiers when the existing 60-day cleanup marks
-- PII as scrubbed. A subscription-bound attempt is removed only after the
-- durable account-deletion action owns the exact cancellation identity; that
-- action remains until provider-confirmed cancellation completes.
CREATE FUNCTION public.purge_chat_only_checkout_attempts_on_tombstone()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Other cleanup triggers also use this tombstone transition. Businesses
  -- without Chat Checkout history are outside this trigger's authority.
  IF NOT EXISTS (
    SELECT 1
    FROM public.chat_only_checkout_attempts AS attempt
    WHERE attempt.business_id = NEW.id
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.deleted_at IS NULL
     OR NEW.deletion_scheduled_for IS NULL
     OR NEW.deletion_scheduled_for >= now()
     OR NEW.owner_id IS NOT NULL THEN
    RAISE EXCEPTION 'chat_only_checkout_retention_invalid_tombstone'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.chat_only_checkout_attempts AS attempt
    WHERE attempt.business_id = NEW.id
      AND attempt.state IN ('creating', 'open')
  ) THEN
    RAISE EXCEPTION 'chat_only_checkout_retention_nonterminal_attempt'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.chat_only_checkout_attempts AS attempt
    WHERE attempt.business_id = NEW.id
      AND attempt.stripe_subscription_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.account_deletion_stripe_actions AS action
        WHERE action.business_id = NEW.id
          AND action.stripe_subscription_id =
                attempt.stripe_subscription_id
          AND action.desired_action = 'cancel'
      )
  ) THEN
    RAISE EXCEPTION 'chat_only_checkout_retention_missing_cancel_authority'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.chat_only_checkout_attempts
  WHERE business_id = NEW.id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER purge_chat_only_checkout_attempts_on_tombstone
AFTER UPDATE OF cleanup_pii_scrubbed_at
ON public.businesses
FOR EACH ROW
WHEN (
  OLD.cleanup_pii_scrubbed_at IS NULL
  AND NEW.cleanup_pii_scrubbed_at IS NOT NULL
)
EXECUTE FUNCTION public.purge_chat_only_checkout_attempts_on_tombstone();

REVOKE ALL
  ON FUNCTION public.purge_chat_only_checkout_attempts_on_tombstone()
  FROM PUBLIC, anon, authenticated, service_role;

-- Direct billing ownership cannot change while an external Checkout outcome
-- is still payable or unknown. Hard deletion is never a cleanup shortcut: any
-- retained attempt, including terminal history, still owns Stripe and family
-- authority that ON DELETE CASCADE must not erase. The normal tombstone scrub
-- purges terminal attempts through the guarded retention trigger instead.
CREATE FUNCTION public.guard_business_chat_checkout_attempt_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.chat_only_checkout_attempts AS attempt
      WHERE attempt.business_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'chat_only_checkout_attempt_authority_locked'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  IF (
       NEW.owner_id IS DISTINCT FROM OLD.owner_id
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
       OR NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
       OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
       OR NEW.partner_plan IS DISTINCT FROM OLD.partner_plan
       OR NEW.billing_pilot IS DISTINCT FROM OLD.billing_pilot
       OR NEW.billing_comped IS DISTINCT FROM OLD.billing_comped
       OR NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt
     )
     AND EXISTS (
       SELECT 1
       FROM public.chat_only_checkout_attempts AS attempt
       WHERE attempt.business_id = NEW.id
         AND attempt.state IN ('creating', 'open')
     ) THEN
    RAISE EXCEPTION 'chat_only_checkout_attempt_authority_locked'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_business_chat_checkout_attempt_authority()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_business_chat_checkout_attempt_authority
BEFORE UPDATE OF
  owner_id,
  deleted_at,
  billing_mode,
  partner_id,
  partner_plan,
  billing_pilot,
  billing_comped,
  billing_exempt
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_chat_checkout_attempt_authority();

CREATE TRIGGER guard_business_delete_chat_checkout_attempt_authority
BEFORE DELETE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_chat_checkout_attempt_authority();

-- Acquire or recover the one active attempt while holding the tenant mutex.
-- An elapsed worker lease rotates ownership of the SAME attempt; elapsed time
-- never proves that Stripe did not create or complete a Session.
CREATE FUNCTION public.acquire_chat_only_checkout_attempt(
  p_business_id uuid,
  p_stripe_price_id text,
  p_request_fingerprint text,
  p_claim_token uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_business public.businesses%ROWTYPE;
  v_family text;
  v_attempt public.chat_only_checkout_attempts%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_claim_token IS NULL
     OR p_stripe_price_id IS NULL
     OR char_length(p_stripe_price_id) NOT BETWEEN 3 AND 255
     OR p_stripe_price_id <> btrim(p_stripe_price_id)
     OR p_stripe_price_id ~ '[[:cntrl:]]'
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_chat_only_checkout_attempt_request'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_business.deleted_at IS NOT NULL
     OR v_business.owner_id IS NULL
     OR v_business.operations_suspended_at IS NOT NULL
     OR v_business.billing_mode <> 'stripe'
     OR v_business.partner_id IS NOT NULL
     OR v_business.partner_plan IS NOT NULL
     OR v_business.billing_pilot
     OR v_business.billing_comped
     OR v_business.billing_exempt THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  -- Phase 4 canary acquisition is intentionally new-business only. The local
  -- `canceled` bucket collapses several recoverable Stripe states and cannot
  -- safely authorize a replacement subscription without event ordering. Keep
  -- every existing-subscription reacquisition paused for a later lifecycle.
  IF EXISTS (
       SELECT 1
       FROM public.subscriptions AS subscription
       WHERE subscription.business_id = v_business.id
     )
     OR EXISTS (
       SELECT 1
       FROM public.chat_only_checkout_attempts AS historical_attempt
       WHERE historical_attempt.business_id = v_business.id
         AND (
           historical_attempt.state = 'completed'
           OR historical_attempt.stripe_subscription_id IS NOT NULL
         )
     )
     OR v_business.onboarding_selected_plan IS DISTINCT FROM 'chat_only' THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT family
  INTO v_family
  FROM public.business_plan_family_locks
  WHERE business_id = v_business.id;

  IF FOUND AND v_family <> 'chat_only' THEN
    RAISE EXCEPTION 'plan_family_transition_not_supported'
      USING ERRCODE = '55000';
  END IF;

  IF NOT FOUND AND NOT public.claim_business_plan_family(
    v_business.id,
    'chat_only',
    'direct_checkout'
  ) THEN
    RETURN jsonb_build_object('status', 'unavailable');
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.business_id = v_business.id
    AND attempt.state IN ('creating', 'open');

  IF FOUND THEN
    IF v_attempt.stripe_price_id <> p_stripe_price_id
       OR v_attempt.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'chat_only_checkout_attempt_conflict'
        USING ERRCODE = '55000';
    END IF;

    IF v_attempt.state = 'open' THEN
      RETURN jsonb_build_object(
        'status', 'open',
        'attempt_id', v_attempt.id,
        'stripe_checkout_session_id',
          v_attempt.stripe_checkout_session_id,
        'stripe_customer_id', v_attempt.stripe_customer_id,
        'checkout_session_expires_at',
          v_attempt.checkout_session_expires_at
      );
    END IF;

    -- Stripe retains idempotency results for at least 24 hours, not forever.
    -- Replaying a pruned key can create a second Session. Stop automatically
    -- calling Stripe before that boundary and preserve the unknown attempt for
    -- evidence-backed support recovery; elapsed time never terminalizes it.
    IF v_attempt.created_at <= v_now - interval '23 hours' THEN
      RETURN jsonb_build_object(
        'status', 'recovery_required',
        'attempt_id', v_attempt.id
      );
    END IF;

    IF v_attempt.claim_token = p_claim_token
       AND v_attempt.claim_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'status', 'create',
        'attempt_id', v_attempt.id,
        'claim_token', v_attempt.claim_token,
        'stripe_customer_id', v_attempt.stripe_customer_id,
        'checkout_session_expires_at',
          v_attempt.checkout_session_expires_at
      );
    END IF;

    IF v_attempt.claim_expires_at > v_now THEN
      RETURN jsonb_build_object(
        'status', 'in_progress',
        'attempt_id', v_attempt.id,
        'stripe_customer_id', v_attempt.stripe_customer_id,
        'retry_after_seconds',
          GREATEST(
            1,
            CEIL(EXTRACT(EPOCH FROM (
              v_attempt.claim_expires_at - v_now
            )))::integer
          )
      );
    END IF;

    UPDATE public.chat_only_checkout_attempts
    SET claim_token = p_claim_token,
        claimed_at = v_now,
        claim_expires_at = v_now + interval '5 minutes',
        attempt_count = attempt_count + 1,
        updated_at = v_now
    WHERE id = v_attempt.id
    RETURNING * INTO v_attempt;

    RETURN jsonb_build_object(
      'status', 'create',
      'attempt_id', v_attempt.id,
      'claim_token', v_attempt.claim_token,
      'stripe_customer_id', v_attempt.stripe_customer_id,
      'checkout_session_expires_at',
        v_attempt.checkout_session_expires_at
    );
  END IF;

  INSERT INTO public.chat_only_checkout_attempts (
    business_id,
    stripe_price_id,
    request_fingerprint,
    claim_token,
    claimed_at,
    claim_expires_at,
    checkout_session_expires_at
  ) VALUES (
    v_business.id,
    p_stripe_price_id,
    p_request_fingerprint,
    p_claim_token,
    v_now,
    v_now + interval '5 minutes',
    date_trunc('second', v_now + interval '60 minutes')
  )
  RETURNING * INTO v_attempt;

  RETURN jsonb_build_object(
    'status', 'create',
    'attempt_id', v_attempt.id,
    'claim_token', v_attempt.claim_token,
    'stripe_customer_id', v_attempt.stripe_customer_id,
    'checkout_session_expires_at',
      v_attempt.checkout_session_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_chat_only_checkout_attempt(
  uuid, text, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_chat_only_checkout_attempt(
  uuid, text, text, uuid
) TO service_role;

-- Every Chat subscription event, including customer.subscription.* events
-- that do not carry a Checkout Session ID, must prove it belongs to the one
-- durable attempt. This wrapper holds the business mutex across validation,
-- the established guarded subscription upsert, and attempt linkage. Exact
-- paid Checkout Session evidence also terminalizes the attempt in this same
-- transaction, closing the crash window before the idempotent completion RPC.
-- Existing SMS plans continue using the unchanged generic sync RPC.
CREATE FUNCTION public.sync_chat_only_subscription_from_attempt(
  p_business_id uuid,
  p_attempt_id uuid,
  p_request_fingerprint text,
  p_checkout_session_expires_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_cancel_at_period_end boolean,
  p_updated_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_attempt public.chat_only_checkout_attempts%ROWTYPE;
  v_synced boolean;
BEGIN
  IF p_business_id IS NULL
     OR p_attempt_id IS NULL
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_checkout_session_expires_at IS NULL
     OR p_stripe_customer_id IS NULL
     OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
     OR p_stripe_subscription_id IS NULL
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$'
     OR p_status IS NULL
     OR p_status NOT IN ('active', 'trialing', 'past_due', 'canceled')
     OR p_stripe_price_id IS NULL
     OR char_length(p_stripe_price_id) NOT BETWEEN 3 AND 255
     OR p_stripe_price_id <> btrim(p_stripe_price_id)
     OR (
       p_stripe_checkout_session_id IS NOT NULL
       AND p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
     )
     OR p_cancel_at_period_end IS NULL
     OR p_updated_at IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_only_subscription_attempt_sync'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.state = 'expired'
     OR v_attempt.stripe_price_id <> p_stripe_price_id
     OR v_attempt.request_fingerprint <> p_request_fingerprint
     OR v_attempt.checkout_session_expires_at <>
          p_checkout_session_expires_at
     OR (
       v_attempt.stripe_checkout_session_id IS NOT NULL
       AND p_stripe_checkout_session_id IS NOT NULL
       AND v_attempt.stripe_checkout_session_id <>
             p_stripe_checkout_session_id
     )
     OR (
       v_attempt.stripe_customer_id IS NOT NULL
       AND v_attempt.stripe_customer_id <> p_stripe_customer_id
     )
     OR (
       v_attempt.stripe_subscription_id IS NOT NULL
       AND v_attempt.stripe_subscription_id <> p_stripe_subscription_id
     ) THEN
    RAISE EXCEPTION 'chat_only_subscription_attempt_mismatch'
      USING ERRCODE = '55000';
  END IF;

  v_synced := public.sync_stripe_subscription_if_business_active(
    p_business_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    'chat_only',
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_stripe_price_id,
    NULL,
    p_stripe_checkout_session_id,
    NULL,
    p_cancel_at_period_end,
    p_updated_at
  );

  IF v_synced IS DISTINCT FROM true THEN
    RETURN false;
  END IF;

  UPDATE public.chat_only_checkout_attempts
  SET state = CASE
        WHEN p_stripe_checkout_session_id IS NOT NULL THEN 'completed'
        ELSE state
      END,
      stripe_checkout_session_id = COALESCE(
        stripe_checkout_session_id,
        p_stripe_checkout_session_id
      ),
      stripe_customer_id = COALESCE(
        stripe_customer_id,
        p_stripe_customer_id
      ),
      stripe_subscription_id = COALESCE(
        stripe_subscription_id,
        p_stripe_subscription_id
      ),
      claim_expires_at = CASE
        WHEN p_stripe_checkout_session_id IS NOT NULL THEN v_now
        ELSE claim_expires_at
      END,
      completed_at = CASE
        WHEN p_stripe_checkout_session_id IS NOT NULL THEN
          COALESCE(completed_at, v_now)
        ELSE completed_at
      END,
      updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_chat_only_subscription_from_attempt(
  uuid, uuid, text, timestamptz, text, text, text, timestamptz,
  timestamptz, text, text, boolean, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_chat_only_subscription_from_attempt(
  uuid, uuid, text, timestamptz, text, text, text, timestamptz,
  timestamptz, text, text, boolean, timestamptz
) TO service_role;

-- Persist the exact open Session only for the current attempt worker. A stale
-- worker cannot replace evidence recorded by the next recovery worker.
CREATE FUNCTION public.record_chat_only_checkout_session(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text,
  p_checkout_url text,
  p_checkout_session_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_business_id uuid;
  v_attempt public.chat_only_checkout_attempts%ROWTYPE;
BEGIN
  IF p_attempt_id IS NULL
     OR p_claim_token IS NULL
     OR p_stripe_checkout_session_id IS NULL
     OR char_length(p_stripe_checkout_session_id) NOT BETWEEN 4 AND 255
     OR p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
     OR (
       p_stripe_customer_id IS NOT NULL
       AND (
         char_length(p_stripe_customer_id) NOT BETWEEN 5 AND 255
         OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
       )
     )
     OR p_checkout_url IS NULL
     OR char_length(p_checkout_url) NOT BETWEEN 1 AND 4096
     OR p_checkout_url <> btrim(p_checkout_url)
     OR p_checkout_url !~ '^https://'
     OR p_checkout_url ~ '[[:cntrl:]]'
     OR p_checkout_session_expires_at IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_only_checkout_session_record'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.business_id
  INTO v_business_id
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.business_id = v_business_id
  FOR UPDATE;

  IF v_attempt.state = 'open' THEN
    RETURN v_attempt.stripe_checkout_session_id =
             p_stripe_checkout_session_id
       AND v_attempt.stripe_customer_id IS NOT DISTINCT FROM
             p_stripe_customer_id
       AND v_attempt.checkout_url = p_checkout_url
       AND v_attempt.checkout_session_expires_at =
             p_checkout_session_expires_at;
  END IF;

  IF v_attempt.state <> 'creating'
     OR v_attempt.claim_token <> p_claim_token
     OR (
       v_attempt.stripe_customer_id IS NOT NULL
       AND v_attempt.stripe_customer_id IS DISTINCT FROM
             p_stripe_customer_id
     )
     OR v_attempt.checkout_session_expires_at <>
          p_checkout_session_expires_at THEN
    RETURN false;
  END IF;

  UPDATE public.chat_only_checkout_attempts
  SET state = 'open',
      stripe_checkout_session_id = p_stripe_checkout_session_id,
      stripe_customer_id = p_stripe_customer_id,
      checkout_url = p_checkout_url,
      claim_expires_at = v_now,
      updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_chat_only_checkout_session(
  uuid, uuid, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_chat_only_checkout_session(
  uuid, uuid, text, text, text, timestamptz
) TO service_role;

-- Release only the transient worker lease after a provider call failed before
-- returning a Session. The attempt remains creating and keeps the same Stripe
-- idempotency identity because the provider outcome may still be ambiguous.
CREATE FUNCTION public.release_chat_only_checkout_attempt_claim(
  p_attempt_id uuid,
  p_claim_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_business_id uuid;
BEGIN
  IF p_attempt_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid_chat_only_checkout_claim_release'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.business_id
  INTO v_business_id
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  UPDATE public.chat_only_checkout_attempts
  SET claim_expires_at = LEAST(claim_expires_at, v_now),
      updated_at = v_now
  WHERE id = p_attempt_id
    AND business_id = v_business_id
    AND state = 'creating'
    AND claim_token = p_claim_token;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.release_chat_only_checkout_attempt_claim(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_chat_only_checkout_attempt_claim(
  uuid, uuid
) TO service_role;

-- Completion is accepted only after the exact Chat subscription has been
-- synchronized locally. Browser finalization and the signed webhook may race;
-- both converge idempotently on the same attempt.
CREATE FUNCTION public.complete_chat_only_checkout_attempt(
  p_business_id uuid,
  p_attempt_id uuid,
  p_stripe_checkout_session_id text,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_request_fingerprint text,
  p_checkout_session_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_attempt public.chat_only_checkout_attempts%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_attempt_id IS NULL
     OR p_stripe_checkout_session_id IS NULL
     OR p_stripe_customer_id IS NULL
     OR p_stripe_subscription_id IS NULL
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_checkout_session_expires_at IS NULL
     OR p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$'
     OR p_stripe_customer_id !~ '^cus_[A-Za-z0-9]+$'
     OR p_stripe_subscription_id !~ '^sub_[A-Za-z0-9]+$' THEN
    RAISE EXCEPTION 'invalid_chat_only_checkout_completion'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_attempt.state = 'completed' THEN
    RETURN v_attempt.stripe_checkout_session_id =
             p_stripe_checkout_session_id
       AND v_attempt.stripe_customer_id = p_stripe_customer_id
       AND v_attempt.stripe_subscription_id = p_stripe_subscription_id
       AND v_attempt.request_fingerprint = p_request_fingerprint
       AND v_attempt.checkout_session_expires_at =
             p_checkout_session_expires_at;
  END IF;

  IF v_attempt.state NOT IN ('creating', 'open')
     OR v_attempt.request_fingerprint <> p_request_fingerprint
     OR v_attempt.checkout_session_expires_at <>
          p_checkout_session_expires_at
     OR (
       v_attempt.stripe_checkout_session_id IS NOT NULL
       AND v_attempt.stripe_checkout_session_id <>
             p_stripe_checkout_session_id
     )
     OR (
       v_attempt.stripe_customer_id IS NOT NULL
       AND v_attempt.stripe_customer_id <> p_stripe_customer_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.subscriptions AS subscription
       WHERE subscription.business_id = p_business_id
         AND subscription.plan = 'chat_only'
         AND subscription.stripe_customer_id = p_stripe_customer_id
         AND subscription.stripe_subscription_id = p_stripe_subscription_id
         AND subscription.stripe_checkout_session_id =
               p_stripe_checkout_session_id
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.chat_only_checkout_attempts
  SET state = 'completed',
      stripe_checkout_session_id = p_stripe_checkout_session_id,
      stripe_customer_id = p_stripe_customer_id,
      stripe_subscription_id = p_stripe_subscription_id,
      claim_expires_at = v_now,
      completed_at = COALESCE(completed_at, v_now),
      updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_chat_only_checkout_attempt(
  uuid, uuid, text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_chat_only_checkout_attempt(
  uuid, uuid, text, text, text, text, timestamptz
) TO service_role;

-- An expired transition requires exact Stripe Session evidence (webhook or a
-- successful GET). Time alone never closes an unknown creating attempt.
CREATE FUNCTION public.expire_chat_only_checkout_attempt(
  p_business_id uuid,
  p_attempt_id uuid,
  p_stripe_checkout_session_id text,
  p_request_fingerprint text,
  p_checkout_session_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_attempt public.chat_only_checkout_attempts%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_attempt_id IS NULL
     OR p_stripe_checkout_session_id IS NULL
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_checkout_session_expires_at IS NULL
     OR p_stripe_checkout_session_id !~ '^cs_[A-Za-z0-9_]+$' THEN
    RAISE EXCEPTION 'invalid_chat_only_checkout_expiry'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.chat_only_checkout_attempts AS attempt
  WHERE attempt.id = p_attempt_id
    AND attempt.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_attempt.state = 'expired' THEN
    RETURN v_attempt.stripe_checkout_session_id =
             p_stripe_checkout_session_id
       AND v_attempt.request_fingerprint = p_request_fingerprint
       AND v_attempt.checkout_session_expires_at =
             p_checkout_session_expires_at;
  END IF;

  IF v_attempt.state NOT IN ('creating', 'open')
     OR v_attempt.stripe_subscription_id IS NOT NULL
     OR v_attempt.request_fingerprint <> p_request_fingerprint
     OR v_attempt.checkout_session_expires_at <>
          p_checkout_session_expires_at
     OR (
       v_attempt.stripe_checkout_session_id IS NOT NULL
       AND v_attempt.stripe_checkout_session_id <>
             p_stripe_checkout_session_id
     ) THEN
    RETURN false;
  END IF;

  UPDATE public.chat_only_checkout_attempts
  SET state = 'expired',
      stripe_checkout_session_id = p_stripe_checkout_session_id,
      claim_expires_at = v_now,
      expired_at = COALESCE(expired_at, v_now),
      updated_at = v_now
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_chat_only_checkout_attempt(
  uuid, uuid, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_chat_only_checkout_attempt(
  uuid, uuid, text, text, timestamptz
) TO service_role;

COMMENT ON TABLE public.chat_only_checkout_attempts IS
  'Private Chat Only Checkout single-flight ledger; checkout_url is sensitive, service-readable only, and purged with terminal attempt identifiers during permanent account cleanup.';
COMMENT ON FUNCTION public.purge_chat_only_checkout_attempts_on_tombstone() IS
  'Purges terminal Chat Checkout evidence at the 60-day tombstone boundary only after exact durable Stripe cancellation authority exists.';
COMMENT ON FUNCTION public.acquire_chat_only_checkout_attempt(
  uuid, text, text, uuid
) IS
  'Acquires or recovers the one direct Chat Only Checkout attempt under the business mutex.';
COMMENT ON FUNCTION public.record_chat_only_checkout_session(
  uuid, uuid, text, text, text, timestamptz
) IS
  'Records exact open Stripe Checkout evidence for the current attempt worker.';
COMMENT ON FUNCTION public.complete_chat_only_checkout_attempt(
  uuid, uuid, text, text, text, text, timestamptz
) IS
  'Completes an exact Chat Checkout attempt only after subscription synchronization.';
COMMENT ON FUNCTION public.expire_chat_only_checkout_attempt(
  uuid, uuid, text, text, timestamptz
) IS
  'Expires an exact Chat Checkout attempt from authenticated Stripe evidence, never elapsed time alone.';

COMMIT;
