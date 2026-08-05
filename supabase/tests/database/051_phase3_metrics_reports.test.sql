BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(87);

-- ---------------------------------------------------------------------------
-- Catalog, constraints, RLS, grants, and additive RPC identities
-- ---------------------------------------------------------------------------

-- 1
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class AS relation
    WHERE relation.oid = ANY (ARRAY[
      'public.metrics_report_configs'::regclass,
      'public.metrics_report_recipients'::regclass,
      'public.metrics_report_selected_businesses'::regclass,
      'public.metrics_reports'::regclass,
      'public.metrics_report_deliveries'::regclass
    ])
      AND relation.relkind = 'r'
  ),
  5,
  '051 creates the five exact report configuration and ledger tables'
);

-- 2
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.metrics_report_configs'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'scope_kind', 'text',
    'partner_id', 'uuid',
    'selection_mode', 'text',
    'reporting_starts_on', 'date',
    'enabled', 'boolean',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'report configs have the exact current-configuration shape'
);

-- 3
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.metrics_report_recipients'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'config_id', 'uuid',
    'email', 'text',
    'enabled', 'boolean',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'editable recipients have the exact canonical-address shape'
);

-- 4
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.metrics_report_selected_businesses'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'config_id', 'uuid',
    'business_id', 'uuid',
    'created_at', 'timestamp with time zone'
  ),
  'selected businesses store only scope membership and creation time'
);

-- 5
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.metrics_reports'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'config_id', 'uuid',
    'period_start', 'date',
    'snapshot_version', 'integer',
    'snapshot_payload', 'jsonb',
    'status', 'text',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'reports store one immutable versioned count snapshot and rollup status'
);

-- 6
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.metrics_report_deliveries'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'report_id', 'uuid',
    'recipient', 'text',
    'status', 'text',
    'attempt_count', 'integer',
    'retry_after', 'timestamp with time zone',
    'claim_token', 'uuid',
    'claimed_at', 'timestamp with time zone',
    'lease_expires_at', 'timestamp with time zone',
    'provider_request_started_at', 'timestamp with time zone',
    'provider_message_id', 'text',
    'accepted_at', 'timestamp with time zone',
    'last_error_code', 'text',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'delivery rows have the exact retry, lease, provider, and audit shape'
);

-- 7
SELECT ok(
  (
    SELECT count(*) = 5 AND bool_and(relation.relrowsecurity)
    FROM pg_class AS relation
    WHERE relation.oid = ANY (ARRAY[
      'public.metrics_report_configs'::regclass,
      'public.metrics_report_recipients'::regclass,
      'public.metrics_report_selected_businesses'::regclass,
      'public.metrics_reports'::regclass,
      'public.metrics_report_deliveries'::regclass
    ])
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = ANY (ARRAY[
      'public.metrics_report_configs'::regclass,
      'public.metrics_report_recipients'::regclass,
      'public.metrics_report_selected_businesses'::regclass,
      'public.metrics_reports'::regclass,
      'public.metrics_report_deliveries'::regclass
    ])
  ),
  'all report tables enable RLS and expose no customer policies'
);

-- 8
SELECT ok(
  pg_get_indexdef(
    'public.metrics_report_configs_one_direct_idx'::regclass
  ) LIKE '%UNIQUE INDEX%scope_kind%WHERE (scope_kind = ''direct''::text)%'
  AND pg_get_indexdef(
    'public.metrics_report_configs_one_partner_idx'::regclass
  ) LIKE '%UNIQUE INDEX%partner_id%WHERE (scope_kind = ''partner''::text)%',
  'partial unique indexes enforce one direct config and one per partner'
);

-- 9
SELECT ok(
  (
    SELECT bool_and(constraint_row.convalidated)
       AND count(*) = 7
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname IN (
      'metrics_report_configs_scope_shape_check',
      'metrics_report_configs_reporting_month_check',
      'metrics_report_recipients_email_canonical',
      'metrics_reports_snapshot_payload_v1_check',
      'metrics_reports_status_check',
      'metrics_report_deliveries_state_shape_check',
      'metrics_report_deliveries_last_error_code_check'
    )
  ),
  'scope, month, email, snapshot, rollup, and delivery checks are validated'
);

-- 10
SELECT is(
  (
    SELECT jsonb_object_agg(
      constraint_row.conname,
      constraint_row.confdeltype::text
      ORDER BY constraint_row.conname
    )
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conname IN (
      'metrics_report_configs_partner_id_fkey',
      'metrics_report_recipients_config_id_fkey',
      'metrics_report_selected_businesses_config_id_fkey',
      'metrics_report_selected_businesses_business_id_fkey',
      'metrics_reports_config_id_fkey',
      'metrics_report_deliveries_report_id_fkey'
    )
  ),
  jsonb_build_object(
    'metrics_report_configs_partner_id_fkey', 'r',
    'metrics_report_recipients_config_id_fkey', 'c',
    'metrics_report_selected_businesses_config_id_fkey', 'c',
    'metrics_report_selected_businesses_business_id_fkey', 'r',
    'metrics_reports_config_id_fkey', 'r',
    'metrics_report_deliveries_report_id_fkey', 'r'
  ),
  'parent history uses RESTRICT while editable config children cascade'
);

-- 11
SELECT ok(
  has_table_privilege(
    'service_role', 'public.metrics_report_configs', 'SELECT,INSERT,UPDATE,DELETE'
  )
  AND has_table_privilege(
    'service_role', 'public.metrics_report_recipients', 'SELECT,INSERT,UPDATE,DELETE'
  )
  AND has_table_privilege(
    'service_role',
    'public.metrics_report_selected_businesses',
    'SELECT,INSERT,UPDATE,DELETE'
  )
  AND has_table_privilege(
    'service_role', 'public.metrics_reports', 'SELECT,INSERT,UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.metrics_reports', 'DELETE'
  )
  AND has_table_privilege(
    'service_role', 'public.metrics_report_deliveries', 'SELECT,INSERT,UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.metrics_report_deliveries', 'DELETE'
  ),
  'service_role has exact current-config and append/update ledger privileges'
);

-- 12
SELECT ok(
  NOT has_table_privilege(
    'anon', 'public.metrics_report_configs', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.metrics_report_configs', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.metrics_reports', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.metrics_report_deliveries', 'SELECT'
  ),
  'anon and authenticated roles cannot read configuration or report history'
);

-- 13
SELECT ok(
  to_regprocedure(
    'public.save_metrics_report_config_v1(text,uuid,text,date,boolean,jsonb,uuid[])'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.list_admin_monthly_business_metrics_v2(date,text,uuid,uuid)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.preview_metrics_report_payload_v1(uuid,date)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.build_metrics_report_snapshot_v1(uuid,date)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.claim_metrics_report_delivery_v1(uuid,uuid,timestamptz)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.mark_metrics_report_delivery_sending_v1(uuid,uuid,timestamptz)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.complete_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.release_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.mark_metrics_report_delivery_needs_review_v1(uuid,uuid,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.reconcile_expired_metrics_report_delivery_leases_v1(integer,timestamptz)'
  ) IS NOT NULL,
  'all configuration, aggregation, snapshot, and delivery RPC identities exist'
);

-- 14
SELECT ok(
  (
    SELECT count(*) = 10
       AND bool_and(NOT procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.save_metrics_report_config_v1(text,uuid,text,date,boolean,jsonb,uuid[])'::regprocedure,
      'public.list_admin_monthly_business_metrics_v2(date,text,uuid,uuid)'::regprocedure,
      'public.preview_metrics_report_payload_v1(uuid,date)'::regprocedure,
      'public.build_metrics_report_snapshot_v1(uuid,date)'::regprocedure,
      'public.claim_metrics_report_delivery_v1(uuid,uuid,timestamptz)'::regprocedure,
      'public.mark_metrics_report_delivery_sending_v1(uuid,uuid,timestamptz)'::regprocedure,
      'public.complete_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.release_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.mark_metrics_report_delivery_needs_review_v1(uuid,uuid,text)'::regprocedure,
      'public.reconcile_expired_metrics_report_delivery_leases_v1(integer,timestamptz)'::regprocedure
    ])
  ),
  'all callable 051 RPCs are fixed-path SECURITY INVOKER functions'
);

-- 15
SELECT ok(
  (
    SELECT bool_and(
      has_function_privilege(
        'service_role', procedure_row.oid, 'EXECUTE'
      )
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.save_metrics_report_config_v1(text,uuid,text,date,boolean,jsonb,uuid[])'::regprocedure,
      'public.list_admin_monthly_business_metrics_v2(date,text,uuid,uuid)'::regprocedure,
      'public.preview_metrics_report_payload_v1(uuid,date)'::regprocedure,
      'public.build_metrics_report_snapshot_v1(uuid,date)'::regprocedure,
      'public.claim_metrics_report_delivery_v1(uuid,uuid,timestamptz)'::regprocedure,
      'public.mark_metrics_report_delivery_sending_v1(uuid,uuid,timestamptz)'::regprocedure,
      'public.complete_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.release_metrics_report_delivery_v1(uuid,uuid,text,timestamptz)'::regprocedure,
      'public.mark_metrics_report_delivery_needs_review_v1(uuid,uuid,text)'::regprocedure,
      'public.reconcile_expired_metrics_report_delivery_leases_v1(integer,timestamptz)'::regprocedure
    ])
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_admin_monthly_business_metrics_v2(date,text,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.build_metrics_report_snapshot_v1(uuid,date)',
    'EXECUTE'
  ),
  'callable report RPCs are executable only by service_role'
);

-- 16
SELECT ok(
  (
    SELECT count(*) = 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname = 'list_admin_monthly_business_metrics_v1'
      AND oidvectortypes(procedure_row.proargtypes) = 'date, text, uuid'
      AND pg_get_function_result(procedure_row.oid) = 'jsonb'
  ),
  'the deployed v1 aggregate remains present with its exact signature'
);

-- 17
SELECT ok(
  (
    SELECT procedure_row.provolatile = 'i'
       AND NOT procedure_row.prosecdef
       AND procedure_row.proisstrict
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.is_valid_metrics_report_snapshot_v1(date,jsonb)'::regprocedure
  )
  AND obj_description(
    'public.metrics_report_deliveries'::regclass,
    'pg_class'
  ) LIKE '%accepted means provider acceptance%'
  AND col_description(
    'public.metrics_report_deliveries'::regclass,
    (
      SELECT attribute.attnum
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid =
        'public.metrics_report_deliveries'::regclass
        AND attribute.attname = 'provider_request_started_at'
    )
  ) LIKE '%expired sending work becomes needs_review%',
  'snapshot validation is immutable and delivery comments preserve honest semantics'
);

-- ---------------------------------------------------------------------------
-- Deterministic partner/business/event fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id, name, slug, custom_domain, domain_status, status
) VALUES
  (
    '21000000-0000-4000-a051-000000000001',
    'Metrics 051 Partner A',
    'metrics-051-partner-a',
    'metrics-051-a.example.com',
    'connected',
    'active'
  ),
  (
    '21000000-0000-4000-a051-000000000002',
    'Metrics 051 Partner B',
    'metrics-051-partner-b',
    'metrics-051-b.example.com',
    'connected',
    'active'
  );

INSERT INTO public.businesses (
  id, name, business_type, slug, partner_id, billing_mode, partner_plan
) VALUES
  (
    '11000000-0000-4000-a051-000000000001',
    'Metrics 051 Direct Active',
    'general',
    'metrics-051-direct-active',
    NULL,
    'stripe',
    NULL
  ),
  (
    '11000000-0000-4000-a051-000000000002',
    'Metrics 051 Direct Zero',
    'general',
    'metrics-051-direct-zero',
    NULL,
    'stripe',
    NULL
  ),
  (
    '11000000-0000-4000-a051-000000000003',
    'Metrics 051 Partner A Active',
    'general',
    'metrics-051-partner-a-active',
    '21000000-0000-4000-a051-000000000001',
    'invoiced',
    'sms_and_chat'
  ),
  (
    '11000000-0000-4000-a051-000000000004',
    'Metrics 051 Partner A Zero',
    'general',
    'metrics-051-partner-a-zero',
    '21000000-0000-4000-a051-000000000001',
    'invoiced',
    'sms_only'
  ),
  (
    '11000000-0000-4000-a051-000000000005',
    'Metrics 051 Transfer',
    'general',
    'metrics-051-transfer',
    '21000000-0000-4000-a051-000000000001',
    'invoiced',
    'full'
  ),
  (
    '11000000-0000-4000-a051-000000000006',
    'Metrics 051 Partner B Active',
    'general',
    'metrics-051-partner-b-active',
    '21000000-0000-4000-a051-000000000002',
    'comped',
    'full'
  );

SET LOCAL ROLE service_role;

SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000001',
  'missed_call_caught',
  2,
  '2020-04-02 12:00:00+00',
  'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa051000001',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000001',
  'booking_confirmed',
  1,
  '2020-04-03 12:00:00+00',
  'ai-booking:71000000-0000-4000-a051-000000000001',
  'ai'
);
SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000003',
  'contact_created',
  3,
  '2020-04-04 12:00:00+00',
  'contact-created:31000000-0000-4000-a051-000000000001',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000005',
  'booking_confirmed',
  1,
  '2020-04-05 12:00:00+00',
  'ai-booking:71000000-0000-4000-a051-000000000002',
  'ai'
);
SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000006',
  'hot_lead_classified',
  4,
  '2020-04-06 12:00:00+00',
  'hot-lead:61000000-0000-4000-a051-000000000001',
  NULL
);

-- ---------------------------------------------------------------------------
-- Atomic config replacement and cross-table invariants
-- ---------------------------------------------------------------------------

-- 18
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'all', NULL, 'all', '2020-01-01', false, '[]'::jsonb, ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'invalid_metrics_report_scope',
  'config save rejects an unsupported scope discriminator'
);

-- 19
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'some', '2020-01-01', false, '[]'::jsonb, ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'invalid_metrics_report_selection_mode',
  'config save rejects an unsupported selection mode'
);

-- 20
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-02', false, '[]'::jsonb, ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'invalid_metrics_report_start_month',
  'config save rejects a non-month-boundary reporting start'
);

-- 21
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-01', false,
      '[{"email":"ADMIN@example.com","enabled":true}]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'invalid_metrics_report_recipient',
  'config save requires already-canonical lowercase recipient mailboxes'
);

-- 22
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-01', false,
      '[
        {"email":"admin@example.com","enabled":true},
        {"email":"admin@example.com","enabled":false}
      ]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'duplicate_metrics_report_recipient',
  'config save rejects duplicate frozen mailbox identities'
);

-- 23
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-01', false, '[]'::jsonb,
      ARRAY['11000000-0000-4000-a051-000000000001'::uuid]
    )
  $$,
  '22023',
  'invalid_metrics_report_selection_shape',
  'all mode cannot retain selected-business child rows'
);

-- 24
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'selected', '2020-01-01', false, '[]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'invalid_metrics_report_selection_shape',
  'selected mode requires at least one selected business'
);

-- 25
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-01', true,
      '[{"email":"disabled@example.com","enabled":false}]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  '22023',
  'enabled_metrics_report_requires_recipient',
  'an enabled config requires at least one enabled recipient'
);

-- 26
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'partner', '21000000-0000-4000-a051-000000000001',
      'selected', '2020-01-01', false, '[]'::jsonb,
      ARRAY['11000000-0000-4000-a051-000000000006'::uuid]
    )
  $$,
  '22023',
  'metrics_report_business_out_of_scope',
  'selected businesses must match the config current partner scope'
);

-- 27
SELECT throws_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'partner', '21000000-0000-4000-a051-999999999999',
      'all', '2020-01-01', false, '[]'::jsonb, ARRAY[]::uuid[]
    )
  $$,
  '23503',
  'metrics_report_partner_not_found',
  'partner configs require an existing partner'
);

-- 28
SELECT lives_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-01-01', false, '[]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  'a missing direct config is created disabled with an empty child set'
);

-- 29
SELECT lives_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-02-01', false,
      '[{"email":"direct@example.com","enabled":true}]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  'saving the direct scope again updates the one existing config'
);

-- 30
SELECT ok(
  (
    SELECT count(*) = 1
       AND min(reporting_starts_on) = '2020-02-01'::date
    FROM public.metrics_report_configs
    WHERE scope_kind = 'direct'
  )
  AND (
    SELECT count(*) = 1
       AND bool_and(email = 'direct@example.com')
    FROM public.metrics_report_recipients AS recipient
    JOIN public.metrics_report_configs AS config
      ON config.id = recipient.config_id
    WHERE config.scope_kind = 'direct'
  ),
  'direct save is an atomic scope upsert plus complete child replacement'
);

-- 31
SELECT lives_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'partner', '21000000-0000-4000-a051-000000000001',
      'selected', '2020-01-01', true,
      '[{"email":"partner-a@example.com","enabled":true}]'::jsonb,
      ARRAY[
        '11000000-0000-4000-a051-000000000003'::uuid,
        '11000000-0000-4000-a051-000000000004'::uuid,
        '11000000-0000-4000-a051-000000000005'::uuid
      ]
    )
  $$,
  'a valid selected partner config and its enabled recipient save atomically'
);

-- 32
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.metrics_report_selected_businesses AS selected
    JOIN public.metrics_report_configs AS config
      ON config.id = selected.config_id
    WHERE config.partner_id = '21000000-0000-4000-a051-000000000001'
  ),
  3,
  'selected mode persists each distinct in-scope business exactly once'
);

RESET ROLE;

-- 33
SELECT throws_ok(
  $$
    INSERT INTO public.metrics_report_configs (
      scope_kind, partner_id, selection_mode, reporting_starts_on
    ) VALUES ('direct', NULL, 'all', '2020-01-01')
  $$,
  '23505',
  NULL,
  'the partial direct index prevents a second direct config'
);

-- 34
SELECT throws_ok(
  $$
    INSERT INTO public.metrics_report_recipients (config_id, email)
    SELECT id, ' Not-Canonical@example.com'
    FROM public.metrics_report_configs
    WHERE scope_kind = 'direct'
  $$,
  '23514',
  NULL,
  'recipient table constraints independently reject noncanonical email'
);

UPDATE public.businesses
SET partner_id = '21000000-0000-4000-a051-000000000002',
    billing_mode = 'invoiced',
    partner_plan = 'full'
WHERE id = '11000000-0000-4000-a051-000000000005';

SET LOCAL ROLE service_role;
SELECT public.record_business_metric_event_v1(
  '11000000-0000-4000-a051-000000000005',
  'booking_confirmed',
  2,
  '2020-04-07 12:00:00+00',
  'dashboard-booking:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb051000002',
  'dashboard'
);

-- ---------------------------------------------------------------------------
-- Additive v2 aggregate: business filter, event-time scope, stable options
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE metrics_051_v2_all_transfer AS
SELECT public.list_admin_monthly_business_metrics_v2(
  '2020-04-01',
  'all',
  NULL,
  '11000000-0000-4000-a051-000000000005'
) AS payload;

CREATE TEMP TABLE metrics_051_v2_partner_a AS
SELECT public.list_admin_monthly_business_metrics_v2(
  '2020-04-01',
  'partner',
  '21000000-0000-4000-a051-000000000001',
  NULL
) AS payload;

CREATE TEMP TABLE metrics_051_v2_partner_a_transfer AS
SELECT public.list_admin_monthly_business_metrics_v2(
  '2020-04-01',
  'partner',
  '21000000-0000-4000-a051-000000000001',
  '11000000-0000-4000-a051-000000000005'
) AS payload;

CREATE TEMP TABLE metrics_051_v2_direct_zero AS
SELECT public.list_admin_monthly_business_metrics_v2(
  '2020-04-01',
  'direct',
  NULL,
  '11000000-0000-4000-a051-000000000002'
) AS payload;

-- 35
SELECT ok(
  (
    SELECT payload -> 'scope' = jsonb_build_object(
      'kind', 'all',
      'partner_id', NULL,
      'business_id', '11000000-0000-4000-a051-000000000005'
    )
    FROM metrics_051_v2_all_transfer
  ),
  'v2 echoes the exact combined scope and business filter tuple'
);

-- 36
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 2
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 3
       AND (payload #>> '{totals,booking_confirmed_ai}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed_dashboard}')::bigint = 2
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business
         WHERE business ->> 'business_id' IS DISTINCT FROM
           '11000000-0000-4000-a051-000000000005'
       )
    FROM metrics_051_v2_all_transfer
  ),
  'all plus business returns both event-time brand segments for that business only'
);

-- 37
SELECT ok(
  (
    SELECT (payload #>> '{totals,contact_created}')::bigint = 3
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 1
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business
         WHERE business ->> 'partner_id_at_event' IS DISTINCT FROM
           '21000000-0000-4000-a051-000000000001'
       )
    FROM metrics_051_v2_partner_a
  ),
  'partner scope includes only exact event-time partner attribution'
);

-- 38
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 1
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed_dashboard}')::bigint = 0
    FROM metrics_051_v2_partner_a_transfer
  ),
  'business filtering remains ANDed with partner event-time attribution'
);

-- 39
SELECT ok(
  (
    SELECT (payload -> 'business_options') = (
      SELECT payload -> 'business_options'
      FROM metrics_051_v2_partner_a_transfer
    )
    FROM metrics_051_v2_partner_a
  ),
  'business options are stable when a business filter is selected'
);

-- 40
SELECT ok(
  (
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(payload -> 'business_options') AS option_row
      WHERE option_row ->> 'business_id' =
        '11000000-0000-4000-a051-000000000005'
    )
    FROM metrics_051_v2_partner_a
  ),
  'historical ledger membership keeps a transferred business in old-scope options'
);

-- 41
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 0
       AND (payload #>> '{totals,missed_call_caught}')::bigint = 0
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'business_options') AS option_row
         WHERE option_row ->> 'business_id' =
           '11000000-0000-4000-a051-000000000002'
       )
    FROM metrics_051_v2_direct_zero
  ),
  'a selected zero-event business has zero totals, no event row, and a stable option'
);

-- 42
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v2(
      '2020-04-01',
      'direct',
      '21000000-0000-4000-a051-000000000001',
      NULL
    )
  $$,
  '22023',
  'invalid_metric_scope',
  'v2 retains strict scope tuple validation'
);

-- 43
SELECT is(
  public.list_admin_monthly_business_metrics_v1(
    '2020-04-01', 'direct', NULL
  ),
  (
    WITH v2 AS (
      SELECT public.list_admin_monthly_business_metrics_v2(
        '2020-04-01', 'direct', NULL, NULL
      ) AS payload
    )
    SELECT jsonb_set(
      payload - 'business_options',
      '{scope}',
      (payload -> 'scope') - 'business_id'
    )
    FROM v2
  ),
  'v2 without a business filter is exactly v1 plus its two additive fields'
);

-- ---------------------------------------------------------------------------
-- Strict preview snapshots and event-time selection intersection
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE metrics_051_partner_preview AS
SELECT public.preview_metrics_report_payload_v1(
  (
    SELECT id
    FROM public.metrics_report_configs
    WHERE partner_id = '21000000-0000-4000-a051-000000000001'
  ),
  '2020-04-01'
) AS payload;

-- 44
SELECT ok(
  (
    SELECT public.is_valid_metrics_report_snapshot_v1(
      '2020-04-01', payload
    )
    FROM metrics_051_partner_preview
  ),
  'the shared preview produces a valid strict v1 snapshot'
);

-- 45
SELECT ok(
  (
    SELECT payload #> '{selection,business_ids}' = jsonb_build_array(
      '11000000-0000-4000-a051-000000000003',
      '11000000-0000-4000-a051-000000000004',
      '11000000-0000-4000-a051-000000000005'
    )
    FROM metrics_051_partner_preview
  ),
  'selected business identities freeze in deterministic UUID order'
);

-- 46
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 3
       AND EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business
         WHERE business ->> 'business_id' =
                 '11000000-0000-4000-a051-000000000004'
           AND (business #>> '{counts,contact_created}')::bigint = 0
       )
    FROM metrics_051_partner_preview
  ),
  'selected snapshots materialize an honest zero row for a zero-event business'
);

-- 47
SELECT ok(
  (
    SELECT (payload #>> '{totals,booking_confirmed}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed_ai}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed_dashboard}')::bigint = 0
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business
         WHERE business ->> 'partner_id_at_event' IS DISTINCT FROM
           '21000000-0000-4000-a051-000000000001'
       )
    FROM metrics_051_partner_preview
  ),
  'selected snapshots intersect membership with event-time partner attribution'
);

-- 48
SELECT ok(
  NOT (
    SELECT public.is_valid_metrics_report_snapshot_v1(
      '2020-04-01', payload || '{"content":"forbidden"}'::jsonb
    )
    FROM metrics_051_partner_preview
  ),
  'snapshot validation rejects an extra content-bearing top-level key'
);

-- 49
SELECT ok(
  NOT (
    SELECT public.is_valid_metrics_report_snapshot_v1(
      '2020-04-01',
      jsonb_set(
        payload,
        '{totals,unexpected}',
        '1'::jsonb
      )
    )
    FROM metrics_051_partner_preview
  ),
  'snapshot validation rejects an extra total key'
);

-- 50
SELECT ok(
  NOT (
    SELECT public.is_valid_metrics_report_snapshot_v1(
      '2020-04-01',
      jsonb_set(payload, '{totals,contact_created}', '999'::jsonb)
    )
    FROM metrics_051_partner_preview
  ),
  'snapshot validation rejects totals that disagree with business rows'
);

-- 51
SELECT ok(
  NOT (
    SELECT public.is_valid_metrics_report_snapshot_v1(
      '2020-04-01',
      jsonb_set(
        payload,
        '{totals,contact_created}',
        '9007199254740992'::jsonb
      )
    )
    FROM metrics_051_partner_preview
  ),
  'snapshot validation rejects counts above the JavaScript safe integer bound'
);

-- 52
SELECT throws_ok(
  $$
    SELECT public.preview_metrics_report_payload_v1(
      (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
      date_trunc('month', transaction_timestamp() AT TIME ZONE 'UTC')::date
    )
  $$,
  '22023',
  'metrics_report_period_not_complete',
  'preview refuses the current incomplete UTC month'
);

-- 53
SELECT throws_ok(
  $$
    SELECT public.preview_metrics_report_payload_v1(
      (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
      '2020-04-02'
    )
  $$,
  '22023',
  'invalid_metrics_report_period',
  'preview requires an exact first-of-month period'
);

-- 54
SELECT ok(
  lower(pg_get_functiondef(
    'public.preview_metrics_report_payload_v1(uuid,date)'::regprocedure
  )) !~ '(messages\\.|phone_number|prompt|message_content|contact_phone)'
  AND lower(pg_get_functiondef(
    'public.list_admin_monthly_business_metrics_v2(date,text,uuid,uuid)'::regprocedure
  )) !~ '(messages\\.|phone_number|prompt|message_content|contact_phone)',
  'aggregate functions never select message, phone, prompt, or contact content'
);

-- ---------------------------------------------------------------------------
-- Atomic build, frozen recipients, and immutable report history
-- ---------------------------------------------------------------------------

-- 55
SELECT throws_ok(
  $$
    SELECT *
    FROM public.build_metrics_report_snapshot_v1(
      (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
      '2020-04-01'
    )
  $$,
  '55000',
  'metrics_report_config_disabled',
  'disabled configs cannot persist snapshots'
);

SET LOCAL ROLE service_role;

-- 56
SELECT lives_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-04-01', true,
      '[
        {"email":"alpha@example.com","enabled":true},
        {"email":"beta@example.com","enabled":true},
        {"email":"disabled@example.com","enabled":false}
      ]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  'a direct config can be enabled with two enabled recipients'
);

CREATE TEMP TABLE metrics_051_direct_build AS
SELECT *
FROM public.build_metrics_report_snapshot_v1(
  (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
  '2020-04-01'
);

-- 57
SELECT is(
  (SELECT outcome FROM metrics_051_direct_build),
  'created',
  'first build atomically creates the report snapshot'
);

-- 58
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.report_id =
      (SELECT report_id FROM metrics_051_direct_build)
  ),
  2,
  'build freezes exactly the currently enabled recipients'
);

-- 59
SELECT results_eq(
  $$
    SELECT recipient
    FROM public.metrics_report_deliveries
    WHERE report_id = (SELECT report_id FROM metrics_051_direct_build)
    ORDER BY recipient
  $$,
  $$ VALUES ('alpha@example.com'::text), ('beta@example.com'::text) $$,
  'disabled editable recipients are excluded from frozen deliveries'
);

CREATE TEMP TABLE metrics_051_direct_rebuild AS
SELECT *
FROM public.build_metrics_report_snapshot_v1(
  (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
  '2020-04-01'
);

-- 60
SELECT ok(
  (SELECT outcome = 'existing' FROM metrics_051_direct_rebuild)
  AND (SELECT report_id FROM metrics_051_direct_rebuild) =
    (SELECT report_id FROM metrics_051_direct_build)
  AND (
    SELECT count(*) = 1
    FROM public.metrics_reports
    WHERE config_id = (
      SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'
    )
      AND period_start = '2020-04-01'
  ),
  'repeated build is idempotent and returns the one existing report'
);

-- 61
SELECT results_eq(
  $$
    SELECT outcome
    FROM public.build_metrics_report_snapshot_v1(
      (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
      '2020-03-01'
    )
  $$,
  $$ VALUES ('not_due'::text) $$,
  'builder returns typed not_due before reporting_starts_on'
);

-- 62
SELECT throws_ok(
  $$
    UPDATE public.metrics_reports
    SET snapshot_payload = snapshot_payload || '{"extra":true}'::jsonb
    WHERE id = (SELECT report_id FROM metrics_051_direct_build)
  $$,
  '55000',
  'metrics_report_snapshot_is_immutable',
  'frozen report payloads cannot be rewritten'
);

-- 63
SELECT throws_ok(
  $$
    UPDATE public.metrics_report_deliveries
    SET recipient = 'changed@example.com'
    WHERE id = (
      SELECT id
      FROM public.metrics_report_deliveries
      WHERE report_id = (SELECT report_id FROM metrics_051_direct_build)
      ORDER BY recipient
      LIMIT 1
    )
  $$,
  '55000',
  'metrics_report_delivery_identity_is_immutable',
  'frozen delivery recipients cannot be rewritten'
);

-- 64
SELECT throws_ok(
  $$
    DELETE FROM public.metrics_report_configs
    WHERE scope_kind = 'direct'
  $$,
  '23503',
  NULL,
  'report history restricts deletion of its config identity'
);

-- 65
SELECT throws_ok(
  $$
    INSERT INTO public.metrics_report_deliveries (
      report_id,
      recipient,
      status,
      attempt_count,
      retry_after,
      claim_token,
      claimed_at,
      lease_expires_at
    ) VALUES (
      (SELECT report_id FROM metrics_051_direct_build),
      'invalid-state@example.com',
      'claimed',
      1,
      NULL,
      '51000000-0000-4000-a051-000000000001',
      '2020-05-01 00:00:00+00',
      '2020-05-01 00:14:00+00'
    )
  $$,
  '23514',
  NULL,
  'delivery state checks enforce the exact fifteen-minute lease shape'
);

-- 66
SELECT lives_ok(
  $$
    SELECT public.save_metrics_report_config_v1(
      'direct', NULL, 'all', '2020-04-01', false, '[]'::jsonb,
      ARRAY[]::uuid[]
    )
  $$,
  'disabling and editing a config does not mutate frozen report history'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.metrics_reports AS report
    WHERE report.id = (SELECT report_id FROM metrics_051_direct_build)
      AND jsonb_array_length(report.snapshot_payload -> 'businesses') = 1
  )
  AND (
    SELECT count(*) = 2
    FROM public.metrics_report_deliveries
    WHERE report_id = (SELECT report_id FROM metrics_051_direct_build)
  ),
  'config disable preserves the frozen snapshot and delivery ledger'
);

-- ---------------------------------------------------------------------------
-- Token-owned delivery transitions, retries, expiry, and report rollups
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE metrics_051_delivery_ids AS
SELECT
  row_number() OVER (ORDER BY recipient) AS ordinal,
  id,
  recipient
FROM public.metrics_report_deliveries
WHERE report_id = (SELECT report_id FROM metrics_051_direct_build);

CREATE TEMP TABLE metrics_051_claim_one AS
SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
  '51000000-0000-4000-a051-000000000011',
  '2030-05-01 00:00:00+00'
);

-- 68
SELECT ok(
  (
    SELECT recipient = 'alpha@example.com'
       AND snapshot_version = 1
       AND public.is_valid_metrics_report_snapshot_v1(
         '2020-04-01', snapshot_payload
       )
       AND attempt_count = 1
    FROM metrics_051_claim_one
  ),
  'claim atomically returns the frozen recipient and valid snapshot payload'
);

-- 69
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
      '51000000-0000-4000-a051-000000000012',
      '2030-05-01 00:00:01+00'
    )
  ),
  0,
  'an already-claimed delivery cannot be double-claimed'
);

-- 70
SELECT is(
  public.mark_metrics_report_delivery_sending_v1(
    (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
    '51000000-0000-4000-a051-000000000099',
    '2030-05-01 00:00:02+00'
  ),
  false,
  'a non-owner token cannot cross the provider-start boundary'
);

-- 71
SELECT is(
  public.mark_metrics_report_delivery_sending_v1(
    (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
    '51000000-0000-4000-a051-000000000011',
    '2030-05-01 00:00:02+00'
  ),
  true,
  'the owner token can mark sending before its lease expires'
);

-- 72
SELECT results_eq(
  $$
    SELECT delivery_status, next_retry_at, attempt_count
    FROM public.release_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
      '51000000-0000-4000-a051-000000000011',
      'provider_rejected',
      '2030-05-01 00:00:03+00'
    )
  $$,
  $$
    VALUES (
      'pending'::text,
      '2030-05-02 00:00:00+00'::timestamptz,
      1::integer
    )
  $$,
  'a first proven no-send failure schedules the next UTC-day retry'
);

-- 73
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
      '51000000-0000-4000-a051-000000000013',
      '2030-05-01 23:59:59+00'
    )
  ),
  0,
  'a pending delivery cannot be claimed before retry_after'
);

CREATE TEMP TABLE metrics_051_claim_two AS
SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 2),
  '51000000-0000-4000-a051-000000000021',
  '2030-05-01 00:00:00+00'
);

SELECT public.mark_metrics_report_delivery_sending_v1(
  (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 2),
  '51000000-0000-4000-a051-000000000021',
  '2030-05-01 00:00:02+00'
);

-- 74
SELECT is(
  public.complete_metrics_report_delivery_v1(
    (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 2),
    '51000000-0000-4000-a051-000000000021',
    'resend-message-051',
    '2030-05-01 00:00:03+00'
  ),
  true,
  'token-owned completion stores provider acceptance after sending'
);

-- 75
SELECT ok(
  (
    SELECT status = 'accepted'
       AND provider_message_id = 'resend-message-051'
       AND accepted_at = '2030-05-01 00:00:03+00'::timestamptz
       AND claim_token IS NULL
       AND provider_request_started_at IS NULL
    FROM public.metrics_report_deliveries
    WHERE id = (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 2)
  )
  AND (
    SELECT status = 'pending'
    FROM public.metrics_reports
    WHERE id = (SELECT report_id FROM metrics_051_direct_build)
  ),
  'accepted stores only provider ID/time while pending precedence controls rollup'
);

-- 76
SELECT is(
  public.mark_metrics_report_delivery_needs_review_v1(
    (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
    '51000000-0000-4000-a051-000000000099',
    'provider_outcome_unknown'
  ),
  false,
  'a stale token cannot force a retryable delivery into review'
);

CREATE TEMP TABLE metrics_051_claim_retry_two AS
SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
  '51000000-0000-4000-a051-000000000014',
  '2030-05-02 00:00:00+00'
);

-- 77
SELECT results_eq(
  $$
    SELECT delivery_status, next_retry_at, attempt_count
    FROM public.release_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
      '51000000-0000-4000-a051-000000000014',
      'provider_rejected',
      '2030-05-02 00:00:01+00'
    )
  $$,
  $$
    VALUES (
      'pending'::text,
      '2030-05-03 00:00:00+00'::timestamptz,
      2::integer
    )
  $$,
  'a second proven no-send failure remains retryable on the next UTC day'
);

CREATE TEMP TABLE metrics_051_claim_retry_three AS
SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
  '51000000-0000-4000-a051-000000000015',
  '2030-05-03 00:00:00+00'
);

-- 78
SELECT results_eq(
  $$
    SELECT delivery_status, next_retry_at, attempt_count
    FROM public.release_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_delivery_ids WHERE ordinal = 1),
      '51000000-0000-4000-a051-000000000015',
      'provider_rejected',
      '2030-05-03 00:00:01+00'
    )
  $$,
  $$ VALUES ('failed'::text, NULL::timestamptz, 3::integer) $$,
  'the third proven no-send failure becomes terminal failed'
);

-- 79
SELECT is(
  (
    SELECT status
    FROM public.metrics_reports
    WHERE id = (SELECT report_id FROM metrics_051_direct_build)
  ),
  'partial',
  'an accepted and failed terminal mixture rolls up to partial'
);

-- Re-enable with one editable recipient; prior frozen rows stay unchanged.
SELECT public.save_metrics_report_config_v1(
  'direct', NULL, 'all', '2020-04-01', true,
  '[{"email":"lease@example.com","enabled":true}]'::jsonb,
  ARRAY[]::uuid[]
);

CREATE TEMP TABLE metrics_051_expired_claim_report AS
SELECT *
FROM public.build_metrics_report_snapshot_v1(
  (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
  '2020-05-01'
);

CREATE TEMP TABLE metrics_051_expired_claim_delivery AS
SELECT id
FROM public.metrics_report_deliveries
WHERE report_id = (SELECT report_id FROM metrics_051_expired_claim_report);

SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_expired_claim_delivery),
  '51000000-0000-4000-a051-000000000031',
  '2030-06-01 00:00:00+00'
);

-- 80
SELECT is(
  public.reconcile_expired_metrics_report_delivery_leases_v1(
    100,
    '2030-06-01 00:16:00+00'
  ),
  jsonb_build_object(
    'reclaimed', 1,
    'needs_review', 0,
    'remaining', 0
  ),
  'expired pre-provider claimed work is safely reclaimed'
);

-- 81
SELECT ok(
  (
    SELECT status = 'pending'
       AND attempt_count = 0
       AND retry_after = '2030-06-01 00:16:00+00'::timestamptz
       AND last_error_code = 'lease_expired_before_provider'
       AND claim_token IS NULL
    FROM public.metrics_report_deliveries
    WHERE id = (SELECT id FROM metrics_051_expired_claim_delivery)
  ),
  'pre-provider lease recovery refunds the optimistic attempt'
);

CREATE TEMP TABLE metrics_051_expired_send_report AS
SELECT *
FROM public.build_metrics_report_snapshot_v1(
  (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
  '2020-06-01'
);

CREATE TEMP TABLE metrics_051_expired_send_delivery AS
SELECT id
FROM public.metrics_report_deliveries
WHERE report_id = (SELECT report_id FROM metrics_051_expired_send_report);

SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_expired_send_delivery),
  '51000000-0000-4000-a051-000000000041',
  '2030-07-01 00:00:00+00'
);
SELECT public.mark_metrics_report_delivery_sending_v1(
  (SELECT id FROM metrics_051_expired_send_delivery),
  '51000000-0000-4000-a051-000000000041',
  '2030-07-01 00:00:01+00'
);

-- 82
SELECT is(
  public.reconcile_expired_metrics_report_delivery_leases_v1(
    100,
    '2030-07-01 00:16:00+00'
  ),
  jsonb_build_object(
    'reclaimed', 0,
    'needs_review', 1,
    'remaining', 0
  ),
  'expired post-provider-start work is classified as ambiguous review work'
);

-- 83
SELECT ok(
  (
    SELECT status = 'needs_review'
       AND last_error_code = 'provider_outcome_unknown'
       AND claim_token IS NULL
       AND provider_request_started_at IS NULL
    FROM public.metrics_report_deliveries
    WHERE id = (SELECT id FROM metrics_051_expired_send_delivery)
  )
  AND (
    SELECT status = 'needs_review'
    FROM public.metrics_reports
    WHERE id = (SELECT report_id FROM metrics_051_expired_send_report)
  ),
  'ambiguous expiry is terminal needs_review at delivery and report levels'
);

-- 84
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_metrics_report_delivery_v1(
      (SELECT id FROM metrics_051_expired_send_delivery),
      '51000000-0000-4000-a051-000000000042',
      '2030-07-02 00:00:00+00'
    )
  ),
  0,
  'needs_review deliveries can never be reclaimed automatically'
);

CREATE TEMP TABLE metrics_051_accepted_report AS
SELECT *
FROM public.build_metrics_report_snapshot_v1(
  (SELECT id FROM public.metrics_report_configs WHERE scope_kind = 'direct'),
  '2020-07-01'
);

CREATE TEMP TABLE metrics_051_accepted_delivery AS
SELECT id
FROM public.metrics_report_deliveries
WHERE report_id = (SELECT report_id FROM metrics_051_accepted_report);

SELECT *
FROM public.claim_metrics_report_delivery_v1(
  (SELECT id FROM metrics_051_accepted_delivery),
  '51000000-0000-4000-a051-000000000051',
  '2030-08-01 00:00:00+00'
);
SELECT public.mark_metrics_report_delivery_sending_v1(
  (SELECT id FROM metrics_051_accepted_delivery),
  '51000000-0000-4000-a051-000000000051',
  '2030-08-01 00:00:01+00'
);

-- 85
SELECT is(
  public.complete_metrics_report_delivery_v1(
    (SELECT id FROM metrics_051_accepted_delivery),
    '51000000-0000-4000-a051-000000000051',
    'resend-message-accepted-051',
    '2030-08-01 00:00:02+00'
  ),
  true,
  'a one-recipient report can complete through the token-owned path'
);

-- 86
SELECT is(
  (
    SELECT status
    FROM public.metrics_reports
    WHERE id = (SELECT report_id FROM metrics_051_accepted_report)
  ),
  'accepted',
  'all accepted deliveries roll the report up to provider accepted'
);

-- 87
SELECT throws_ok(
  $test$
    DO $orphan_report$
    DECLARE
      v_config_id uuid;
      v_payload jsonb;
    BEGIN
      SELECT config.id
      INTO v_config_id
      FROM public.metrics_report_configs AS config
      WHERE config.scope_kind = 'direct';

      v_payload := public.preview_metrics_report_payload_v1(
        v_config_id,
        '2019-12-01'
      );

      INSERT INTO public.metrics_reports (
        config_id,
        period_start,
        snapshot_payload
      ) VALUES (
        v_config_id,
        '2019-12-01',
        v_payload
      );

      SET CONSTRAINTS metrics_reports_require_delivery IMMEDIATE;
    END;
    $orphan_report$
  $test$,
  '23514',
  'metrics_report_requires_delivery',
  'the deferred constraint makes a committed report without deliveries impossible'
);

SELECT * FROM finish();

ROLLBACK;
