BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(69);

-- ---------------------------------------------------------------------------
-- Catalog, authorization, and exact durable shapes
-- ---------------------------------------------------------------------------

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.businesses'::regclass
      AND attribute.attname IN (
        'operations_suspended_at',
        'ai_replies_paused_at',
        'texting_paused_at',
        'bookings_paused_at'
      )
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'operations_suspended_at', 'timestamp with time zone',
    'ai_replies_paused_at', 'timestamp with time zone',
    'texting_paused_at', 'timestamp with time zone',
    'bookings_paused_at', 'timestamp with time zone'
  ),
  'businesses store the four exact operational-control timestamp types'
);

SELECT ok(
  (
    SELECT count(*) = 4
       AND bool_and(NOT attribute.attnotnull)
       AND bool_and(default_value.oid IS NULL)
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.businesses'::regclass
      AND attribute.attname IN (
        'operations_suspended_at',
        'ai_replies_paused_at',
        'texting_paused_at',
        'bookings_paused_at'
      )
      AND NOT attribute.attisdropped
  ),
  'operational controls are nullable and have no defaults'
);

SELECT ok(
  pg_get_indexdef(
    'public.idx_businesses_admin_suspended_created_at'::regclass
  ) LIKE '%(created_at DESC NULLS LAST, id DESC)%'
  AND pg_get_indexdef(
    'public.idx_businesses_admin_suspended_created_at'::regclass
  ) LIKE '%operations_suspended_at IS NOT NULL%'
  AND pg_get_indexdef(
    'public.idx_businesses_admin_suspended_created_at'::regclass
  ) LIKE '%deleted_at IS NULL%'
  AND pg_get_indexdef(
    'public.idx_businesses_admin_suspended_created_at'::regclass
  ) LIKE '%deletion_scheduled_for IS NULL%',
  'the suspended-account index has exact non-deletion predicate and ordering'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_operational_control_fields',
  'businesses protect operational controls with a sibling trigger'
);

SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.guard_business_operational_control_fields()'::regprocedure
  )
  AND NOT has_function_privilege(
    'anon',
    'public.guard_business_operational_control_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.guard_business_operational_control_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_business_operational_control_fields()',
    'EXECUTE'
  ),
  'the operational-control trigger is uncallable SECURITY INVOKER code'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.admin_action_events'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  8,
  'admin action events remain the approved eight-column table'
);

SELECT ok(
  pg_get_constraintdef(
    (
      SELECT constraint_row.oid
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
        AND constraint_row.conname = 'admin_action_events_action_check'
    )
  ) LIKE ALL (ARRAY[
    '%account_operations_suspended%',
    '%account_operations_reactivated%',
    '%account_service_paused%',
    '%account_service_resumed%'
  ]),
  'the audit action check includes every operational transition'
);

SELECT ok(
  pg_get_constraintdef(
    (
      SELECT constraint_row.oid
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
        AND constraint_row.conname = 'admin_action_summary_shape'
    )
  ) LIKE ALL (ARRAY[
    '%ai_replies%',
    '%texting%',
    '%bookings%',
    '%char_length%',
    '%500%'
  ]),
  'audit summaries constrain service keys and bounded reasons in the database'
);

SELECT ok(
  to_regprocedure(
    'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)'
  ) IS NOT NULL,
  'both atomic administrator control RPCs have exact identities'
);

SELECT is(
  pg_get_function_result(
    'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)'::regprocedure
  ),
  'jsonb',
  'the suspension RPC returns one strict JSON snapshot'
);

SELECT is(
  pg_get_function_result(
    'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)'::regprocedure
  ),
  'jsonb',
  'the service-pause RPC returns one strict JSON snapshot'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)'::regprocedure,
      'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)'::regprocedure
    ])
  )
  AND has_function_privilege(
    'service_role',
    'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS privilege
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.set_admin_business_operations_suspension(uuid,boolean,text,uuid)'::regprocedure,
      'public.set_admin_business_service_pause(uuid,text,boolean,text,uuid)'::regprocedure
    ])
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'control RPCs are fixed-path SECURITY INVOKER functions for service_role only'
);

SELECT ok(
  (
    SELECT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)'::regprocedure
  )
  AND has_function_privilege(
    'service_role',
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
    'EXECUTE'
  ),
  'booking reservation retains its exact SECURITY DEFINER execution boundary'
);

SELECT ok(
  pg_get_functiondef(
    'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)'::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%operations_suspended_at IS NULL%',
    '%bookings_paused_at IS NULL%'
  ]),
  'booking reservation checks both operational gates under the business lock'
);

SELECT ok(
  to_regprocedure(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'
  ) IS NOT NULL,
  'the versioned health RPC retains the six-argument identity'
);

SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.provolatile = 's'
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'::regprocedure
  )
  AND has_function_privilege(
    'service_role',
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)',
    'EXECUTE'
  ),
  'health v2 is stable SECURITY INVOKER code executable only by service_role'
);

SELECT ok(
  pg_get_function_result(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'::regprocedure
  ) LIKE ALL (ARRAY[
    '%operations_suspended_at timestamp with time zone%',
    '%ai_replies_paused_at timestamp with time zone%',
    '%texting_paused_at timestamp with time zone%',
    '%bookings_paused_at timestamp with time zone%'
  ]),
  'health v2 appends all four exact operational-control timestamps'
);

SELECT ok(
  pg_get_functiondef(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'::regprocedure
  ) LIKE '%p_lifecycle = ''suspended''%snapshot_operations_suspended_at IS NOT NULL%'
  AND pg_get_functiondef(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'::regprocedure
  ) LIKE '%snapshot_deleted_at IS NULL%'
  AND pg_get_functiondef(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'::regprocedure
  ) LIKE '%snapshot_deletion_scheduled_for IS NULL%',
  'health v2 defines suspended as operationally suspended and not deleting'
);

-- ---------------------------------------------------------------------------
-- Fixtures and customer-write protection
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a048-000000000001',
  'service-controls-a048@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a048-000000000001',
    name = 'Service Controls 048',
    slug = 'service-controls-a048',
    created_at = '2048-01-01 00:00:00+00',
    onboarding_completed_at = '2048-01-01 00:00:00+00',
    onboarding_step = 'complete'
WHERE owner_id = '00000000-0000-4000-a048-000000000001';

INSERT INTO public.businesses (
  id,
  name,
  email,
  business_type,
  slug,
  created_at,
  deleted_at,
  deletion_scheduled_for,
  operations_suspended_at
) VALUES (
  '10000000-0000-4000-a048-000000000002',
  'Deleting Suspended Controls 048',
  'deleting-controls-a048@example.test',
  'general',
  'deleting-suspended-controls-a048',
  '2048-01-02 00:00:00+00',
  '2048-01-02 00:00:00+00',
  '2048-03-02 00:00:00+00',
  '2048-01-01 12:00:00+00'
);

INSERT INTO public.businesses (
  id,
  name,
  email,
  business_type,
  slug,
  created_at
) VALUES (
  '10000000-0000-4000-a048-000000000003',
  'Service Role Controls 048',
  'service-role-controls-a048@example.test',
  'general',
  'service-role-controls-a048',
  '2047-01-01 00:00:00+00'
);

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  stripe_price_id,
  setup_fee_paid_at
) VALUES (
  '10000000-0000-4000-a048-000000000001',
  'cus_controls_048',
  'sub_controls_048',
  'full',
  'active',
  'price_controls_048',
  now()
);

INSERT INTO public.account_deletion_stripe_actions (
  business_id,
  stripe_subscription_id,
  desired_action
) VALUES (
  '10000000-0000-4000-a048-000000000001',
  'sub_controls_048',
  'pause'
);

CREATE TEMP TABLE controls_048_billing_before AS
SELECT
  to_jsonb(subscription) AS subscription_snapshot,
  to_jsonb(stripe_action) AS stripe_action_snapshot,
  jsonb_build_object(
    'deleted_at', business.deleted_at,
    'deletion_scheduled_for', business.deletion_scheduled_for
  ) AS deletion_snapshot
FROM public.businesses AS business
JOIN public.subscriptions AS subscription
  ON subscription.business_id = business.id
JOIN public.account_deletion_stripe_actions AS stripe_action
  ON stripe_action.business_id = business.id
WHERE business.id = '10000000-0000-4000-a048-000000000001';

GRANT SELECT, INSERT, UPDATE ON TABLE public.businesses TO authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a048-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Service Controls 048 Renamed'
    WHERE id = '10000000-0000-4000-a048-000000000001'
  $$,
  'owners retain ordinary profile updates'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET operations_suspended_at = now(),
        ai_replies_paused_at = now(),
        texting_paused_at = now(),
        bookings_paused_at = now()
    WHERE id = '10000000-0000-4000-a048-000000000001'
  $$,
  '42501',
  'customer writes cannot change protected business operational controls',
  'owners cannot mutate any operational control'
);

SELECT throws_ok(
  $$
    INSERT INTO public.businesses (
      owner_id, name, business_type, slug, operations_suspended_at
    ) VALUES (
      '00000000-0000-4000-a048-000000000001',
      'Forged Service Control 048',
      'general',
      'forged-service-control-a048',
      now()
    )
  $$,
  '42501',
  'customer writes cannot set protected business operational controls',
  'owners cannot seed operational controls on insert'
);

RESET ROLE;

SET LOCAL ROLE service_role;

WITH call AS MATERIALIZED (
  SELECT public.set_admin_business_service_pause(
    '10000000-0000-4000-a048-000000000003',
    'bookings',
    true,
    NULL,
    '90000000-0000-4000-a048-000000000003'
  ) AS result
)
SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'admin_event_id' IS NOT NULL
       AND result->>'bookings_paused_at' IS NOT NULL
    FROM call
  ),
  'service_role can atomically update and audit through the invoker RPC'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Strict inputs, idempotency, independent controls, and exact audit
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_operations_suspension(
      '10000000-0000-4000-a048-000000000001', true, NULL,
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'account suspension requires a reason'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_operations_suspension(
      '10000000-0000-4000-a048-000000000001', true, 'short',
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'account reasons require at least eight characters'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_operations_suspension(
      '10000000-0000-4000-a048-000000000001', true,
      ' reason padded ',
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'account reasons must already be trimmed'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_operations_suspension(
      '10000000-0000-4000-a048-000000000001', true, repeat('x', 501),
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'account reasons reject more than five hundred characters'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_service_pause(
      '10000000-0000-4000-a048-000000000001', 'email', true, NULL,
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_service',
  'service controls reject unknown service keys'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_service_pause(
      '10000000-0000-4000-a048-000000000001', 'texting', true, 'short',
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'a supplied service reason follows the account reason bounds'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_service_pause(
      '10000000-0000-4000-a048-000000000001',
      'texting',
      true,
      E'valid line\nbreak',
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '22023',
  'invalid_admin_action_reason',
  'a supplied service reason rejects control characters'
);

SELECT ok(
  (
    SELECT NOT (result->>'changed')::boolean
       AND result->'admin_event_id' = 'null'::jsonb
    FROM (
      SELECT public.set_admin_business_operations_suspension(
        '10000000-0000-4000-a048-000000000001',
        false,
        'Already operational',
        '90000000-0000-4000-a048-000000000001'
      ) AS result
    ) AS call
  ),
  'an already-active account is an idempotent no-op with null event id'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000001'
  ),
  0,
  'a no-op creates no false audit event'
);

CREATE TEMP TABLE controls_048_suspend AS
SELECT public.set_admin_business_operations_suspension(
  '10000000-0000-4000-a048-000000000001',
  true,
  'Manual compliance suspension',
  '90000000-0000-4000-a048-000000000001'
) AS result;

SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'admin_event_id' IS NOT NULL
       AND result->>'operations_suspended_at' IS NOT NULL
    FROM controls_048_suspend
  ),
  'suspension returns changed state, event identity, and timestamp'
);

SELECT ok(
  (
    SELECT operations_suspended_at IS NOT NULL
       AND ai_replies_paused_at IS NULL
       AND texting_paused_at IS NULL
       AND bookings_paused_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000001'
  ),
  'global suspension leaves all independent service controls unchanged'
);

SELECT ok(
  (
    SELECT event.action = 'account_operations_suspended'
       AND event.actor_admin_user_id =
         '90000000-0000-4000-a048-000000000001'
       AND event.summary =
         '{"reason":"Manual compliance suspension"}'::jsonb
       AND event.created_at = business.operations_suspended_at
    FROM public.admin_action_events AS event
    JOIN public.businesses AS business
      ON business.id = event.business_id
    WHERE event.id = (
      SELECT (result->>'admin_event_id')::uuid FROM controls_048_suspend
    )
  ),
  'suspension state and its exact actor/reason audit share one timestamp'
);

SELECT ok(
  (
    SELECT NOT (result->>'changed')::boolean
       AND result->'admin_event_id' = 'null'::jsonb
    FROM (
      SELECT public.set_admin_business_operations_suspension(
        '10000000-0000-4000-a048-000000000001',
        true,
        'Duplicate suspension request',
        '90000000-0000-4000-a048-000000000001'
      ) AS result
    ) AS call
  ),
  'a repeated suspension is an idempotent no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000001'
      AND action = 'account_operations_suspended'
  ),
  1,
  'a repeated suspension creates no duplicate audit event'
);

CREATE TEMP TABLE controls_048_ai_pause AS
SELECT public.set_admin_business_service_pause(
  '10000000-0000-4000-a048-000000000001',
  'ai_replies',
  true,
  NULL,
  '90000000-0000-4000-a048-000000000001'
) AS result;

SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'ai_replies_paused_at' IS NOT NULL
    FROM controls_048_ai_pause
  )
  AND (
    SELECT summary = '{"service":"ai_replies"}'::jsonb
    FROM public.admin_action_events
    WHERE id = (
      SELECT (result->>'admin_event_id')::uuid FROM controls_048_ai_pause
    )
  ),
  'AI replies can pause with the exact reason-omitted audit shape'
);

CREATE TEMP TABLE controls_048_text_pause AS
SELECT public.set_admin_business_service_pause(
  '10000000-0000-4000-a048-000000000001',
  'texting',
  true,
  'Carrier abuse review',
  '90000000-0000-4000-a048-000000000001'
) AS result;

SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'texting_paused_at' IS NOT NULL
    FROM controls_048_text_pause
  )
  AND (
    SELECT summary = jsonb_build_object(
      'service', 'texting', 'reason', 'Carrier abuse review'
    )
    FROM public.admin_action_events
    WHERE id = (
      SELECT (result->>'admin_event_id')::uuid FROM controls_048_text_pause
    )
  ),
  'texting can pause with the exact optional-reason audit shape'
);

SELECT ok(
  (
    SELECT NOT (result->>'changed')::boolean
       AND result->'admin_event_id' = 'null'::jsonb
       AND result ?& ARRAY[
         'business_id',
         'changed',
         'admin_event_id',
         'operations_suspended_at',
         'ai_replies_paused_at',
         'texting_paused_at',
         'bookings_paused_at'
       ]
       AND result - ARRAY[
         'business_id',
         'changed',
         'admin_event_id',
         'operations_suspended_at',
         'ai_replies_paused_at',
         'texting_paused_at',
         'bookings_paused_at'
       ] = '{}'::jsonb
       AND result->>'operations_suspended_at' IS NOT NULL
       AND result->>'ai_replies_paused_at' = (
         SELECT paused.result->>'ai_replies_paused_at'
         FROM controls_048_ai_pause AS paused
       )
       AND result->>'texting_paused_at' = (
         SELECT paused.result->>'texting_paused_at'
         FROM controls_048_text_pause AS paused
       )
       AND result->'bookings_paused_at' = 'null'::jsonb
    FROM (
      SELECT public.set_admin_business_service_pause(
        '10000000-0000-4000-a048-000000000001',
        'texting',
        true,
        'Duplicate texting pause',
        '90000000-0000-4000-a048-000000000001'
      ) AS result
    ) AS call
  ),
  'a repeated service pause is an unchanged complete-snapshot no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000001'
      AND action = 'account_service_paused'
      AND summary->>'service' = 'texting'
  ),
  1,
  'a repeated service pause creates no duplicate audit event'
);

CREATE TEMP TABLE controls_048_reactivate AS
SELECT public.set_admin_business_operations_suspension(
  '10000000-0000-4000-a048-000000000001',
  false,
  'Compliance review completed',
  '90000000-0000-4000-a048-000000000001'
) AS result;

SELECT ok(
  (
    SELECT operations_suspended_at IS NULL
       AND ai_replies_paused_at IS NOT NULL
       AND texting_paused_at IS NOT NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000001'
  ),
  'reactivation preserves independently paused services'
);

SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'operations_suspended_at' IS NULL
       AND result->>'ai_replies_paused_at' IS NOT NULL
       AND result->>'texting_paused_at' IS NOT NULL
    FROM controls_048_reactivate
  ),
  'reactivation returns the complete preserved service snapshot'
);

SELECT ok(
  (
    SELECT event.action = 'account_operations_reactivated'
       AND event.summary =
         '{"reason":"Compliance review completed"}'::jsonb
       AND event.actor_admin_user_id =
         '90000000-0000-4000-a048-000000000001'
    FROM public.admin_action_events AS event
    WHERE event.id = (
      SELECT (result->>'admin_event_id')::uuid
      FROM controls_048_reactivate
    )
  ),
  'reactivation writes its exact action, actor, and reason summary'
);

CREATE TEMP TABLE controls_048_ai_resume AS
SELECT public.set_admin_business_service_pause(
  '10000000-0000-4000-a048-000000000001',
  'ai_replies',
  false,
  NULL,
  '90000000-0000-4000-a048-000000000001'
) AS result;

SELECT ok(
  (
    SELECT (result->>'changed')::boolean
       AND result->>'ai_replies_paused_at' IS NULL
       AND result->>'texting_paused_at' IS NOT NULL
    FROM controls_048_ai_resume
  ),
  'resuming AI replies does not resume texting'
);

SELECT ok(
  (
    SELECT NOT (result->>'changed')::boolean
       AND result->'admin_event_id' = 'null'::jsonb
       AND result ?& ARRAY[
         'business_id',
         'changed',
         'admin_event_id',
         'operations_suspended_at',
         'ai_replies_paused_at',
         'texting_paused_at',
         'bookings_paused_at'
       ]
       AND result - ARRAY[
         'business_id',
         'changed',
         'admin_event_id',
         'operations_suspended_at',
         'ai_replies_paused_at',
         'texting_paused_at',
         'bookings_paused_at'
       ] = '{}'::jsonb
       AND result->'operations_suspended_at' = 'null'::jsonb
       AND result->'ai_replies_paused_at' = 'null'::jsonb
       AND result->>'texting_paused_at' = (
         SELECT resumed.result->>'texting_paused_at'
         FROM controls_048_ai_resume AS resumed
       )
       AND result->'bookings_paused_at' = 'null'::jsonb
    FROM (
      SELECT public.set_admin_business_service_pause(
        '10000000-0000-4000-a048-000000000001',
        'ai_replies',
        false,
        NULL,
        '90000000-0000-4000-a048-000000000001'
      ) AS result
    ) AS call
  ),
  'an already-resumed service is an unchanged complete-snapshot no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000001'
      AND action = 'account_service_resumed'
      AND summary = '{"service":"ai_replies"}'::jsonb
  ),
  1,
  'an already-resumed service creates no duplicate audit event'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id, action, business_id, summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_operations_suspended',
      '10000000-0000-4000-a048-000000000001',
      '{}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'account operational audit requires a reason'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id, action, business_id, summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_service_paused',
      '10000000-0000-4000-a048-000000000001',
      '{"service":"texting","reason":null}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'service audit rejects an explicit null reason instead of treating it as absent'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id, action, business_id, summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_service_paused',
      '10000000-0000-4000-a048-000000000001',
      '{"service":"email"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'service audit rejects unknown service keys'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id, action, business_id, summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_service_paused',
      '10000000-0000-4000-a048-000000000001',
      '{"service":"bookings","extra":"forbidden"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'service audit rejects every unapproved summary key'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      provisioning_job_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_service_paused',
      '10000000-0000-4000-a048-000000000001',
      '80000000-0000-4000-a048-000000000001',
      '{"service":"bookings"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'an operational audit cannot also target a provisioning job'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      deletion_scheduled_for,
      summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_operations_suspended',
      '10000000-0000-4000-a048-000000000001',
      now() + interval '60 days',
      '{"reason":"Valid operational reason"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'an operational audit cannot carry a deletion deadline'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id, action, summary
    ) VALUES (
      '90000000-0000-4000-a048-000000000001',
      'account_service_resumed',
      '{"service":"texting"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'an operational audit requires its business target'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_operations_suspension(
      '10000000-0000-4000-a048-000000000002',
      false,
      'Deletion state is separate',
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '55000',
  'account_deletion_in_progress',
  'operational reactivation rejects a deleting account'
);

SELECT throws_ok(
  $$
    SELECT public.set_admin_business_service_pause(
      '10000000-0000-4000-a048-000000000002',
      'bookings',
      true,
      NULL,
      '90000000-0000-4000-a048-000000000001'
    )
  $$,
  '55000',
  'account_deletion_in_progress',
  'service controls reject a deleting account'
);

SELECT ok(
  (
    SELECT deleted_at = '2048-01-02 00:00:00+00'::timestamptz
       AND deletion_scheduled_for = '2048-03-02 00:00:00+00'::timestamptz
       AND operations_suspended_at = '2048-01-01 12:00:00+00'::timestamptz
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000002'
  ),
  'rejected controls do not touch deletion or operational state'
);

-- ---------------------------------------------------------------------------
-- Health pre-cap filtering and locked booking execution boundary
-- ---------------------------------------------------------------------------

SELECT public.set_admin_business_service_pause(
  '10000000-0000-4000-a048-000000000001',
  'bookings',
  true,
  NULL,
  '90000000-0000-4000-a048-000000000001'
);

SELECT public.set_admin_business_operations_suspension(
  '10000000-0000-4000-a048-000000000001',
  true,
  'Temporary operations hold',
  '90000000-0000-4000-a048-000000000001'
);

INSERT INTO public.businesses (
  id, name, email, business_type, slug, created_at
)
SELECT
  ('a0000000-0000-4000-a048-' || lpad(series.value::text, 12, '0'))::uuid,
  'Newer Unsuspended 048 ' || series.value::text,
  'newer-unsuspended-' || series.value::text || '-a048@example.test',
  'general',
  'newer-unsuspended-a048-' || series.value::text,
  '2049-01-01 00:00:00+00'::timestamptz
    + series.value * interval '1 day'
FROM generate_series(1, 76) AS series(value);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a048-000000000001',
      p_lifecycle => 'live'
    )
  ),
  1,
  'the migration-047 health RPC remains compatible and callable'
);

SELECT is(
  (
    SELECT to_jsonb(health_v2) - ARRAY[
      'operations_suspended_at',
      'ai_replies_paused_at',
      'texting_paused_at',
      'bookings_paused_at'
    ]
    FROM public.list_admin_business_health_v2(
      p_business_id => '10000000-0000-4000-a048-000000000001',
      p_lifecycle => 'live',
      p_ownership => 'direct',
      p_partner => '70000000-0000-4000-a048-000000000001',
      p_plan => 'full',
      p_query => 'Service Controls 048 Renamed'
    ) AS health_v2
  ),
  (
    SELECT to_jsonb(health_v1)
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a048-000000000001',
      p_lifecycle => 'live',
      p_ownership => 'direct',
      p_partner => '70000000-0000-4000-a048-000000000001',
      p_plan => 'full',
      p_query => 'Service Controls 048 Renamed'
    ) AS health_v1
  ),
  'health v2 preserves the complete v1 row under identical combined filters'
);

SELECT is(
  (SELECT count(*)::integer FROM public.list_admin_business_health_v2()),
  75,
  'health v2 retains the unfiltered seventy-five-row cap'
);

SELECT is(
  (
    SELECT business_id
    FROM public.list_admin_business_health_v2()
    LIMIT 1
  ),
  'a0000000-0000-4000-a048-000000000076'::uuid,
  'health v2 orders the newest created business first'
);

SELECT is(
  (
    SELECT business_id
    FROM public.list_admin_business_health_v2()
    OFFSET 74
    LIMIT 1
  ),
  'a0000000-0000-4000-a048-000000000002'::uuid,
  'health v2 uses deterministic descending order through the cap boundary'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.list_admin_business_health_v2(
      p_lifecycle => 'suspended'
    )
  ),
  1,
  'suspended filtering runs before the seventy-five-row cap'
);

SELECT ok(
  (
    SELECT business_id = '10000000-0000-4000-a048-000000000001'
       AND operations_suspended_at IS NOT NULL
       AND ai_replies_paused_at IS NULL
       AND texting_paused_at IS NOT NULL
       AND bookings_paused_at IS NOT NULL
    FROM public.list_admin_business_health_v2(
      p_lifecycle => 'suspended'
    )
  ),
  'health v2 returns the complete operational snapshot for the live suspended account'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.list_admin_business_health_v2(
      p_lifecycle => 'suspended'
    )
    WHERE business_id = '10000000-0000-4000-a048-000000000002'
  ),
  'the suspended filter excludes deletion-scheduled accounts'
);

INSERT INTO public.google_calendar_tokens (
  id,
  business_id,
  access_token,
  refresh_token,
  token_expiry,
  calendar_id,
  google_email,
  created_at,
  updated_at
) VALUES (
  '62000000-0000-4000-a048-000000000001',
  '10000000-0000-4000-a048-000000000001',
  'fixture-access-a048-1',
  'fixture-refresh-a048-1',
  '2099-01-01 00:00:00+00',
  'primary',
  'service-controls-a048@example.test',
  '2048-01-01 00:00:00+00',
  '2048-01-01 00:00:00+00'
);

INSERT INTO public.contacts (
  id, business_id, name, phone_number, source_channel, lead_score
) VALUES (
  '20000000-0000-4000-a048-000000000001',
  '10000000-0000-4000-a048-000000000001',
  'Booking Gate Contact 048',
  '+13175550481',
  'sms',
  0
);

INSERT INTO public.conversations (
  id, business_id, contact_id, channel, status, is_ai_handling
) VALUES (
  '30000000-0000-4000-a048-000000000001',
  '10000000-0000-4000-a048-000000000001',
  '20000000-0000-4000-a048-000000000001',
  'sms',
  'active',
  true
);

INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
) VALUES (
  '40000000-0000-4000-a048-000000000001',
  '30000000-0000-4000-a048-000000000001',
  '10000000-0000-4000-a048-000000000001',
  'customer',
  'Please book this appointment.',
  'sms'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_calendar_booking(
      '10000000-0000-4000-a048-000000000001',
      '20000000-0000-4000-a048-000000000001',
      '30000000-0000-4000-a048-000000000001',
      '40000000-0000-4000-a048-000000000001',
      '2049-09-10 14:00:00+00',
      '2049-09-10 14:30:00+00',
      '50000000-0000-4000-a048-000000000001',
      'primary',
      'Controls 048 booking',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  '23514',
  'calendar booking business is not active',
  'global suspension blocks booking reservation before persistence'
);

SELECT public.set_admin_business_operations_suspension(
  '10000000-0000-4000-a048-000000000001',
  false,
  'Operations hold cleared',
  '90000000-0000-4000-a048-000000000001'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_calendar_booking(
      '10000000-0000-4000-a048-000000000001',
      '20000000-0000-4000-a048-000000000001',
      '30000000-0000-4000-a048-000000000001',
      '40000000-0000-4000-a048-000000000001',
      '2049-09-10 14:00:00+00',
      '2049-09-10 14:30:00+00',
      '50000000-0000-4000-a048-000000000001',
      'primary',
      'Controls 048 booking',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  '23514',
  'calendar booking business is not active',
  'booking pause independently blocks reservation after reactivation'
);

SELECT public.set_admin_business_service_pause(
  '10000000-0000-4000-a048-000000000001',
  'bookings',
  false,
  NULL,
  '90000000-0000-4000-a048-000000000001'
);

SELECT lives_ok(
  $$
    SELECT public.reserve_calendar_booking(
      '10000000-0000-4000-a048-000000000001',
      '20000000-0000-4000-a048-000000000001',
      '30000000-0000-4000-a048-000000000001',
      '40000000-0000-4000-a048-000000000001',
      '2049-09-10 14:00:00+00',
      '2049-09-10 14:30:00+00',
      '50000000-0000-4000-a048-000000000001',
      'primary',
      'Controls 048 booking',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
  $$,
  'reservation succeeds after both operational gates are active'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.calendar_bookings
    WHERE business_id = '10000000-0000-4000-a048-000000000001'
      AND source_message_id = '40000000-0000-4000-a048-000000000001'
  ),
  1,
  'blocked reservations persist nothing and the resumed reservation persists once'
);

SELECT ok(
  (
    SELECT to_jsonb(subscription) = before.subscription_snapshot
       AND to_jsonb(stripe_action) = before.stripe_action_snapshot
       AND jsonb_build_object(
         'deleted_at', business.deleted_at,
         'deletion_scheduled_for', business.deletion_scheduled_for
       ) = before.deletion_snapshot
    FROM public.businesses AS business
    JOIN public.subscriptions AS subscription
      ON subscription.business_id = business.id
    JOIN public.account_deletion_stripe_actions AS stripe_action
      ON stripe_action.business_id = business.id
    CROSS JOIN controls_048_billing_before AS before
    WHERE business.id = '10000000-0000-4000-a048-000000000001'
  ),
  'operational transitions do not mutate Stripe, subscription, or deletion state'
);

DELETE FROM public.calendar_bookings
WHERE business_id = '10000000-0000-4000-a048-000000000001';

DELETE FROM public.google_calendar_tokens
WHERE id = '62000000-0000-4000-a048-000000000001'
  AND business_id = '10000000-0000-4000-a048-000000000001';

SELECT * FROM finish();

ROLLBACK;
