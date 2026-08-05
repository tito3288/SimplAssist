BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(43);

-- ---------------------------------------------------------------------------
-- Catalog, exact audit shapes, and function boundaries
-- ---------------------------------------------------------------------------

-- 1
SELECT ok(
  pg_get_constraintdef(
    (
      SELECT constraint_row.oid
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
        AND constraint_row.conname = 'admin_action_events_action_check'
    )
  ) LIKE '%phone_assignment_recheck_requested%',
  'the admin audit action contract includes phone assignment recheck requests'
);

-- 2
SELECT ok(
  pg_get_constraintdef(
    (
      SELECT constraint_row.oid
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
        AND constraint_row.conname = 'admin_action_target_shape'
    )
  ) LIKE ALL (ARRAY[
    '%phone_assignment_recheck_requested%',
    '%business_id IS NOT NULL%',
    '%provisioning_job_id IS NULL%',
    '%deletion_scheduled_for IS NULL%'
  ]),
  'phone assignment recheck audits use the exact business-only target shape'
);

-- 3
SELECT ok(
  (
    SELECT constraint_row.convalidated
       AND pg_get_constraintdef(constraint_row.oid) LIKE ALL (ARRAY[
         '%reason%',
         '%char_length%',
         '%500%',
         '%resource_counts%'
       ])
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
      AND constraint_row.conname = 'admin_action_summary_shape'
  ),
  'the validated summary shape accepts only bounded deletion reasons beside the original snapshot'
);

-- 4
SELECT is(
  (
    SELECT constraint_row.convalidated
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
      AND constraint_row.conname = 'admin_action_deletion_reason_required'
  ),
  false,
  'the deletion-reason presence check intentionally does not validate historical rows'
);

-- 5
SELECT ok(
  to_regprocedure(
    'public.schedule_admin_account_deletion(uuid,text,boolean,uuid)'
  ) IS NULL
  AND to_regprocedure(
    'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.request_admin_phone_assignment_recheck(uuid,uuid)'
  ) IS NOT NULL,
  'the old deletion RPC is removed and both Slice 3 RPC identities exist'
);

-- 6
SELECT ok(
  pg_get_function_result(
    'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)'::regprocedure
  ) = 'jsonb'
  AND pg_get_function_result(
    'public.request_admin_phone_assignment_recheck(uuid,uuid)'::regprocedure
  ) = 'jsonb',
  'both Slice 3 administrator RPCs return jsonb'
);

-- 7
SELECT ok(
  (
    SELECT count(*) = 2
       AND bool_and(NOT procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)'::regprocedure,
      'public.request_admin_phone_assignment_recheck(uuid,uuid)'::regprocedure
    ])
  )
  AND has_function_privilege(
    'service_role',
    'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.request_admin_phone_assignment_recheck(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.request_admin_phone_assignment_recheck(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.request_admin_phone_assignment_recheck(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS privilege
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.schedule_admin_account_deletion(uuid,text,boolean,text,uuid)'::regprocedure,
      'public.request_admin_phone_assignment_recheck(uuid,uuid)'::regprocedure
    ])
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'Slice 3 RPCs are fixed-path SECURITY INVOKER functions for service_role only'
);

-- 8
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'schedule_admin_account_deletion',
        'request_admin_phone_assignment_recheck'
      )
      AND procedure_row.pronargdefaults = 0
  ),
  2,
  'the two exact administrator RPCs expose no default-argument bypass'
);

-- ---------------------------------------------------------------------------
-- Historical deletion-audit compatibility and future enforcement
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE audit_049_legacy_summary AS
SELECT jsonb_build_object(
  'business_id', '10000000-0000-4000-a049-000000000091',
  'business_name', 'Historical Deletion 049',
  'billing_mode', 'stripe',
  'partner_slug', NULL,
  'resource_counts', jsonb_build_object(
    'auth_users', 1,
    'provisioning_jobs', 0,
    'assigned_phone_rows', 0,
    'google_calendar_token_rows', 0,
    'configuration_rows', 0,
    'contact_rows_to_scrub', 0,
    'message_rows_to_scrub', 0
  )
) AS summary;

-- Simulate a row written before migration 049, then repeat only the
-- grandfathering step inside this rolled-back test transaction.
ALTER TABLE public.admin_action_events
  DROP CONSTRAINT admin_action_deletion_reason_required;

INSERT INTO public.admin_action_events (
  actor_admin_user_id,
  action,
  business_id,
  deletion_scheduled_for,
  summary
)
SELECT
  '90000000-0000-4000-a049-000000000091',
  'account_deletion_scheduled',
  '10000000-0000-4000-a049-000000000091',
  '2049-03-01 00:00:00+00',
  summary
FROM audit_049_legacy_summary;

ALTER TABLE public.admin_action_events
  ADD CONSTRAINT admin_action_deletion_reason_required CHECK (
    action <> 'account_deletion_scheduled'
    OR summary ? 'reason'
  ) NOT VALID;

-- 9
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a049-000000000091'
      AND action = 'account_deletion_scheduled'
      AND NOT summary ? 'reason'
  )
  AND (
    SELECT NOT constraint_row.convalidated
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
      AND constraint_row.conname = 'admin_action_deletion_reason_required'
  ),
  'the NOT VALID contract preserves a valid historical reasonless deletion audit'
);

-- 10
SELECT throws_ok(
  $$
    ALTER TABLE public.admin_action_events
      VALIDATE CONSTRAINT admin_action_deletion_reason_required
  $$,
  '23514',
  NULL,
  'the historical fixture prevents dishonest validation of the reason-presence check'
);

-- 11
SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      deletion_scheduled_for,
      summary
    )
    SELECT
      '90000000-0000-4000-a049-000000000092',
      'account_deletion_scheduled',
      '10000000-0000-4000-a049-000000000092',
      '2049-03-02 00:00:00+00',
      jsonb_set(
        summary,
        '{business_id}',
        to_jsonb('10000000-0000-4000-a049-000000000092'::text)
      )
    FROM audit_049_legacy_summary
  $$,
  '23514',
  NULL,
  'future deletion audit inserts cannot omit the administrator reason'
);

-- 12
SELECT lives_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      deletion_scheduled_for,
      summary
    )
    SELECT
      '90000000-0000-4000-a049-000000000092',
      'account_deletion_scheduled',
      '10000000-0000-4000-a049-000000000092',
      '2049-03-02 00:00:00+00',
      jsonb_set(
        jsonb_set(
          summary,
          '{business_id}',
          to_jsonb('10000000-0000-4000-a049-000000000092'::text)
        ),
        '{reason}',
        to_jsonb('Requested partner offboarding'::text)
      )
    FROM audit_049_legacy_summary
  $$,
  'future deletion audit inserts accept the exact bounded reason shape'
);

-- 13
SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      deletion_scheduled_for,
      summary
    )
    SELECT
      '90000000-0000-4000-a049-000000000093',
      'account_deletion_scheduled',
      '10000000-0000-4000-a049-000000000093',
      '2049-03-03 00:00:00+00',
      jsonb_set(
        jsonb_set(
          summary,
          '{business_id}',
          to_jsonb('10000000-0000-4000-a049-000000000093'::text)
        ),
        '{reason}',
        to_jsonb(' padded deletion reason '::text)
      )
    FROM audit_049_legacy_summary
  $$,
  '23514',
  NULL,
  'deletion audit rejects a noncanonical padded reason'
);

-- 14
SELECT lives_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a049-000000000094',
      'phone_assignment_recheck_requested',
      '10000000-0000-4000-a049-000000000094',
      '{}'::jsonb
    )
  $$,
  'phone assignment recheck requests accept the exact actor-only summary'
);

-- 15
SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a049-000000000095',
      'phone_assignment_recheck_requested',
      '10000000-0000-4000-a049-000000000095',
      '{"reason":"not approved"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'phone assignment recheck audit rejects every nonempty summary'
);

-- 16
SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      provisioning_job_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a049-000000000096',
      'phone_assignment_recheck_requested',
      '30000000-0000-4000-a049-000000000096',
      '{}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'phone assignment recheck audit cannot target a provisioning job'
);

-- ---------------------------------------------------------------------------
-- Isolated business fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a049-000000000001',
    'deletion-reason-a049@example.test'
  ),
  (
    '00000000-0000-4000-a049-000000000002',
    'assignment-recheck-a049@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a049-000000000001',
    name = 'Deletion Reason 049',
    slug = 'deletion-reason-049'
WHERE owner_id = '00000000-0000-4000-a049-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a049-000000000002',
    name = 'Assignment Recheck 049',
    slug = 'assignment-recheck-049',
    telnyx_brand_id = '49000000-0000-4000-a000-000000000001',
    telnyx_campaign_id = 'CRECHECK049',
    telnyx_messaging_profile_id =
      '49000000-0000-4000-a100-000000000001',
    brand_status = 'approved',
    campaign_status = 'approved',
    telnyx_resource_state = 'active',
    telnyx_submission_disabled = false
WHERE owner_id = '00000000-0000-4000-a049-000000000002';

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status,
  telnyx_campaign_assignment_status,
  telnyx_campaign_assignment_campaign_id,
  telnyx_campaign_assignment_failure_reason,
  telnyx_campaign_assignment_updated_at
) VALUES (
  '20000000-0000-4000-a049-000000000001',
  '10000000-0000-4000-a049-000000000002',
  '+13175550491',
  '49000000-0000-4000-a200-000000000001',
  true,
  'active',
  'failed',
  'CRECHECK049',
  'Telnyx assignment failed',
  clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- Required deletion reason and atomic audit
-- ---------------------------------------------------------------------------

-- 17
SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a049-000000000001',
      'Deletion Reason 049',
      false,
      NULL,
      '90000000-0000-4000-a049-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'administrator deletion rejects a null reason'
);

-- 18
SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a049-000000000001',
      'Deletion Reason 049',
      false,
      'short',
      '90000000-0000-4000-a049-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'administrator deletion rejects a short reason'
);

-- 19
SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a049-000000000001',
      'Deletion Reason 049',
      false,
      ' padded administrator reason ',
      '90000000-0000-4000-a049-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'administrator deletion rejects a padded reason'
);

-- 20
SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a049-000000000001',
      'Deletion Reason 049',
      false,
      E'administrator\nreason',
      '90000000-0000-4000-a049-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'administrator deletion rejects reason control characters'
);

-- 21
SELECT ok(
  (
    SELECT deleted_at IS NULL AND deletion_scheduled_for IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a049-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a049-000000000001'
  ),
  'invalid deletion reasons leave both lifecycle state and audit history untouched'
);

CREATE TEMP TABLE deletion_049_scheduled AS
SELECT public.schedule_admin_account_deletion(
  '10000000-0000-4000-a049-000000000001',
  'Deletion Reason 049',
  false,
  'Partner requested terminal offboarding',
  '90000000-0000-4000-a049-000000000001'
) AS result;

-- 22
SELECT ok(
  (
    SELECT (result->>'admin_event_created')::boolean
    FROM deletion_049_scheduled
  )
  AND (
    SELECT event.summary->>'reason' =
             'Partner requested terminal offboarding'
       AND event.actor_admin_user_id =
             '90000000-0000-4000-a049-000000000001'
       AND event.deletion_scheduled_for = business.deletion_scheduled_for
    FROM public.admin_action_events AS event
    JOIN public.businesses AS business
      ON business.id = event.business_id
    WHERE event.business_id = '10000000-0000-4000-a049-000000000001'
      AND event.action = 'account_deletion_scheduled'
  ),
  'valid administrator deletion stores the exact reason in the atomic audit event'
);

-- 23
SELECT ok(
  (
    SELECT NOT (result->>'admin_event_created')::boolean
       AND (result->>'previously_scheduled_by_admin')::boolean
    FROM (
      SELECT public.schedule_admin_account_deletion(
        '10000000-0000-4000-a049-000000000001',
        'Deletion Reason 049',
        false,
        'Different repeated deletion reason',
        '90000000-0000-4000-a049-000000000001'
      ) AS result
    ) AS repeated
  )
  AND (
    SELECT count(*) = 1
       AND min(summary->>'reason') =
             'Partner requested terminal offboarding'
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a049-000000000001'
      AND action = 'account_deletion_scheduled'
  ),
  'idempotent repeat scheduling neither duplicates nor rewrites the original reason'
);

-- ---------------------------------------------------------------------------
-- Phone-assignment recheck request eligibility and actor audit
-- ---------------------------------------------------------------------------

-- 24
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      NULL
    )
  $$,
  '22004',
  'admin_user_required',
  'phone assignment recheck requires an administrator actor'
);

-- 25
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000099',
      '90000000-0000-4000-a049-000000000002'
    )
  $$,
  'P0002',
  'business_not_found',
  'phone assignment recheck rejects a missing business'
);

CREATE TEMP TABLE recheck_049_first AS
SELECT public.request_admin_phone_assignment_recheck(
  '10000000-0000-4000-a049-000000000002',
  '90000000-0000-4000-a049-000000000002'
) AS result;

-- 26
SELECT ok(
  (
    SELECT result ?& ARRAY['business_id', 'admin_event_id', 'requested_at']
       AND result - ARRAY['business_id', 'admin_event_id', 'requested_at'] =
             '{}'::jsonb
       AND result->>'business_id' =
             '10000000-0000-4000-a049-000000000002'
    FROM recheck_049_first
  )
  AND (
    SELECT event.action = 'phone_assignment_recheck_requested'
       AND event.actor_admin_user_id =
             '90000000-0000-4000-a049-000000000002'
       AND event.summary = '{}'::jsonb
       AND event.created_at =
             (SELECT (result->>'requested_at')::timestamptz
              FROM recheck_049_first)
    FROM public.admin_action_events AS event
    WHERE event.id = (
      SELECT (result->>'admin_event_id')::uuid FROM recheck_049_first
    )
  ),
  'failed assignment recheck returns and stores the exact request audit'
);

-- 27
CREATE TEMP TABLE recheck_049_second AS
SELECT public.request_admin_phone_assignment_recheck(
  '10000000-0000-4000-a049-000000000002',
  '90000000-0000-4000-a049-000000000003'
) AS result;

SELECT ok(
  (
    SELECT result->>'admin_event_id' IS NOT NULL
    FROM recheck_049_second
  )
  AND (
    SELECT count(*) = 2
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a049-000000000002'
      AND action = 'phone_assignment_recheck_requested'
  ),
  'separate accepted administrator requests remain separate audit events'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_status = 'pending',
    telnyx_campaign_assignment_updated_at =
      clock_timestamp() - interval '60 seconds'
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 28
SELECT lives_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000004'
    )
  $$,
  'a pending assignment at least sixty seconds old is eligible for recheck'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_updated_at = NULL
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 29
SELECT lives_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000005'
    )
  $$,
  'a pending assignment without a recorded check time is eligible for recheck'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_updated_at = clock_timestamp()
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 30
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000006'
    )
  $$,
  '55000',
  'phone_assignment_recheck_not_needed',
  'a fresh pending assignment cannot be force-rechecked'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_status = 'unassigned',
    telnyx_campaign_assignment_updated_at = NULL
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 31
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000007'
    )
  $$,
  '55000',
  'phone_assignment_recheck_not_needed',
  'an unassigned phone is not an administrator recheck surface'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_status = 'assigned',
    telnyx_campaign_assignment_updated_at = clock_timestamp(),
    telnyx_campaign_assigned_at = clock_timestamp()
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 32
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000008'
    )
  $$,
  '55000',
  'phone_assignment_recheck_not_needed',
  'an already-assigned phone is not rechecked'
);

UPDATE public.phone_numbers
SET telnyx_campaign_assignment_status = 'failed',
    telnyx_campaign_assignment_failure_reason = 'Telnyx assignment failed',
    telnyx_campaign_assignment_updated_at = clock_timestamp(),
    telnyx_campaign_assigned_at = NULL
WHERE id = '20000000-0000-4000-a049-000000000001';

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status,
  telnyx_campaign_assignment_status,
  telnyx_campaign_assignment_campaign_id,
  telnyx_campaign_assignment_failure_reason,
  telnyx_campaign_assignment_updated_at
) VALUES (
  '20000000-0000-4000-a049-000000000002',
  '10000000-0000-4000-a049-000000000002',
  '+13175550492',
  '49000000-0000-4000-a200-000000000002',
  true,
  'active',
  'failed',
  'CRECHECK049',
  'Second active assignment failed',
  clock_timestamp()
);

-- 33
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000009'
    )
  $$,
  '55000',
  'phone_assignment_recheck_not_needed',
  'ambiguous multiple active phones cannot be rechecked by this action'
);

UPDATE public.phone_numbers
SET is_active = false
WHERE id = '20000000-0000-4000-a049-000000000002';

UPDATE public.phone_numbers
SET resource_status = 'parked'
WHERE id = '20000000-0000-4000-a049-000000000001';

-- 34
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000018'
    )
  $$,
  '55000',
  'phone_assignment_recheck_not_needed',
  'an active flag on a non-active phone resource is not eligible for recheck'
);

UPDATE public.phone_numbers
SET resource_status = 'active'
WHERE id = '20000000-0000-4000-a049-000000000001';

UPDATE public.businesses
SET operations_suspended_at = clock_timestamp()
WHERE id = '10000000-0000-4000-a049-000000000002';

-- 35
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000010'
    )
  $$,
  '55000',
  'account_operations_suspended',
  'operational suspension blocks phone assignment rechecks'
);

UPDATE public.businesses
SET operations_suspended_at = NULL
WHERE id = '10000000-0000-4000-a049-000000000002';

INSERT INTO public.businesses (
  id,
  name,
  email,
  business_type,
  slug,
  deleted_at,
  deletion_scheduled_for
) VALUES (
  '10000000-0000-4000-a049-000000000003',
  'Deleting Recheck 049',
  'deleting-recheck-a049@example.test',
  'general',
  'deleting-recheck-049',
  '2049-01-01 00:00:00+00',
  '2049-03-02 00:00:00+00'
);

-- 36
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000003',
      '90000000-0000-4000-a049-000000000011'
    )
  $$,
  '55000',
  'account_deletion_in_progress',
  'account deletion blocks phone assignment rechecks'
);

UPDATE public.businesses
SET telnyx_submission_disabled = true
WHERE id = '10000000-0000-4000-a049-000000000002';

-- 37
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000012'
    )
  $$,
  '55000',
  'phone_assignment_recheck_unavailable',
  'submission-disabled accounts cannot request assignment rechecks'
);

UPDATE public.businesses
SET telnyx_submission_disabled = false,
    brand_status = 'pending'
WHERE id = '10000000-0000-4000-a049-000000000002';

-- 38
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000013'
    )
  $$,
  '55000',
  'phone_assignment_recheck_unavailable',
  'unapproved registration cannot request assignment rechecks'
);

UPDATE public.businesses
SET brand_status = 'approved',
    telnyx_campaign_assignment_claim_token =
      '49000000-0000-4000-a049-000000000001',
    telnyx_campaign_assignment_claimed_at = clock_timestamp(),
    telnyx_campaign_assignment_claim_campaign_id = 'CRECHECK049',
    telnyx_campaign_assignment_claim_profile_id =
      '49000000-0000-4000-a100-000000000001'
WHERE id = '10000000-0000-4000-a049-000000000002';

-- 39
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000014'
    )
  $$,
  '55000',
  'phone_assignment_recheck_in_progress',
  'a fresh business assignment claim blocks a duplicate administrator recheck'
);

-- Build a stale-claim fixture without letting the database-clock trigger renew
-- it. Only this rolled-back fixture construction disables the trigger.
ALTER TABLE public.businesses
  DISABLE TRIGGER guard_business_campaign_assignment_claim_fields;
UPDATE public.businesses
SET telnyx_campaign_assignment_claimed_at =
      clock_timestamp() - interval '61 seconds'
WHERE id = '10000000-0000-4000-a049-000000000002';
ALTER TABLE public.businesses
  ENABLE TRIGGER guard_business_campaign_assignment_claim_fields;

-- 40
SELECT lives_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000015'
    )
  $$,
  'an expired business assignment claim does not permanently block recheck'
);

UPDATE public.businesses
SET telnyx_campaign_assignment_claim_token = NULL,
    telnyx_campaign_assignment_claimed_at = NULL,
    telnyx_campaign_assignment_claim_campaign_id = NULL,
    telnyx_campaign_assignment_claim_profile_id = NULL,
    telnyx_resource_state = 'parked'
WHERE id = '10000000-0000-4000-a049-000000000002';

-- 41
SELECT throws_ok(
  $$
    SELECT public.request_admin_phone_assignment_recheck(
      '10000000-0000-4000-a049-000000000002',
      '90000000-0000-4000-a049-000000000016'
    )
  $$,
  '55000',
  'phone_assignment_recheck_unavailable',
  'a parked Telnyx resource lifecycle blocks assignment recheck'
);

-- 42
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a049-000000000002'
      AND action = 'phone_assignment_recheck_requested'
  ),
  5,
  'rejected eligibility checks create no false administrator request audits'
);

-- 43
SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a049-000000000001',
      'Deletion Reason 049',
      false,
      repeat('a', 501),
      '90000000-0000-4000-a049-000000000017'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'administrator deletion rejects a reason longer than 500 characters'
);

SELECT * FROM finish();

ROLLBACK;
