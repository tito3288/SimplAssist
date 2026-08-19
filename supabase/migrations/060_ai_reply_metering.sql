BEGIN;

-- Phase 3: authoritative AI reply metering.
--
-- One unit is consumed only when one durable assistant message is linked to a
-- live web-chat inbound and its reservation is completed. Anthropic provider
-- calls (including tool loops and previews) are recorded separately and never
-- increment reply usage by themselves.

CREATE TABLE public.ai_reply_usage_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  billing_source text NOT NULL CHECK (
    billing_source IN ('subscription', 'partner_billing', 'billing_override')
  ),
  plan text NOT NULL CHECK (
    plan IN ('chat_only', 'sms_only', 'sms_and_chat', 'full')
  ),
  included_ai_replies integer CHECK (
    included_ai_replies IS NULL OR included_ai_replies >= 0
  ),
  completed_replies integer NOT NULL DEFAULT 0
    CHECK (completed_replies >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start),
  CHECK (
    (plan = 'chat_only'
      AND included_ai_replies IS NOT NULL
      AND included_ai_replies = 200)
    OR (plan <> 'chat_only' AND included_ai_replies IS NULL)
  ),
  UNIQUE (business_id, period_start)
);

COMMENT ON TABLE public.ai_reply_usage_periods IS
  'Authoritative AI reply allowance periods. NULL included_ai_replies means the established plan has no newly imposed reply cap.';
COMMENT ON COLUMN public.ai_reply_usage_periods.completed_replies IS
  'Successful durable assistant replies only; provider calls and failed/released reservations do not increment this value.';

CREATE TABLE public.ai_reply_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  usage_period_id uuid NOT NULL
    REFERENCES public.ai_reply_usage_periods(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel = 'web_chat'),
  client_message_id text NOT NULL CHECK (
    btrim(client_message_id) <> '' AND char_length(client_message_id) <= 200
  ),
  request_fingerprint text NOT NULL CHECK (
    request_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  -- Deliberately not an FK: the established owner contact-delete flow must be
  -- able to cascade-delete conversation content without erasing the
  -- content-free usage/cost ledger. The service-only reserve RPC validates
  -- this durable source before insert.
  source_message_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN ('reserved', 'completed', 'released', 'expired')
  ),
  attempt_token uuid NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  reserved_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  released_at timestamptz,
  release_reason text CHECK (
    release_reason IS NULL OR (
      btrim(release_reason) <> '' AND char_length(release_reason) <= 120
    )
  ),
  -- The service-only finalizer verifies this message before setting the proof.
  -- Keeping the opaque id after transcript deletion preserves usage history.
  assistant_message_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > reserved_at),
  CHECK (
    (status = 'completed'
      AND completed_at IS NOT NULL
      AND assistant_message_id IS NOT NULL
      AND released_at IS NULL)
    OR
    (status = 'reserved'
      AND completed_at IS NULL
      AND assistant_message_id IS NULL
      AND released_at IS NULL
      AND release_reason IS NULL)
    OR
    (status IN ('released', 'expired')
      AND completed_at IS NULL
      AND assistant_message_id IS NULL)
  ),
  UNIQUE (business_id, channel, client_message_id),
  UNIQUE (business_id, source_message_id)
);

COMMENT ON TABLE public.ai_reply_reservations IS
  'Idempotent live web-chat reply ledger. A released or expired logical row is reused with a new opaque attempt token on retry.';
COMMENT ON COLUMN public.ai_reply_reservations.request_fingerprint IS
  'Lowercase SHA-256 of immutable request identity; a client id may never replay a different request.';

CREATE TABLE public.ai_reply_reservation_attempts (
  reservation_id uuid NOT NULL
    REFERENCES public.ai_reply_reservations(id) ON DELETE CASCADE,
  attempt_count integer NOT NULL CHECK (attempt_count > 0),
  attempt_token uuid NOT NULL UNIQUE,
  status text NOT NULL CHECK (
    status IN ('reserved', 'completed', 'released', 'expired')
  ),
  reserved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > reserved_at),
  CHECK (
    (status = 'reserved' AND ended_at IS NULL)
    OR (status <> 'reserved' AND ended_at IS NOT NULL)
  ),
  PRIMARY KEY (reservation_id, attempt_count),
  UNIQUE (reservation_id, attempt_count, attempt_token)
);

ALTER TABLE public.ai_reply_reservations
  ADD CONSTRAINT ai_reply_reservations_current_attempt_fkey
  FOREIGN KEY (id, attempt_count, attempt_token)
  REFERENCES public.ai_reply_reservation_attempts (
    reservation_id, attempt_count, attempt_token
  )
  ON DELETE NO ACTION
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON TABLE public.ai_reply_reservation_attempts IS
  'Content-free attempt history for a reused logical reservation. It preserves cost attribution after a retry rotates the current opaque token.';

-- The assistant row carries both reservation and attempt proof at insert time.
-- This closes the crash window between persistence and finalization: a later
-- reserve/finalize can reconcile the linked message without another model call.
ALTER TABLE public.messages
  ADD COLUMN ai_reply_reservation_id uuid
    REFERENCES public.ai_reply_reservations(id)
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN ai_reply_reservation_attempt_token uuid,
  ADD CONSTRAINT messages_ai_reply_reservation_proof_pair CHECK (
    (ai_reply_reservation_id IS NULL)
      = (ai_reply_reservation_attempt_token IS NULL)
  ),
  ADD CONSTRAINT messages_ai_reply_reservation_unique
    UNIQUE (ai_reply_reservation_id);

COMMENT ON COLUMN public.messages.ai_reply_reservation_id IS
  'Service-owned proof linking one durable assistant message to one billable live web-chat reply reservation.';
COMMENT ON COLUMN public.messages.ai_reply_reservation_attempt_token IS
  'Opaque attempt proof preventing an expired worker from persisting after the logical reservation is retried.';

CREATE FUNCTION public.guard_message_ai_reply_reservation_proof()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_source_conversation_id uuid;
BEGIN
  IF TG_OP = 'INSERT'
     AND NEW.ai_reply_reservation_id IS NULL
     AND NEW.ai_reply_reservation_attempt_token IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.ai_reply_reservation_id IS NOT DISTINCT FROM
           OLD.ai_reply_reservation_id
     AND NEW.ai_reply_reservation_attempt_token IS NOT DISTINCT FROM
           OLD.ai_reply_reservation_attempt_token THEN
    RETURN NEW;
  END IF;

  IF COALESCE(auth.role(), current_setting('role', true), '')
       IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION 'customer writes cannot set AI reply reservation proof'
      USING ERRCODE = '42501';
  END IF;

  -- Privileged referential cleanup may clear both columns when the linked
  -- reservation is deleted. Customer roles were rejected above.
  IF TG_OP = 'UPDATE'
     AND OLD.ai_reply_reservation_id IS NOT NULL
     AND NEW.ai_reply_reservation_id IS NULL
     AND NEW.ai_reply_reservation_attempt_token IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.ai_reply_reservation_id IS NULL
     OR NEW.ai_reply_reservation_attempt_token IS NULL
     OR NEW.role <> 'assistant'
     OR NEW.channel <> 'web_chat' THEN
    RAISE EXCEPTION 'invalid_ai_reply_assistant_proof'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = NEW.ai_reply_reservation_id
  FOR SHARE;

  IF NOT FOUND
     OR v_reservation.business_id IS DISTINCT FROM NEW.business_id
     OR v_reservation.channel IS DISTINCT FROM NEW.channel
     OR v_reservation.status <> 'reserved'
     OR v_reservation.attempt_token IS DISTINCT FROM
          NEW.ai_reply_reservation_attempt_token
     OR statement_timestamp() >= v_reservation.expires_at THEN
    RAISE EXCEPTION 'invalid_or_expired_ai_reply_reservation_proof'
      USING ERRCODE = '55000';
  END IF;

  SELECT source_message.conversation_id
  INTO v_source_conversation_id
  FROM public.messages AS source_message
  WHERE source_message.id = v_reservation.source_message_id
    AND source_message.business_id = v_reservation.business_id
    AND source_message.role = 'customer'
    AND source_message.channel = 'web_chat';

  IF NOT FOUND
     OR v_source_conversation_id IS DISTINCT FROM NEW.conversation_id THEN
    RAISE EXCEPTION 'ai_reply_assistant_conversation_mismatch'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_message_ai_reply_reservation_proof
BEFORE INSERT OR UPDATE OF
  ai_reply_reservation_id,
  ai_reply_reservation_attempt_token
ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_message_ai_reply_reservation_proof();

REVOKE ALL ON FUNCTION public.guard_message_ai_reply_reservation_proof()
  FROM PUBLIC, anon, authenticated, service_role;

-- Once a message is durable billing proof, customer-facing table grants must
-- not let an owner rewrite the request or exact replay target. Service-owned
-- retention/account cleanup remains able to delete the whole business graph.
CREATE FUNCTION public.guard_metered_message_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.ai_reply_reservations AS reservation
    WHERE reservation.source_message_id = OLD.id
       OR reservation.assistant_message_id = OLD.id
  ) AND (
    NEW.business_id IS DISTINCT FROM OLD.business_id
    OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id
    OR NEW.role IS DISTINCT FROM OLD.role
    OR NEW.channel IS DISTINCT FROM OLD.channel
    OR NEW.content IS DISTINCT FROM OLD.content
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'customer writes cannot change metered message proof'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_metered_message_immutability
BEFORE UPDATE ON public.messages
FOR EACH ROW
EXECUTE FUNCTION public.guard_metered_message_immutability();

REVOKE ALL ON FUNCTION public.guard_metered_message_immutability()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE INDEX idx_ai_reply_periods_business_period
  ON public.ai_reply_usage_periods (business_id, period_start DESC);
CREATE INDEX idx_ai_reply_reservations_period_status_expiry
  ON public.ai_reply_reservations (usage_period_id, status, expires_at);
CREATE INDEX idx_ai_reply_reservations_business_status_expiry
  ON public.ai_reply_reservations (business_id, status, expires_at);
CREATE INDEX idx_ai_reply_reservations_global_expiry
  ON public.ai_reply_reservations (expires_at, id)
  WHERE status = 'reserved';
CREATE INDEX idx_ai_reply_attempts_status_expiry
  ON public.ai_reply_reservation_attempts (status, expires_at);

ALTER TABLE public.ai_reply_usage_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reply_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_reply_reservation_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_reply_usage_periods
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_reply_reservations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.ai_reply_reservation_attempts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.ai_reply_usage_periods TO service_role;
GRANT SELECT ON TABLE public.ai_reply_reservations TO service_role;
GRANT SELECT ON TABLE public.ai_reply_reservation_attempts TO service_role;

-- Caller holds the business row lock. Reconcile every assistant that was
-- durably linked before a worker crashed, including one whose reservation TTL
-- elapsed. This must run before a new allowance decision so a completed reply
-- cannot be displaced by a later reservation.
CREATE FUNCTION public.reconcile_linked_ai_reply_reservations(
  p_business_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate record;
  v_completed integer := 0;
BEGIN
  FOR v_candidate IN
    SELECT
      reservation.id,
      reservation.usage_period_id,
      assistant.id AS assistant_message_id
    FROM public.ai_reply_reservations AS reservation
    JOIN public.messages AS assistant
      ON assistant.ai_reply_reservation_id = reservation.id
     AND assistant.ai_reply_reservation_attempt_token =
           reservation.attempt_token
     AND assistant.business_id = reservation.business_id
     AND assistant.role = 'assistant'
     AND assistant.channel = 'web_chat'
    WHERE reservation.business_id = p_business_id
      AND reservation.status <> 'completed'
    ORDER BY reservation.created_at, reservation.id
    FOR UPDATE OF reservation
  LOOP
    UPDATE public.ai_reply_usage_periods
    SET completed_replies = completed_replies + 1,
        updated_at = statement_timestamp()
    WHERE id = v_candidate.usage_period_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_reply_usage_period_missing'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.ai_reply_reservations
    SET status = 'completed',
        completed_at = statement_timestamp(),
        assistant_message_id = v_candidate.assistant_message_id,
        released_at = NULL,
        release_reason = NULL,
        updated_at = statement_timestamp()
    WHERE id = v_candidate.id;

    UPDATE public.ai_reply_reservation_attempts
    SET status = 'completed',
        ended_at = statement_timestamp()
    WHERE reservation_id = v_candidate.id
      AND attempt_token = (
        SELECT reservation.attempt_token
        FROM public.ai_reply_reservations AS reservation
        WHERE reservation.id = v_candidate.id
      )
      AND status <> 'completed';

    v_completed := v_completed + 1;
  END LOOP;

  RETURN v_completed;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_linked_ai_reply_reservations(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Recover an exact durable reply before runtime entitlement or operational
-- gates. This is deliberately not a general reservation reader: callers must
-- prove the immutable browser request fingerprint, and only a completed row
-- returns assistant-message linkage. Reconciliation closes the crash window
-- between the durable assistant INSERT and finalize_ai_reply.
CREATE FUNCTION public.get_completed_ai_reply(
  p_business_id uuid,
  p_channel text,
  p_client_message_id text,
  p_request_fingerprint text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_assistant public.messages%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_channel IS DISTINCT FROM 'web_chat'
     OR p_client_message_id IS NULL
     OR btrim(p_client_message_id) = ''
     OR char_length(p_client_message_id) > 200
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_ai_reply_completion_lookup'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize with billing transitions and finalization without consulting
  -- mutable billing/operational state. A committed reply remains recoverable
  -- after a later pause or subscription cancellation.
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.business_id = p_business_id
    AND reservation.channel = p_channel
    AND reservation.client_message_id = p_client_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_reservation.request_fingerprint IS DISTINCT FROM
       p_request_fingerprint THEN
    RAISE EXCEPTION 'ai_reply_idempotency_conflict'
      USING ERRCODE = '23505';
  END IF;

  PERFORM public.reconcile_linked_ai_reply_reservations(p_business_id);

  SELECT reservation.*
  INTO STRICT v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = v_reservation.id;

  IF v_reservation.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'outcome', 'not_completed',
      'reservation_id', v_reservation.id,
      'source_message_id', v_reservation.source_message_id,
      'status', v_reservation.status
    );
  END IF;

  SELECT assistant.*
  INTO v_assistant
  FROM public.messages AS assistant
  WHERE assistant.id = v_reservation.assistant_message_id
    AND assistant.ai_reply_reservation_id = v_reservation.id
    AND assistant.ai_reply_reservation_attempt_token =
          v_reservation.attempt_token
    AND assistant.business_id = v_reservation.business_id
    AND assistant.role = 'assistant'
    AND assistant.channel = 'web_chat';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_reply_completed_proof_missing'
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'reservation_id', v_reservation.id,
    'source_message_id', v_reservation.source_message_id,
    'assistant_message_id', v_assistant.id,
    'conversation_id', v_assistant.conversation_id,
    'usage_period_id', v_reservation.usage_period_id,
    'completed_at', v_reservation.completed_at
  );
END;
$$;

-- Side-effect-free current-period read model for Billing/dashboard surfaces.
-- It resolves the same billing authority as reserve_ai_reply but never creates
-- or reconciles a usage row. A linked assistant left behind by a finalizer
-- crash is included in the effective completed count without mutating state.
CREATE FUNCTION public.get_current_ai_reply_usage(
  p_business_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_period public.ai_reply_usage_periods%ROWTYPE;
  v_plan text;
  v_billing_source text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_allowance integer;
  v_completed integer := 0;
  v_linked_unfinalized integer := 0;
  v_active_reservations integer := 0;
  v_remaining integer;
  v_now timestamptz;
  v_allowance_renewal text := 'scheduled';
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'invalid_ai_reply_usage_request'
      USING ERRCODE = '22023';
  END IF;

  -- The central Stripe and partner transition RPCs also lock this row. Use an
  -- exclusive row lock so a concurrent first subscription insert cannot make
  -- this read observe a transient, non-authoritative billing source.
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'business_not_found'
    );
  END IF;

  v_now := clock_timestamp();

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  IF FOUND THEN
    IF v_subscription.status IS NULL
       OR v_subscription.status NOT IN ('active', 'past_due', 'trialing') THEN
      RETURN jsonb_build_object(
        'outcome', 'not_entitled',
        'reason', 'inactive_subscription',
        'plan', v_subscription.plan
      );
    END IF;

    v_plan := v_subscription.plan;
    v_billing_source := 'subscription';

    IF v_plan = 'chat_only' THEN
      -- A paid/current Chat Only allowance must always use the exact Stripe
      -- period. During Phase 2's past-due service grace, freeze the last valid
      -- period instead of minting another unpaid 200-reply allowance.
      IF v_subscription.current_period_start IS NULL
         OR v_subscription.current_period_end IS NULL
         OR v_subscription.current_period_end <=
              v_subscription.current_period_start
         OR v_now < v_subscription.current_period_start
         OR (
           v_subscription.status IN ('active', 'trialing')
           AND v_now >= v_subscription.current_period_end
         ) THEN
        RAISE EXCEPTION 'invalid_ai_reply_subscription_period'
          USING ERRCODE = '55000';
      END IF;
      v_period_start := v_subscription.current_period_start;
      v_period_end := v_subscription.current_period_end;
      IF v_subscription.status = 'past_due' THEN
        v_allowance_renewal := 'frozen_past_due';
      END IF;
    ELSIF v_plan IN ('sms_and_chat', 'full') THEN
      -- Existing plans are uncapped. Period values group telemetry only and
      -- must never turn a stale/null Stripe snapshot into a service outage.
      IF v_subscription.current_period_start IS NOT NULL
         AND v_subscription.current_period_end IS NOT NULL
         AND v_subscription.current_period_end >
              v_subscription.current_period_start THEN
        v_period_start := v_subscription.current_period_start;
        v_period_end := v_subscription.current_period_end;
      ELSE
        v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
          AT TIME ZONE 'UTC';
        v_period_end := v_period_start + interval '1 month';
      END IF;
    ELSIF v_plan = 'sms_only' THEN
      v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
        AT TIME ZONE 'UTC';
      v_period_end := v_period_start + interval '1 month';
    ELSE
      RAISE EXCEPTION 'invalid_ai_reply_plan'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_business.billing_mode IN ('invoiced', 'comped') THEN
    IF v_business.partner_plan IS NULL THEN
      RAISE EXCEPTION 'invalid_ai_reply_partner_billing_state'
        USING ERRCODE = '55000';
    END IF;
    v_plan := v_business.partner_plan;
    v_billing_source := 'partner_billing';
    v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC';
    v_period_end := v_period_start + interval '1 month';
  ELSIF v_business.billing_mode = 'stripe'
        AND v_business.partner_plan IS NULL
        AND (
          v_business.billing_pilot
          OR v_business.billing_comped
          OR v_business.billing_exempt
        ) THEN
    v_plan := 'full';
    v_billing_source := 'billing_override';
    v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC';
    v_period_end := v_period_start + interval '1 month';
  ELSE
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'billing_required'
    );
  END IF;

  IF v_plan = 'sms_only' THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'plan',
      'plan', v_plan
    );
  ELSIF v_plan = 'chat_only' THEN
    v_allowance := 200;
  ELSIF v_plan IN ('sms_and_chat', 'full') THEN
    v_allowance := NULL;
  ELSE
    RAISE EXCEPTION 'invalid_ai_reply_plan'
      USING ERRCODE = '55000';
  END IF;

  SELECT period.*
  INTO v_period
  FROM public.ai_reply_usage_periods AS period
  WHERE period.business_id = p_business_id
    AND period.period_start = v_period_start;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'no_period',
      'usage_period_id', NULL,
      'billing_source', v_billing_source,
      'plan', v_plan,
      'allowance', v_allowance,
      'completed_replies', 0,
      'active_reservations', 0,
      'remaining_replies', v_allowance,
      'period_start', v_period_start,
      'period_end', v_period_end,
      'reset_at', CASE
        WHEN v_allowance_renewal = 'frozen_past_due' THEN NULL
        ELSE v_period_end
      END,
      'allowance_renewal', v_allowance_renewal
    );
  END IF;

  SELECT count(*)::integer
  INTO v_linked_unfinalized
  FROM public.ai_reply_reservations AS reservation
  JOIN public.messages AS assistant
    ON assistant.ai_reply_reservation_id = reservation.id
   AND assistant.ai_reply_reservation_attempt_token =
         reservation.attempt_token
   AND assistant.business_id = reservation.business_id
   AND assistant.role = 'assistant'
   AND assistant.channel = 'web_chat'
  WHERE reservation.usage_period_id = v_period.id
    AND reservation.status <> 'completed';

  v_completed := v_period.completed_replies + v_linked_unfinalized;

  SELECT count(*)::integer
  INTO v_active_reservations
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.usage_period_id = v_period.id
    AND reservation.status = 'reserved'
    AND reservation.expires_at > v_now
    AND NOT EXISTS (
      SELECT 1
      FROM public.messages AS assistant
      WHERE assistant.ai_reply_reservation_id = reservation.id
        AND assistant.ai_reply_reservation_attempt_token =
              reservation.attempt_token
        AND assistant.business_id = reservation.business_id
        AND assistant.role = 'assistant'
        AND assistant.channel = 'web_chat'
    );

  v_remaining := CASE
    WHEN v_allowance IS NULL THEN NULL
    ELSE GREATEST(
      v_allowance - v_completed - v_active_reservations,
      0
    )
  END;

  RETURN jsonb_build_object(
    'outcome', 'current',
    'usage_period_id', v_period.id,
    'billing_source', v_billing_source,
    'plan', v_plan,
    'allowance', v_allowance,
    'completed_replies', v_completed,
    'active_reservations', v_active_reservations,
    'remaining_replies', v_remaining,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'reset_at', CASE
      WHEN v_allowance_renewal = 'frozen_past_due' THEN NULL
      ELSE v_period_end
    END,
    'allowance_renewal', v_allowance_renewal
  );
END;
$$;

CREATE FUNCTION public.reserve_ai_reply(
  p_business_id uuid,
  p_channel text,
  p_client_message_id text,
  p_request_fingerprint text,
  p_source_message_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_subscription public.subscriptions%ROWTYPE;
  v_source_message public.messages%ROWTYPE;
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_period public.ai_reply_usage_periods%ROWTYPE;
  v_assistant public.messages%ROWTYPE;
  v_plan text;
  v_billing_source text;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_allowance integer;
  v_active_reservations integer;
  v_remaining integer;
  v_now timestamptz;
  v_new_token uuid;
  v_allowance_renewal text := 'scheduled';
BEGIN
  IF p_business_id IS NULL
     OR p_channel IS DISTINCT FROM 'web_chat'
     OR p_client_message_id IS NULL
     OR btrim(p_client_message_id) = ''
     OR char_length(p_client_message_id) > 200
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_source_message_id IS NULL THEN
    RAISE EXCEPTION 'invalid_ai_reply_reservation_request'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'business_not_found'
    );
  END IF;

  v_now := clock_timestamp();

  SELECT source_message.*
  INTO v_source_message
  FROM public.messages AS source_message
  JOIN public.conversations AS conversation
    ON conversation.id = source_message.conversation_id
   AND conversation.business_id = source_message.business_id
   AND conversation.channel = source_message.channel
  WHERE source_message.id = p_source_message_id
    AND source_message.business_id = p_business_id
    AND source_message.role = 'customer'
    AND source_message.channel = 'web_chat';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_ai_reply_source_message'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.*
  INTO v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.business_id = p_business_id
    AND reservation.channel = p_channel
    AND reservation.client_message_id = p_client_message_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_reservation.request_fingerprint <> p_request_fingerprint
       OR v_reservation.source_message_id <> p_source_message_id THEN
      RAISE EXCEPTION 'ai_reply_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;

    -- Reconcile the whole business before returning this row so an assistant
    -- persisted immediately before a crash always becomes authoritative.
    PERFORM public.reconcile_linked_ai_reply_reservations(p_business_id);

    SELECT reservation.*
    INTO STRICT v_reservation
    FROM public.ai_reply_reservations AS reservation
    WHERE reservation.business_id = p_business_id
      AND reservation.channel = p_channel
      AND reservation.client_message_id = p_client_message_id;

    IF v_reservation.status = 'completed' THEN
      SELECT assistant.*
      INTO v_assistant
      FROM public.messages AS assistant
      WHERE assistant.id = v_reservation.assistant_message_id
        AND assistant.ai_reply_reservation_id = v_reservation.id
        AND assistant.business_id = v_reservation.business_id
        AND assistant.role = 'assistant'
        AND assistant.channel = 'web_chat';

      IF NOT FOUND THEN
        RAISE EXCEPTION 'ai_reply_completed_proof_missing'
          USING ERRCODE = '55000';
      END IF;

      RETURN jsonb_build_object(
        'outcome', 'completed',
        'reservation_id', v_reservation.id,
        'source_message_id', v_reservation.source_message_id,
        'assistant_message_id', v_assistant.id,
        'conversation_id', v_assistant.conversation_id,
        'usage_period_id', v_reservation.usage_period_id,
        'completed_at', v_reservation.completed_at
      );
    END IF;

    IF v_reservation.status = 'reserved'
       AND v_reservation.expires_at > v_now THEN
      RETURN jsonb_build_object(
        'outcome', 'in_progress',
        'reservation_id', v_reservation.id,
        'source_message_id', v_reservation.source_message_id,
        'usage_period_id', v_reservation.usage_period_id,
        'expires_at', v_reservation.expires_at,
        'attempt_count', v_reservation.attempt_count
      );
    END IF;

    IF v_reservation.status = 'reserved' THEN
      UPDATE public.ai_reply_reservations
      SET status = 'expired',
          released_at = v_now,
          release_reason = 'reservation_ttl_expired',
          updated_at = v_now
      WHERE id = v_reservation.id;
      UPDATE public.ai_reply_reservation_attempts
      SET status = 'expired',
          ended_at = v_now
      WHERE reservation_id = v_reservation.id
        AND attempt_token = v_reservation.attempt_token
        AND status = 'reserved';
      v_reservation.status := 'expired';
    END IF;
  ELSE
    -- A durable inbound may not be charged under two different client ids.
    IF EXISTS (
      SELECT 1
      FROM public.ai_reply_reservations AS reservation
      WHERE reservation.business_id = p_business_id
        AND reservation.source_message_id = p_source_message_id
    ) THEN
      RAISE EXCEPTION 'ai_reply_source_message_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;

    PERFORM public.reconcile_linked_ai_reply_reservations(p_business_id);
  END IF;

  IF v_business.operations_suspended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'account_suspended'
    );
  END IF;
  IF v_business.ai_replies_paused_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'outcome', 'blocked',
      'reason', 'ai_replies_paused'
    );
  END IF;

  SELECT subscription.*
  INTO v_subscription
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  IF FOUND THEN
    IF v_subscription.status IS NULL
       OR v_subscription.status NOT IN ('active', 'past_due', 'trialing') THEN
      RETURN jsonb_build_object(
        'outcome', 'not_entitled',
        'reason', 'inactive_subscription',
        'plan', v_subscription.plan
      );
    END IF;

    v_plan := v_subscription.plan;
    v_billing_source := 'subscription';

    IF v_plan = 'chat_only' THEN
      IF v_subscription.current_period_start IS NULL
         OR v_subscription.current_period_end IS NULL
         OR v_subscription.current_period_end <=
              v_subscription.current_period_start
         OR v_now < v_subscription.current_period_start
         OR (
           v_subscription.status IN ('active', 'trialing')
           AND v_now >= v_subscription.current_period_end
         ) THEN
        RAISE EXCEPTION 'invalid_ai_reply_subscription_period'
          USING ERRCODE = '55000';
      END IF;
      v_period_start := v_subscription.current_period_start;
      v_period_end := v_subscription.current_period_end;
      IF v_subscription.status = 'past_due' THEN
        v_allowance_renewal := 'frozen_past_due';
      END IF;
    ELSIF v_plan IN ('sms_and_chat', 'full') THEN
      IF v_subscription.current_period_start IS NOT NULL
         AND v_subscription.current_period_end IS NOT NULL
         AND v_subscription.current_period_end >
              v_subscription.current_period_start THEN
        v_period_start := v_subscription.current_period_start;
        v_period_end := v_subscription.current_period_end;
      ELSE
        v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
          AT TIME ZONE 'UTC';
        v_period_end := v_period_start + interval '1 month';
      END IF;
    ELSIF v_plan = 'sms_only' THEN
      v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
        AT TIME ZONE 'UTC';
      v_period_end := v_period_start + interval '1 month';
    ELSE
      RAISE EXCEPTION 'invalid_ai_reply_plan'
        USING ERRCODE = '55000';
    END IF;
  ELSIF v_business.billing_mode IN ('invoiced', 'comped') THEN
    IF v_business.partner_plan IS NULL THEN
      RAISE EXCEPTION 'invalid_ai_reply_partner_billing_state'
        USING ERRCODE = '55000';
    END IF;
    v_plan := v_business.partner_plan;
    v_billing_source := 'partner_billing';
    v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC';
    v_period_end := v_period_start + interval '1 month';
  ELSIF v_business.billing_mode = 'stripe'
        AND v_business.partner_plan IS NULL
        AND (
          v_business.billing_pilot
          OR v_business.billing_comped
          OR v_business.billing_exempt
        ) THEN
    v_plan := 'full';
    v_billing_source := 'billing_override';
    v_period_start := date_trunc('month', v_now AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC';
    v_period_end := v_period_start + interval '1 month';
  ELSE
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'billing_required'
    );
  END IF;

  IF v_plan = 'sms_only' THEN
    RETURN jsonb_build_object(
      'outcome', 'not_entitled',
      'reason', 'plan',
      'plan', v_plan
    );
  ELSIF v_plan = 'chat_only' THEN
    v_allowance := 200;
  ELSIF v_plan IN ('sms_and_chat', 'full') THEN
    -- Existing plans deliberately keep their established uncapped behavior.
    v_allowance := NULL;
  ELSE
    RAISE EXCEPTION 'invalid_ai_reply_plan'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.ai_reply_usage_periods (
    business_id,
    period_start,
    period_end,
    billing_source,
    plan,
    included_ai_replies
  ) VALUES (
    p_business_id,
    v_period_start,
    v_period_end,
    v_billing_source,
    v_plan,
    v_allowance
  )
  ON CONFLICT (business_id, period_start) DO UPDATE
  SET period_end = EXCLUDED.period_end,
      billing_source = EXCLUDED.billing_source,
      plan = EXCLUDED.plan,
      included_ai_replies = EXCLUDED.included_ai_replies,
      updated_at = v_now
  RETURNING * INTO v_period;

  SELECT count(*)::integer
  INTO v_active_reservations
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.usage_period_id = v_period.id
    AND reservation.status = 'reserved'
    AND reservation.expires_at > v_now;

  IF v_allowance IS NOT NULL
     AND v_period.completed_replies + v_active_reservations >= v_allowance THEN
    RETURN jsonb_build_object(
      'outcome', 'limit_reached',
      'usage_period_id', v_period.id,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'plan', v_period.plan,
      'allowance', v_allowance,
      'completed_replies', v_period.completed_replies,
      'active_reservations', v_active_reservations,
      'remaining_replies', 0,
      'reset_at', CASE
        WHEN v_allowance_renewal = 'frozen_past_due' THEN NULL
        ELSE v_period.period_end
      END,
      'allowance_renewal', v_allowance_renewal
    );
  END IF;

  v_new_token := gen_random_uuid();

  IF v_reservation.id IS NULL THEN
    INSERT INTO public.ai_reply_reservations (
      business_id,
      usage_period_id,
      channel,
      client_message_id,
      request_fingerprint,
      source_message_id,
      status,
      attempt_token,
      attempt_count,
      reserved_at,
      expires_at
    ) VALUES (
      p_business_id,
      v_period.id,
      p_channel,
      p_client_message_id,
      p_request_fingerprint,
      p_source_message_id,
      'reserved',
      v_new_token,
      1,
      v_now,
      v_now + interval '10 minutes'
    )
    RETURNING * INTO v_reservation;
    INSERT INTO public.ai_reply_reservation_attempts (
      reservation_id,
      attempt_count,
      attempt_token,
      status,
      reserved_at,
      expires_at
    ) VALUES (
      v_reservation.id,
      v_reservation.attempt_count,
      v_reservation.attempt_token,
      'reserved',
      v_reservation.reserved_at,
      v_reservation.expires_at
    );
  ELSE
    UPDATE public.ai_reply_reservations
    SET usage_period_id = v_period.id,
        status = 'reserved',
        attempt_token = v_new_token,
        attempt_count = attempt_count + 1,
        reserved_at = v_now,
        expires_at = v_now + interval '10 minutes',
        completed_at = NULL,
        released_at = NULL,
        release_reason = NULL,
        assistant_message_id = NULL,
        updated_at = v_now
    WHERE id = v_reservation.id
    RETURNING * INTO v_reservation;
    INSERT INTO public.ai_reply_reservation_attempts (
      reservation_id,
      attempt_count,
      attempt_token,
      status,
      reserved_at,
      expires_at
    ) VALUES (
      v_reservation.id,
      v_reservation.attempt_count,
      v_reservation.attempt_token,
      'reserved',
      v_reservation.reserved_at,
      v_reservation.expires_at
    );
  END IF;

  v_active_reservations := v_active_reservations + 1;
  v_remaining := CASE
    WHEN v_allowance IS NULL THEN NULL
    ELSE GREATEST(
      v_allowance - v_period.completed_replies - v_active_reservations,
      0
    )
  END;

  RETURN jsonb_build_object(
    'outcome', 'reserved',
    'reservation_id', v_reservation.id,
    'attempt_token', v_reservation.attempt_token,
    'attempt_count', v_reservation.attempt_count,
    'source_message_id', v_reservation.source_message_id,
    'usage_period_id', v_period.id,
    'period_start', v_period.period_start,
    'period_end', v_period.period_end,
    'plan', v_period.plan,
    'allowance', v_allowance,
    'completed_replies', v_period.completed_replies,
    'active_reservations', v_active_reservations,
    'remaining_replies', v_remaining,
    'reset_at', CASE
      WHEN v_allowance_renewal = 'frozen_past_due' THEN NULL
      ELSE v_period.period_end
    END,
    'allowance_renewal', v_allowance_renewal,
    'expires_at', v_reservation.expires_at
  );
END;
$$;

CREATE FUNCTION public.finalize_ai_reply(
  p_reservation_id uuid,
  p_attempt_token uuid,
  p_assistant_message_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_assistant public.messages%ROWTYPE;
  v_conversation_id uuid;
BEGIN
  IF p_reservation_id IS NULL
     OR p_attempt_token IS NULL
     OR p_assistant_message_id IS NULL THEN
    RAISE EXCEPTION 'invalid_ai_reply_finalize_request'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.business_id
  INTO v_business_id
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  SELECT reservation.*
  INTO STRICT v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.status = 'completed' THEN
    IF v_reservation.assistant_message_id <> p_assistant_message_id THEN
      RAISE EXCEPTION 'ai_reply_finalize_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;
    SELECT assistant.conversation_id
    INTO v_conversation_id
    FROM public.messages AS assistant
    WHERE assistant.id = v_reservation.assistant_message_id
      AND assistant.ai_reply_reservation_id = v_reservation.id
      AND assistant.business_id = v_reservation.business_id
      AND assistant.role = 'assistant'
      AND assistant.channel = 'web_chat';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ai_reply_completed_proof_missing'
        USING ERRCODE = '55000';
    END IF;

    RETURN jsonb_build_object(
      'outcome', 'completed',
      'reservation_id', v_reservation.id,
      'source_message_id', v_reservation.source_message_id,
      'assistant_message_id', v_reservation.assistant_message_id,
      'conversation_id', v_conversation_id,
      'usage_period_id', v_reservation.usage_period_id,
      'completed_at', v_reservation.completed_at
    );
  END IF;

  IF v_reservation.attempt_token <> p_attempt_token THEN
    RETURN jsonb_build_object(
      'outcome', 'stale_attempt',
      'reservation_id', v_reservation.id
    );
  END IF;

  SELECT assistant.*
  INTO v_assistant
  FROM public.messages AS assistant
  JOIN public.messages AS source_message
    ON source_message.id = v_reservation.source_message_id
   AND source_message.business_id = assistant.business_id
   AND source_message.conversation_id = assistant.conversation_id
   AND source_message.role = 'customer'
   AND source_message.channel = 'web_chat'
  WHERE assistant.id = p_assistant_message_id
    AND assistant.ai_reply_reservation_id = v_reservation.id
    AND assistant.ai_reply_reservation_attempt_token = p_attempt_token
    AND assistant.business_id = v_reservation.business_id
    AND assistant.role = 'assistant'
    AND assistant.channel = 'web_chat';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'outcome', 'not_ready',
      'reservation_id', v_reservation.id
    );
  END IF;

  UPDATE public.ai_reply_usage_periods
  SET completed_replies = completed_replies + 1,
      updated_at = statement_timestamp()
  WHERE id = v_reservation.usage_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ai_reply_usage_period_missing'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.ai_reply_reservations
  SET status = 'completed',
      completed_at = statement_timestamp(),
      released_at = NULL,
      release_reason = NULL,
      assistant_message_id = v_assistant.id,
      updated_at = statement_timestamp()
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  UPDATE public.ai_reply_reservation_attempts
  SET status = 'completed',
      ended_at = statement_timestamp()
  WHERE reservation_id = v_reservation.id
    AND attempt_token = p_attempt_token
    AND status <> 'completed';

  RETURN jsonb_build_object(
    'outcome', 'completed',
    'reservation_id', v_reservation.id,
    'source_message_id', v_reservation.source_message_id,
    'assistant_message_id', v_reservation.assistant_message_id,
    'conversation_id', v_assistant.conversation_id,
    'usage_period_id', v_reservation.usage_period_id,
    'completed_at', v_reservation.completed_at
  );
END;
$$;

CREATE FUNCTION public.release_ai_reply(
  p_reservation_id uuid,
  p_attempt_token uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_assistant_message_id uuid;
BEGIN
  IF p_reservation_id IS NULL
     OR p_attempt_token IS NULL
     OR p_reason IS NULL
     OR btrim(p_reason) = ''
     OR char_length(p_reason) > 120 THEN
    RAISE EXCEPTION 'invalid_ai_reply_release_request'
      USING ERRCODE = '22023';
  END IF;

  SELECT reservation.business_id
  INTO v_business_id
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;

  SELECT reservation.*
  INTO STRICT v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.status = 'completed' THEN
    RETURN public.finalize_ai_reply(
      v_reservation.id,
      v_reservation.attempt_token,
      v_reservation.assistant_message_id
    );
  END IF;

  IF v_reservation.attempt_token <> p_attempt_token THEN
    RETURN jsonb_build_object(
      'outcome', 'stale_attempt',
      'reservation_id', v_reservation.id
    );
  END IF;

  -- Persistence wins over a cleanup call. This handles a catch/finally crash
  -- boundary without turning a durable assistant into a free or duplicate row.
  SELECT assistant.id
  INTO v_assistant_message_id
  FROM public.messages AS assistant
  WHERE assistant.ai_reply_reservation_id = v_reservation.id
    AND assistant.ai_reply_reservation_attempt_token = p_attempt_token
    AND assistant.business_id = v_reservation.business_id
    AND assistant.role = 'assistant'
    AND assistant.channel = 'web_chat';

  IF FOUND THEN
    RETURN public.finalize_ai_reply(
      v_reservation.id,
      p_attempt_token,
      v_assistant_message_id
    );
  END IF;

  IF v_reservation.status IN ('released', 'expired') THEN
    RETURN jsonb_build_object(
      'outcome', v_reservation.status,
      'reservation_id', v_reservation.id
    );
  END IF;

  UPDATE public.ai_reply_reservations
  SET status = 'released',
      released_at = statement_timestamp(),
      release_reason = p_reason,
      updated_at = statement_timestamp()
  WHERE id = v_reservation.id
  RETURNING * INTO v_reservation;

  UPDATE public.ai_reply_reservation_attempts
  SET status = 'released',
      ended_at = statement_timestamp()
  WHERE reservation_id = v_reservation.id
    AND attempt_token = p_attempt_token
    AND status = 'reserved';

  RETURN jsonb_build_object(
    'outcome', 'released',
    'reservation_id', v_reservation.id
  );
END;
$$;

CREATE FUNCTION public.reap_expired_ai_reply_reservations(
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_reconciled integer := 0;
  v_expired integer := 0;
  v_expire_limit integer;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION 'invalid_ai_reply_reaper_limit'
      USING ERRCODE = '22023';
  END IF;

  -- Complete linked crash-window assistants before expiring ordinary
  -- abandoned work. Match the business-then-reservation lock order used by
  -- reserve/finalize/release so scheduled cleanup cannot deadlock them.
  FOR v_business_id IN
    SELECT DISTINCT reservation.business_id
    FROM public.ai_reply_reservations AS reservation
    JOIN public.messages AS assistant
      ON assistant.ai_reply_reservation_id = reservation.id
     AND assistant.ai_reply_reservation_attempt_token =
           reservation.attempt_token
     AND assistant.business_id = reservation.business_id
     AND assistant.role = 'assistant'
     AND assistant.channel = 'web_chat'
    WHERE reservation.status <> 'completed'
    ORDER BY reservation.business_id
    LIMIT p_limit
  LOOP
    PERFORM 1
    FROM public.businesses AS business
    WHERE business.id = v_business_id
    FOR UPDATE;

    IF FOUND THEN
      v_reconciled := v_reconciled
        + public.reconcile_linked_ai_reply_reservations(v_business_id);
    END IF;

    EXIT WHEN v_reconciled >= p_limit;
  END LOOP;

  v_expire_limit := GREATEST(p_limit - v_reconciled, 0);
  IF v_expire_limit = 0 THEN
    RETURN v_reconciled;
  END IF;

  WITH expired AS (
    SELECT reservation.id
    FROM public.ai_reply_reservations AS reservation
    WHERE reservation.status = 'reserved'
      AND reservation.expires_at <= statement_timestamp()
      -- Linked assistant proof is reconciled by reserve/finalize/release and
      -- must never be treated as an ordinary failed attempt.
      AND NOT EXISTS (
        SELECT 1
        FROM public.messages AS assistant
        WHERE assistant.ai_reply_reservation_id = reservation.id
          AND assistant.ai_reply_reservation_attempt_token =
                reservation.attempt_token
      )
    ORDER BY reservation.expires_at, reservation.id
    FOR UPDATE SKIP LOCKED
    LIMIT v_expire_limit
  ), updated_reservations AS (
    UPDATE public.ai_reply_reservations AS reservation
    SET status = 'expired',
        released_at = statement_timestamp(),
        release_reason = 'reservation_ttl_expired',
        updated_at = statement_timestamp()
    FROM expired
    WHERE reservation.id = expired.id
    RETURNING reservation.id, reservation.attempt_token
  )
  UPDATE public.ai_reply_reservation_attempts AS attempt
  SET status = 'expired',
      ended_at = statement_timestamp()
  FROM updated_reservations AS reservation
  WHERE attempt.reservation_id = reservation.id
    AND attempt.attempt_token = reservation.attempt_token
    AND attempt.status = 'reserved';

  GET DIAGNOSTICS v_expired = ROW_COUNT;
  RETURN v_reconciled + v_expired;
END;
$$;

-- Reservation state is self-healing on every customer retry; this small
-- scheduled pass also closes abandoned/crash-window rows when no retry occurs.
SELECT cron.schedule(
  'reap_expired_ai_reply_reservations',
  '* * * * *',
  $$SELECT public.reap_expired_ai_reply_reservations(500)$$
);

-- Content-free provider-call accounting. These rows describe cost and model
-- behavior only; prompts, user text, assistant text, tool inputs/results, and
-- arbitrary metadata have no columns here.
CREATE TABLE public.anthropic_provider_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  reservation_id uuid
    REFERENCES public.ai_reply_reservations(id) ON DELETE CASCADE,
  reservation_attempt_count integer CHECK (
    reservation_attempt_count IS NULL OR reservation_attempt_count > 0
  ),
  call_idempotency_key text NOT NULL UNIQUE CHECK (
    btrim(call_idempotency_key) <> ''
      AND char_length(call_idempotency_key) <= 240
  ),
  operation text NOT NULL CHECK (
    btrim(operation) <> '' AND char_length(operation) <= 80
  ),
  channel text CHECK (channel IS NULL OR channel IN ('sms', 'web_chat')),
  is_preview boolean NOT NULL DEFAULT false,
  model text NOT NULL CHECK (
    btrim(model) <> '' AND char_length(model) <= 120
  ),
  provider_request_id text CHECK (
    provider_request_id IS NULL OR (
      btrim(provider_request_id) <> ''
      AND char_length(provider_request_id) <= 200
    )
  ),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  cache_creation_input_tokens bigint NOT NULL DEFAULT 0
    CHECK (cache_creation_input_tokens >= 0),
  cache_read_input_tokens bigint NOT NULL DEFAULT 0
    CHECK (cache_read_input_tokens >= 0),
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  stop_reason text CHECK (
    stop_reason IS NULL OR char_length(stop_reason) <= 80
  ),
  tool_use_count integer NOT NULL DEFAULT 0 CHECK (tool_use_count >= 0),
  tool_result_count integer NOT NULL DEFAULT 0 CHECK (tool_result_count >= 0),
  succeeded boolean NOT NULL,
  error_code text CHECK (
    error_code IS NULL OR (
      btrim(error_code) <> '' AND char_length(error_code) <= 120
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (reservation_id IS NULL AND reservation_attempt_count IS NULL)
    OR
    (reservation_id IS NOT NULL AND reservation_attempt_count IS NOT NULL)
  )
);

CREATE UNIQUE INDEX anthropic_provider_calls_provider_request_unique
  ON public.anthropic_provider_calls (provider_request_id)
  WHERE provider_request_id IS NOT NULL;
CREATE INDEX idx_anthropic_provider_calls_business_created
  ON public.anthropic_provider_calls (business_id, created_at DESC);
CREATE INDEX idx_anthropic_provider_calls_reservation
  ON public.anthropic_provider_calls (reservation_id)
  WHERE reservation_id IS NOT NULL;

ALTER TABLE public.anthropic_provider_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.anthropic_provider_calls
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.anthropic_provider_calls TO service_role;

CREATE FUNCTION public.record_anthropic_provider_call(
  p_business_id uuid,
  p_reservation_id uuid,
  p_attempt_token uuid,
  p_call_idempotency_key text,
  p_operation text,
  p_channel text,
  p_is_preview boolean,
  p_model text,
  p_provider_request_id text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cache_creation_input_tokens bigint,
  p_cache_read_input_tokens bigint,
  p_latency_ms integer,
  p_stop_reason text,
  p_tool_use_count integer,
  p_tool_result_count integer,
  p_succeeded boolean,
  p_error_code text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reservation public.ai_reply_reservations%ROWTYPE;
  v_attempt public.ai_reply_reservation_attempts%ROWTYPE;
  v_existing public.anthropic_provider_calls%ROWTYPE;
  v_id uuid;
  v_attempt_count integer;
BEGIN
  IF p_business_id IS NULL
     OR p_call_idempotency_key IS NULL
     OR btrim(p_call_idempotency_key) = ''
     OR char_length(p_call_idempotency_key) > 240
     OR p_operation IS NULL
     OR btrim(p_operation) = ''
     OR char_length(p_operation) > 80
     OR p_channel IS NOT NULL
        AND p_channel NOT IN ('sms', 'web_chat')
     OR p_is_preview IS NULL
     OR p_model IS NULL
     OR btrim(p_model) = ''
     OR char_length(p_model) > 120
     OR p_provider_request_id IS NOT NULL
        AND (
          btrim(p_provider_request_id) = ''
          OR char_length(p_provider_request_id) > 200
        )
     OR p_input_tokens IS NULL OR p_input_tokens < 0
     OR p_output_tokens IS NULL OR p_output_tokens < 0
     OR p_cache_creation_input_tokens IS NULL
        OR p_cache_creation_input_tokens < 0
     OR p_cache_read_input_tokens IS NULL
        OR p_cache_read_input_tokens < 0
     OR p_latency_ms IS NULL OR p_latency_ms < 0
     OR p_stop_reason IS NOT NULL AND char_length(p_stop_reason) > 80
     OR p_tool_use_count IS NULL OR p_tool_use_count < 0
     OR p_tool_result_count IS NULL OR p_tool_result_count < 0
     OR p_succeeded IS NULL
     OR p_error_code IS NOT NULL
        AND (
          btrim(p_error_code) = '' OR char_length(p_error_code) > 120
        ) THEN
    RAISE EXCEPTION 'invalid_anthropic_provider_call'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize only identical accounting keys. The losing half of an
  -- identical concurrent retry then observes and returns the committed row;
  -- a different fact set reaches the explicit conflict comparison below.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'anthropic_provider_calls:' || p_call_idempotency_key,
      0
    )
  );

  IF p_reservation_id IS NULL THEN
    IF p_attempt_token IS NOT NULL
       OR (p_channel = 'web_chat' AND NOT p_is_preview)
       OR (p_is_preview AND p_channel IS DISTINCT FROM 'web_chat') THEN
      RAISE EXCEPTION 'invalid_anthropic_provider_call_reservation'
        USING ERRCODE = '22023';
    END IF;
    v_attempt_count := NULL;
  ELSE
    IF p_attempt_token IS NULL THEN
      RAISE EXCEPTION 'invalid_anthropic_provider_call_reservation'
        USING ERRCODE = '22023';
    END IF;

    SELECT reservation.*
    INTO v_reservation
    FROM public.ai_reply_reservations AS reservation
    JOIN public.ai_reply_reservation_attempts AS attempt
      ON attempt.reservation_id = reservation.id
     AND attempt.attempt_token = p_attempt_token
    WHERE reservation.id = p_reservation_id;

    IF NOT FOUND
       OR v_reservation.business_id <> p_business_id
       OR p_is_preview
       OR p_channel IS DISTINCT FROM 'web_chat' THEN
      RAISE EXCEPTION 'invalid_anthropic_provider_call_reservation'
        USING ERRCODE = '55000';
    END IF;

    SELECT attempt.*
    INTO STRICT v_attempt
    FROM public.ai_reply_reservation_attempts AS attempt
    WHERE attempt.reservation_id = p_reservation_id
      AND attempt.attempt_token = p_attempt_token;
    v_attempt_count := v_attempt.attempt_count;
  END IF;

  SELECT provider_call.*
  INTO v_existing
  FROM public.anthropic_provider_calls AS provider_call
  WHERE provider_call.call_idempotency_key = p_call_idempotency_key;

  IF FOUND THEN
    IF v_existing.business_id IS DISTINCT FROM p_business_id
       OR v_existing.reservation_id IS DISTINCT FROM p_reservation_id
       OR v_existing.reservation_attempt_count IS DISTINCT FROM v_attempt_count
       OR v_existing.operation IS DISTINCT FROM p_operation
       OR v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.is_preview IS DISTINCT FROM p_is_preview
       OR v_existing.model IS DISTINCT FROM p_model
       OR v_existing.provider_request_id IS DISTINCT FROM p_provider_request_id
       OR v_existing.input_tokens IS DISTINCT FROM p_input_tokens
       OR v_existing.output_tokens IS DISTINCT FROM p_output_tokens
       OR v_existing.cache_creation_input_tokens IS DISTINCT FROM
            p_cache_creation_input_tokens
       OR v_existing.cache_read_input_tokens IS DISTINCT FROM
            p_cache_read_input_tokens
       OR v_existing.latency_ms IS DISTINCT FROM p_latency_ms
       OR v_existing.stop_reason IS DISTINCT FROM p_stop_reason
       OR v_existing.tool_use_count IS DISTINCT FROM p_tool_use_count
       OR v_existing.tool_result_count IS DISTINCT FROM p_tool_result_count
       OR v_existing.succeeded IS DISTINCT FROM p_succeeded
       OR v_existing.error_code IS DISTINCT FROM p_error_code THEN
      RAISE EXCEPTION 'anthropic_provider_call_idempotency_conflict'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  INSERT INTO public.anthropic_provider_calls (
    business_id,
    reservation_id,
    reservation_attempt_count,
    call_idempotency_key,
    operation,
    channel,
    is_preview,
    model,
    provider_request_id,
    input_tokens,
    output_tokens,
    cache_creation_input_tokens,
    cache_read_input_tokens,
    latency_ms,
    stop_reason,
    tool_use_count,
    tool_result_count,
    succeeded,
    error_code
  ) VALUES (
    p_business_id,
    p_reservation_id,
    v_attempt_count,
    p_call_idempotency_key,
    p_operation,
    p_channel,
    p_is_preview,
    p_model,
    p_provider_request_id,
    p_input_tokens,
    p_output_tokens,
    p_cache_creation_input_tokens,
    p_cache_read_input_tokens,
    p_latency_ms,
    p_stop_reason,
    p_tool_use_count,
    p_tool_result_count,
    p_succeeded,
    p_error_code
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_reply(uuid, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_ai_reply_usage(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_completed_ai_reply(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalize_ai_reply(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_ai_reply(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reap_expired_ai_reply_reservations(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_anthropic_provider_call(
  uuid, uuid, uuid, text, text, text, boolean, text, text,
  bigint, bigint, bigint, bigint, integer, text, integer, integer,
  boolean, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.reserve_ai_reply(
  uuid, text, text, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_current_ai_reply_usage(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_completed_ai_reply(
  uuid, text, text, text
) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_ai_reply(uuid, uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_ai_reply(uuid, uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_expired_ai_reply_reservations(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_anthropic_provider_call(
  uuid, uuid, uuid, text, text, text, boolean, text, text,
  bigint, bigint, bigint, bigint, integer, text, integer, integer,
  boolean, text
) TO service_role;

COMMIT;
