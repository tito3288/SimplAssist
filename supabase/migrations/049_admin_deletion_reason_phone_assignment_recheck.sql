BEGIN;

-- Phase 3 Slice 3: require a bounded administrator reason for every new
-- administrator-scheduled account deletion, while preserving pre-049 audit
-- rows that legitimately predate that field. Also record an actor-attributed
-- request before an administrator starts an external phone-assignment recheck.

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
      'account_service_resumed',
      'phone_assignment_recheck_requested'
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
        'account_service_resumed',
        'phone_assignment_recheck_requested'
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
          'resource_counts',
          'reason'
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
        AND (
          NOT summary ? 'reason'
          OR (
            jsonb_typeof(summary->'reason') = 'string'
            AND char_length(summary->>'reason') BETWEEN 8 AND 500
            AND summary->>'reason' = btrim(summary->>'reason')
            AND summary->>'reason' !~ '[[:cntrl:]]'
          )
        )
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

-- Existing deletion audit rows cannot be assigned an honest reason after the
-- fact. NOT VALID preserves those rows while enforcing this check for every
-- row inserted or updated after migration 049.
ALTER TABLE public.admin_action_events
  ADD CONSTRAINT admin_action_deletion_reason_required CHECK (
    action <> 'account_deletion_scheduled'
    OR summary ? 'reason'
  ) NOT VALID;

COMMENT ON CONSTRAINT admin_action_deletion_reason_required
  ON public.admin_action_events IS
  'Enforced for post-049 writes; intentionally NOT VALID because historical deletion audits predate typed reasons.';
COMMENT ON TABLE public.admin_action_events IS
  'Append-only administrator lifecycle, operational-control, and retry-request audit. Summaries are exact-key constrained and PII-lean.';
COMMENT ON COLUMN public.admin_action_events.summary IS
  'Strict action-specific payload: deletion snapshot with bounded reason for post-049 writes, bounded operational-control reason/service, or empty lifecycle/retry-request summary.';

-- A new required argument changes the PostgreSQL identity. Remove the old
-- callable rather than leaving a four-argument reasonless bypass.
DROP FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, uuid
);

CREATE FUNCTION public.schedule_admin_account_deletion(
  p_business_id uuid,
  p_confirmation_name text,
  p_acknowledge_live_resources boolean,
  p_reason text,
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
  IF p_reason IS NULL
     OR p_reason IS DISTINCT FROM btrim(p_reason)
     OR char_length(p_reason) NOT BETWEEN 8 AND 500
     OR p_reason ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'invalid_admin_action_reason'
      USING ERRCODE = '22023';
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
  v_summary :=
    public.account_deletion_audit_summary_json(p_business_id)
    || jsonb_build_object('reason', p_reason);

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

-- This RPC records only that an administrator requested a recheck. The
-- external Telnyx inspection/heal runs after this transaction commits and is
-- protected independently by the existing assignment claims.
CREATE FUNCTION public.request_admin_phone_assignment_recheck(
  p_business_id uuid,
  p_actor_admin_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_active_phone_count integer;
  v_eligible_phone_count integer;
  v_requested_at timestamptz;
  v_event_id uuid;
BEGIN
  IF p_actor_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'admin_user_required'
      USING ERRCODE = '22004';
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

  IF v_business.operations_suspended_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_operations_suspended'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_campaign_assignment_claim_token IS NOT NULL
     AND (
       v_business.telnyx_campaign_assignment_claimed_at IS NULL
       OR v_business.telnyx_campaign_assignment_claimed_at >
            clock_timestamp() - interval '60 seconds'
     ) THEN
    RAISE EXCEPTION 'phone_assignment_recheck_in_progress'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.brand_status IS DISTINCT FROM 'approved'
     OR v_business.campaign_status IS DISTINCT FROM 'approved'
     OR NULLIF(btrim(v_business.telnyx_brand_id), '') IS NULL
     OR NULLIF(btrim(v_business.telnyx_campaign_id), '') IS NULL
     OR NULLIF(btrim(v_business.telnyx_messaging_profile_id), '') IS NULL
     OR v_business.telnyx_unique_claims_released_at IS NOT NULL
     OR v_business.active_telnyx_release_run_id IS NOT NULL
     OR v_business.telnyx_submission_disabled IS NOT FALSE
     OR v_business.telnyx_resource_state IS NULL
     OR v_business.telnyx_resource_state NOT IN ('provisioning', 'active') THEN
    RAISE EXCEPTION 'phone_assignment_recheck_unavailable'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE phone.telnyx_campaign_assignment_status = 'failed'
         OR (
           phone.telnyx_campaign_assignment_status = 'pending'
           AND (
             phone.telnyx_campaign_assignment_updated_at IS NULL
             OR phone.telnyx_campaign_assignment_updated_at <=
                  clock_timestamp() - interval '60 seconds'
           )
         )
    )::integer
  INTO v_active_phone_count, v_eligible_phone_count
  FROM public.phone_numbers AS phone
  WHERE phone.business_id = p_business_id
    AND phone.is_active IS TRUE
    AND phone.resource_status = 'active';

  IF v_active_phone_count <> 1 OR v_eligible_phone_count <> 1 THEN
    RAISE EXCEPTION 'phone_assignment_recheck_not_needed'
      USING ERRCODE = '55000';
  END IF;

  v_requested_at := clock_timestamp();

  INSERT INTO public.admin_action_events (
    actor_admin_user_id,
    action,
    business_id,
    summary,
    created_at
  ) VALUES (
    p_actor_admin_user_id,
    'phone_assignment_recheck_requested',
    p_business_id,
    '{}'::jsonb,
    v_requested_at
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'admin_event_id', v_event_id,
    'requested_at', v_requested_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, text, uuid
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.request_admin_phone_assignment_recheck(
  uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, text, uuid
) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_admin_phone_assignment_recheck(
  uuid, uuid
) TO service_role;

COMMENT ON FUNCTION public.schedule_admin_account_deletion(
  uuid, text, boolean, text, uuid
) IS
  'Atomically validates exact-name/live-resource confirmation and a bounded reason, schedules the existing 60-day lifecycle, and inserts one PII-lean audit event.';
COMMENT ON FUNCTION public.request_admin_phone_assignment_recheck(
  uuid, uuid
) IS
  'Service-role-only eligibility check and actor audit for a requested phone-assignment recheck; external Telnyx work starts only after commit.';

COMMIT;
