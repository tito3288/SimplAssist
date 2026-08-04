BEGIN;

-- ============================================================================
-- A. Provisioning dismissal and external-operation fencing
-- ============================================================================

ALTER TABLE public.partner_client_provisioning_jobs
  DROP CONSTRAINT partner_client_provisioning_jobs_status_check,
  ADD COLUMN dismissed_at timestamptz,
  ADD COLUMN dismissed_by_admin_id uuid,
  ADD COLUMN operation_token uuid,
  ADD COLUMN operation_kind text,
  ADD COLUMN operation_started_at timestamptz,
  ADD COLUMN operation_expires_at timestamptz,
  ADD CONSTRAINT partner_client_provisioning_jobs_status_check
    CHECK (
      status IN (
        'pending',
        'admin_setup',
        'auth_created',
        'business_prepared',
        'assigned',
        'invite_pending',
        'setup_email_sent',
        'needs_attention',
        'dismissed'
      )
    ),
  ADD CONSTRAINT provisioning_dismissed_shape
    CHECK (
      (
        status = 'dismissed'
        AND dismissed_at IS NOT NULL
        AND dismissed_by_admin_id IS NOT NULL
        AND auth_user_id IS NULL
        AND business_id IS NULL
        AND setup_email_sent_at IS NULL
        AND operation_token IS NULL
        AND operation_kind IS NULL
        AND operation_started_at IS NULL
        AND operation_expires_at IS NULL
      )
      OR
      (
        status <> 'dismissed'
        AND dismissed_at IS NULL
        AND dismissed_by_admin_id IS NULL
      )
    ),
  ADD CONSTRAINT provisioning_operation_shape
    CHECK (
      (
        operation_token IS NULL
        AND operation_kind IS NULL
        AND operation_started_at IS NULL
        AND operation_expires_at IS NULL
      )
      OR
      (
        operation_token IS NOT NULL
        AND operation_kind IN ('provision', 'retry', 'send_setup')
        AND operation_started_at IS NOT NULL
        AND operation_expires_at IS NOT NULL
        AND operation_expires_at > operation_started_at
        AND operation_started_at <= updated_at
        AND operation_expires_at <= updated_at + interval '15 minutes'
      )
    );

CREATE INDEX partner_client_provisioning_jobs_operation_idx
  ON public.partner_client_provisioning_jobs(operation_expires_at)
  WHERE operation_token IS NOT NULL;

COMMENT ON COLUMN public.partner_client_provisioning_jobs.dismissed_at IS
  'When an administrator hid a resource-free failed provisioning attempt.';
COMMENT ON COLUMN public.partner_client_provisioning_jobs.dismissed_by_admin_id IS
  'Administrator auth UUID that dismissed this resource-free job.';
COMMENT ON COLUMN public.partner_client_provisioning_jobs.operation_token IS
  'Opaque fencing token for an external Auth, assignment, link, or email operation.';
COMMENT ON COLUMN public.partner_client_provisioning_jobs.operation_expires_at IS
  'Lease deadline; expiry means outcome unknown until reconciliation, not safe abandonment.';

-- ============================================================================
-- B. Append-only, PII-lean administrator action audit
-- ============================================================================

CREATE TABLE public.admin_action_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_admin_user_id uuid NOT NULL,
  action text NOT NULL
    CHECK (
      action IN (
        'account_deletion_scheduled',
        'provisioning_job_dismissed',
        'provisioning_job_restored'
      )
    ),
  business_id uuid,
  provisioning_job_id uuid,
  deletion_scheduled_for timestamptz,
  -- No byte cap: businesses.name is existing unbounded text and the deletion
  -- snapshot must retain its exact locked value without making that account
  -- impossible to schedule. The strict key/type shape below bounds scope.
  summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (
      jsonb_typeof(summary) = 'object'
    ),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT admin_action_target_shape CHECK (
    (
      action = 'account_deletion_scheduled'
      AND business_id IS NOT NULL
      AND provisioning_job_id IS NULL
      AND deletion_scheduled_for IS NOT NULL
    )
    OR
    (
      action IN (
        'provisioning_job_dismissed',
        'provisioning_job_restored'
      )
      AND business_id IS NULL
      AND provisioning_job_id IS NOT NULL
      AND deletion_scheduled_for IS NULL
    )
  ),

  -- Account deletion stores one exact, PII-lean snapshot generated from the
  -- locked database row. Provisioning transitions deliberately store no
  -- payload at all. The subtraction checks reject every unapproved key.
  CONSTRAINT admin_action_summary_shape CHECK (
    CASE
      WHEN action = 'account_deletion_scheduled' THEN
        summary ?& ARRAY[
          'business_id',
          'business_name',
          'billing_mode',
          'partner_slug',
          'resource_counts'
        ]
        AND summary - ARRAY[
          'business_id',
          'business_name',
          'billing_mode',
          'partner_slug',
          'resource_counts'
        ] = '{}'::jsonb
        AND jsonb_typeof(summary->'business_id') = 'string'
        AND summary->>'business_id' = business_id::text
        AND jsonb_typeof(summary->'business_name') = 'string'
        AND jsonb_typeof(summary->'billing_mode') = 'string'
        AND summary->>'billing_mode' IN ('stripe', 'invoiced', 'comped')
        AND jsonb_typeof(summary->'partner_slug') IN ('string', 'null')
        AND jsonb_typeof(summary->'resource_counts') = 'object'
        AND (summary->'resource_counts') ?& ARRAY[
          'auth_users',
          'provisioning_jobs',
          'assigned_phone_rows',
          'google_calendar_token_rows',
          'configuration_rows',
          'contact_rows_to_scrub',
          'message_rows_to_scrub'
        ]
        AND (summary->'resource_counts') - ARRAY[
          'auth_users',
          'provisioning_jobs',
          'assigned_phone_rows',
          'google_calendar_token_rows',
          'configuration_rows',
          'contact_rows_to_scrub',
          'message_rows_to_scrub'
        ] = '{}'::jsonb
        AND jsonb_typeof(summary#>'{resource_counts,auth_users}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,provisioning_jobs}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,assigned_phone_rows}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,google_calendar_token_rows}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,configuration_rows}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,contact_rows_to_scrub}') = 'number'
        AND jsonb_typeof(summary#>'{resource_counts,message_rows_to_scrub}') = 'number'
        AND (summary#>>'{resource_counts,auth_users}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,provisioning_jobs}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,assigned_phone_rows}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,google_calendar_token_rows}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,configuration_rows}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,contact_rows_to_scrub}') ~ '^[0-9]+$'
        AND (summary#>>'{resource_counts,message_rows_to_scrub}') ~ '^[0-9]+$'
      ELSE summary = '{}'::jsonb
    END
  )
);

CREATE UNIQUE INDEX admin_action_deletion_once
  ON public.admin_action_events(
    action,
    business_id,
    deletion_scheduled_for
  )
  WHERE action = 'account_deletion_scheduled';

CREATE INDEX admin_action_events_business_idx
  ON public.admin_action_events(business_id, created_at DESC);

CREATE INDEX admin_action_events_job_idx
  ON public.admin_action_events(provisioning_job_id, created_at DESC);

ALTER TABLE public.admin_action_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_action_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT
  ON TABLE public.admin_action_events
  TO service_role;

COMMENT ON TABLE public.admin_action_events IS
  'Append-only administrator lifecycle audit. Account-deletion summaries are strictly key-whitelisted and PII-lean.';
COMMENT ON COLUMN public.admin_action_events.summary IS
  'Deletion snapshots contain only business ID/name, billing mode, partner slug, and aggregate counts; never customer email, message content, or phone values.';

-- ============================================================================
-- C. Private cross-domain Google Calendar OAuth attempts
-- ============================================================================

CREATE TABLE public.google_calendar_oauth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_digest text NOT NULL
    CHECK (state_digest ~ '^[0-9a-f]{64}$'),
  origin_verifier_digest text NOT NULL
    CHECK (origin_verifier_digest ~ '^[0-9a-f]{64}$'),
  handoff_digest text
    CHECK (
      handoff_digest IS NULL
      OR handoff_digest ~ '^[0-9a-f]{64}$'
    ),

  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL
    REFERENCES auth.users(id) ON DELETE CASCADE,
  origin_partner_id uuid
    REFERENCES public.partners(id) ON DELETE CASCADE,
  origin_hostname text NOT NULL
    CHECK (
      origin_hostname = lower(origin_hostname)
      AND length(origin_hostname) <= 253
      AND origin_hostname ~
        '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
    ),

  status text NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated', 'handoff_ready', 'claimed', 'failed')),
  authorization_code text
    CHECK (
      authorization_code IS NULL
      OR (
        length(authorization_code) BETWEEN 1 AND 4096
        AND authorization_code !~ '[[:cntrl:]]'
      )
    ),
  sanitized_result text
    CHECK (
      sanitized_result IS NULL
      OR sanitized_result IN ('access_denied', 'provider_error')
    ),

  expires_at timestamptz NOT NULL,
  handoff_expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT google_calendar_oauth_attempt_expiry CHECK (
    expires_at > created_at
    AND (
      handoff_expires_at IS NULL
      OR (
        handoff_expires_at > created_at
        AND handoff_expires_at <= expires_at
      )
    )
  ),
  CONSTRAINT google_calendar_oauth_attempt_shape CHECK (
    (
      status = 'initiated'
      AND handoff_digest IS NULL
      AND authorization_code IS NULL
      AND sanitized_result IS NULL
      AND handoff_expires_at IS NULL
      AND claimed_at IS NULL
    )
    OR
    (
      status = 'handoff_ready'
      AND handoff_digest IS NOT NULL
      AND authorization_code IS NOT NULL
      AND sanitized_result IS NULL
      AND handoff_expires_at IS NOT NULL
      AND claimed_at IS NULL
    )
    OR
    (
      status = 'failed'
      AND handoff_digest IS NOT NULL
      AND authorization_code IS NULL
      AND sanitized_result IS NOT NULL
      AND handoff_expires_at IS NOT NULL
      AND claimed_at IS NULL
    )
    OR
    (
      status = 'claimed'
      AND handoff_digest IS NOT NULL
      AND authorization_code IS NULL
      AND handoff_expires_at IS NOT NULL
      AND claimed_at IS NOT NULL
    )
  ),
  UNIQUE (state_digest),
  UNIQUE (handoff_digest)
);

CREATE INDEX google_calendar_oauth_attempts_expiry_idx
  ON public.google_calendar_oauth_attempts(expires_at);

CREATE TRIGGER set_updated_at_google_calendar_oauth_attempts
BEFORE UPDATE ON public.google_calendar_oauth_attempts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.google_calendar_oauth_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_calendar_oauth_attempts
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.google_calendar_oauth_attempts
  TO service_role;

COMMENT ON TABLE public.google_calendar_oauth_attempts IS
  'Service-role-only, short-lived cross-domain Google Calendar OAuth attempts. Raw state, verifier, and handoff values are never stored.';
COMMENT ON COLUMN public.google_calendar_oauth_attempts.authorization_code IS
  'One-use Google authorization code staged only until the original-host session claims it.';

-- ============================================================================
-- D. Provisioning operation and dismissal RPCs
-- ============================================================================

CREATE FUNCTION public.claim_partner_client_provisioning_operation(
  p_job_id uuid,
  p_operation_kind text,
  p_operation_token uuid,
  p_reconciled_operation_token uuid DEFAULT NULL,
  p_now timestamptz DEFAULT now()
) RETURNS public.partner_client_provisioning_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.partner_client_provisioning_jobs%ROWTYPE;
BEGIN
  IF p_operation_kind IS NULL
     OR p_operation_kind NOT IN ('provision', 'retry', 'send_setup') THEN
    RAISE EXCEPTION 'invalid_operation_kind'
      USING ERRCODE = '22023';
  END IF;

  IF p_operation_token IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'operation_token_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.partner_client_provisioning_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provisioning_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'dismissed' THEN
    RAISE EXCEPTION 'job_dismissed'
      USING ERRCODE = '55000';
  END IF;

  IF v_job.operation_token IS NOT NULL THEN
    IF v_job.operation_expires_at > p_now THEN
      RAISE EXCEPTION 'provisioning_in_progress'
        USING ERRCODE = '55000';
    END IF;

    IF p_reconciled_operation_token IS NULL
       OR p_reconciled_operation_token IS DISTINCT FROM v_job.operation_token THEN
      RAISE EXCEPTION 'provisioning_outcome_unknown'
        USING ERRCODE = '55000';
    END IF;

    IF p_operation_token IS NOT DISTINCT FROM v_job.operation_token THEN
      RAISE EXCEPTION 'auth_identity_mismatch'
        USING ERRCODE = '55000';
    END IF;
  ELSIF p_reconciled_operation_token IS NOT NULL THEN
    RAISE EXCEPTION 'auth_identity_mismatch'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.partner_client_provisioning_jobs AS job
  SET operation_token = p_operation_token,
      operation_kind = p_operation_kind,
      operation_started_at = p_now,
      operation_expires_at = p_now + interval '15 minutes',
      updated_at = now()
  WHERE job.id = p_job_id
  RETURNING job.* INTO v_job;

  RETURN v_job;
END;
$$;

CREATE FUNCTION public.dismiss_partner_client_provisioning_job(
  p_job_id uuid,
  p_admin_user_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS public.partner_client_provisioning_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.partner_client_provisioning_jobs%ROWTYPE;
BEGIN
  IF p_admin_user_id IS NULL OR p_now IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.partner_client_provisioning_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provisioning_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status = 'dismissed' THEN
    RETURN v_job;
  END IF;

  IF v_job.operation_token IS NOT NULL THEN
    IF v_job.operation_expires_at > p_now THEN
      RAISE EXCEPTION 'provisioning_in_progress'
        USING ERRCODE = '55000';
    END IF;
    RAISE EXCEPTION 'provisioning_outcome_unknown'
      USING ERRCODE = '55000';
  END IF;

  IF v_job.auth_user_id IS NOT NULL
     OR v_job.business_id IS NOT NULL
     OR v_job.setup_email_sent_at IS NOT NULL THEN
    RAISE EXCEPTION 'provisioning_has_resources'
      USING ERRCODE = '55000';
  END IF;

  IF v_job.status <> 'needs_attention'
     AND NOT (
       v_job.status = 'pending'
       AND v_job.updated_at <= p_now - interval '15 minutes'
     ) THEN
    RAISE EXCEPTION 'job_not_dismissible'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.partner_client_provisioning_jobs AS job
  SET status = 'dismissed',
      dismissed_at = p_now,
      dismissed_by_admin_id = p_admin_user_id,
      updated_at = now()
  WHERE job.id = p_job_id
  RETURNING job.* INTO v_job;

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    provisioning_job_id,
    summary
  ) VALUES (
    p_admin_user_id,
    'provisioning_job_dismissed',
    p_job_id,
    '{}'::jsonb
  );

  RETURN v_job;
END;
$$;

CREATE FUNCTION public.restore_partner_client_provisioning_job(
  p_job_id uuid,
  p_admin_user_id uuid
) RETURNS public.partner_client_provisioning_jobs
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.partner_client_provisioning_jobs%ROWTYPE;
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT job.*
  INTO v_job
  FROM public.partner_client_provisioning_jobs AS job
  WHERE job.id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'provisioning_job_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_job.status <> 'dismissed' THEN
    RETURN v_job;
  END IF;

  IF v_job.auth_user_id IS NOT NULL
     OR v_job.business_id IS NOT NULL
     OR v_job.setup_email_sent_at IS NOT NULL
     OR v_job.operation_token IS NOT NULL THEN
    RAISE EXCEPTION 'provisioning_has_resources'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.partner_client_provisioning_jobs AS job
  SET status = 'needs_attention',
      dismissed_at = NULL,
      dismissed_by_admin_id = NULL,
      updated_at = now()
  WHERE job.id = p_job_id
  RETURNING job.* INTO v_job;

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    provisioning_job_id,
    summary
  ) VALUES (
    p_admin_user_id,
    'provisioning_job_restored',
    p_job_id,
    '{}'::jsonb
  );

  RETURN v_job;
END;
$$;

-- Lock provisioning rows before their business everywhere that can schedule
-- or terminally clean an account. The order is stable across concurrent admin,
-- customer, and provisioning operations.
CREATE FUNCTION public.lock_account_provisioning_jobs(
  p_business_id uuid,
  p_owner_user_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_job public.partner_client_provisioning_jobs%ROWTYPE;
BEGIN
  FOR v_job IN
    SELECT job.*
    FROM public.partner_client_provisioning_jobs AS job
    WHERE job.business_id = p_business_id
       OR (
         p_owner_user_id IS NOT NULL
         AND job.auth_user_id = p_owner_user_id
       )
    ORDER BY job.id::text
    FOR UPDATE
  LOOP
    IF v_job.operation_token IS NOT NULL THEN
      IF v_job.operation_expires_at > p_now THEN
        RAISE EXCEPTION 'provisioning_in_progress'
          USING ERRCODE = '55000';
      END IF;
      RAISE EXCEPTION 'provisioning_outcome_unknown'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.account_deletion_preview_json(
  p_business_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_partner_slug text;
  v_subscription_status text;
  v_assigned_phone_count integer;
  v_provisioning_job_count integer;
  v_operation_state text;
  v_requires_live_ack boolean;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id;

  IF NOT FOUND
     OR v_business.owner_id IS NULL
     OR (
       v_business.deleted_at IS NOT NULL
       AND v_business.deletion_scheduled_for IS NULL
     ) THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT partner.slug
  INTO v_partner_slug
  FROM public.partners AS partner
  WHERE partner.id = v_business.partner_id;

  SELECT subscription.status
  INTO v_subscription_status
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  SELECT count(*)::integer
  INTO v_assigned_phone_count
  FROM public.phone_numbers AS phone
  WHERE phone.business_id = p_business_id
    AND phone.is_active IS TRUE;

  SELECT
    count(*)::integer,
    CASE
      WHEN bool_or(
        job.operation_token IS NOT NULL
        AND job.operation_expires_at <= now()
      ) THEN 'unknown'
      WHEN bool_or(
        job.operation_token IS NOT NULL
        AND job.operation_expires_at > now()
      ) THEN 'active'
      ELSE 'idle'
    END
  INTO v_provisioning_job_count, v_operation_state
  FROM public.partner_client_provisioning_jobs AS job
  WHERE job.business_id = p_business_id
     OR job.auth_user_id = v_business.owner_id;

  v_operation_state := COALESCE(v_operation_state, 'idle');
  v_requires_live_ack :=
    v_subscription_status IN ('active', 'trialing', 'past_due')
    OR v_business.campaign_status IN ('pending', 'approved')
    OR v_assigned_phone_count > 0
    OR v_business.pending_phone_number IS NOT NULL;

  RETURN jsonb_build_object(
    'business_id', v_business.id,
    'business_name', v_business.name,
    'billing_mode', v_business.billing_mode,
    'partner_id', v_business.partner_id,
    'partner_slug', v_partner_slug,
    'lifecycle_stage', CASE
      WHEN v_business.deleted_at IS NOT NULL THEN 'suspended'
      WHEN v_business.onboarding_completed_at IS NOT NULL THEN 'launched'
      ELSE 'onboarding'
    END,
    'deletion_scheduled_for', v_business.deletion_scheduled_for,
    'subscription_status', v_subscription_status,
    'campaign_status', v_business.campaign_status,
    'assigned_phone_count', v_assigned_phone_count,
    'has_pending_phone_number',
      v_business.pending_phone_number IS NOT NULL,
    'provisioning_job_count', v_provisioning_job_count,
    'provisioning_operation_state', v_operation_state,
    'requires_live_acknowledgement', v_requires_live_ack
  );
END;
$$;

CREATE FUNCTION public.account_deletion_audit_summary_json(
  p_business_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_partner_slug text;
  v_owner_id uuid;
  v_provisioning_jobs integer;
  v_assigned_phone_rows integer;
  v_google_calendar_token_rows integer;
  v_configuration_rows integer;
  v_contact_rows integer;
  v_message_rows integer;
BEGIN
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  v_owner_id := COALESCE(
    v_business.owner_id,
    v_business.cleanup_auth_user_id
  );

  SELECT partner.slug
  INTO v_partner_slug
  FROM public.partners AS partner
  WHERE partner.id = v_business.partner_id;

  SELECT count(*)::integer
  INTO v_provisioning_jobs
  FROM public.partner_client_provisioning_jobs AS job
  WHERE job.business_id = p_business_id
     OR (
       v_owner_id IS NOT NULL
       AND job.auth_user_id = v_owner_id
     );

  SELECT count(*)::integer
  INTO v_assigned_phone_rows
  FROM public.phone_numbers AS phone
  WHERE phone.business_id = p_business_id
    AND phone.is_active IS TRUE;

  SELECT count(*)::integer
  INTO v_google_calendar_token_rows
  FROM public.google_calendar_tokens AS token
  WHERE token.business_id = p_business_id;

  SELECT
    (SELECT count(*) FROM public.ai_settings WHERE business_id = p_business_id)
    + (SELECT count(*) FROM public.services WHERE business_id = p_business_id)
    + (SELECT count(*) FROM public.faqs WHERE business_id = p_business_id)
    + (SELECT count(*) FROM public.business_hours WHERE business_id = p_business_id)
    + (SELECT count(*) FROM public.widget_configs WHERE business_id = p_business_id)
  INTO v_configuration_rows;

  SELECT count(*)::integer
  INTO v_contact_rows
  FROM public.contacts AS contact
  WHERE contact.business_id = p_business_id;

  SELECT count(DISTINCT message.id)::integer
  INTO v_message_rows
  FROM public.messages AS message
  WHERE message.business_id = p_business_id
     OR message.conversation_id IN (
       SELECT conversation.id
       FROM public.conversations AS conversation
       WHERE conversation.business_id = p_business_id
     );

  RETURN jsonb_build_object(
    'business_id', v_business.id,
    'business_name', v_business.name,
    'billing_mode', v_business.billing_mode,
    'partner_slug', v_partner_slug,
    'resource_counts', jsonb_build_object(
      'auth_users', CASE WHEN v_owner_id IS NULL THEN 0 ELSE 1 END,
      'provisioning_jobs', v_provisioning_jobs,
      'assigned_phone_rows', v_assigned_phone_rows,
      'google_calendar_token_rows', v_google_calendar_token_rows,
      'configuration_rows', v_configuration_rows,
      'contact_rows_to_scrub', v_contact_rows,
      'message_rows_to_scrub', v_message_rows
    )
  );
END;
$$;

CREATE FUNCTION public.get_account_deletion_preview(
  p_business_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT public.account_deletion_preview_json(p_business_id);
$$;

CREATE FUNCTION public.schedule_admin_account_deletion(
  p_business_id uuid,
  p_confirmation_name text,
  p_acknowledge_live_resources boolean,
  p_actor_admin_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_snapshot uuid;
  v_business public.businesses%ROWTYPE;
  v_preview jsonb;
  v_summary jsonb;
  v_result jsonb;
  v_deleted_at timestamptz;
  v_scheduled_for timestamptz;
  v_existing_admin_event boolean;
BEGIN
  IF p_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
  END IF;

  -- Read only the candidate owner before the lock-order boundary, then prove
  -- it did not change after jobs are locked and the business lock is held.
  SELECT business.owner_id
  INTO v_owner_snapshot
  FROM public.businesses AS business
  WHERE business.id = p_business_id;

  IF NOT FOUND OR v_owner_snapshot IS NULL THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.lock_account_provisioning_jobs(
    p_business_id,
    v_owner_snapshot,
    now()
  );

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = v_owner_snapshot
  FOR UPDATE;

  IF NOT FOUND
     OR (
       v_business.deleted_at IS NOT NULL
       AND v_business.deletion_scheduled_for IS NULL
     ) THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_confirmation_name IS DISTINCT FROM v_business.name THEN
    RAISE EXCEPTION 'confirmation_mismatch'
      USING ERRCODE = '55000';
  END IF;

  v_preview := public.account_deletion_preview_json(p_business_id);

  IF COALESCE(
       (v_preview->>'requires_live_acknowledgement')::boolean,
       false
     )
     AND p_acknowledge_live_resources IS NOT TRUE THEN
    RAISE EXCEPTION 'live_ack_required'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.deleted_at IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.admin_action_events AS event
      WHERE event.action = 'account_deletion_scheduled'
        AND event.business_id = p_business_id
        AND event.deletion_scheduled_for =
              v_business.deletion_scheduled_for
    ) INTO v_existing_admin_event;

    RETURN jsonb_build_object(
      'scheduled', jsonb_build_object(
        'business_id', p_business_id,
        'deleted_at', v_business.deleted_at,
        'deletion_scheduled_for', v_business.deletion_scheduled_for,
        'stripe_action', (
          SELECT to_jsonb(action)
          FROM public.account_deletion_stripe_actions AS action
          WHERE action.business_id = p_business_id
        )
      ),
      'preview', v_preview,
      'admin_event_created', false,
      'previously_scheduled_by_admin', v_existing_admin_event
    );
  END IF;

  v_deleted_at := now();
  v_scheduled_for := v_deleted_at + interval '60 days';
  v_summary := public.account_deletion_audit_summary_json(p_business_id);

  v_result := public.schedule_account_deletion(
    p_business_id,
    v_business.owner_id,
    v_deleted_at,
    v_scheduled_for
  );

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    business_id,
    deletion_scheduled_for,
    summary
  ) VALUES (
    p_actor_admin_user_id,
    'account_deletion_scheduled',
    p_business_id,
    v_scheduled_for,
    v_summary
  );

  RETURN jsonb_build_object(
    'scheduled', v_result,
    'preview', public.account_deletion_preview_json(p_business_id),
    'admin_event_created', true,
    'previously_scheduled_by_admin', false
  );
END;
$$;

-- ============================================================================
-- E. Cross-domain Google Calendar OAuth RPCs
-- ============================================================================

CREATE FUNCTION public.purge_expired_google_calendar_oauth_attempts(
  p_now timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.expires_at <= p_now
     OR (
       attempt.handoff_expires_at IS NOT NULL
       AND attempt.handoff_expires_at <= p_now
     );

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE FUNCTION public.create_google_calendar_oauth_attempt(
  p_state_digest text,
  p_origin_verifier_digest text,
  p_business_id uuid,
  p_owner_user_id uuid,
  p_origin_partner_id uuid,
  p_origin_hostname text,
  p_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
  v_attempt_id uuid;
BEGIN
  IF p_state_digest IS NULL
     OR p_state_digest !~ '^[0-9a-f]{64}$'
     OR p_origin_verifier_digest IS NULL
     OR p_origin_verifier_digest !~ '^[0-9a-f]{64}$'
     OR p_origin_hostname IS NULL
     OR p_origin_hostname <> lower(p_origin_hostname)
     OR p_origin_hostname !~
       '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$'
     OR p_expires_at IS NULL
     OR p_expires_at <= now()
     OR p_expires_at > now() + interval '10 minutes 5 seconds' THEN
    RAISE EXCEPTION 'invalid_oauth_attempt'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.purge_expired_google_calendar_oauth_attempts(now());

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_user_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_workspace_changed'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.partner_id IS DISTINCT FROM p_origin_partner_id THEN
    RAISE EXCEPTION 'oauth_workspace_changed'
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

  INSERT INTO public.google_calendar_oauth_attempts (
    state_digest,
    origin_verifier_digest,
    business_id,
    owner_user_id,
    origin_partner_id,
    origin_hostname,
    expires_at
  ) VALUES (
    p_state_digest,
    p_origin_verifier_digest,
    p_business_id,
    p_owner_user_id,
    p_origin_partner_id,
    p_origin_hostname,
    p_expires_at
  )
  RETURNING id INTO v_attempt_id;

  RETURN v_attempt_id;
END;
$$;

CREATE FUNCTION public.stage_google_calendar_oauth_handoff(
  p_state_digest text,
  p_handoff_digest text,
  p_authorization_code text,
  p_sanitized_result text,
  p_handoff_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.google_calendar_oauth_attempts%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
BEGIN
  IF p_state_digest IS NULL
     OR p_state_digest !~ '^[0-9a-f]{64}$'
     OR p_handoff_digest IS NULL
     OR p_handoff_digest !~ '^[0-9a-f]{64}$'
     OR p_handoff_expires_at IS NULL
     OR (
       (p_authorization_code IS NULL) =
       (p_sanitized_result IS NULL)
     )
     OR (
       p_authorization_code IS NOT NULL
       AND (
         length(p_authorization_code) NOT BETWEEN 1 AND 4096
         OR p_authorization_code ~ '[[:cntrl:]]'
       )
     )
     OR (
       p_sanitized_result IS NOT NULL
       AND p_sanitized_result NOT IN ('access_denied', 'provider_error')
     ) THEN
    RAISE EXCEPTION 'invalid_oauth_handoff'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.state_digest = p_state_digest;

  IF NOT FOUND
     OR v_attempt.status <> 'initiated'
     OR v_attempt.expires_at <= now()
     OR p_handoff_expires_at <= now()
     OR p_handoff_expires_at > v_attempt.expires_at THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  -- Lock order is business, attempt, then partner. Workspace changes already
  -- hold the business before their invalidation trigger deletes attempts.
  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = v_attempt.business_id
    AND business.owner_id = v_attempt.owner_user_id
    AND business.partner_id IS NOT DISTINCT FROM v_attempt.origin_partner_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_workspace_changed'
      USING ERRCODE = '55000';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.state_digest = p_state_digest
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.state_digest IS DISTINCT FROM p_state_digest
     OR v_attempt.status <> 'initiated'
     OR v_attempt.expires_at <= now()
     OR p_handoff_expires_at <= now()
     OR p_handoff_expires_at > v_attempt.expires_at
     OR v_attempt.business_id IS DISTINCT FROM v_business.id
     OR v_attempt.owner_user_id IS DISTINCT FROM v_business.owner_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM v_business.partner_id THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  IF v_attempt.origin_partner_id IS NOT NULL THEN
    SELECT partner.*
    INTO v_partner
    FROM public.partners AS partner
    WHERE partner.id = v_attempt.origin_partner_id
      AND partner.status = 'active'
      AND partner.domain_status = 'connected'
      AND partner.custom_domain = v_attempt.origin_hostname
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'oauth_workspace_changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  UPDATE public.google_calendar_oauth_attempts AS attempt
  SET handoff_digest = p_handoff_digest,
      authorization_code = p_authorization_code,
      sanitized_result = p_sanitized_result,
      handoff_expires_at = p_handoff_expires_at,
      status = CASE
        WHEN p_authorization_code IS NOT NULL THEN 'handoff_ready'
        ELSE 'failed'
      END,
      updated_at = now()
  WHERE attempt.id = v_attempt.id
  RETURNING attempt.* INTO v_attempt;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'business_id', v_attempt.business_id,
    'owner_user_id', v_attempt.owner_user_id,
    'origin_partner_id', v_attempt.origin_partner_id,
    'origin_hostname', v_attempt.origin_hostname,
    'sanitized_result', v_attempt.sanitized_result,
    'handoff_expires_at', v_attempt.handoff_expires_at
  );
END;
$$;

CREATE FUNCTION public.claim_google_calendar_oauth_handoff(
  p_handoff_digest text,
  p_origin_verifier_digest text,
  p_business_id uuid,
  p_owner_user_id uuid,
  p_origin_partner_id uuid,
  p_origin_hostname text,
  p_claimed_at timestamptz DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.google_calendar_oauth_attempts%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
  v_authorization_code text;
  v_sanitized_result text;
BEGIN
  IF p_handoff_digest IS NULL
     OR p_handoff_digest !~ '^[0-9a-f]{64}$'
     OR p_origin_verifier_digest IS NULL
     OR p_origin_verifier_digest !~ '^[0-9a-f]{64}$'
     OR p_claimed_at IS NULL THEN
    RAISE EXCEPTION 'invalid_oauth_handoff'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.handoff_digest = p_handoff_digest;

  IF NOT FOUND
     OR v_attempt.status NOT IN ('handoff_ready', 'failed')
     OR v_attempt.expires_at <= p_claimed_at
     OR v_attempt.handoff_expires_at <= p_claimed_at
     OR v_attempt.origin_verifier_digest
          IS DISTINCT FROM p_origin_verifier_digest
     OR v_attempt.business_id IS DISTINCT FROM p_business_id
     OR v_attempt.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM p_origin_partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_handoff_invalid_or_expired'
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

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.handoff_digest = p_handoff_digest
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.handoff_digest IS DISTINCT FROM p_handoff_digest
     OR v_attempt.status NOT IN ('handoff_ready', 'failed')
     OR v_attempt.expires_at <= p_claimed_at
     OR v_attempt.handoff_expires_at <= p_claimed_at
     OR v_attempt.origin_verifier_digest
          IS DISTINCT FROM p_origin_verifier_digest
     OR v_attempt.business_id IS DISTINCT FROM v_business.id
     OR v_attempt.owner_user_id IS DISTINCT FROM v_business.owner_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM v_business.partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_handoff_invalid_or_expired'
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

  v_authorization_code := v_attempt.authorization_code;
  v_sanitized_result := v_attempt.sanitized_result;

  UPDATE public.google_calendar_oauth_attempts AS attempt
  SET status = 'claimed',
      authorization_code = NULL,
      claimed_at = p_claimed_at,
      updated_at = now()
  WHERE attempt.id = v_attempt.id;

  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'authorization_code', v_authorization_code,
    'sanitized_result', v_sanitized_result
  );
END;
$$;

CREATE FUNCTION public.complete_google_calendar_oauth_connection(
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
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.google_calendar_oauth_attempts%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
BEGIN
  IF p_access_token IS NULL
     OR p_access_token = ''
     OR p_refresh_token IS NULL
     OR p_refresh_token = ''
     OR p_token_expiry IS NULL
     OR p_token_expiry <= now()
     OR p_calendar_id IS NULL
     OR btrim(p_calendar_id) = '' THEN
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
    p_google_email,
    p_calendar_id
  )
  ON CONFLICT (business_id) DO UPDATE
  SET access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expiry = EXCLUDED.token_expiry,
      google_email = EXCLUDED.google_email,
      calendar_id = EXCLUDED.calendar_id,
      updated_at = now();

  UPDATE public.ai_settings
  SET booking_enabled = true,
      booking_mode = 'schedule_direct',
      updated_at = now()
  WHERE business_id = p_business_id;

  DELETE FROM public.google_calendar_oauth_attempts
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

CREATE FUNCTION public.invalidate_google_calendar_oauth_attempts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    DELETE FROM public.google_calendar_oauth_attempts
    WHERE business_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER invalidate_google_calendar_oauth_attempts_on_workspace_change
AFTER UPDATE OF owner_id, partner_id, deleted_at
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.invalidate_google_calendar_oauth_attempts();

-- Preserve migration 029's queue behavior for Stripe businesses while making
-- the Phase 2 billing-mode invariant structural at this trusted helper. The
-- business lock also prevents a queue insert from racing partner lifecycle
-- handling after it has proved that no Stripe action exists.
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
  v_billing_mode text;
BEGIN
  IF p_stripe_subscription_id IS NULL
     OR btrim(p_stripe_subscription_id) = '' THEN
    RAISE EXCEPTION 'stripe subscription id is required'
      USING ERRCODE = '22004';
  END IF;

  IF p_desired_action IS NULL
     OR p_desired_action NOT IN ('pause', 'resume', 'cancel') THEN
    RAISE EXCEPTION
      'invalid Stripe account-deletion action: %',
      p_desired_action
      USING ERRCODE = '22023';
  END IF;

  SELECT business.billing_mode
  INTO v_billing_mode
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_billing_mode <> 'stripe' THEN
    RAISE EXCEPTION 'partner_stripe_action_forbidden'
      USING ERRCODE = '55000';
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

    -- Exact retries retain generation, idempotency key, claim, attempts, and
    -- result. Applied or blocked work is never resurrected.
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

-- A partner-managed business should never have a Stripe deletion action. Only
-- a never-claimed pending row is safe to discard. Once a worker may have
-- crossed the database/provider boundary, deletion fails closed until an
-- operator reconciles the outcome; the application never calls Stripe here.
CREATE FUNCTION public.discard_unattempted_partner_stripe_action(
  p_business_id uuid,
  p_now timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_billing_mode text;
BEGIN
  IF p_now IS NULL THEN
    RAISE EXCEPTION 'stripe_action_reference_time_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT business.billing_mode
  INTO v_billing_mode
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_billing_mode = 'stripe' THEN
    RAISE EXCEPTION 'stripe_action_discard_requires_partner_mode'
      USING ERRCODE = '55000';
  END IF;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_action.lease_token IS NOT NULL
     AND v_action.lease_expires_at > p_now THEN
    RAISE EXCEPTION 'stripe_action_in_progress'
      USING ERRCODE = '55000';
  END IF;

  IF v_action.lease_token IS NOT NULL
     OR v_action.status <> 'pending'
     OR v_action.attempt_count <> 0
     OR v_action.last_attempted_at IS NOT NULL
     OR v_action.applied_action IS NOT NULL THEN
    RAISE EXCEPTION 'stripe_action_outcome_unknown'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.account_deletion_stripe_actions
  WHERE business_id = p_business_id;
END;
$$;

-- ============================================================================
-- F. Partner-aware account scheduling and reactivation
-- ============================================================================

-- Preserve migration 034's exact Stripe behavior for Stripe-mode businesses.
-- Provisioning rows are locked first, and partner billing never creates or
-- retains an account-deletion Stripe action.
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

  PERFORM public.lock_account_provisioning_jobs(
    p_business_id,
    p_owner_id,
    now()
  );

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

  IF v_business.billing_mode <> 'stripe' THEN
    IF EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'partner_subscription_conflict'
        USING ERRCODE = '55000';
    END IF;

    PERFORM public.discard_unattempted_partner_stripe_action(
      p_business_id,
      now()
    );
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

  IF v_business.billing_mode = 'stripe' THEN
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
  ELSE
    PERFORM public.discard_unattempted_partner_stripe_action(
      p_business_id,
      now()
    );
    v_stripe_subscription_id := NULL;
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

-- Migration 034 reactivation is retained verbatim within the Stripe branch.
-- Partner accounts reserve/cancel Telnyx work without queueing or requiring a
-- Stripe action. An impossible stale subscription pointer fails closed for
-- operator reconciliation instead of being treated as partner authority.
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

  IF v_business.billing_mode <> 'stripe' THEN
    PERFORM public.discard_unattempted_partner_stripe_action(
      p_business_id,
      now()
    );

    IF EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'partner_subscription_conflict'
        USING ERRCODE = '55000';
    END IF;
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

  IF v_business.billing_mode = 'stripe' THEN
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
  ELSE
    -- The safe-discard helper ran before any Telnyx reservation mutation.
    NULL;
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

  IF v_business.billing_mode = 'stripe' THEN
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
  ELSE
    v_stripe_subscription_id := NULL;
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

CREATE OR REPLACE FUNCTION public.complete_account_reactivation(
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

  IF v_business.billing_mode <> 'stripe' THEN
    PERFORM public.discard_unattempted_partner_stripe_action(
      p_business_id,
      now()
    );

    IF EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'partner_subscription_conflict'
        USING ERRCODE = '55000';
    END IF;
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

  IF v_business.billing_mode = 'stripe' THEN
    SELECT action.*
    INTO v_action
    FROM public.account_deletion_stripe_actions AS action
    WHERE action.business_id = p_business_id
    FOR UPDATE;

    v_had_action := FOUND;
  ELSE
    -- The safe-discard helper ran before reactivation validation.
    NULL;
  END IF;

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
  ELSIF v_business.billing_mode = 'stripe'
        AND EXISTS (
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

  IF v_business.billing_mode = 'stripe'
     AND v_applied_action = 'cancel' THEN
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

-- Preserve migration 034's cleanup body and add only the partner/provisioning
-- lifecycle boundary. Stripe businesses execute the original Stripe block;
  -- partner businesses perform no provider/outbox work and fail closed if an
  -- impossible stale subscription pointer requires operator reconciliation.
CREATE OR REPLACE FUNCTION public.cleanup_expired_business(
  p_business_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_snapshot uuid;
  v_owner_id uuid;
  v_auth_user uuid;
  v_existing_auth_user uuid;
  v_deleted_at timestamptz;
  v_deletion_scheduled_for timestamptz;
  v_billing_mode text;
  v_local_stripe_subscription_id text;
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
  v_release_run_id uuid;
BEGIN
  -- Candidate read only; the value is re-proved under the business lock after
  -- every account-linked provisioning row has been locked in UUID order.
  SELECT COALESCE(business.owner_id, business.cleanup_auth_user_id)
  INTO v_owner_snapshot
  FROM public.businesses AS business
  WHERE business.id = p_business_id;

  PERFORM public.lock_account_provisioning_jobs(
    p_business_id,
    v_owner_snapshot,
    now()
  );

  SELECT business.owner_id, business.cleanup_auth_user_id,
         business.deleted_at, business.deletion_scheduled_for,
         business.billing_mode
  INTO v_owner_id, v_existing_auth_user,
       v_deleted_at, v_deletion_scheduled_for,
       v_billing_mode
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NOT NULL
    AND business.deletion_scheduled_for < now()
    AND COALESCE(business.owner_id, business.cleanup_auth_user_id)
          IS NOT DISTINCT FROM v_owner_snapshot
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % is not an expired deleted account', p_business_id
      USING ERRCODE = '42501';
  END IF;

  IF v_billing_mode <> 'stripe' THEN
    IF EXISTS (
      SELECT 1
      FROM public.subscriptions
      WHERE business_id = p_business_id
    ) THEN
      RAISE EXCEPTION 'partner_subscription_conflict'
        USING ERRCODE = '55000';
    END IF;

    PERFORM public.discard_unattempted_partner_stripe_action(
      p_business_id,
      now()
    );
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

  IF v_billing_mode = 'stripe' THEN
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
  ELSE
    -- The safe-discard helper ran before any irreversible scrub.
    NULL;
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

  -- Account-linked concierge state contains the customer's canonical email
  -- and requested business name. It survives grace, then is deleted before
  -- Auth deletion. Standalone dismissed history is not linked and remains.
  DELETE FROM public.partner_client_provisioning_jobs AS job
  WHERE job.business_id = p_business_id
     OR (
       v_auth_user IS NOT NULL
       AND job.auth_user_id = v_auth_user
     );

  DELETE FROM public.google_calendar_oauth_attempts
  WHERE business_id = p_business_id;

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
      -- Partner assignment is customer lifecycle data. Normalizing the
      -- retained tombstone to Stripe/null-plan preserves migration 044's mode
      -- constraint without implying a surviving partner relationship.
      partner_id = NULL,
      billing_mode = 'stripe',
      partner_plan = NULL,
      cleanup_pii_scrubbed_at = COALESCE(cleanup_pii_scrubbed_at, now()),
      owner_id = NULL
  WHERE id = p_business_id;

  RETURN v_auth_user;
END;
$$;

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

    IF NEW.billing_mode = 'stripe' THEN
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
    ELSE
      IF EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE business_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'partner_subscription_conflict'
          USING ERRCODE = '55000';
      END IF;

      PERFORM public.discard_unattempted_partner_stripe_action(
        NEW.id,
        now()
      );
    END IF;
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
    IF NEW.billing_mode = 'stripe' THEN
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
    ELSE
      IF EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE business_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'partner_subscription_conflict'
          USING ERRCODE = '55000';
      END IF;

      PERFORM public.discard_unattempted_partner_stripe_action(
        NEW.id,
        now()
      );
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
    IF OLD.billing_mode = 'stripe' THEN
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
    ELSE
      IF EXISTS (
        SELECT 1
        FROM public.subscriptions
        WHERE business_id = NEW.id
      ) THEN
        RAISE EXCEPTION 'partner_subscription_conflict'
          USING ERRCODE = '55000';
      END IF;

      PERFORM public.discard_unattempted_partner_stripe_action(
        NEW.id,
        now()
      );
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

-- ============================================================================
-- G. Exact execution boundaries
-- ============================================================================

REVOKE ALL ON FUNCTION public.claim_partner_client_provisioning_operation(
  uuid, text, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.dismiss_partner_client_provisioning_job(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.restore_partner_client_provisioning_job(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.lock_account_provisioning_jobs(
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.discard_unattempted_partner_stripe_action(
  uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.account_deletion_preview_json(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_deletion_audit_summary_json(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_account_deletion_preview(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, uuid
) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.purge_expired_google_calendar_oauth_attempts(
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_google_calendar_oauth_attempt(
  text, text, uuid, uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.stage_google_calendar_oauth_handoff(
  text, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_google_calendar_oauth_handoff(
  text, text, uuid, uuid, uuid, text, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invalidate_google_calendar_oauth_attempts()
  FROM PUBLIC, anon, authenticated, service_role;

-- Reassert the existing lifecycle function boundary after replacing bodies.
REVOKE ALL ON FUNCTION public.schedule_account_deletion(
  uuid, uuid, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prepare_account_reactivation(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_account_reactivation(
  uuid, uuid, bigint, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_account_deletion_business_transition()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_partner_client_provisioning_operation(
  uuid, text, uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.dismiss_partner_client_provisioning_job(
  uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_partner_client_provisioning_job(
  uuid, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.lock_account_provisioning_jobs(
  uuid, uuid, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_unattempted_partner_stripe_action(
  uuid, timestamptz
) TO service_role;

GRANT EXECUTE ON FUNCTION public.account_deletion_preview_json(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_audit_summary_json(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_preview(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, uuid
) TO service_role;

GRANT EXECUTE ON FUNCTION public.purge_expired_google_calendar_oauth_attempts(
  timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_google_calendar_oauth_attempt(
  text, text, uuid, uuid, uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_google_calendar_oauth_handoff(
  text, text, text, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_google_calendar_oauth_handoff(
  text, text, uuid, uuid, uuid, text, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION public.schedule_account_deletion(
  uuid, uuid, timestamptz, timestamptz
) TO service_role;
GRANT EXECUTE ON FUNCTION public.prepare_account_reactivation(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_account_reactivation(
  uuid, uuid, bigint, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_business(uuid)
  TO service_role;

COMMENT ON FUNCTION public.claim_partner_client_provisioning_operation(
  uuid, text, uuid, uuid, timestamptz
) IS
  'Claims a fifteen-minute fenced provisioning operation; an expired lease requires explicit reconciled-token proof.';
COMMENT ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, uuid
) IS
  'Atomically validates an exact-name/live-resource confirmation, schedules the existing 60-day lifecycle, and inserts one PII-lean audit event.';
COMMENT ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) IS
  'Atomically revalidates a claimed one-use OAuth attempt, writes Calendar credentials/settings, and removes the attempt.';

COMMIT;
