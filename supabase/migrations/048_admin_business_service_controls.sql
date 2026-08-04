BEGIN;

-- Phase 3 Slice 2: reversible operational suspension and orthogonal service
-- pauses. NULL timestamps mean active/resumed. Operational controls remain
-- independent from the account-deletion lifecycle and from Stripe billing.

ALTER TABLE public.businesses
  ADD COLUMN operations_suspended_at timestamptz,
  ADD COLUMN ai_replies_paused_at timestamptz,
  ADD COLUMN texting_paused_at timestamptz,
  ADD COLUMN bookings_paused_at timestamptz;

COMMENT ON COLUMN public.businesses.operations_suspended_at IS
  'Administrative operational suspension instant. NULL means account operations are active; independent from account deletion and billing.';
COMMENT ON COLUMN public.businesses.ai_replies_paused_at IS
  'Administrative AI-reply pause instant. NULL means AI replies are not independently paused.';
COMMENT ON COLUMN public.businesses.texting_paused_at IS
  'Administrative texting pause instant. NULL means texting is not independently paused.';
COMMENT ON COLUMN public.businesses.bookings_paused_at IS
  'Administrative booking pause instant. NULL means bookings are not independently paused.';

CREATE INDEX idx_businesses_admin_suspended_created_at
  ON public.businesses (created_at DESC NULLS LAST, id DESC)
  WHERE operations_suspended_at IS NOT NULL
    AND deleted_at IS NULL
    AND deletion_scheduled_for IS NULL;

-- Owners may continue ordinary profile writes and read these facts for the
-- dashboard notice, but cannot alter administrator-controlled service state.
CREATE FUNCTION public.guard_business_operational_control_fields()
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
    IF NEW.operations_suspended_at IS NOT NULL
       OR NEW.ai_replies_paused_at IS NOT NULL
       OR NEW.texting_paused_at IS NOT NULL
       OR NEW.bookings_paused_at IS NOT NULL THEN
      RAISE EXCEPTION
        'customer writes cannot set protected business operational controls'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.operations_suspended_at IS DISTINCT FROM
          OLD.operations_suspended_at
     OR NEW.ai_replies_paused_at IS DISTINCT FROM OLD.ai_replies_paused_at
     OR NEW.texting_paused_at IS DISTINCT FROM OLD.texting_paused_at
     OR NEW.bookings_paused_at IS DISTINCT FROM OLD.bookings_paused_at THEN
    RAISE EXCEPTION
      'customer writes cannot change protected business operational controls'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_business_operational_control_fields
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_operational_control_fields();

REVOKE ALL ON FUNCTION public.guard_business_operational_control_fields()
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the eight-column append-only audit table. Reasons and service keys
-- use its existing action-shaped, exact-key summary payload.
ALTER TABLE public.admin_action_events
  DROP CONSTRAINT admin_action_events_action_check,
  DROP CONSTRAINT admin_action_target_shape,
  DROP CONSTRAINT admin_action_summary_shape;

ALTER TABLE public.admin_action_events
  ADD CONSTRAINT admin_action_events_action_check CHECK (
    action IN (
      'account_deletion_scheduled',
      'provisioning_job_dismissed',
      'provisioning_job_restored',
      'account_operations_suspended',
      'account_operations_reactivated',
      'account_service_paused',
      'account_service_resumed'
    )
  ),
  ADD CONSTRAINT admin_action_target_shape CHECK (
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
    OR
    (
      action IN (
        'account_operations_suspended',
        'account_operations_reactivated',
        'account_service_paused',
        'account_service_resumed'
      )
      AND business_id IS NOT NULL
      AND provisioning_job_id IS NULL
      AND deletion_scheduled_for IS NULL
    )
  ),
  ADD CONSTRAINT admin_action_summary_shape CHECK (
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
      WHEN action IN (
        'account_operations_suspended',
        'account_operations_reactivated'
      ) THEN
        summary ?& ARRAY['reason']
        AND summary - ARRAY['reason'] = '{}'::jsonb
        AND jsonb_typeof(summary->'reason') = 'string'
        AND char_length(summary->>'reason') BETWEEN 8 AND 500
        AND summary->>'reason' = btrim(summary->>'reason')
        AND summary->>'reason' !~ '[[:cntrl:]]'
      WHEN action IN (
        'account_service_paused',
        'account_service_resumed'
      ) THEN
        summary ? 'service'
        AND summary - ARRAY['service', 'reason'] = '{}'::jsonb
        AND jsonb_typeof(summary->'service') = 'string'
        AND summary->>'service' IN ('ai_replies', 'texting', 'bookings')
        AND (
          NOT summary ? 'reason'
          OR (
            jsonb_typeof(summary->'reason') = 'string'
            AND char_length(summary->>'reason') BETWEEN 8 AND 500
            AND summary->>'reason' = btrim(summary->>'reason')
            AND summary->>'reason' !~ '[[:cntrl:]]'
          )
        )
      ELSE summary = '{}'::jsonb
    END
  );

COMMENT ON TABLE public.admin_action_events IS
  'Append-only administrator lifecycle and operational-control audit. Summaries are exact-key constrained and PII-lean.';
COMMENT ON COLUMN public.admin_action_events.summary IS
  'Strict action-specific payload: deletion snapshot, bounded operational-control reason/service, or empty provisioning summary.';

-- One business-row lock serializes each state transition. A no-op is
-- idempotent and creates no false audit event. Account deletion remains a
-- separate lifecycle and blocks new operational-control transitions.
CREATE FUNCTION public.set_admin_business_operations_suspension(
  p_business_id uuid,
  p_suspended boolean,
  p_reason text,
  p_actor_admin_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_changed_at timestamptz;
  v_event_id uuid;
BEGIN
  IF p_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
  END IF;
  IF p_suspended IS NULL THEN
    RAISE EXCEPTION 'suspension_state_required'
      USING ERRCODE = '22004';
  END IF;
  IF p_reason IS NULL
     OR p_reason IS DISTINCT FROM btrim(p_reason)
     OR char_length(p_reason) NOT BETWEEN 8 AND 500
     OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_admin_action_reason'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_business.deleted_at IS NOT NULL
     OR v_business.deletion_scheduled_for IS NOT NULL THEN
    RAISE EXCEPTION 'account_deletion_in_progress'
      USING ERRCODE = '55000';
  END IF;

  IF (v_business.operations_suspended_at IS NOT NULL) = p_suspended THEN
    RETURN jsonb_build_object(
      'business_id', v_business.id,
      'changed', false,
      'admin_event_id', NULL,
      'operations_suspended_at', v_business.operations_suspended_at,
      'ai_replies_paused_at', v_business.ai_replies_paused_at,
      'texting_paused_at', v_business.texting_paused_at,
      'bookings_paused_at', v_business.bookings_paused_at
    );
  END IF;

  v_changed_at := now();
  UPDATE public.businesses AS business
  SET operations_suspended_at = CASE
        WHEN p_suspended THEN v_changed_at
        ELSE NULL
      END
  WHERE business.id = p_business_id
  RETURNING business.* INTO v_business;

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    business_id,
    summary,
    created_at
  ) VALUES (
    p_actor_admin_user_id,
    CASE
      WHEN p_suspended THEN 'account_operations_suspended'
      ELSE 'account_operations_reactivated'
    END,
    p_business_id,
    jsonb_build_object('reason', p_reason),
    v_changed_at
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'business_id', v_business.id,
    'changed', true,
    'admin_event_id', v_event_id,
    'operations_suspended_at', v_business.operations_suspended_at,
    'ai_replies_paused_at', v_business.ai_replies_paused_at,
    'texting_paused_at', v_business.texting_paused_at,
    'bookings_paused_at', v_business.bookings_paused_at
  );
END;
$$;

CREATE FUNCTION public.set_admin_business_service_pause(
  p_business_id uuid,
  p_service text,
  p_paused boolean,
  p_reason text,
  p_actor_admin_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_current_paused boolean;
  v_changed_at timestamptz;
  v_event_id uuid;
BEGIN
  IF p_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
  END IF;
  IF p_paused IS NULL THEN
    RAISE EXCEPTION 'service_pause_state_required'
      USING ERRCODE = '22004';
  END IF;
  IF p_service IS NULL
     OR p_service NOT IN ('ai_replies', 'texting', 'bookings') THEN
    RAISE EXCEPTION 'invalid_admin_service'
      USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NOT NULL
     AND (
       p_reason IS DISTINCT FROM btrim(p_reason)
       OR char_length(p_reason) NOT BETWEEN 8 AND 500
       OR p_reason ~ '[[:cntrl:]]'
     ) THEN
    RAISE EXCEPTION 'invalid_admin_action_reason'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business_not_found'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_business.deleted_at IS NOT NULL
     OR v_business.deletion_scheduled_for IS NOT NULL THEN
    RAISE EXCEPTION 'account_deletion_in_progress'
      USING ERRCODE = '55000';
  END IF;

  v_current_paused := CASE p_service
    WHEN 'ai_replies' THEN v_business.ai_replies_paused_at IS NOT NULL
    WHEN 'texting' THEN v_business.texting_paused_at IS NOT NULL
    WHEN 'bookings' THEN v_business.bookings_paused_at IS NOT NULL
  END;

  IF v_current_paused = p_paused THEN
    RETURN jsonb_build_object(
      'business_id', v_business.id,
      'changed', false,
      'admin_event_id', NULL,
      'operations_suspended_at', v_business.operations_suspended_at,
      'ai_replies_paused_at', v_business.ai_replies_paused_at,
      'texting_paused_at', v_business.texting_paused_at,
      'bookings_paused_at', v_business.bookings_paused_at
    );
  END IF;

  v_changed_at := now();
  UPDATE public.businesses AS business
  SET ai_replies_paused_at = CASE
        WHEN p_service = 'ai_replies' THEN
          CASE WHEN p_paused THEN v_changed_at ELSE NULL END
        ELSE business.ai_replies_paused_at
      END,
      texting_paused_at = CASE
        WHEN p_service = 'texting' THEN
          CASE WHEN p_paused THEN v_changed_at ELSE NULL END
        ELSE business.texting_paused_at
      END,
      bookings_paused_at = CASE
        WHEN p_service = 'bookings' THEN
          CASE WHEN p_paused THEN v_changed_at ELSE NULL END
        ELSE business.bookings_paused_at
      END
  WHERE business.id = p_business_id
  RETURNING business.* INTO v_business;

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    business_id,
    summary,
    created_at
  ) VALUES (
    p_actor_admin_user_id,
    CASE
      WHEN p_paused THEN 'account_service_paused'
      ELSE 'account_service_resumed'
    END,
    p_business_id,
    CASE
      WHEN p_reason IS NULL THEN jsonb_build_object('service', p_service)
      ELSE jsonb_build_object('service', p_service, 'reason', p_reason)
    END,
    v_changed_at
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'business_id', v_business.id,
    'changed', true,
    'admin_event_id', v_event_id,
    'operations_suspended_at', v_business.operations_suspended_at,
    'ai_replies_paused_at', v_business.ai_replies_paused_at,
    'texting_paused_at', v_business.texting_paused_at,
    'bookings_paused_at', v_business.bookings_paused_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_admin_business_operations_suspension(
  uuid, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.set_admin_business_service_pause(
  uuid, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.set_admin_business_operations_suspension(
  uuid, boolean, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_admin_business_service_pause(
  uuid, text, boolean, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.set_admin_business_operations_suspension(
  uuid, boolean, text, uuid
) IS
  'Service-role-only idempotent operational suspension/reactivation with one locked state transition and strict audit event.';
COMMENT ON FUNCTION public.set_admin_business_service_pause(
  uuid, text, boolean, text, uuid
) IS
  'Service-role-only idempotent AI-reply, texting, or booking pause/resume with one locked state transition and an optional bounded audit reason.';

-- Recheck booking controls while holding the same business-row lock used by
-- reservation. This closes the enqueue-time race before a provider operation
-- can acquire or renew its durable local claim.
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
  ON CONFLICT (business_id, source_message_id) DO NOTHING;

  SELECT booking.*
  INTO v_booking
  FROM public.calendar_bookings AS booking
  WHERE booking.business_id = p_business_id
    AND booking.source_message_id = p_source_message_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'calendar booking reservation was not persisted'
      USING ERRCODE = '55000';
  END IF;
  IF v_booking.contact_id <> p_contact_id
     OR v_booking.conversation_id <> p_conversation_id THEN
    RAISE EXCEPTION 'calendar booking reservation linkage mismatch'
      USING ERRCODE = '23514';
  END IF;

  -- Once confirmed, the stored provider result is the authoritative
  -- idempotency response even if an AI retry emits different tool arguments.
  -- Pending/failed attempts still require an exact request fingerprint.
  IF v_booking.status = 'confirmed' THEN
    RETURN v_booking;
  END IF;
  IF v_booking.status = 'cancelled' THEN
    RAISE EXCEPTION 'cancelled calendar booking cannot be reused'
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
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.reserve_calendar_booking(
  uuid, uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, text
) IS
  'Reserves direct-booking work only while the locked business is active, operationally unsuspended, and bookings are unpaused.';


-- Keep migration 047 unchanged for deployment compatibility. Its strict
-- application decoder cannot tolerate an in-place return-shape expansion.
-- The versioned full query retains every Slice 1 predicate and applies the new
-- suspension predicate before deterministic ordering and the 75-row cap.
GRANT SELECT (
  operations_suspended_at,
  ai_replies_paused_at,
  texting_paused_at,
  bookings_paused_at
) ON public.businesses TO service_role;

CREATE FUNCTION public.list_admin_business_health_v2(
  p_business_id uuid DEFAULT NULL,
  p_lifecycle text DEFAULT NULL,
  p_ownership text DEFAULT NULL,
  p_partner uuid DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_query text DEFAULT NULL
) RETURNS TABLE (
  business_id uuid,
  business_name text,
  business_email text,
  website_url text,
  business_type text,
  business_created_at timestamptz,
  snapshot_at timestamptz,
  deleted_at timestamptz,
  deletion_scheduled_for timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_step text,
  partner_id uuid,
  partner_name text,
  partner_slug text,
  billing_mode text,
  partner_plan text,
  billing_pilot boolean,
  billing_comped boolean,
  billing_exempt boolean,
  telnyx_submission_disabled boolean,
  sms_overage_opt_in boolean,
  subscription_plan text,
  subscription_status text,
  subscription_cancel_at_period_end boolean,
  effective_plan text,
  usage_period_start timestamptz,
  usage_period_end timestamptz,
  usage_included_sms_parts integer,
  usage_inbound_sms_parts integer,
  usage_outbound_sms_parts integer,
  usage_inbound_mms_events integer,
  usage_outbound_mms_events integer,
  a2p_risk_review_status text,
  a2p_risk_review_message text,
  onboarding_registration_status text,
  onboarding_registration_started_at timestamptz,
  brand_status text,
  campaign_status text,
  telnyx_messaging_profile_id text,
  telnyx_campaign_id text,
  messaging_profile_configured boolean,
  campaign_configured boolean,
  pending_phone_number_present boolean,
  pending_phone_number_failed boolean,
  active_phone_count bigint,
  active_phone_number text,
  active_phone_assignment_status text,
  active_phone_assignment_campaign_id text,
  active_phone_assignment_matches_campaign boolean,
  active_phone_assignment_failed boolean,
  ai_configured boolean,
  ai_booking_enabled boolean,
  ai_booking_mode text,
  web_chat_enabled boolean,
  calendar_connected boolean,
  provisioning_job_count bigint,
  provisioning_status text,
  provisioning_needs_attention boolean,
  provisioning_invite_failed boolean,
  provisioning_lease_expired boolean,
  failed_setup boolean,
  failed_setup_reasons text[],
  last_activity_at timestamptz,
  operations_suspended_at timestamptz,
  ai_replies_paused_at timestamptz,
  texting_paused_at timestamptz,
  bookings_paused_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_query text := NULLIF(btrim(p_query), '');
BEGIN
  IF p_lifecycle IS NOT NULL
     AND p_lifecycle NOT IN (
       'live',
       'onboarding',
       'past_due',
       'pending_deletion',
       'failed_setup',
       'suspended'
     ) THEN
    RAISE EXCEPTION 'invalid_admin_lifecycle_filter'
      USING ERRCODE = '22023';
  END IF;

  IF p_ownership IS NOT NULL
     AND p_ownership NOT IN ('direct', 'partner') THEN
    RAISE EXCEPTION 'invalid_admin_ownership_filter'
      USING ERRCODE = '22023';
  END IF;

  IF p_plan IS NOT NULL
     AND p_plan NOT IN ('sms_only', 'sms_and_chat', 'full') THEN
    RAISE EXCEPTION 'invalid_admin_plan_filter'
      USING ERRCODE = '22023';
  END IF;

  IF v_query IS NOT NULL AND length(v_query) > 100 THEN
    RAISE EXCEPTION 'invalid_admin_query_filter'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH base_businesses AS (
    SELECT
      business.id,
      business.owner_id,
      business.name,
      business.email,
      business.website_url,
      business.business_type,
      business.created_at,
      business.deleted_at,
      business.deletion_scheduled_for,
      business.operations_suspended_at,
      business.ai_replies_paused_at,
      business.texting_paused_at,
      business.bookings_paused_at,
      business.onboarding_completed_at,
      business.onboarding_step,
      business.partner_id,
      business.billing_mode,
      business.partner_plan,
      business.billing_pilot,
      business.billing_comped,
      business.billing_exempt,
      business.telnyx_submission_disabled,
      business.sms_overage_opt_in,
      business.a2p_risk_review_status,
      business.a2p_risk_review_message,
      business.onboarding_registration_status,
      business.onboarding_registration_started_at,
      business.brand_status,
      business.campaign_status,
      business.telnyx_messaging_profile_id,
      business.telnyx_campaign_id,
      business.pending_phone_number,
      business.pending_phone_number_failure_reason
    FROM public.businesses AS business
    WHERE (p_business_id IS NULL OR business.id = p_business_id)
      AND (
        p_ownership IS NULL
        OR (p_ownership = 'direct' AND business.partner_id IS NULL)
        OR (p_ownership = 'partner' AND business.partner_id IS NOT NULL)
      )
      -- A specific partner has meaning only inside partner ownership. This
      -- keeps a stale partner query parameter from narrowing direct/all views.
      AND (
        p_partner IS NULL
        OR p_ownership IS DISTINCT FROM 'partner'
        OR business.partner_id = p_partner
      )
      AND (
        v_query IS NULL
        OR position(lower(v_query) IN lower(COALESCE(business.name, ''))) > 0
        OR position(lower(v_query) IN lower(COALESCE(business.email, ''))) > 0
      )
  ),
  raw_snapshots AS (
    SELECT
      business.id AS snapshot_business_id,
      business.name AS snapshot_business_name,
      business.email AS snapshot_business_email,
      business.website_url AS snapshot_website_url,
      business.business_type AS snapshot_business_type,
      business.created_at AS snapshot_business_created_at,
      now() AS snapshot_snapshot_at,
      business.deleted_at AS snapshot_deleted_at,
      business.deletion_scheduled_for AS snapshot_deletion_scheduled_for,
      business.operations_suspended_at AS snapshot_operations_suspended_at,
      business.ai_replies_paused_at AS snapshot_ai_replies_paused_at,
      business.texting_paused_at AS snapshot_texting_paused_at,
      business.bookings_paused_at AS snapshot_bookings_paused_at,
      business.onboarding_completed_at AS snapshot_onboarding_completed_at,
      business.onboarding_step AS snapshot_onboarding_step,
      business.partner_id AS snapshot_partner_id,
      partner.name AS snapshot_partner_name,
      partner.slug AS snapshot_partner_slug,
      business.billing_mode AS snapshot_billing_mode,
      business.partner_plan AS snapshot_partner_plan,
      business.billing_pilot AS snapshot_billing_pilot,
      business.billing_comped AS snapshot_billing_comped,
      business.billing_exempt AS snapshot_billing_exempt,
      business.telnyx_submission_disabled
        AS snapshot_telnyx_submission_disabled,
      business.sms_overage_opt_in AS snapshot_sms_overage_opt_in,
      subscription.plan AS snapshot_subscription_plan,
      subscription.status AS snapshot_subscription_status,
      subscription.cancel_at_period_end
        AS snapshot_subscription_cancel_at_period_end,
      CASE
        WHEN subscription.id IS NOT NULL THEN subscription.plan
        WHEN business.billing_mode IN ('invoiced', 'comped')
          THEN business.partner_plan
        WHEN business.billing_mode = 'stripe'
             AND business.partner_plan IS NULL
             AND (
               business.billing_pilot
               OR business.billing_comped
               OR business.billing_exempt
             )
          THEN 'full'::text
        ELSE NULL
      END AS snapshot_effective_plan,
      usage.period_start AS snapshot_usage_period_start,
      usage.period_end AS snapshot_usage_period_end,
      usage.included_sms_parts AS snapshot_usage_included_sms_parts,
      usage.inbound_sms_parts AS snapshot_usage_inbound_sms_parts,
      usage.outbound_sms_parts AS snapshot_usage_outbound_sms_parts,
      usage.inbound_mms_events AS snapshot_usage_inbound_mms_events,
      usage.outbound_mms_events AS snapshot_usage_outbound_mms_events,
      business.a2p_risk_review_status
        AS snapshot_a2p_risk_review_status,
      business.a2p_risk_review_message
        AS snapshot_a2p_risk_review_message,
      business.onboarding_registration_status
        AS snapshot_onboarding_registration_status,
      business.onboarding_registration_started_at
        AS snapshot_onboarding_registration_started_at,
      business.brand_status AS snapshot_brand_status,
      business.campaign_status AS snapshot_campaign_status,
      business.telnyx_messaging_profile_id
        AS snapshot_telnyx_messaging_profile_id,
      business.telnyx_campaign_id AS snapshot_telnyx_campaign_id,
      business.telnyx_messaging_profile_id IS NOT NULL
        AS snapshot_messaging_profile_configured,
      business.telnyx_campaign_id IS NOT NULL
        AS snapshot_campaign_configured,
      business.pending_phone_number IS NOT NULL
        AS snapshot_pending_phone_number_present,
      business.pending_phone_number_failure_reason IS NOT NULL
        AS snapshot_pending_phone_number_failed,
      phone.active_phone_count AS snapshot_active_phone_count,
      phone.active_phone_number AS snapshot_active_phone_number,
      phone.assignment_status AS snapshot_active_phone_assignment_status,
      phone.assignment_campaign_id
        AS snapshot_active_phone_assignment_campaign_id,
      COALESCE(phone.assignment_matches_campaign, false)
        AS snapshot_active_phone_assignment_matches_campaign,
      ai.id IS NOT NULL AS snapshot_ai_configured,
      ai.booking_enabled AS snapshot_ai_booking_enabled,
      ai.booking_mode AS snapshot_ai_booking_mode,
      COALESCE(widget.is_active, false) AS snapshot_web_chat_enabled,
      calendar_token.id IS NOT NULL AS snapshot_calendar_connected,
      provisioning.job_count AS snapshot_provisioning_job_count,
      provisioning.status AS snapshot_provisioning_status,
      activity.last_activity_at AS snapshot_last_activity_at,
      COALESCE(phone.any_assignment_failed, false)
        AS snapshot_phone_assignment_failed,
      COALESCE(provisioning.needs_attention, false)
        AS snapshot_provisioning_needs_attention,
      COALESCE(provisioning.invite_failed, false)
        AS snapshot_provisioning_invite_failed,
      COALESCE(provisioning.lease_expired, false)
        AS snapshot_provisioning_lease_expired
    FROM base_businesses AS business
    LEFT JOIN public.partners AS partner
      ON partner.id = business.partner_id
    LEFT JOIN public.subscriptions AS subscription
      ON subscription.business_id = business.id
    LEFT JOIN public.ai_settings AS ai
      ON ai.business_id = business.id
    LEFT JOIN public.widget_configs AS widget
      ON widget.business_id = business.id
    LEFT JOIN public.google_calendar_tokens AS calendar_token
      ON calendar_token.business_id = business.id
    LEFT JOIN LATERAL (
      SELECT
        period.period_start,
        period.period_end,
        period.included_sms_parts,
        period.inbound_sms_parts,
        period.outbound_sms_parts,
        period.inbound_mms_events,
        period.outbound_mms_events
      FROM public.billing_usage_periods AS period
      WHERE period.business_id = business.id
      ORDER BY period.period_start DESC
      LIMIT 1
    ) AS usage ON true
    CROSS JOIN LATERAL (
      SELECT
        count(*)::bigint AS active_phone_count,
        CASE WHEN count(*) = 1 THEN min(number.phone_number) END
          AS active_phone_number,
        CASE
          WHEN count(*) = 1
            THEN min(number.telnyx_campaign_assignment_status)
        END AS assignment_status,
        CASE
          WHEN count(*) = 1
            THEN min(number.telnyx_campaign_assignment_campaign_id)
        END AS assignment_campaign_id,
        CASE
          WHEN count(*) = 1 THEN bool_and(
            number.telnyx_campaign_assignment_status = 'assigned'
            AND business.telnyx_campaign_id IS NOT NULL
            AND number.telnyx_campaign_assignment_campaign_id =
                  business.telnyx_campaign_id
          )
          ELSE false
        END AS assignment_matches_campaign,
        COALESCE(
          bool_or(number.telnyx_campaign_assignment_status = 'failed'),
          false
        ) AS any_assignment_failed
      FROM public.phone_numbers AS number
      WHERE number.business_id = business.id
        AND number.is_active IS TRUE
    ) AS phone
    CROSS JOIN LATERAL (
      SELECT
        count(job.id)::bigint AS job_count,
        CASE WHEN count(job.id) = 1 THEN min(job.status) END AS status,
        COALESCE(bool_or(job.status = 'needs_attention'), false)
          AS needs_attention,
        COALESCE(
          bool_or(
            job.status = 'invite_pending'
            AND job.last_error_code IS NOT NULL
          ),
          false
        ) AS invite_failed,
        COALESCE(
          bool_or(
            job.operation_token IS NOT NULL
            AND job.operation_expires_at <= now()
          ),
          false
        ) AS lease_expired
      FROM public.partner_client_provisioning_jobs AS job
      WHERE job.business_id = business.id
        OR (
          job.business_id IS NULL
          AND job.auth_user_id = business.owner_id
        )
    ) AS provisioning
    CROSS JOIN LATERAL (
      SELECT max(source.activity_at) AS last_activity_at
      FROM (
        SELECT max(message.created_at) AS activity_at
        FROM public.messages AS message
        WHERE message.business_id = business.id

        UNION ALL

        SELECT max(conversation.last_message_at) AS activity_at
        FROM public.conversations AS conversation
        WHERE conversation.business_id = business.id
      ) AS source
    ) AS activity
  ),
  snapshots AS (
    SELECT
      raw.*,
      array_remove(
        ARRAY[
          CASE
            WHEN raw.snapshot_onboarding_registration_status = 'failed'
              THEN 'registration_failed'
          END,
          CASE
            WHEN raw.snapshot_onboarding_registration_status = 'submitting'
                 AND (
                   raw.snapshot_onboarding_registration_started_at IS NULL
                   OR raw.snapshot_onboarding_registration_started_at <=
                        now() - interval '15 minutes'
                 )
              THEN 'registration_submission_stale'
          END,
          CASE
            WHEN raw.snapshot_a2p_risk_review_status = 'blocked'
              THEN 'risk_review_blocked'
          END,
          CASE
            WHEN raw.snapshot_brand_status = 'rejected'
              THEN 'brand_rejected'
          END,
          CASE
            WHEN raw.snapshot_campaign_status = 'rejected'
              THEN 'campaign_rejected'
          END,
          CASE
            WHEN raw.snapshot_phone_assignment_failed
              THEN 'phone_assignment_failed'
          END,
          CASE
            WHEN raw.snapshot_pending_phone_number_failed
              THEN 'pending_phone_failed'
          END,
          CASE
            WHEN raw.snapshot_provisioning_needs_attention
              THEN 'provisioning_needs_attention'
          END,
          CASE
            WHEN raw.snapshot_provisioning_invite_failed
              THEN 'provisioning_invite_failed'
          END,
          CASE
            WHEN raw.snapshot_provisioning_lease_expired
              THEN 'provisioning_lease_expired'
          END
        ]::text[],
        NULL
      ) AS snapshot_failed_setup_reasons
    FROM raw_snapshots AS raw
  ),
  filtered_snapshots AS (
    SELECT snapshot.*
    FROM snapshots AS snapshot
    WHERE (
      p_plan IS NULL
      OR snapshot.snapshot_effective_plan = p_plan
    )
      AND (
        p_lifecycle IS NULL
        OR (
          p_lifecycle = 'live'
          AND snapshot.snapshot_deleted_at IS NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NULL
          AND snapshot.snapshot_onboarding_completed_at IS NOT NULL
        )
        OR (
          p_lifecycle = 'onboarding'
          AND snapshot.snapshot_deleted_at IS NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NULL
          AND snapshot.snapshot_onboarding_completed_at IS NULL
        )
        OR (
          p_lifecycle = 'past_due'
          AND snapshot.snapshot_subscription_status = 'past_due'
        )
        OR (
          p_lifecycle = 'pending_deletion'
          AND snapshot.snapshot_deleted_at IS NOT NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NOT NULL
        )
        OR (
          p_lifecycle = 'failed_setup'
          AND cardinality(snapshot.snapshot_failed_setup_reasons) > 0
        )
        OR (
          p_lifecycle = 'suspended'
          AND snapshot.snapshot_operations_suspended_at IS NOT NULL
          AND snapshot.snapshot_deleted_at IS NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NULL
        )
      )
  )
  SELECT
    snapshot.snapshot_business_id,
    snapshot.snapshot_business_name,
    snapshot.snapshot_business_email,
    snapshot.snapshot_website_url,
    snapshot.snapshot_business_type,
    snapshot.snapshot_business_created_at,
    snapshot.snapshot_snapshot_at,
    snapshot.snapshot_deleted_at,
    snapshot.snapshot_deletion_scheduled_for,
    snapshot.snapshot_onboarding_completed_at,
    snapshot.snapshot_onboarding_step,
    snapshot.snapshot_partner_id,
    snapshot.snapshot_partner_name,
    snapshot.snapshot_partner_slug,
    snapshot.snapshot_billing_mode,
    snapshot.snapshot_partner_plan,
    snapshot.snapshot_billing_pilot,
    snapshot.snapshot_billing_comped,
    snapshot.snapshot_billing_exempt,
    snapshot.snapshot_telnyx_submission_disabled,
    snapshot.snapshot_sms_overage_opt_in,
    snapshot.snapshot_subscription_plan,
    snapshot.snapshot_subscription_status,
    snapshot.snapshot_subscription_cancel_at_period_end,
    snapshot.snapshot_effective_plan,
    snapshot.snapshot_usage_period_start,
    snapshot.snapshot_usage_period_end,
    snapshot.snapshot_usage_included_sms_parts,
    snapshot.snapshot_usage_inbound_sms_parts,
    snapshot.snapshot_usage_outbound_sms_parts,
    snapshot.snapshot_usage_inbound_mms_events,
    snapshot.snapshot_usage_outbound_mms_events,
    snapshot.snapshot_a2p_risk_review_status,
    snapshot.snapshot_a2p_risk_review_message,
    snapshot.snapshot_onboarding_registration_status,
    snapshot.snapshot_onboarding_registration_started_at,
    snapshot.snapshot_brand_status,
    snapshot.snapshot_campaign_status,
    snapshot.snapshot_telnyx_messaging_profile_id,
    snapshot.snapshot_telnyx_campaign_id,
    snapshot.snapshot_messaging_profile_configured,
    snapshot.snapshot_campaign_configured,
    snapshot.snapshot_pending_phone_number_present,
    snapshot.snapshot_pending_phone_number_failed,
    snapshot.snapshot_active_phone_count,
    snapshot.snapshot_active_phone_number,
    snapshot.snapshot_active_phone_assignment_status,
    snapshot.snapshot_active_phone_assignment_campaign_id,
    snapshot.snapshot_active_phone_assignment_matches_campaign,
    snapshot.snapshot_phone_assignment_failed,
    snapshot.snapshot_ai_configured,
    snapshot.snapshot_ai_booking_enabled,
    snapshot.snapshot_ai_booking_mode,
    snapshot.snapshot_web_chat_enabled,
    snapshot.snapshot_calendar_connected,
    snapshot.snapshot_provisioning_job_count,
    snapshot.snapshot_provisioning_status,
    snapshot.snapshot_provisioning_needs_attention,
    snapshot.snapshot_provisioning_invite_failed,
    snapshot.snapshot_provisioning_lease_expired,
    cardinality(snapshot.snapshot_failed_setup_reasons) > 0,
    snapshot.snapshot_failed_setup_reasons,
    snapshot.snapshot_last_activity_at,
    snapshot.snapshot_operations_suspended_at,
    snapshot.snapshot_ai_replies_paused_at,
    snapshot.snapshot_texting_paused_at,
    snapshot.snapshot_bookings_paused_at
  FROM filtered_snapshots AS snapshot
  ORDER BY
    snapshot.snapshot_business_created_at DESC NULLS LAST,
    snapshot.snapshot_business_id DESC
  LIMIT 75;
END;
$function$;

COMMENT ON FUNCTION public.list_admin_business_health_v2(
  uuid, text, text, uuid, text, text
) IS
  'Versioned bounded administrator health snapshot that preserves migration 047, appends control timestamps, and filters non-deletion operational suspension before the cap.';

REVOKE ALL ON FUNCTION public.list_admin_business_health_v2(
  uuid, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_admin_business_health_v2(
  uuid, text, text, uuid, text, text
) TO service_role;

COMMIT;
