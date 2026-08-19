BEGIN;

-- Freeze the legacy writer surfaces while inventorying provider ambiguity.
-- The order follows the durable mutex hierarchy (business before booking/token)
-- so an old in-flight reserve/disconnect either commits before this preflight
-- or waits until all 063 guards are installed.
LOCK TABLE public.businesses IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.calendar_bookings IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.google_calendar_tokens IN SHARE ROW EXCLUSIVE MODE;

-- A legacy disconnect could remove credentials while an AI booking was in
-- the provider-to-database ambiguity window. Elapsed time cannot prove that
-- Google did not create the event, so do not auto-fail or release those rows.
-- Inventory and reconcile them before installing the new fail-closed token
-- and account-cleanup guards.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.status = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM public.google_calendar_tokens AS token
        WHERE token.business_id = booking.business_id
      )
  ) THEN
    RAISE EXCEPTION
      'calendar_provider_operations_preflight_pending_booking_without_token'
      USING
        ERRCODE = 'P0001',
        HINT = 'Inventory pending booking IDs with service-only SQL, restore credentials and reconcile provider state, then rerun migration 063.';
  END IF;
END;
$$;

-- The account/calendar namespace is the non-secret identity used to fence
-- OAuth replacement against provider work. A legacy nullable/blank identity
-- cannot be inferred safely once a mutation is ambiguous, so require manual
-- reconnect/remediation before installing the new lifecycle.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens AS token
    WHERE NULLIF(btrim(token.google_email), '') IS NULL
       OR length(btrim(token.google_email)) > 254
       OR btrim(token.google_email) ~ '[[:cntrl:]]'
       OR lower(btrim(token.google_email)) !~
          '^[^[:space:]@]+@[^[:space:]@]+$'
       OR NULLIF(btrim(token.calendar_id), '') IS NULL
       OR length(btrim(token.calendar_id)) > 1024
       OR btrim(token.calendar_id) ~ '[[:cntrl:]]'
  ) THEN
    RAISE EXCEPTION
      'calendar_provider_operations_preflight_invalid_provider_namespace'
      USING
        ERRCODE = 'P0001',
        HINT = 'Inventory affected businesses with service-only SQL, reconnect Google Calendar to populate a verified email/calendar namespace, then rerun migration 063.';
  END IF;
END;
$$;

UPDATE public.google_calendar_tokens
SET
  google_email = lower(btrim(google_email)),
  calendar_id = btrim(calendar_id)
WHERE google_email IS DISTINCT FROM lower(btrim(google_email))
   OR calendar_id IS DISTINCT FROM btrim(calendar_id);

ALTER TABLE public.google_calendar_tokens
  ADD CONSTRAINT google_calendar_tokens_provider_namespace_valid
  CHECK (
    google_email IS NOT NULL
    AND google_email = lower(btrim(google_email))
    AND length(google_email) BETWEEN 3 AND 254
    AND google_email !~ '[[:cntrl:]]'
    AND google_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    AND calendar_id IS NOT NULL
    AND calendar_id = btrim(calendar_id)
    AND length(calendar_id) BETWEEN 1 AND 1024
    AND calendar_id !~ '[[:cntrl:]]'
  );

-- OAuth callbacks and explicit access-token refreshes can overlap. A durable,
-- non-secret generation lets service RPCs compare-and-swap credentials after
-- the shared business mutex without ever passing an access or refresh token
-- back as the comparison key.
ALTER TABLE public.google_calendar_tokens
  ADD COLUMN credential_version uuid;
UPDATE public.google_calendar_tokens
SET credential_version = gen_random_uuid()
WHERE credential_version IS NULL;
ALTER TABLE public.google_calendar_tokens
  ALTER COLUMN credential_version SET DEFAULT gen_random_uuid(),
  ALTER COLUMN credential_version SET NOT NULL;

COMMENT ON COLUMN public.google_calendar_tokens.credential_version IS
  'Non-secret CAS generation rotated by OAuth replacement and explicit refresh persistence.';

-- Rolling deploys can leave an already-entered older OAuth function waiting
-- on the migration's token-table lock. Rotate at the table boundary so that
-- even that legacy writer invalidates any refresh snapshot loaded before its
-- credential change.
CREATE FUNCTION public.rotate_google_calendar_token_credential_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The generation is database-owned even when a rolling legacy writer or
    -- direct service client supplies a value explicitly.
    NEW.credential_version := gen_random_uuid();
  ELSIF NEW.access_token IS DISTINCT FROM OLD.access_token
     OR NEW.refresh_token IS DISTINCT FROM OLD.refresh_token
     OR NEW.token_expiry IS DISTINCT FROM OLD.token_expiry
     OR NEW.google_email IS DISTINCT FROM OLD.google_email
     OR NEW.calendar_id IS DISTINCT FROM OLD.calendar_id THEN
    NEW.credential_version := gen_random_uuid();
  ELSE
    NEW.credential_version := OLD.credential_version;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_google_calendar_token_credential_version()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER rotate_google_calendar_token_credential_version
  BEFORE INSERT OR UPDATE ON public.google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.rotate_google_calendar_token_credential_version();

-- Dashboard calendar mutations cross a database/provider boundary. Keep a
-- durable, service-owned intent before calling Google so dashboard creates,
-- edits, and AI direct bookings all serialize on the same business mutex.
CREATE TABLE public.calendar_provider_operations (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  operation_kind text NOT NULL,
  google_calendar_id text NOT NULL,
  desired_starts_at timestamptz,
  desired_ends_at timestamptz,
  linked_booking_id uuid
    REFERENCES public.calendar_bookings(id) ON DELETE SET NULL,
  deterministic_google_event_id text,
  target_google_event_id text,
  provider_target_event_id text GENERATED ALWAYS AS (
    COALESCE(target_google_event_id, deterministic_google_event_id)
  ) STORED,
  request_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'holding',
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claim_released_at timestamptz,
  reconciliation_review_after_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 1,
  provider_submission_started_at timestamptz,
  provider_event_id text,
  provider_starts_at timestamptz,
  provider_ends_at timestamptz,
  provider_evidence jsonb,
  provider_applied_at timestamptz,
  finalized_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  reconciliation_claim_token uuid,
  reconciliation_claimed_at timestamptz,
  reconciliation_claim_expires_at timestamptz,
  reconciliation_attempt_count integer NOT NULL DEFAULT 0,
  reconciliation_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_provider_operations_kind_valid
    CHECK (operation_kind IN ('create', 'update', 'delete')),
  CONSTRAINT calendar_provider_operations_status_valid
    CHECK (status IN ('holding', 'provider_applied', 'finalized', 'failed')),
  CONSTRAINT calendar_provider_operations_time_order
    CHECK (
      (
        operation_kind IN ('create', 'update')
        AND desired_starts_at IS NOT NULL
        AND desired_ends_at IS NOT NULL
        AND desired_ends_at > desired_starts_at
      )
      OR (
        operation_kind = 'delete'
        AND desired_starts_at IS NULL
        AND desired_ends_at IS NULL
      )
    ),
  CONSTRAINT calendar_provider_operations_calendar_id_valid
    CHECK (
      btrim(google_calendar_id) <> ''
      AND length(google_calendar_id) <= 1024
    ),
  CONSTRAINT calendar_provider_operations_fingerprint_valid
    CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  CONSTRAINT calendar_provider_operations_attempt_count_valid
    CHECK (attempt_count >= 1),
  CONSTRAINT calendar_provider_operations_reconciliation_attempt_count_valid
    CHECK (reconciliation_attempt_count >= 0),
  CONSTRAINT calendar_provider_operations_provider_time_order
    CHECK (
      (provider_starts_at IS NULL AND provider_ends_at IS NULL)
      OR (
        provider_starts_at IS NOT NULL
        AND provider_ends_at IS NOT NULL
        AND provider_ends_at > provider_starts_at
      )
    ),
  CONSTRAINT calendar_provider_operations_failure_reason_valid
    CHECK (
      failure_reason IS NULL
      OR (
        NULLIF(btrim(failure_reason), '') IS NOT NULL
        AND length(failure_reason) <= 1000
      )
    ),
  CONSTRAINT calendar_provider_operations_event_ids_valid
    CHECK (
      (
        deterministic_google_event_id IS NULL
        OR (
          length(deterministic_google_event_id) >= 5
          AND length(deterministic_google_event_id) <= 1024
          AND deterministic_google_event_id ~ '^[0-9a-v]+$'
        )
      )
      AND (
        target_google_event_id IS NULL
        OR (
          btrim(target_google_event_id) <> ''
          AND length(target_google_event_id) <= 1024
          AND target_google_event_id !~ '[[:cntrl:]]'
        )
      )
      AND (
        provider_event_id IS NULL
        OR (
          btrim(provider_event_id) <> ''
          AND length(provider_event_id) <= 1024
          AND provider_event_id !~ '[[:cntrl:]]'
        )
      )
    ),
  CONSTRAINT calendar_provider_operations_evidence_valid
    CHECK (
      provider_evidence IS NULL
      OR (
        jsonb_typeof(provider_evidence) = 'object'
        AND (
          provider_evidence
          - 'operation_marker_verified'
          - 'provider_status'
          - 'provider_etag_sha256'
          - 'provider_absence_verified'
        ) = '{}'::jsonb
        AND (
          (
            operation_kind IN ('create', 'update')
            AND provider_evidence ? 'operation_marker_verified'
            AND provider_evidence -> 'operation_marker_verified' =
              'true'::jsonb
            AND NOT (provider_evidence ? 'provider_absence_verified')
          )
          OR (
            operation_kind = 'delete'
            AND provider_evidence ? 'provider_absence_verified'
            AND provider_evidence -> 'provider_absence_verified' =
              'true'::jsonb
            AND NOT (provider_evidence ? 'operation_marker_verified')
          )
        )
        AND (
          NOT (provider_evidence ? 'provider_status')
          OR (
            jsonb_typeof(provider_evidence -> 'provider_status') = 'string'
            AND provider_evidence ->> 'provider_status' IN (
              'confirmed', 'tentative', 'unknown'
            )
          )
        )
        AND (
          NOT (provider_evidence ? 'provider_etag_sha256')
          OR (
            jsonb_typeof(provider_evidence -> 'provider_etag_sha256') =
              'string'
            AND provider_evidence ->> 'provider_etag_sha256'
              ~ '^[0-9a-f]{64}$'
          )
        )
      )
    ),
  CONSTRAINT calendar_provider_operations_kind_shape
    CHECK (
      (
        operation_kind = 'create'
        AND linked_booking_id IS NULL
        AND deterministic_google_event_id IS NOT NULL
        AND NULLIF(btrim(deterministic_google_event_id), '') IS NOT NULL
        AND target_google_event_id IS NULL
      )
      OR (
        operation_kind = 'update'
        AND deterministic_google_event_id IS NULL
        AND target_google_event_id IS NOT NULL
        AND NULLIF(btrim(target_google_event_id), '') IS NOT NULL
      )
      OR (
        operation_kind = 'delete'
        AND deterministic_google_event_id IS NULL
        AND target_google_event_id IS NOT NULL
        AND NULLIF(btrim(target_google_event_id), '') IS NOT NULL
      )
    ),
  CONSTRAINT calendar_provider_operations_claim_shape
    CHECK (
      (
        claim_token IS NULL
        AND claimed_at IS NULL
        AND claim_expires_at IS NULL
      )
      OR (
        claim_token IS NOT NULL
        AND claimed_at IS NOT NULL
        AND claim_expires_at IS NOT NULL
        AND claim_expires_at > claimed_at
      )
    ),
  CONSTRAINT calendar_provider_operations_reconciliation_claim_shape
    CHECK (
      (
        reconciliation_claim_token IS NULL
        AND reconciliation_claimed_at IS NULL
        AND reconciliation_claim_expires_at IS NULL
      )
      OR (
        reconciliation_claim_token IS NOT NULL
        AND reconciliation_claimed_at IS NOT NULL
        AND reconciliation_claim_expires_at IS NOT NULL
        AND reconciliation_claim_expires_at > reconciliation_claimed_at
        AND status IN ('holding', 'provider_applied')
      )
    ),
  CONSTRAINT calendar_provider_operations_lifecycle_shape
    CHECK (
      (
        status = 'holding'
        AND provider_event_id IS NULL
        AND provider_starts_at IS NULL
        AND provider_ends_at IS NULL
        AND provider_evidence IS NULL
        AND provider_applied_at IS NULL
        AND finalized_at IS NULL
        AND failed_at IS NULL
        AND failure_reason IS NULL
      )
      OR (
        status = 'provider_applied'
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND claim_expires_at IS NULL
        AND NULLIF(btrim(provider_event_id), '') IS NOT NULL
        AND (
          (
            operation_kind IN ('create', 'update')
            AND provider_starts_at IS NOT NULL
            AND provider_ends_at IS NOT NULL
          )
          OR (
            operation_kind = 'delete'
            AND provider_starts_at IS NULL
            AND provider_ends_at IS NULL
          )
        )
        AND provider_evidence IS NOT NULL
        AND jsonb_typeof(provider_evidence) = 'object'
        AND provider_submission_started_at IS NOT NULL
        AND provider_applied_at IS NOT NULL
        AND finalized_at IS NULL
        AND failed_at IS NULL
        AND failure_reason IS NULL
      )
      OR (
        status = 'finalized'
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND claim_expires_at IS NULL
        AND NULLIF(btrim(provider_event_id), '') IS NOT NULL
        AND (
          (
            operation_kind IN ('create', 'update')
            AND provider_starts_at IS NOT NULL
            AND provider_ends_at IS NOT NULL
          )
          OR (
            operation_kind = 'delete'
            AND provider_starts_at IS NULL
            AND provider_ends_at IS NULL
          )
        )
        AND provider_evidence IS NOT NULL
        AND jsonb_typeof(provider_evidence) = 'object'
        AND provider_submission_started_at IS NOT NULL
        AND provider_applied_at IS NOT NULL
        AND finalized_at IS NOT NULL
        AND failed_at IS NULL
        AND failure_reason IS NULL
        AND reconciliation_claim_token IS NULL
        AND reconciliation_claimed_at IS NULL
        AND reconciliation_claim_expires_at IS NULL
      )
      OR (
        status = 'failed'
        AND claim_token IS NULL
        AND claimed_at IS NULL
        AND claim_expires_at IS NULL
        AND (
          (
            provider_applied_at IS NULL
            AND provider_event_id IS NULL
            AND provider_starts_at IS NULL
            AND provider_ends_at IS NULL
            AND provider_evidence IS NULL
          )
          OR (
            provider_applied_at IS NOT NULL
            AND NULLIF(btrim(provider_event_id), '') IS NOT NULL
            AND provider_evidence IS NOT NULL
            AND jsonb_typeof(provider_evidence) = 'object'
          )
        )
        AND finalized_at IS NULL
        AND failed_at IS NOT NULL
        AND NULLIF(btrim(failure_reason), '') IS NOT NULL
        AND reconciliation_claim_token IS NULL
        AND reconciliation_claimed_at IS NULL
        AND reconciliation_claim_expires_at IS NULL
      )
    )
);

CREATE UNIQUE INDEX calendar_provider_operations_create_event_unique
  ON public.calendar_provider_operations (
    business_id,
    google_calendar_id,
    deterministic_google_event_id
  )
  WHERE deterministic_google_event_id IS NOT NULL;

CREATE INDEX calendar_provider_operations_live_slot_idx
  ON public.calendar_provider_operations (
    business_id,
    google_calendar_id,
    desired_starts_at,
    desired_ends_at
  )
  WHERE status IN ('holding', 'provider_applied');

CREATE INDEX calendar_provider_operations_reconciliation_idx
  ON public.calendar_provider_operations (
    status,
    reconciliation_attempted_at,
    created_at,
    claim_expires_at,
    reconciliation_claim_expires_at
  )
  WHERE status IN ('holding', 'provider_applied');

CREATE UNIQUE INDEX calendar_provider_operations_live_target_unique
  ON public.calendar_provider_operations (
    business_id,
    google_calendar_id,
    provider_target_event_id
  )
  WHERE status IN ('holding', 'provider_applied');

ALTER TABLE public.calendar_provider_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.calendar_provider_operations
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.calendar_provider_operations TO service_role;

COMMENT ON TABLE public.calendar_provider_operations IS
  'Private durable intents and provider evidence for idempotent dashboard Google Calendar mutations.';

-- Acquire or recover one exact operation. The five-minute worker claim avoids
-- duplicate provider calls. reconciliation_review_after_at is a 48-hour
-- review/SLA deadline,
-- not authority expiry: ambiguous work remains fail-closed until provider
-- evidence drives finalization or failure.
CREATE FUNCTION public.acquire_calendar_provider_operation(
  p_operation_id uuid,
  p_business_id uuid,
  p_operation_kind text,
  p_google_calendar_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_linked_booking_id uuid,
  p_deterministic_google_event_id text,
  p_target_google_event_id text,
  p_request_fingerprint text,
  p_claim_token uuid
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_operation_id IS NULL
     OR p_business_id IS NULL
     OR p_operation_kind NOT IN ('create', 'update', 'delete')
     OR NULLIF(btrim(p_google_calendar_id), '') IS NULL
     OR length(p_google_calendar_id) > 1024
     OR p_google_calendar_id ~ '[[:cntrl:]]'
     OR (
       p_operation_kind IN ('create', 'update')
       AND (
         p_starts_at IS NULL
         OR p_ends_at IS NULL
         OR p_ends_at <= p_starts_at
       )
     )
     OR (
       p_operation_kind = 'delete'
       AND (p_starts_at IS NOT NULL OR p_ends_at IS NOT NULL)
     )
     OR p_request_fingerprint IS NULL
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_claim_token IS NULL
     OR (
       p_deterministic_google_event_id IS NOT NULL
       AND (
         length(p_deterministic_google_event_id) < 5
         OR length(p_deterministic_google_event_id) > 1024
         OR p_deterministic_google_event_id !~ '^[0-9a-v]+$'
       )
     )
     OR (
       p_target_google_event_id IS NOT NULL
       AND (
         length(p_target_google_event_id) > 1024
         OR p_target_google_event_id ~ '[[:cntrl:]]'
       )
     )
     OR (
       p_operation_kind = 'create'
       AND (
         p_linked_booking_id IS NOT NULL
         OR NULLIF(btrim(p_deterministic_google_event_id), '') IS NULL
         OR p_target_google_event_id IS NOT NULL
       )
     )
     OR (
       p_operation_kind = 'update'
       AND (
         p_deterministic_google_event_id IS NOT NULL
         OR NULLIF(btrim(p_target_google_event_id), '') IS NULL
       )
     )
     OR (
       p_operation_kind = 'delete'
       AND (
         p_deterministic_google_event_id IS NOT NULL
         OR NULLIF(btrim(p_target_google_event_id), '') IS NULL
       )
     ) THEN
    RAISE EXCEPTION 'invalid calendar provider operation input'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the business row first even for recovery. Existing ambiguous or
  -- provider-applied work must remain recoverable after a later pause or
  -- suspension, while brand-new and definitively-failed retries re-evaluate
  -- the current operational gates below.
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_provider_operation_business_unavailable'
      USING ERRCODE = '55000';
  END IF;
  v_now := clock_timestamp();

  -- With the business mutex held, an expired operation that never crossed the
  -- provider fence is proven side-effect free. Retire it before checking a new
  -- target/slot so normal traffic need not wait for the maintenance heartbeat.
  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = v_now,
    failure_reason = 'Provider submission was never started.',
    updated_at = v_now
  WHERE business_id = p_business_id
    AND status = 'holding'
    AND provider_submission_started_at IS NULL
    AND (claim_token IS NULL OR claim_expires_at <= v_now)
    AND (
      reconciliation_claim_token IS NULL
      OR reconciliation_claim_expires_at <= v_now
    );

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_operation.business_id <> p_business_id
       OR v_operation.operation_kind <> p_operation_kind
       OR v_operation.google_calendar_id <> btrim(p_google_calendar_id)
       OR v_operation.desired_starts_at IS DISTINCT FROM p_starts_at
       OR v_operation.desired_ends_at IS DISTINCT FROM p_ends_at
       OR v_operation.linked_booking_id IS DISTINCT FROM p_linked_booking_id
       OR v_operation.deterministic_google_event_id IS DISTINCT FROM
          NULLIF(btrim(p_deterministic_google_event_id), '')
       OR v_operation.target_google_event_id IS DISTINCT FROM
          NULLIF(btrim(p_target_google_event_id), '')
       OR v_operation.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'calendar_provider_operation_idempotency_conflict'
        USING ERRCODE = '23514';
    END IF;

    IF v_operation.status IN ('provider_applied', 'finalized') THEN
      RETURN v_operation;
    END IF;

    -- A transport retry from the worker that already owns a live claim is an
    -- exact read of the same durable attempt, not a new attempt. Return before
    -- lease rotation/revalidation so request retries cannot inflate accounting
    -- or accidentally change ownership. A different live token remains busy.
    IF v_operation.status = 'holding'
       AND v_operation.claim_token = p_claim_token
       AND v_operation.claim_expires_at > v_now THEN
      RETURN v_operation;
    END IF;

    IF v_operation.status = 'holding'
       AND v_operation.claim_token IS NOT NULL
       AND v_operation.claim_token <> p_claim_token
       AND v_operation.claim_expires_at > v_now THEN
      RAISE EXCEPTION 'calendar_provider_operation_busy'
        USING ERRCODE = '55P03';
    END IF;

    -- Only a request that already crossed the durable provider-submission
    -- fence may bypass later pause/suspension gates for ambiguity recovery.
    -- A stale pre-submit claim is still a brand-new side effect and falls
    -- through to the current operational/target/slot checks below.
    IF v_operation.status = 'holding'
       AND v_operation.provider_submission_started_at IS NOT NULL THEN
      UPDATE public.calendar_provider_operations
      SET
        claim_token = p_claim_token,
        claimed_at = v_now,
        claim_expires_at = v_now + interval '5 minutes',
        claim_released_at = NULL,
        reconciliation_review_after_at = GREATEST(
          reconciliation_review_after_at,
          v_now + interval '48 hours'
        ),
        attempt_count = attempt_count + 1,
        updated_at = v_now
      WHERE id = p_operation_id
      RETURNING * INTO v_operation;
      RETURN v_operation;
    END IF;

    IF v_operation.status = 'failed'
       AND v_operation.provider_applied_at IS NOT NULL THEN
      RAISE EXCEPTION 'calendar_provider_operation_terminal'
        USING ERRCODE = '23514';
    END IF;

    IF v_operation.status = 'failed' AND EXISTS (
      SELECT 1
      FROM public.calendar_provider_operations AS newer_operation
      WHERE newer_operation.business_id = p_business_id
        AND newer_operation.google_calendar_id =
          v_operation.google_calendar_id
        AND newer_operation.provider_target_event_id =
          v_operation.provider_target_event_id
        AND newer_operation.provider_applied_at > v_operation.failed_at
        AND newer_operation.status IN ('provider_applied', 'finalized')
    ) THEN
      RAISE EXCEPTION 'calendar_provider_operation_superseded'
        USING ERRCODE = '23514';
    END IF;

    PERFORM 1
    FROM public.businesses AS business
    WHERE business.id = p_business_id
      AND business.owner_id IS NOT NULL
      AND business.deleted_at IS NULL
      AND business.operations_suspended_at IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.google_calendar_tokens AS token
        WHERE token.business_id = business.id
      )
      AND (
        p_operation_kind IN ('update', 'delete')
        OR business.bookings_paused_at IS NULL
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'calendar_provider_operation_business_unavailable'
        USING ERRCODE = '55000';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.calendar_bookings AS booking
      WHERE booking.business_id = p_business_id
        AND booking.google_calendar_id = btrim(p_google_calendar_id)
        AND booking.status IN ('pending', 'confirmed')
        AND COALESCE(
          booking.google_event_id,
          replace(booking.id::text, '-', '')
        ) = COALESCE(
          NULLIF(btrim(p_target_google_event_id), ''),
          NULLIF(btrim(p_deterministic_google_event_id), '')
        )
        AND (
          p_linked_booking_id IS NULL
          OR booking.id <> p_linked_booking_id
        )
    ) OR EXISTS (
      SELECT 1
      FROM public.calendar_provider_operations AS operation
      WHERE operation.business_id = p_business_id
        AND operation.google_calendar_id = btrim(p_google_calendar_id)
        AND operation.provider_target_event_id = COALESCE(
          NULLIF(btrim(p_target_google_event_id), ''),
          NULLIF(btrim(p_deterministic_google_event_id), '')
        )
        AND operation.id <> p_operation_id
        AND operation.status IN ('holding', 'provider_applied')
    ) THEN
      RAISE EXCEPTION 'calendar_provider_operation_busy'
        USING ERRCODE = '55P03';
    END IF;

    -- A definitive provider rejection or an abandoned pre-submit claim may be
    -- retried with the exact same operation identity only after revalidation.
    IF p_operation_kind <> 'delete' AND (
      EXISTS (
      SELECT 1
      FROM public.calendar_bookings AS booking
      WHERE booking.business_id = p_business_id
        AND booking.google_calendar_id = btrim(p_google_calendar_id)
        AND booking.status IN ('pending', 'confirmed')
        AND (
          p_linked_booking_id IS NULL
          OR booking.id <> p_linked_booking_id
        )
        AND booking.starts_at < p_ends_at
        AND booking.ends_at > p_starts_at
      ) OR EXISTS (
      SELECT 1
      FROM public.calendar_provider_operations AS operation
      WHERE operation.business_id = p_business_id
        AND operation.google_calendar_id = btrim(p_google_calendar_id)
        AND operation.id <> p_operation_id
          AND operation.status IN ('holding', 'provider_applied')
        AND COALESCE(
          operation.provider_starts_at,
          operation.desired_starts_at
        ) < p_ends_at
        AND COALESCE(
          operation.provider_ends_at,
          operation.desired_ends_at
        ) > p_starts_at
      )
    ) THEN
      RAISE EXCEPTION 'calendar_provider_slot_unavailable'
        USING ERRCODE = '23P01';
    END IF;

    UPDATE public.calendar_provider_operations
    SET
      status = 'holding',
      claim_token = p_claim_token,
      claimed_at = v_now,
      claim_expires_at = v_now + interval '5 minutes',
      claim_released_at = NULL,
      reconciliation_review_after_at = v_now + interval '48 hours',
      attempt_count = attempt_count + 1,
      provider_submission_started_at = NULL,
      failed_at = NULL,
      failure_reason = NULL,
      updated_at = v_now
    WHERE id = p_operation_id
    RETURNING * INTO v_operation;
    RETURN v_operation;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id IS NOT NULL
    AND business.deleted_at IS NULL
    AND business.operations_suspended_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.google_calendar_tokens AS token
      WHERE token.business_id = business.id
    )
      AND (
        p_operation_kind IN ('update', 'delete')
      OR business.bookings_paused_at IS NULL
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar_provider_operation_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  IF p_linked_booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.id = p_linked_booking_id
      AND booking.business_id = p_business_id
      AND booking.google_calendar_id = btrim(p_google_calendar_id)
      AND booking.google_event_id = btrim(p_target_google_event_id)
      AND booking.status = 'confirmed'
  ) THEN
    RAISE EXCEPTION 'calendar provider linked booking mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.google_calendar_id = btrim(p_google_calendar_id)
      AND booking.status IN ('pending', 'confirmed')
      AND COALESCE(
        booking.google_event_id,
        replace(booking.id::text, '-', '')
      ) = COALESCE(
        NULLIF(btrim(p_target_google_event_id), ''),
        NULLIF(btrim(p_deterministic_google_event_id), '')
      )
      AND (
        p_linked_booking_id IS NULL
        OR booking.id <> p_linked_booking_id
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = btrim(p_google_calendar_id)
      AND operation.provider_target_event_id = COALESCE(
        NULLIF(btrim(p_target_google_event_id), ''),
        NULLIF(btrim(p_deterministic_google_event_id), '')
      )
      AND operation.status IN ('holding', 'provider_applied')
  ) THEN
    RAISE EXCEPTION 'calendar_provider_operation_busy'
      USING ERRCODE = '55P03';
  END IF;

  IF p_operation_kind <> 'delete' AND (
    EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.google_calendar_id = btrim(p_google_calendar_id)
      AND booking.status IN ('pending', 'confirmed')
      AND (
        p_linked_booking_id IS NULL
        OR booking.id <> p_linked_booking_id
      )
      AND booking.starts_at < p_ends_at
      AND booking.ends_at > p_starts_at
    ) OR EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = btrim(p_google_calendar_id)
      AND operation.status IN ('holding', 'provider_applied')
      AND COALESCE(
        operation.provider_starts_at,
        operation.desired_starts_at
      ) < p_ends_at
      AND COALESCE(
        operation.provider_ends_at,
        operation.desired_ends_at
      ) > p_starts_at
    )
  ) THEN
    RAISE EXCEPTION 'calendar_provider_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.calendar_provider_operations (
    id,
    business_id,
    operation_kind,
    google_calendar_id,
    desired_starts_at,
    desired_ends_at,
    linked_booking_id,
    deterministic_google_event_id,
    target_google_event_id,
    request_fingerprint,
    status,
    claim_token,
    claimed_at,
    claim_expires_at,
    reconciliation_review_after_at
  ) VALUES (
    p_operation_id,
    p_business_id,
    p_operation_kind,
    btrim(p_google_calendar_id),
    p_starts_at,
    p_ends_at,
    p_linked_booking_id,
    NULLIF(btrim(p_deterministic_google_event_id), ''),
    NULLIF(btrim(p_target_google_event_id), ''),
    p_request_fingerprint,
    'holding',
    p_claim_token,
    v_now,
    v_now + interval '5 minutes',
    v_now + interval '48 hours'
  )
  RETURNING * INTO v_operation;

  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_calendar_provider_operation(
  uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text,
  text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.acquire_calendar_provider_operation(
  uuid, uuid, text, text, timestamptz, timestamptz, uuid, text, text,
  text, uuid
) TO service_role;

-- Cross the provider side-effect boundary durably. A stale holding row with no
-- submission timestamp is safe for maintenance to fail and release; once this
-- timestamp exists, elapsed time alone can never prove the provider mutation
-- absent.
CREATE FUNCTION public.mark_calendar_provider_submission_started(
  p_business_id uuid,
  p_operation_id uuid,
  p_claim_token uuid
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_operation public.calendar_provider_operations%ROWTYPE;
  v_now timestamptz;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('provider_applied', 'finalized') THEN
    RETURN v_operation;
  END IF;

  -- Acquisition and the first provider mutation are separate transactions.
  -- Re-prove mutable authority under the same business mutex immediately
  -- before crossing the side-effect fence. Once submission has already
  -- started, exact ambiguity recovery remains allowed after a later pause or
  -- suspension and never reaches a second provider mutation in the app.
  IF v_operation.provider_submission_started_at IS NULL AND (
    v_business.owner_id IS NULL
    OR v_business.deleted_at IS NOT NULL
    OR v_business.operations_suspended_at IS NOT NULL
    OR (
      v_operation.operation_kind = 'create'
      AND v_business.bookings_paused_at IS NOT NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM public.google_calendar_tokens AS token
      WHERE token.business_id = p_business_id
    )
  ) THEN
    RAISE EXCEPTION 'calendar_provider_operation_business_unavailable'
      USING ERRCODE = '55000';
  END IF;

  v_now := clock_timestamp();
  IF v_operation.status <> 'holding'
     OR v_operation.claim_token <> p_claim_token
     OR v_operation.claim_expires_at <= v_now THEN
    RAISE EXCEPTION 'calendar provider operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    provider_submission_started_at = COALESCE(
      provider_submission_started_at,
      v_now
    ),
    claimed_at = v_now,
    claim_expires_at = v_now + interval '5 minutes',
    updated_at = v_now
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_calendar_provider_submission_started(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_calendar_provider_submission_started(
  uuid, uuid, uuid
) TO service_role;

-- Persist the provider evidence before any local finalization. This function
-- deliberately does not reject a provider-returned overlap: Google has
-- already mutated, so losing the evidence would make recovery unsafe.
CREATE FUNCTION public.mark_calendar_provider_operation_applied(
  p_business_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_provider_event_id text,
  p_provider_starts_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_evidence jsonb
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_provider_event_id), '') IS NULL
     OR length(p_provider_event_id) > 1024
     OR p_provider_event_id ~ '[[:cntrl:]]'
     OR p_provider_starts_at IS NULL
     OR p_provider_ends_at IS NULL
     OR p_provider_ends_at <= p_provider_starts_at
     OR p_provider_evidence IS NULL
     OR jsonb_typeof(p_provider_evidence) <> 'object' THEN
    RAISE EXCEPTION 'invalid calendar provider evidence'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('provider_applied', 'finalized') THEN
    IF v_operation.provider_event_id = btrim(p_provider_event_id)
       AND v_operation.provider_starts_at = p_provider_starts_at
       AND v_operation.provider_ends_at = p_provider_ends_at THEN
      RETURN v_operation;
    END IF;
    RAISE EXCEPTION 'calendar provider evidence conflict'
      USING ERRCODE = '23514';
  END IF;
  IF v_operation.operation_kind = 'delete' THEN
    RAISE EXCEPTION 'delete operations require absence evidence'
      USING ERRCODE = '23514';
  END IF;
  IF v_operation.provider_submission_started_at IS NULL THEN
    RAISE EXCEPTION 'calendar provider submission was not started'
      USING ERRCODE = '23514';
  END IF;
  IF v_operation.status <> 'holding'
     OR v_operation.claim_token <> p_claim_token
     OR v_operation.claim_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'calendar provider operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF (
    v_operation.operation_kind = 'create'
    AND v_operation.deterministic_google_event_id <>
      btrim(p_provider_event_id)
  ) OR (
    v_operation.operation_kind = 'update'
    AND v_operation.target_google_event_id <> btrim(p_provider_event_id)
  ) THEN
    RAISE EXCEPTION 'calendar provider event identity mismatch'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    status = 'provider_applied',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    provider_event_id = btrim(p_provider_event_id),
    provider_starts_at = p_provider_starts_at,
    provider_ends_at = p_provider_ends_at,
    provider_evidence = p_provider_evidence,
    provider_applied_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_calendar_provider_operation_applied(
  uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_calendar_provider_operation_applied(
  uuid, uuid, uuid, text, timestamptz, timestamptz, jsonb
) TO service_role;

-- DELETE success is the verified absence of the stable provider target. A
-- Google 404 is idempotent success and is recorded before local cancellation.
CREATE FUNCTION public.mark_calendar_provider_delete_applied(
  p_business_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_provider_event_id text
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_provider_event_id), '') IS NULL
     OR length(p_provider_event_id) > 1024
     OR p_provider_event_id ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid calendar provider delete evidence'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('provider_applied', 'finalized') THEN
    IF v_operation.operation_kind = 'delete'
       AND v_operation.provider_event_id = btrim(p_provider_event_id) THEN
      RETURN v_operation;
    END IF;
    RAISE EXCEPTION 'calendar provider delete evidence conflict'
      USING ERRCODE = '23514';
  END IF;
  IF v_operation.operation_kind <> 'delete'
     OR v_operation.status <> 'holding'
     OR v_operation.claim_token <> p_claim_token
     OR v_operation.claim_expires_at <= clock_timestamp()
     OR v_operation.target_google_event_id <> btrim(p_provider_event_id) THEN
    RAISE EXCEPTION 'calendar provider delete claim mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_operation.provider_submission_started_at IS NULL THEN
    RAISE EXCEPTION 'calendar provider submission was not started'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    status = 'provider_applied',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    provider_event_id = btrim(p_provider_event_id),
    provider_starts_at = NULL,
    provider_ends_at = NULL,
    provider_evidence = jsonb_build_object(
      'provider_absence_verified', true,
      'provider_status', 'unknown'
    ),
    provider_applied_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_calendar_provider_delete_applied(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_calendar_provider_delete_applied(
  uuid, uuid, uuid, text
) TO service_role;

-- Finalize only after durable provider evidence exists. Linked dashboard
-- edits move their direct-booking row atomically while the old slot and the
-- desired provider-operation hold are both still authoritative.
CREATE FUNCTION public.finalize_calendar_provider_operation(
  p_business_id uuid,
  p_operation_id uuid
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status = 'finalized' THEN
    RETURN v_operation;
  END IF;
  IF v_operation.status <> 'provider_applied' THEN
    RAISE EXCEPTION 'calendar_provider_operation_not_applied'
      USING ERRCODE = '55000';
  END IF;

  IF v_operation.operation_kind <> 'delete' AND (
    EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.google_calendar_id = v_operation.google_calendar_id
      AND booking.status IN ('pending', 'confirmed')
      AND (
        v_operation.linked_booking_id IS NULL
        OR booking.id <> v_operation.linked_booking_id
      )
      AND booking.starts_at < v_operation.provider_ends_at
      AND booking.ends_at > v_operation.provider_starts_at
    ) OR EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = v_operation.google_calendar_id
      AND operation.id <> v_operation.id
      AND operation.status IN ('holding', 'provider_applied')
      AND COALESCE(
        operation.provider_starts_at,
        operation.desired_starts_at
      ) < v_operation.provider_ends_at
      AND COALESCE(
        operation.provider_ends_at,
        operation.desired_ends_at
      ) > v_operation.provider_starts_at
    )
  ) THEN
    RAISE EXCEPTION 'calendar_provider_finalize_conflict'
      USING ERRCODE = '23P01';
  END IF;

  IF v_operation.linked_booking_id IS NOT NULL THEN
    IF v_operation.operation_kind = 'delete' THEN
      UPDATE public.calendar_bookings
      SET
        status = 'cancelled',
        cancelled_at = clock_timestamp(),
        updated_at = clock_timestamp()
      WHERE id = v_operation.linked_booking_id
        AND business_id = p_business_id
        AND google_calendar_id = v_operation.google_calendar_id
        AND google_event_id = v_operation.target_google_event_id
        AND status = 'confirmed';
    ELSE
      UPDATE public.calendar_bookings
      SET
        starts_at = v_operation.provider_starts_at,
        ends_at = v_operation.provider_ends_at,
        updated_at = clock_timestamp()
      WHERE id = v_operation.linked_booking_id
        AND business_id = p_business_id
        AND google_calendar_id = v_operation.google_calendar_id
        AND google_event_id = v_operation.target_google_event_id
        AND status = 'confirmed';
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'calendar provider linked booking changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    status = 'finalized',
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    finalized_at = clock_timestamp(),
    updated_at = clock_timestamp()
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_calendar_provider_operation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_calendar_provider_operation(
  uuid, uuid
) TO service_role;

-- If reconciliation proves that a previously-applied CREATE/UPDATE target is
-- now absent, preserve its content-free provider evidence but release the
-- permanent provider-applied hold. A linked confirmed booking is cancelled
-- atomically because its provider event is proven absent.
CREATE FUNCTION public.resolve_calendar_provider_operation_absent(
  p_business_id uuid,
  p_operation_id uuid,
  p_claim_token uuid
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('finalized', 'failed') THEN
    RETURN v_operation;
  END IF;
  IF v_operation.operation_kind = 'delete'
     OR v_operation.status NOT IN ('holding', 'provider_applied')
     OR (
       v_operation.status = 'holding'
       AND (
         v_operation.provider_submission_started_at IS NULL
         OR v_operation.claim_token <> p_claim_token
         OR (
           v_operation.reconciliation_claim_token IS NOT NULL
           AND v_operation.reconciliation_claim_token IS DISTINCT FROM
             p_claim_token
         )
       )
     )
     OR (
       v_operation.status = 'provider_applied'
       AND v_operation.reconciliation_claim_token IS DISTINCT FROM
         p_claim_token
     ) THEN
    RAISE EXCEPTION 'calendar provider operation cannot resolve absent'
      USING ERRCODE = '23514';
  END IF;

  IF v_operation.linked_booking_id IS NOT NULL THEN
    UPDATE public.calendar_bookings
    SET
      status = 'cancelled',
      cancelled_at = clock_timestamp(),
      updated_at = clock_timestamp()
    WHERE id = v_operation.linked_booking_id
      AND business_id = p_business_id
      AND google_calendar_id = v_operation.google_calendar_id
      AND google_event_id = v_operation.target_google_event_id
      AND status = 'confirmed';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'calendar provider linked booking changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = clock_timestamp(),
    failure_reason = 'Provider event was absent during reconciliation.',
    updated_at = clock_timestamp()
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_calendar_provider_operation_absent(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_calendar_provider_operation_absent(
  uuid, uuid, uuid
) TO service_role;

CREATE FUNCTION public.fail_calendar_provider_operation(
  p_business_id uuid,
  p_operation_id uuid,
  p_claim_token uuid,
  p_failure_reason text
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_operation public.calendar_provider_operations%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_failure_reason), '') IS NULL
     OR length(p_failure_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid calendar provider failure reason'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation business not found'
      USING ERRCODE = '23503';
  END IF;

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = p_operation_id
    AND operation.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar provider operation not found'
      USING ERRCODE = '23503';
  END IF;

  IF v_operation.status IN ('provider_applied', 'finalized') THEN
    RETURN v_operation;
  END IF;
  IF v_operation.status = 'failed' THEN
    RETURN v_operation;
  END IF;
  IF v_operation.claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar provider operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = clock_timestamp(),
    failure_reason = btrim(p_failure_reason),
    updated_at = clock_timestamp()
  WHERE id = p_operation_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_calendar_provider_operation(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_calendar_provider_operation(
  uuid, uuid, uuid, text
) TO service_role;

-- Atomically choose and lease the next eligible maintenance item. Eligibility
-- is evaluated before selection, and ordering by the last attempt rotates
-- unresolved work instead of letting a few old rows starve the queue. The
-- candidate lookup takes no row lock; the business row remains the first
-- durable mutex acquired before the operation row is revalidated.
CREATE FUNCTION public.claim_next_calendar_provider_operation_reconciliation(
  p_claim_token uuid
) RETURNS public.calendar_provider_operations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_candidate_id uuid;
  v_business_id uuid;
  v_operation public.calendar_provider_operations%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid calendar provider reconciliation claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT operation.id, operation.business_id
  INTO v_candidate_id, v_business_id
  FROM public.calendar_provider_operations AS operation
  WHERE operation.status IN ('holding', 'provider_applied')
    AND (
      operation.reconciliation_claim_token IS NULL
      OR operation.reconciliation_claim_expires_at <= v_now
    )
    AND (
      operation.status = 'provider_applied'
      OR operation.claim_token IS NULL
      OR operation.claim_expires_at <= v_now
    )
  ORDER BY
    operation.reconciliation_attempted_at ASC NULLS FIRST,
    operation.created_at,
    operation.id
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = v_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  v_now := clock_timestamp();

  SELECT operation.*
  INTO v_operation
  FROM public.calendar_provider_operations AS operation
  WHERE operation.id = v_candidate_id
    AND operation.business_id = v_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_operation.status NOT IN ('holding', 'provider_applied')
     OR (
       v_operation.reconciliation_claim_token IS NOT NULL
       AND v_operation.reconciliation_claim_expires_at > v_now
     )
     OR (
       v_operation.status = 'holding'
       AND v_operation.claim_token IS NOT NULL
       AND v_operation.claim_expires_at > v_now
     ) THEN
    RETURN NULL;
  END IF;

  UPDATE public.calendar_provider_operations
  SET
    claim_token = CASE
      WHEN status = 'holding' THEN p_claim_token
      ELSE claim_token
    END,
    claimed_at = CASE
      WHEN status = 'holding' THEN v_now
      ELSE claimed_at
    END,
    claim_expires_at = CASE
      WHEN status = 'holding' THEN v_now + interval '5 minutes'
      ELSE claim_expires_at
    END,
    claim_released_at = CASE
      WHEN status = 'holding' THEN NULL
      ELSE claim_released_at
    END,
    attempt_count = CASE
      WHEN status = 'holding' THEN attempt_count + 1
      ELSE attempt_count
    END,
    reconciliation_claim_token = p_claim_token,
    reconciliation_claimed_at = v_now,
    reconciliation_claim_expires_at = v_now + interval '5 minutes',
    reconciliation_attempt_count = reconciliation_attempt_count + 1,
    reconciliation_attempted_at = v_now,
    updated_at = v_now
  WHERE id = v_candidate_id
  RETURNING * INTO v_operation;
  RETURN v_operation;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_next_calendar_provider_operation_reconciliation(
  uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_calendar_provider_operation_reconciliation(
  uuid
) TO service_role;

-- Disconnect is a local fencing operation first and an external revocation
-- second. Delete and return the exact token under the same business mutex used
-- by dashboard operations and AI booking reservations. The server route never
-- returns this sensitive value to the browser.
CREATE FUNCTION public.disconnect_google_calendar_token(
  p_business_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_access_token text;
  v_now timestamptz;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'invalid Google Calendar disconnect input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google Calendar disconnect business not found'
      USING ERRCODE = '23503';
  END IF;
  v_now := clock_timestamp();

  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = v_now,
    failure_reason = 'Provider submission was never started.',
    updated_at = v_now
  WHERE business_id = p_business_id
    AND status = 'holding'
    AND provider_submission_started_at IS NULL
    AND (claim_token IS NULL OR claim_expires_at <= v_now)
    AND (
      reconciliation_claim_token IS NULL
      OR reconciliation_claim_expires_at <= v_now
    );

  IF EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.status IN ('holding', 'provider_applied')
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'calendar_provider_operation_busy'
      USING ERRCODE = '55P03';
  END IF;

  DELETE FROM public.google_calendar_tokens AS token
  WHERE token.business_id = p_business_id
  RETURNING token.access_token INTO v_access_token;
  RETURN v_access_token;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_google_calendar_token(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_google_calendar_token(uuid)
  TO service_role;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.google_calendar_tokens
  FROM anon, authenticated;

-- cleanup_expired_business is an established service-only SECURITY INVOKER
-- function and deletes this row directly, so service_role must retain table
-- DELETE. Enforce the unresolved-work invariant at the table boundary instead.
-- Every supported 063 caller already owns the business mutex before DELETE;
-- the trigger's business lookup is a backstop, not permission to keep old
-- revoke-before-delete app instances live during rollout (those must drain).
CREATE FUNCTION public.guard_google_calendar_token_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz;
BEGIN
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = OLD.business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN OLD;
  END IF;
  v_now := clock_timestamp();

  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = v_now,
    failure_reason = 'Provider submission was never started.',
    updated_at = v_now
  WHERE business_id = OLD.business_id
    AND status = 'holding'
    AND provider_submission_started_at IS NULL
    AND (claim_token IS NULL OR claim_expires_at <= v_now)
    AND (
      reconciliation_claim_token IS NULL
      OR reconciliation_claim_expires_at <= v_now
    );

  IF EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = OLD.business_id
      AND operation.status IN ('holding', 'provider_applied')
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = OLD.business_id
      AND booking.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'calendar_provider_operation_busy'
      USING ERRCODE = '55P03';
  END IF;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_google_calendar_token_delete()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_google_calendar_token_delete
  BEFORE DELETE ON public.google_calendar_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_google_calendar_token_delete();

-- Persist an explicitly bounded Google refresh only when the credential row
-- is still the exact generation that was loaded before the network request.
-- OAuth replacement uses the same business mutex and rotates the generation,
-- so a late refresh can never overwrite a newly connected account/token.
CREATE FUNCTION public.persist_google_calendar_token_refresh_if_unchanged(
  p_business_id uuid,
  p_expected_credential_version uuid,
  p_access_token text,
  p_token_expiry timestamptz
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_business_id IS NULL
     OR p_expected_credential_version IS NULL
     OR NULLIF(p_access_token, '') IS NULL
     OR p_token_expiry IS NULL
     OR p_token_expiry <= clock_timestamp() THEN
    RAISE EXCEPTION 'invalid Google Calendar refresh persistence input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google Calendar refresh business not found'
      USING ERRCODE = '23503';
  END IF;

  UPDATE public.google_calendar_tokens AS token
  SET
    access_token = p_access_token,
    token_expiry = p_token_expiry,
    credential_version = gen_random_uuid(),
    updated_at = clock_timestamp()
  WHERE token.business_id = p_business_id
    AND token.credential_version = p_expected_credential_version;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_google_calendar_token_refresh_if_unchanged(
  uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.persist_google_calendar_token_refresh_if_unchanged(
  uuid, uuid, text, timestamptz
) TO service_role;

-- A definitive invalid_grant may remove only the unchanged credential that
-- produced it. Transient/ambiguous refresh errors never call this RPC. Keep
-- pending bookings and provider-ambiguous operations fenced for reauthorization
-- instead of deleting the only namespace evidence needed to reconcile them.
CREATE FUNCTION public.disconnect_google_calendar_token_if_unchanged(
  p_business_id uuid,
  p_expected_credential_version uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz;
  v_deleted integer;
BEGIN
  IF p_business_id IS NULL OR p_expected_credential_version IS NULL THEN
    RAISE EXCEPTION 'invalid conditional Google Calendar disconnect input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Google Calendar disconnect business not found'
      USING ERRCODE = '23503';
  END IF;

  PERFORM 1
  FROM public.google_calendar_tokens AS token
  WHERE token.business_id = p_business_id
    AND token.credential_version = p_expected_credential_version
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_now := clock_timestamp();
  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = v_now,
    failure_reason = 'Provider submission was never started.',
    updated_at = v_now
  WHERE business_id = p_business_id
    AND status = 'holding'
    AND provider_submission_started_at IS NULL
    AND (claim_token IS NULL OR claim_expires_at <= v_now)
    AND (
      reconciliation_claim_token IS NULL
      OR reconciliation_claim_expires_at <= v_now
    );

  IF EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.status IN ('holding', 'provider_applied')
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'calendar_provider_operation_busy'
      USING ERRCODE = '55P03';
  END IF;

  DELETE FROM public.google_calendar_tokens AS token
  WHERE token.business_id = p_business_id
    AND token.credential_version = p_expected_credential_version;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.disconnect_google_calendar_token_if_unchanged(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.disconnect_google_calendar_token_if_unchanged(
  uuid, uuid
) TO service_role;

-- OAuth completion is a credential-namespace mutation. Serialize it on the
-- same business mutex as reservations/provider intents. While provider work
-- is unresolved, permit credential recovery only when both the existing and
-- incoming identity prove the same normalized Google account and exact
-- selected calendar; an account/calendar switch would make later provider
-- reconciliation inspect the wrong namespace.
CREATE OR REPLACE FUNCTION public.complete_google_calendar_oauth_connection(
  p_attempt_id uuid,
  p_business_id uuid,
  p_owner_user_id uuid,
  p_origin_partner_id uuid,
  p_origin_hostname text,
  p_access_token text,
  p_refresh_token text,
  p_token_expiry timestamptz,
  p_google_email text,
  p_calendar_id text DEFAULT 'primary'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.google_calendar_oauth_attempts%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
  v_existing_token public.google_calendar_tokens%ROWTYPE;
  v_settings_id uuid;
  v_settings_updated integer;
  v_has_unresolved_provider_work boolean;
  v_now timestamptz;
BEGIN
  IF p_access_token IS NULL
     OR p_access_token = ''
     OR p_refresh_token IS NULL
     OR p_refresh_token = ''
     OR p_token_expiry IS NULL
     OR p_token_expiry <= now()
     OR NULLIF(btrim(p_google_email), '') IS NULL
     OR length(btrim(p_google_email)) > 254
     OR btrim(p_google_email) ~ '[[:cntrl:]]'
     OR lower(btrim(p_google_email)) !~
        '^[^[:space:]@]+@[^[:space:]@]+$'
     OR p_calendar_id IS NULL
     OR btrim(p_calendar_id) = ''
     OR length(btrim(p_calendar_id)) > 1024
     OR btrim(p_calendar_id) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_google_credentials'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.id = p_attempt_id;

  IF NOT FOUND
     OR v_attempt.status <> 'claimed'
     OR v_attempt.claimed_at IS NULL
     OR v_attempt.sanitized_result IS NOT NULL
     OR v_attempt.expires_at <= now()
     OR v_attempt.business_id IS DISTINCT FROM p_business_id
     OR v_attempt.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM p_origin_partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_user_id
    AND business.partner_id IS NOT DISTINCT FROM p_origin_partner_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_workspace_changed'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.primary_goal IS NOT DISTINCT FROM 'signup' THEN
    RAISE EXCEPTION 'google_calendar_goal_unavailable'
      USING ERRCODE = '55000';
  END IF;

  -- A never-submitted intent whose worker and reconciliation claims have both
  -- elapsed cannot have changed Google. Retire that safe preflight residue
  -- under the business mutex before deciding whether an OAuth namespace
  -- change must remain fenced. Post-submission ambiguity stays fail-closed.
  v_now := clock_timestamp();
  UPDATE public.calendar_provider_operations
  SET
    status = 'failed',
    claim_token = NULL,
    claimed_at = NULL,
    claim_expires_at = NULL,
    claim_released_at = NULL,
    reconciliation_claim_token = NULL,
    reconciliation_claimed_at = NULL,
    reconciliation_claim_expires_at = NULL,
    failed_at = v_now,
    failure_reason = 'Provider submission was never started.',
    updated_at = v_now
  WHERE business_id = p_business_id
    AND status = 'holding'
    AND provider_submission_started_at IS NULL
    AND (claim_token IS NULL OR claim_expires_at <= v_now)
    AND (
      reconciliation_claim_token IS NULL
      OR reconciliation_claim_expires_at <= v_now
    );

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.calendar_bookings AS booking
      WHERE booking.business_id = p_business_id
        AND booking.status = 'pending'
    )
    OR EXISTS (
      SELECT 1
      FROM public.calendar_provider_operations AS operation
      WHERE operation.business_id = p_business_id
        AND operation.status IN ('holding', 'provider_applied')
    )
  )
  INTO v_has_unresolved_provider_work;

  IF v_has_unresolved_provider_work THEN
    SELECT token.*
    INTO v_existing_token
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = p_business_id
    FOR UPDATE;

    IF NOT FOUND
       OR NULLIF(lower(btrim(v_existing_token.google_email)), '') IS NULL
       OR NULLIF(lower(btrim(p_google_email)), '') IS NULL
       OR lower(btrim(v_existing_token.google_email)) <>
          lower(btrim(p_google_email))
       OR NULLIF(btrim(v_existing_token.calendar_id), '') IS NULL
       OR NULLIF(btrim(p_calendar_id), '') IS NULL
       OR btrim(v_existing_token.calendar_id) IS DISTINCT FROM
          btrim(p_calendar_id) THEN
      RAISE EXCEPTION 'calendar_provider_oauth_namespace_busy'
        USING ERRCODE = '55P03';
    END IF;
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.status <> 'claimed'
     OR v_attempt.claimed_at IS NULL
     OR v_attempt.sanitized_result IS NOT NULL
     OR v_attempt.expires_at <= now()
     OR v_attempt.business_id IS DISTINCT FROM v_business.id
     OR v_attempt.owner_user_id IS DISTINCT FROM v_business.owner_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM v_business.partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  IF p_origin_partner_id IS NOT NULL THEN
    SELECT partner.*
    INTO v_partner
    FROM public.partners AS partner
    WHERE partner.id = p_origin_partner_id
      AND partner.status = 'active'
      AND partner.domain_status = 'connected'
      AND partner.custom_domain = p_origin_hostname
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'oauth_workspace_changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  SELECT settings.id
  INTO v_settings_id
  FROM public.ai_settings AS settings
  WHERE settings.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'google_calendar_settings_missing'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.google_calendar_tokens (
    business_id,
    access_token,
    refresh_token,
    token_expiry,
    google_email,
    calendar_id
  ) VALUES (
    p_business_id,
    p_access_token,
    p_refresh_token,
    p_token_expiry,
    lower(btrim(p_google_email)),
    btrim(p_calendar_id)
  )
  ON CONFLICT (business_id) DO UPDATE
  SET access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expiry = EXCLUDED.token_expiry,
      google_email = EXCLUDED.google_email,
      calendar_id = EXCLUDED.calendar_id,
      credential_version = gen_random_uuid(),
      updated_at = now();

  UPDATE public.ai_settings
  SET booking_enabled = true,
      booking_mode = 'schedule_direct',
      updated_at = now()
  WHERE id = v_settings_id
    AND business_id = p_business_id;

  GET DIAGNOSTICS v_settings_updated = ROW_COUNT;
  IF v_settings_updated <> 1 THEN
    RAISE EXCEPTION 'google_calendar_settings_missing'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.google_calendar_oauth_attempts
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

-- OAuth completion must be able to retire a proven side-effect-free provider
-- intent while direct lifecycle-table writes remain closed. Keep the elevated
-- function boundary service-only and pin its search path above.
REVOKE ALL ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) TO service_role;

-- Account cleanup must not delete Google credentials or booking linkage while
-- provider work is unresolved. This BEFORE-owner-null guard runs in the same
-- cleanup transaction, so raising rolls all earlier token/config deletion
-- back. Terminal operation rows are scrubbed before the tombstone is written.
CREATE OR REPLACE FUNCTION public.guard_hot_lead_cleanup_inflight()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.owner_id IS NOT NULL AND NEW.owner_id IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.calendar_bookings AS booking
      WHERE booking.business_id = NEW.id
        AND booking.status = 'pending'
    ) THEN
      RAISE EXCEPTION
        'account cleanup is waiting for an in-flight calendar booking'
        USING ERRCODE = '55000';
    END IF;

    UPDATE public.calendar_provider_operations
    SET
      status = 'failed',
      claim_token = NULL,
      claimed_at = NULL,
      claim_expires_at = NULL,
      claim_released_at = NULL,
      reconciliation_claim_token = NULL,
      reconciliation_claimed_at = NULL,
      reconciliation_claim_expires_at = NULL,
      failed_at = clock_timestamp(),
      failure_reason = 'Provider submission was never started.',
      updated_at = clock_timestamp()
    WHERE business_id = NEW.id
      AND status = 'holding'
      AND provider_submission_started_at IS NULL
      AND (claim_token IS NULL OR claim_expires_at <= clock_timestamp())
      AND (
        reconciliation_claim_token IS NULL
        OR reconciliation_claim_expires_at <= clock_timestamp()
      );

    IF EXISTS (
      SELECT 1
      FROM public.calendar_provider_operations AS operation
      WHERE operation.business_id = NEW.id
        AND operation.status IN ('holding', 'provider_applied')
    ) THEN
      RAISE EXCEPTION
        'account cleanup is waiting for a calendar provider operation'
        USING ERRCODE = '55000';
    END IF;

    DELETE FROM public.calendar_provider_operations
    WHERE business_id = NEW.id
      AND status IN ('finalized', 'failed');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_hot_lead_cleanup_inflight()
  FROM PUBLIC, anon, authenticated, service_role;

-- Maintenance recovery is allowed for an owner-linked soft-deleted business:
-- it performs only provider reads plus local confirmation/failure and is what
-- lets the atomic hard-cleanup guard converge. Normal reservation remains
-- denied by reserve_calendar_booking's deleted/operational gates.
CREATE OR REPLACE FUNCTION public.claim_calendar_booking_reconciliation(
  p_business_id uuid,
  p_booking_id uuid,
  p_claim_token uuid
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_booking_id IS NULL
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid calendar booking reconciliation claim'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking business is unavailable'
      USING ERRCODE = '23514';
  END IF;

  -- Disconnect and OAuth namespace replacement use the same business mutex.
  -- A recovery claim must retain credentials for its read-only provider proof.
  IF NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'calendar booking credentials are unavailable'
      USING ERRCODE = '23514';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF v_booking.status <> 'pending' THEN
    RETURN v_booking;
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;
  IF v_booking.operation_claimed_at
     > clock_timestamp() - interval '5 minutes' THEN
    RAISE EXCEPTION 'calendar booking claim is not stale'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.calendar_bookings
  SET
    operation_claimed_at = clock_timestamp(),
    reconciliation_attempt_count = reconciliation_attempt_count + 1,
    reconciliation_attempted_at = clock_timestamp()
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_calendar_booking_reconciliation(
  uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_calendar_booking_reconciliation(
  uuid, uuid, uuid
) TO service_role;

-- Preserve the 039 failure semantics while joining the business-first lock
-- order used by cleanup, disconnect, reserve, confirm, and provider intents.
CREATE OR REPLACE FUNCTION public.fail_calendar_booking(
  p_business_id uuid,
  p_booking_id uuid,
  p_claim_token uuid,
  p_failure_reason text
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_booking_id IS NULL
     OR p_claim_token IS NULL
     OR NULLIF(btrim(p_failure_reason), '') IS NULL
     OR length(p_failure_reason) > 1000 THEN
    RAISE EXCEPTION 'invalid calendar booking failure input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF v_booking.status IN ('confirmed', 'failed', 'cancelled') THEN
    RETURN v_booking;
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_bookings
  SET
    status = 'failed',
    operation_claim_token = NULL,
    operation_claimed_at = NULL,
    failed_at = clock_timestamp(),
    failure_reason = left(btrim(p_failure_reason), 1000)
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.fail_calendar_booking(
  uuid, uuid, uuid, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_calendar_booking(
  uuid, uuid, uuid, text
) TO service_role;

-- Replace the effective 062 reservation definition, preserving its validation,
-- source-message idempotency, retry semantics, grants, and business-first lock
-- while also rejecting live dashboard provider operations.
CREATE OR REPLACE FUNCTION public.reserve_calendar_booking(
  p_business_id uuid,
  p_contact_id uuid,
  p_conversation_id uuid,
  p_source_message_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_claim_token uuid,
  p_google_calendar_id text,
  p_event_summary text,
  p_request_fingerprint text
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_contact_id IS NULL
     OR p_conversation_id IS NULL
     OR p_source_message_id IS NULL
     OR p_starts_at IS NULL
     OR p_ends_at IS NULL
     OR p_ends_at <= p_starts_at
     OR p_claim_token IS NULL
     OR NULLIF(btrim(p_google_calendar_id), '') IS NULL
     OR length(p_google_calendar_id) > 1024
     OR NULLIF(btrim(p_event_summary), '') IS NULL
     OR length(p_event_summary) > 1000
     OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid calendar booking reservation input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id IS NOT NULL
    AND business.deleted_at IS NULL
    AND business.operations_suspended_at IS NULL
    AND business.bookings_paused_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.contacts AS contact
    JOIN public.conversations AS conversation
      ON conversation.id = p_conversation_id
     AND conversation.business_id = contact.business_id
     AND conversation.contact_id = contact.id
    JOIN public.messages AS message
      ON message.id = p_source_message_id
     AND message.business_id = conversation.business_id
     AND message.conversation_id = conversation.id
     AND message.role = 'customer'
    WHERE contact.id = p_contact_id
      AND contact.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'calendar booking reservation tenant mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.business_id = p_business_id
    AND booking.source_message_id = p_source_message_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_booking.contact_id <> p_contact_id
       OR v_booking.conversation_id <> p_conversation_id THEN
      RAISE EXCEPTION 'calendar booking reservation linkage mismatch'
        USING ERRCODE = '23514';
    END IF;
    IF v_booking.status = 'confirmed' THEN
      RETURN v_booking;
    END IF;
    IF v_booking.status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled calendar booking cannot be reused'
        USING ERRCODE = '23514';
    END IF;
    -- Confirmed is authoritative local recovery and cannot issue provider
    -- work. Every remaining status may call Google, so recheck the credential
    -- in a distinct statement after the business lock. Folding this lookup
    -- into the waiting business SELECT would retain a pre-disconnect snapshot.
    IF NOT EXISTS (
      SELECT 1
      FROM public.google_calendar_tokens AS token
      WHERE token.business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'calendar booking business is not active'
        USING ERRCODE = '23514';
    END IF;
    IF v_booking.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'source message was reused with different booking details'
        USING ERRCODE = '23514';
    END IF;
    IF v_booking.status = 'pending'
       AND (
         v_booking.operation_claim_token = p_claim_token
         OR v_booking.operation_claimed_at
            > clock_timestamp() - interval '5 minutes'
       ) THEN
      RETURN v_booking;
    END IF;
    IF v_booking.status = 'failed'
       OR (
         v_booking.status = 'pending'
         AND v_booking.operation_claimed_at
            <= clock_timestamp() - interval '5 minutes'
       ) THEN
      IF EXISTS (
        SELECT 1
        FROM public.calendar_bookings AS conflicting_booking
        WHERE conflicting_booking.business_id = p_business_id
          AND conflicting_booking.google_calendar_id =
            v_booking.google_calendar_id
          AND conflicting_booking.status IN ('pending', 'confirmed')
          AND conflicting_booking.id <> v_booking.id
          AND conflicting_booking.starts_at < v_booking.ends_at
          AND conflicting_booking.ends_at > v_booking.starts_at
      ) OR EXISTS (
        SELECT 1
        FROM public.calendar_provider_operations AS operation
        WHERE operation.business_id = p_business_id
          AND operation.google_calendar_id = v_booking.google_calendar_id
          AND operation.status IN ('holding', 'provider_applied')
          AND COALESCE(
            operation.provider_starts_at,
            operation.desired_starts_at
          ) < v_booking.ends_at
          AND COALESCE(
            operation.provider_ends_at,
            operation.desired_ends_at
          ) > v_booking.starts_at
      ) THEN
        RAISE EXCEPTION 'calendar_booking_slot_unavailable'
          USING ERRCODE = '23P01';
      END IF;

      UPDATE public.calendar_bookings
      SET
        status = 'pending',
        operation_claim_token = p_claim_token,
        operation_claimed_at = clock_timestamp(),
        reconciliation_attempt_count = 0,
        reconciliation_attempted_at = NULL,
        failed_at = NULL,
        failure_reason = NULL
      WHERE id = v_booking.id
      RETURNING * INTO v_booking;
      RETURN v_booking;
    END IF;
    RAISE EXCEPTION 'calendar booking cannot be reserved from status %',
      v_booking.status
      USING ERRCODE = '23514';
  END IF;

  -- Brand-new reservation work may call Google and must serialize after a
  -- disconnect using this post-business-lock credential snapshot.
  IF NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = p_business_id
      AND booking.google_calendar_id = btrim(p_google_calendar_id)
      AND booking.status IN ('pending', 'confirmed')
      AND booking.starts_at < p_ends_at
      AND booking.ends_at > p_starts_at
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = btrim(p_google_calendar_id)
      AND operation.status IN ('holding', 'provider_applied')
      AND COALESCE(
        operation.provider_starts_at,
        operation.desired_starts_at
      ) < p_ends_at
      AND COALESCE(
        operation.provider_ends_at,
        operation.desired_ends_at
      ) > p_starts_at
  ) THEN
    RAISE EXCEPTION 'calendar_booking_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  INSERT INTO public.calendar_bookings (
    business_id,
    contact_id,
    conversation_id,
    source_message_id,
    google_calendar_id,
    event_summary,
    request_fingerprint,
    status,
    starts_at,
    ends_at,
    operation_claim_token,
    operation_claimed_at
  ) VALUES (
    p_business_id,
    p_contact_id,
    p_conversation_id,
    p_source_message_id,
    btrim(p_google_calendar_id),
    btrim(p_event_summary),
    p_request_fingerprint,
    'pending',
    p_starts_at,
    p_ends_at,
    p_claim_token,
    clock_timestamp()
  )
  RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) TO service_role;

-- Renew the existing-plan AI booking claim at the exact provider side-effect
-- fence. The claimed-at compare-and-swap distinguishes the original worker
-- from a maintenance reconciler, which intentionally retains the stable claim
-- token while rotating the timestamp. Whichever takes the business/booking
-- mutex first wins; the loser must not issue a Google mutation.
CREATE FUNCTION public.mark_calendar_booking_submission_started(
  p_business_id uuid,
  p_booking_id uuid,
  p_claim_token uuid,
  p_expected_claimed_at timestamptz
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_booking public.calendar_bookings%ROWTYPE;
  v_now timestamptz;
BEGIN
  IF p_business_id IS NULL
     OR p_booking_id IS NULL
     OR p_claim_token IS NULL
     OR p_expected_claimed_at IS NULL THEN
    RAISE EXCEPTION 'invalid calendar booking submission fence input'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
  END IF;
  v_now := clock_timestamp();

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF v_booking.status = 'confirmed' THEN
    RETURN v_booking;
  END IF;
  IF v_business.owner_id IS NULL
     OR v_business.deleted_at IS NOT NULL
     OR v_business.operations_suspended_at IS NOT NULL
     OR v_business.bookings_paused_at IS NOT NULL THEN
    RAISE EXCEPTION 'calendar booking business is not active'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'calendar booking credentials are unavailable'
      USING ERRCODE = '23514';
  END IF;
  IF v_booking.status <> 'pending'
     OR v_booking.operation_claim_token <> p_claim_token
     OR v_booking.operation_claimed_at IS DISTINCT FROM
        p_expected_claimed_at THEN
    RAISE EXCEPTION 'calendar booking submission claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.calendar_bookings
  SET operation_claimed_at = v_now
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;
  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_calendar_booking_submission_started(
  uuid, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_calendar_booking_submission_started(
  uuid, uuid, uuid, timestamptz
) TO service_role;

-- Replace the effective 062 confirmation definition. A provider-operation
-- hold serializes provider-returned direct-booking times too.
CREATE OR REPLACE FUNCTION public.confirm_calendar_booking(
  p_business_id uuid,
  p_booking_id uuid,
  p_google_event_id text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_claim_token uuid
) RETURNS public.calendar_bookings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_booking public.calendar_bookings%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_booking_id IS NULL
     OR NULLIF(btrim(p_google_event_id), '') IS NULL
     OR p_starts_at IS NULL
     OR p_ends_at IS NULL
     OR p_ends_at <= p_starts_at
     OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'invalid calendar booking confirmation input'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.id = p_booking_id
    AND booking.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking not found for business'
      USING ERRCODE = '23503';
  END IF;

  IF v_booking.status = 'confirmed' THEN
    IF v_booking.google_event_id = btrim(p_google_event_id) THEN
      RETURN v_booking;
    END IF;
    RAISE EXCEPTION 'calendar booking has a conflicting Google event'
      USING ERRCODE = '23514';
  END IF;
  IF v_booking.status <> 'pending' THEN
    RAISE EXCEPTION 'calendar booking is not pending'
      USING ERRCODE = '23514';
  END IF;
  IF v_booking.operation_claim_token <> p_claim_token THEN
    RAISE EXCEPTION 'calendar booking operation claim mismatch'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = v_booking.google_calendar_id
      AND operation.provider_target_event_id = btrim(p_google_event_id)
      AND operation.status IN ('holding', 'provider_applied')
  ) THEN
    RAISE EXCEPTION 'calendar_booking_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.calendar_bookings AS conflicting_booking
    WHERE conflicting_booking.business_id = p_business_id
      AND conflicting_booking.google_calendar_id =
        v_booking.google_calendar_id
      AND conflicting_booking.status IN ('pending', 'confirmed')
      AND conflicting_booking.id <> v_booking.id
      AND conflicting_booking.starts_at < p_ends_at
      AND conflicting_booking.ends_at > p_starts_at
  ) OR EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations AS operation
    WHERE operation.business_id = p_business_id
      AND operation.google_calendar_id = v_booking.google_calendar_id
      AND operation.status IN ('holding', 'provider_applied')
      AND COALESCE(
        operation.provider_starts_at,
        operation.desired_starts_at
      ) < p_ends_at
      AND COALESCE(
        operation.provider_ends_at,
        operation.desired_ends_at
      ) > p_starts_at
  ) THEN
    RAISE EXCEPTION 'calendar_booking_slot_unavailable'
      USING ERRCODE = '23P01';
  END IF;

  UPDATE public.calendar_bookings
  SET
    status = 'confirmed',
    google_event_id = btrim(p_google_event_id),
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    operation_claim_token = NULL,
    operation_claimed_at = NULL,
    confirmed_at = clock_timestamp()
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  PERFORM public.promote_contact_lead_status(
    v_booking.business_id,
    v_booking.contact_id,
    'hot',
    'booking_confirmed',
    v_booking.conversation_id,
    v_booking.source_message_id,
    v_booking.id,
    true
  );

  RETURN v_booking;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_calendar_booking(
  uuid, uuid, text, timestamptz, timestamptz, uuid
) TO service_role;

COMMIT;
