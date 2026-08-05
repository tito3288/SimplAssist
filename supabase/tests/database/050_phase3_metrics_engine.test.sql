BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(66);

-- ---------------------------------------------------------------------------
-- Catalog, immutability, authorization, and content-free contracts
-- ---------------------------------------------------------------------------

-- 1
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
      ORDER BY attribute.attnum
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.business_metric_events'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'business_id', 'uuid',
    'partner_id_at_event', 'uuid',
    'metric_key', 'text',
    'quantity', 'bigint',
    'occurred_at', 'timestamp with time zone',
    'definition_version', 'integer',
    'attribution', 'text',
    'source_key', 'text',
    'origin', 'text'
  ),
  'the metric ledger has the exact count-only column contract'
);

-- 2
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.business_metric_events'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  10,
  'the metric ledger contains no hidden payload columns'
);

-- 3
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name IN (
        'business_metric_events',
        'business_metric_definitions'
      )
      AND (
        column_row.data_type IN ('json', 'jsonb', 'bytea')
        OR column_row.column_name ~* '(content|message|metadata|phone|prompt|token|payload)'
      )
  ),
  'metric storage has no content, metadata, phone, prompt, token, or payload columns'
);

-- 4
SELECT ok(
  pg_get_constraintdef(
    (
      SELECT constraint_row.oid
      FROM pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.business_metric_events'::regclass
        AND constraint_row.conname = 'business_metric_events_metric_key_check'
    )
  ) LIKE ALL (ARRAY[
    '%missed_call_caught%',
    '%ai_conversation_engaged%',
    '%booking_confirmed%',
    '%web_chat_session_engaged%',
    '%contact_created%',
    '%hot_lead_classified%',
    '%sms_message_inbound%',
    '%sms_message_outbound%',
    '%sms_parts_inbound%',
    '%sms_parts_outbound%',
    '%mms_event_inbound%',
    '%mms_event_outbound%'
  ]),
  'the ledger CHECK enumerates every approved v1 metric key'
);

-- 5
SELECT ok(
  (
    SELECT count(*) = 5
       AND bool_and(constraint_row.convalidated)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.business_metric_events'::regclass
      AND constraint_row.conname IN (
        'business_metric_events_quantity_check',
        'business_metric_events_attribution_check',
        'business_metric_events_source_key_check',
        'business_metric_events_source_contract_check',
        'business_metric_events_origin_check'
      )
  ),
  'quantity, attribution, source-key, and booking-origin checks are validated'
);

-- 6
SELECT ok(
  (
    SELECT constraint_row.contype = 'u'
       AND pg_get_constraintdef(constraint_row.oid)
             = 'UNIQUE (metric_key, source_key)'
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.business_metric_events'::regclass
      AND constraint_row.conname =
            'business_metric_events_metric_source_unique'
  ),
  'metric key plus source key is the immutable idempotency boundary'
);

-- 7
SELECT is(
  (
    SELECT constraint_row.confdeltype::text
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.business_metric_events'::regclass
      AND constraint_row.conname =
            'business_metric_events_business_id_fkey'
  ),
  'r',
  'business metric history restricts hard business deletion'
);

-- 8
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.business_metric_events'::regclass
      AND constraint_row.contype = 'f'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%partner_id_at_event%'
  ),
  'event-time partner attribution deliberately has no foreign key'
);

-- 9
SELECT ok(
  pg_get_indexdef(
    'public.business_metric_events_business_occurred_metric_idx'::regclass
  ) LIKE '%(business_id, occurred_at, metric_key)%'
  AND pg_get_indexdef(
    'public.business_metric_events_partner_occurred_idx'::regclass
  ) LIKE '%(partner_id_at_event, occurred_at)%',
  'the ledger has only the two targeted reporting indexes'
);

-- 10
SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.business_metric_events'::regclass
  )
  AND (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.business_metric_definitions'::regclass
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid IN (
      'public.business_metric_events'::regclass,
      'public.business_metric_definitions'::regclass
    )
  ),
  'metric tables use RLS with no customer-facing policies'
);

-- 11
SELECT ok(
  (
    SELECT count(*) = 19
    FROM information_schema.column_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name = 'business_metric_events'
      AND privilege.grantee = 'service_role'
      AND privilege.privilege_type IN ('SELECT', 'INSERT')
  )
  AND NOT has_table_privilege(
    'service_role', 'public.business_metric_events', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.business_metric_events', 'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.business_metric_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.business_metric_events', 'INSERT'
  ),
  'the service role has column-scoped append/read access and customer roles have none'
);

-- 12
SELECT ok(
  (
    SELECT count(*) = 12
       AND count(*) FILTER (WHERE definition_version = 1) = 12
       AND count(*) FILTER (WHERE supports_historical_backfill) = 9
       AND bool_and(available_since IS NOT NULL)
    FROM public.business_metric_definitions
  ),
  'the immutable catalog exposes all v1 availability and backfill definitions'
);

-- 13
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.business_metric_events'::regclass
      AND trigger_row.tgname = 'reject_business_metric_events_mutation'
      AND NOT trigger_row.tgisinternal
  )
  AND EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.business_metric_definitions'::regclass
      AND trigger_row.tgname = 'reject_business_metric_definitions_mutation'
      AND NOT trigger_row.tgisinternal
  ),
  'both metric history tables reject update and delete mutations'
);

-- 14
SELECT ok(
  to_regprocedure(
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.backfill_business_metric_events_v1()'
  ) IS NOT NULL
  AND to_regprocedure(
    'public.list_admin_monthly_business_metrics_v1(date,text,uuid)'
  ) IS NOT NULL
  AND pg_get_function_result(
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'::regprocedure
  ) = 'boolean'
  AND pg_get_function_result(
    'public.backfill_business_metric_events_v1()'::regprocedure
  ) = 'bigint'
  AND pg_get_function_result(
    'public.list_admin_monthly_business_metrics_v1(date,text,uuid)'::regprocedure
  ) = 'jsonb',
  'the three versioned metric RPCs have exact identities and return types'
);

-- 15
SELECT ok(
  (
    SELECT count(*) = 3
       AND bool_and(NOT procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
       )
       AND bool_and(
         CASE procedure_row.proname
           WHEN 'list_admin_monthly_business_metrics_v1'
             THEN procedure_row.provolatile = 's'
           ELSE procedure_row.provolatile = 'v'
         END
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'::regprocedure,
      'public.backfill_business_metric_events_v1()'::regprocedure,
      'public.list_admin_monthly_business_metrics_v1(date,text,uuid)'::regprocedure
    ])
  ),
  'metric RPCs are fixed-path SECURITY INVOKER with correct volatility'
);

-- 16
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.backfill_business_metric_events_v1()',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.list_admin_monthly_business_metrics_v1(date,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_admin_monthly_business_metrics_v1(date,text,uuid)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS privilege
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'::regprocedure,
      'public.backfill_business_metric_events_v1()'::regprocedure,
      'public.list_admin_monthly_business_metrics_v1(date,text,uuid)'::regprocedure
    ])
      AND privilege.grantee = 0
      AND privilege.privilege_type = 'EXECUTE'
  ),
  'metric RPC execution is granted only to service_role'
);

-- 17
SELECT ok(
  (
    SELECT count(*) = 3
       AND bool_and(procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.record_contact_created_metric_v1()'::regprocedure,
      'public.record_hot_lead_classified_metric_v1()'::regprocedure,
      'public.record_ai_booking_confirmed_metric_v1()'::regprocedure
    ])
  )
  AND NOT has_function_privilege(
    'service_role', 'public.record_contact_created_metric_v1()', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_hot_lead_classified_metric_v1()',
    'EXECUTE'
  ),
  'SQL-native metric hooks are fixed-path, uncallable SECURITY DEFINER triggers'
);

-- 18
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.contacts'::regclass
      AND tgname = 'record_contact_created_metric_v1'
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.lead_events'::regclass
      AND tgname = 'record_hot_lead_classified_metric_v1'
      AND NOT tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.calendar_bookings'::regclass
      AND tgname = 'record_ai_booking_confirmed_metric_v1'
      AND NOT tgisinternal
  ),
  'contacts, HOT audits, and AI confirmations have durable metric hooks'
);

-- 19
SELECT ok(
  lower(pg_get_functiondef(
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'::regprocedure
  )) !~ '(messages\\.|content|metadata|phone_number|prompt|token)'
  AND lower(pg_get_functiondef(
    'public.backfill_business_metric_events_v1()'::regprocedure
  )) !~ '(messages\\.|content|metadata|phone|prompt|token|payload)'
  AND lower(pg_get_functiondef(
    'public.list_admin_monthly_business_metrics_v1(date,text,uuid)'::regprocedure
  )) !~ '(messages\\.|content|metadata|phone|prompt|token|payload)',
  'recording, backfill, and aggregate definitions never select content-bearing fields'
);

-- 20
SELECT ok(
  to_regprocedure(
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'
  ) IS NOT NULL
  AND pg_get_function_result(
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'::regprocedure
  ) = 'boolean'
  AND (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'::regprocedure
  ),
  'the billing usage RPC retains its exact deployed callable contract'
);

-- ---------------------------------------------------------------------------
-- Recorder idempotency, event-time attribution, and strict scope
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id, name, slug, custom_domain, domain_status, status
) VALUES
  (
    '20000000-0000-4000-a050-000000000001',
    'Metrics Partner A',
    'metrics-partner-a-050',
    'metrics-a-050.example.com',
    'connected',
    'active'
  ),
  (
    '20000000-0000-4000-a050-000000000002',
    'Metrics Partner B',
    'metrics-partner-b-050',
    'metrics-b-050.example.com',
    'connected',
    'active'
  );

INSERT INTO public.businesses (
  id, name, business_type, slug, partner_id, billing_mode, partner_plan
) VALUES
  (
    '10000000-0000-4000-a050-000000000001',
    'Metrics Direct',
    'general',
    'metrics-direct-050',
    NULL,
    'stripe',
    NULL
  ),
  (
    '10000000-0000-4000-a050-000000000002',
    'Metrics Partner A Business',
    'general',
    'metrics-partner-a-business-050',
    '20000000-0000-4000-a050-000000000001',
    'invoiced',
    'sms_and_chat'
  ),
  (
    '10000000-0000-4000-a050-000000000003',
    'Metrics Partner B Business',
    'general',
    'metrics-partner-b-business-050',
    '20000000-0000-4000-a050-000000000002',
    'comped',
    'full'
  ),
  (
    '10000000-0000-4000-a050-000000000004',
    'Metrics Transfer Business',
    'general',
    'metrics-transfer-050',
    '20000000-0000-4000-a050-000000000001',
    'invoiced',
    'sms_only'
  ),
  (
    '10000000-0000-4000-a050-000000000005',
    'Metrics Poison Business',
    'general',
    'metrics-poison-050',
    NULL,
    'stripe',
    NULL
  );

SET LOCAL ROLE service_role;

-- 21
SELECT is(
  public.record_business_metric_event_v1(
    '10000000-0000-4000-a050-000000000001',
    'missed_call_caught',
    2,
    '2020-04-01 00:00:00+00',
    'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    NULL
  ),
  true,
  'the first source key records an event'
);

-- 22
SELECT is(
  public.record_business_metric_event_v1(
    '10000000-0000-4000-a050-000000000001',
    'missed_call_caught',
    99,
    '2020-04-15 00:00:00+00',
    'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    NULL
  ),
  false,
  'a duplicate metric/source key is a successful no-op'
);

RESET ROLE;

-- 23
SELECT ok(
  (
    SELECT quantity = 2
       AND occurred_at = '2020-04-01 00:00:00+00'::timestamptz
       AND partner_id_at_event IS NULL
       AND attribution = 'event_time'
    FROM public.business_metric_events
    WHERE metric_key = 'missed_call_caught'
      AND source_key =
        'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  'a duplicate cannot rewrite quantity, time, attribution, or partner snapshot'
);

SET LOCAL ROLE service_role;

SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000001',
  'missed_call_caught',
  10,
  '2020-03-31 23:59:59.999999+00',
  'missed-call:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000001',
  'missed_call_caught',
  20,
  '2020-05-01 00:00:00+00',
  'missed-call:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000002',
  'contact_created',
  1,
  '2020-04-10 12:00:00+00',
  'contact-created:30000000-0000-4000-a050-0000000000a1',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000003',
  'hot_lead_classified',
  5,
  '2020-04-11 12:00:00+00',
  'hot-lead:60000000-0000-4000-a050-0000000000a1',
  NULL
);
SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000004',
  'booking_confirmed',
  1,
  '2020-04-12 12:00:00+00',
  'ai-booking:70000000-0000-4000-a050-0000000000a1',
  'ai'
);

RESET ROLE;

UPDATE public.businesses
SET partner_id = '20000000-0000-4000-a050-000000000002',
    billing_mode = 'invoiced',
    partner_plan = 'sms_only'
WHERE id = '10000000-0000-4000-a050-000000000004';

SET LOCAL ROLE service_role;

SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000004',
  'booking_confirmed',
  1,
  '2020-04-13 12:00:00+00',
  'dashboard-booking:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
  'dashboard'
);

RESET ROLE;

-- 24
SELECT results_eq(
  $$
    SELECT partner_id_at_event
    FROM public.business_metric_events
    WHERE business_id = '10000000-0000-4000-a050-000000000004'
      AND metric_key = 'booking_confirmed'
    ORDER BY occurred_at
  $$,
  $$
    VALUES
      ('20000000-0000-4000-a050-000000000001'::uuid),
      ('20000000-0000-4000-a050-000000000002'::uuid)
  $$,
  'partner attribution is snapshotted separately at each event time'
);

-- 25
SELECT throws_ok(
  $$
    SELECT public.record_business_metric_event_v1(
      '10000000-0000-4000-a050-000000000001',
      'contact_created',
      0,
      now(),
      'contact-created:30000000-0000-4000-a050-0000000000a2',
      NULL
    )
  $$,
  '22023',
  'invalid business metric event payload',
  'the recorder rejects non-positive quantities before writing'
);

-- 26
SELECT throws_ok(
  $$
    SELECT public.record_business_metric_event_v1(
      '10000000-0000-4000-a050-000000000001',
      'booking_confirmed',
      1,
      now(),
      'dashboard-booking:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
      'email'
    )
  $$,
  '23514',
  NULL,
  'the ledger rejects booking origins outside ai and dashboard'
);

SET LOCAL ROLE authenticated;

-- 27
SELECT throws_ok(
  $$
    SELECT public.record_business_metric_event_v1(
      '10000000-0000-4000-a050-000000000001',
      'contact_created',
      1,
      now(),
      'contact-created:30000000-0000-4000-a050-0000000000a3',
      NULL
    )
  $$,
  '42501',
  NULL,
  'authenticated callers cannot invoke the recorder'
);

RESET ROLE;
SET LOCAL ROLE service_role;

CREATE TEMP TABLE metrics_050_all AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01', 'all', NULL
) AS payload;
CREATE TEMP TABLE metrics_050_direct AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01', 'direct', NULL
) AS payload;
CREATE TEMP TABLE metrics_050_partner_a AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01',
  'partner',
  '20000000-0000-4000-a050-000000000001'
) AS payload;
CREATE TEMP TABLE metrics_050_partner_b AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01',
  'partner',
  '20000000-0000-4000-a050-000000000002'
) AS payload;

RESET ROLE;

-- 28
SELECT ok(
  (
    SELECT payload -> 'period' = jsonb_build_object(
      'month', '2020-04',
      'start', '2020-04-01 00:00:00+00'::timestamptz,
      'end_exclusive', '2020-05-01 00:00:00+00'::timestamptz
    )
    FROM metrics_050_all
  ),
  'the aggregate computes exact server-side UTC month boundaries'
);

-- 29
SELECT ok(
  (
    SELECT (payload #>> '{totals,missed_call_caught}')::bigint = 2
       AND jsonb_array_length(payload -> 'businesses') = 1
       AND payload #>> '{scope,kind}' = 'direct'
    FROM metrics_050_direct
  )
  AND (
    SELECT business_row ->> 'business_id' =
             '10000000-0000-4000-a050-000000000001'
       AND business_row -> 'partner_id_at_event' = 'null'::jsonb
    FROM metrics_050_direct,
      LATERAL jsonb_array_elements(payload -> 'businesses') AS business_row
  ),
  'direct scope includes only null event-time attribution and excludes both month edges correctly'
);

-- 30
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 2
       AND (payload #>> '{totals,contact_created}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 1
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business_row
         WHERE business_row ->> 'partner_id_at_event' IS DISTINCT FROM
           '20000000-0000-4000-a050-000000000001'
       )
    FROM metrics_050_partner_a
  ),
  'partner A scope cannot contain a direct or partner B business segment'
);

-- 31
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 2
       AND (payload #>> '{totals,hot_lead_classified}')::bigint = 5
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 1
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business_row
         WHERE business_row ->> 'partner_id_at_event' IS DISTINCT FROM
           '20000000-0000-4000-a050-000000000002'
       )
    FROM metrics_050_partner_b
  ),
  'partner B scope cannot contain a direct or partner A business segment'
);

-- 32
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 5
       AND jsonb_array_length(payload -> 'brand_totals') = 3
       AND jsonb_array_length(payload -> 'definitions') = 12
    FROM metrics_050_all
  )
  AND (
    SELECT count(*) = 2
    FROM metrics_050_all,
      LATERAL jsonb_array_elements(payload -> 'businesses') AS business_row
    WHERE business_row ->> 'business_id' =
      '10000000-0000-4000-a050-000000000004'
  ),
  'all scope retains separate per-business segments across partner reassignment'
);

-- 33
SELECT ok(
  (
    SELECT (payload #>> '{totals,missed_call_caught}')::bigint = 2
       AND (payload #>> '{totals,contact_created}')::bigint = 1
       AND (payload #>> '{totals,hot_lead_classified}')::bigint = 5
       AND (payload #>> '{totals,booking_confirmed}')::bigint = 2
    FROM metrics_050_all
  ),
  'overall totals sum quantity rather than counting ledger rows'
);

-- 34
SELECT ok(
  (
    SELECT (payload #>> '{totals,booking_confirmed_ai}')::bigint = 1
       AND (payload #>> '{totals,booking_confirmed_dashboard}')::bigint = 1
    FROM metrics_050_all
  ),
  'booking totals retain exact AI and dashboard origin breakdowns'
);

-- 35
SELECT is(
  (
    SELECT SUM(
      (business_row #>> '{counts,booking_confirmed}')::bigint
    )::bigint
    FROM metrics_050_all,
      LATERAL jsonb_array_elements(payload -> 'businesses') AS business_row
  ),
  (
    SELECT (payload #>> '{totals,booking_confirmed}')::bigint
    FROM metrics_050_all
  ),
  'overall totals equal the structurally filtered business rows'
);

-- 36
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      '2020-04-01',
      'all',
      '20000000-0000-4000-a050-000000000001'
    )
  $$,
  '22023',
  'invalid_metric_scope',
  'all scope rejects a stale partner parameter instead of ignoring it'
);

-- 37
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      '2020-04-01', 'partner', NULL
    )
  $$,
  '22023',
  'invalid_metric_scope',
  'partner scope requires one exact partner id'
);

-- 38
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      '2020-04-02', 'direct', NULL
    )
  $$,
  '22023',
  'invalid_metric_month',
  'the aggregate rejects dates that are not month starts'
);

DELETE FROM public.partners
WHERE id = '20000000-0000-4000-a050-000000000001';

-- 39
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.business_metric_events
    WHERE partner_id_at_event =
      '20000000-0000-4000-a050-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.partners
    WHERE id = '20000000-0000-4000-a050-000000000001'
  ),
  'deleting a partner row cannot erase historical attribution'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE metrics_050_deleted_partner AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01',
  'partner',
  '20000000-0000-4000-a050-000000000001'
) AS payload;
RESET ROLE;

-- 40
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 2
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(payload -> 'businesses') AS business_row
         WHERE business_row ->> 'partner_id_at_event' IS DISTINCT FROM
           '20000000-0000-4000-a050-000000000001'
       )
    FROM metrics_050_deleted_partner
  ),
  'exact partner scope remains isolated after the partner configuration row is gone'
);

-- 41
SELECT throws_ok(
  $$
    UPDATE public.business_metric_events
    SET quantity = quantity + 1
    WHERE source_key =
      'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $$,
  '55000',
  'business metric history is immutable',
  'ledger rows cannot be updated'
);

-- 42
SELECT throws_ok(
  $$
    DELETE FROM public.business_metric_events
    WHERE source_key =
      'missed-call:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  $$,
  '55000',
  'business metric history is immutable',
  'ledger rows cannot be deleted'
);

-- 43
SELECT throws_ok(
  $$
    DELETE FROM public.businesses
    WHERE id = '10000000-0000-4000-a050-000000000001'
  $$,
  '23503',
  NULL,
  'an unexpected hard business delete cannot cascade metric history'
);

-- ---------------------------------------------------------------------------
-- Fail-open database hooks and billing mirror isolation
-- ---------------------------------------------------------------------------

SET LOCAL session_replication_role = replica;

INSERT INTO public.contacts (
  id, business_id, source_channel, created_at
) VALUES (
  '30000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  'sms',
  '2020-04-14 12:00:00+00'
);

INSERT INTO public.conversations (
  id, business_id, contact_id, channel, status
) VALUES (
  '40000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  '30000000-0000-4000-a050-000000000001',
  'sms',
  'active'
);

INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
) VALUES (
  '50000000-0000-4000-a050-000000000001',
  '40000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  'customer',
  '050 secret message content',
  'sms'
);

SET LOCAL session_replication_role = origin;

CREATE FUNCTION public.poison_business_metric_insert_050()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.business_id = '10000000-0000-4000-a050-000000000005' THEN
    RAISE EXCEPTION '050 metric poison';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER poison_business_metric_insert_050
BEFORE INSERT ON public.business_metric_events
FOR EACH ROW
EXECUTE FUNCTION public.poison_business_metric_insert_050();

INSERT INTO public.contacts (
  id, business_id, source_channel, created_at, phone_number, notes
) VALUES (
  '30000000-0000-4000-a050-000000000002',
  '10000000-0000-4000-a050-000000000005',
  'sms',
  '2020-04-15 12:00:00+00',
  '+13175550123',
  '050 secret contact notes'
);

INSERT INTO public.lead_events (
  id, business_id, contact_id, event_type, reason, created_at
) VALUES (
  '60000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  '30000000-0000-4000-a050-000000000001',
  'became_hot',
  '050 secret reason',
  '2020-04-16 12:00:00+00'
);

INSERT INTO public.calendar_bookings (
  id,
  business_id,
  contact_id,
  conversation_id,
  source_message_id,
  google_calendar_id,
  google_event_id,
  event_summary,
  request_fingerprint,
  status,
  starts_at,
  ends_at,
  confirmed_at
) VALUES (
  '70000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  '30000000-0000-4000-a050-000000000001',
  '40000000-0000-4000-a050-000000000001',
  '50000000-0000-4000-a050-000000000001',
  '050-secret-calendar@example.test',
  '050-secret-provider-event',
  '050 secret booking summary',
  repeat('a', 64),
  'confirmed',
  '2020-04-17 12:00:00+00',
  '2020-04-17 13:00:00+00',
  '2020-04-16 13:00:00+00'
);

INSERT INTO public.billing_usage_periods (
  id, business_id, period_start, period_end, plan, included_sms_parts
) VALUES (
  '80000000-0000-4000-a050-000000000001',
  '10000000-0000-4000-a050-000000000005',
  '2020-04-01 00:00:00+00',
  '2020-05-01 00:00:00+00',
  'sms_only',
  500
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE metrics_050_usage_first AS
SELECT public.record_billing_usage_event(
  '10000000-0000-4000-a050-000000000005',
  '80000000-0000-4000-a050-000000000001',
  'telnyx:poison-usage-a050',
  'outbound',
  'mms',
  'ai_reply',
  2,
  1,
  '050-secret-provider-message',
  '{"phone":"+13175550999","content":"050 secret usage metadata"}'::jsonb
) AS inserted;
RESET ROLE;

-- 44
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.contacts
    WHERE id = '30000000-0000-4000-a050-000000000002'
  )
  AND EXISTS (
    SELECT 1 FROM public.lead_events
    WHERE id = '60000000-0000-4000-a050-000000000001'
  )
  AND EXISTS (
    SELECT 1 FROM public.calendar_bookings
    WHERE id = '70000000-0000-4000-a050-000000000001'
      AND confirmed_at IS NOT NULL
  ),
  'contact, HOT classification, and AI booking source writes survive metric exceptions'
);

-- 45
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_metric_events
    WHERE business_id = '10000000-0000-4000-a050-000000000005'
  ),
  0,
  'failed SQL-native hooks leave no partial metric rows'
);

-- 46
SELECT ok(
  (SELECT inserted FROM metrics_050_usage_first)
  AND EXISTS (
    SELECT 1
    FROM public.billing_usage_events
    WHERE idempotency_key = 'telnyx:poison-usage-a050'
      AND metric_partner_snapshot_captured
      AND metric_partner_id_at_event IS NULL
  )
  AND (
    SELECT outbound_sms_parts = 2
       AND outbound_mms_events = 1
    FROM public.billing_usage_periods
    WHERE id = '80000000-0000-4000-a050-000000000001'
  ),
  'billing usage and counters commit when every metric mirror is forced to fail'
);

-- 47
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_metric_events
    WHERE business_id = '10000000-0000-4000-a050-000000000005'
      AND metric_key IN (
        'sms_message_outbound',
        'sms_parts_outbound',
        'mms_event_outbound'
      )
  ),
  0,
  'the exception-isolated billing mirror rolls back all mirror rows without rolling back usage'
);

-- Reassignment after the failed mirror must not change the brand snapshot
-- used by the duplicate repair below.
UPDATE public.businesses
SET partner_id = '20000000-0000-4000-a050-000000000002',
    billing_mode = 'invoiced',
    partner_plan = 'sms_and_chat'
WHERE id = '10000000-0000-4000-a050-000000000005';

DROP TRIGGER poison_business_metric_insert_050
  ON public.business_metric_events;
DROP FUNCTION public.poison_business_metric_insert_050();

SET LOCAL ROLE service_role;
CREATE TEMP TABLE metrics_050_usage_retry AS
SELECT public.record_billing_usage_event(
  '10000000-0000-4000-a050-000000000005',
  '80000000-0000-4000-a050-000000000001',
  'telnyx:poison-usage-a050',
  'outbound',
  'mms',
  'ai_reply',
  2,
  1,
  '050-secret-provider-message',
  '{"phone":"+13175550999","content":"050 secret usage metadata"}'::jsonb
) AS inserted;
RESET ROLE;

-- 48
SELECT ok(
  NOT (SELECT inserted FROM metrics_050_usage_retry)
  AND (
    SELECT outbound_sms_parts = 2
       AND outbound_mms_events = 1
    FROM public.billing_usage_periods
    WHERE id = '80000000-0000-4000-a050-000000000001'
  )
  AND (
    SELECT count(*) = 3
       AND SUM(quantity) = 4
       AND bool_and(partner_id_at_event IS NULL)
       AND bool_and(attribution = 'event_time')
    FROM public.business_metric_events
    WHERE business_id = '10000000-0000-4000-a050-000000000005'
      AND source_key LIKE 'billing-usage:%'
  ),
  'a duplicate usage call repairs all mirrors with the original event-time brand snapshot'
);

-- 49
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.business_metric_events AS event
    WHERE to_jsonb(event)::text LIKE ANY (ARRAY[
      '%050 secret message content%',
      '%050 secret contact notes%',
      '%050 secret reason%',
      '%050 secret booking summary%',
      '%050 secret usage metadata%',
      '%+1317555%'
    ])
  ),
  'metric rows never copy content, reasons, metadata, summaries, or phone numbers'
);

-- ---------------------------------------------------------------------------
-- Real tombstone cleanup survival
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id, name, slug, custom_domain, domain_status, status
) VALUES (
  '20000000-0000-4000-a050-000000000003',
  'Metrics Tombstone Partner',
  'metrics-tombstone-partner-050',
  'metrics-tombstone-050.example.com',
  'connected',
  'active'
);

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a050-000000000001',
  'metrics-tombstone-a050@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a050-000000000006',
    name = 'Metrics Tombstone Business',
    slug = 'metrics-tombstone-business-050',
    partner_id = '20000000-0000-4000-a050-000000000003',
    billing_mode = 'invoiced',
    partner_plan = 'sms_and_chat'
WHERE owner_id = '00000000-0000-4000-a050-000000000001';

SET LOCAL ROLE service_role;
SELECT public.record_business_metric_event_v1(
  '10000000-0000-4000-a050-000000000006',
  'contact_created',
  1,
  '2020-04-18 12:00:00+00',
  'contact-created:30000000-0000-4000-a050-000000000006',
  NULL
);
RESET ROLE;

SET LOCAL session_replication_role = replica;
UPDATE public.businesses
SET deleted_at = now() - interval '60 days 1 second',
    deletion_scheduled_for = now() - interval '1 second'
WHERE id = '10000000-0000-4000-a050-000000000006';
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE metrics_050_cleanup AS
SELECT public.cleanup_expired_business(
  '10000000-0000-4000-a050-000000000006'
) AS owner_id;

-- 50
SELECT is(
  (SELECT owner_id FROM metrics_050_cleanup),
  '00000000-0000-4000-a050-000000000001'::uuid,
  'the real terminal cleanup completes for the metric-bearing business'
);

-- 51
SELECT ok(
  (
    SELECT name = '[deleted]'
       AND owner_id IS NULL
       AND partner_id IS NULL
       AND cleanup_pii_scrubbed_at IS NOT NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a050-000000000006'
  )
  AND (
    SELECT partner_id_at_event =
             '20000000-0000-4000-a050-000000000003'
       AND attribution = 'event_time'
    FROM public.business_metric_events
    WHERE source_key =
      'contact-created:30000000-0000-4000-a050-000000000006'
  ),
  'tombstoning scrubs current assignment but preserves event-time metric history'
);

-- 52
SELECT ok(
  lower(pg_get_functiondef(
    'public.cleanup_expired_business(uuid)'::regprocedure
  )) NOT LIKE '%business_metric_events%'
  AND lower(pg_get_functiondef(
    'public.cleanup_hot_lead_data_on_tombstone()'::regprocedure
  )) NOT LIKE '%business_metric_events%',
  'the deletion engine contains no metric-ledger scrub path'
);

-- 53
SELECT throws_ok(
  $$
    UPDATE public.business_metric_definitions
    SET available_since = now()
    WHERE metric_key = 'missed_call_caught'
      AND definition_version = 1
  $$,
  '55000',
  'business metric history is immutable',
  'metric definition versions cannot be rewritten'
);

-- 54
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.business_metric_events
    WHERE metric_key IN (
      'ai_conversation_engaged',
      'web_chat_session_engaged'
    )
      AND attribution = 'current_assignment_backfill'
  ),
  'no unrecoverable engagement history is synthesized by live database hooks'
);

-- 55
SELECT throws_ok(
  $$
    INSERT INTO public.business_metric_events (
      business_id,
      partner_id_at_event,
      metric_key,
      quantity,
      occurred_at,
      definition_version,
      attribution,
      source_key,
      origin
    ) VALUES (
      '10000000-0000-4000-a050-000000000001',
      NULL,
      'missed_call_caught',
      1,
      now(),
      1,
      'event_time',
      'missed-call:raw-provider-session-token',
      NULL
    )
  $$,
  '23514',
  NULL,
  'the ledger structurally rejects raw external identifiers as source keys'
);

-- 56
SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'billing_usage_events'
      AND column_row.column_name = 'metric_partner_id_at_event'
      AND column_row.data_type = 'uuid'
      AND column_row.is_nullable = 'YES'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'billing_usage_events'
      AND column_row.column_name = 'metric_partner_snapshot_captured'
      AND column_row.data_type = 'boolean'
      AND column_row.is_nullable = 'NO'
      AND column_row.column_default = 'false'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.billing_usage_events'::regclass
      AND constraint_row.contype = 'f'
      AND pg_get_constraintdef(constraint_row.oid)
            LIKE '%metric_partner_id_at_event%'
  )
  AND lower(pg_get_functiondef(
    'public.record_business_metric_event_v1(uuid,text,bigint,timestamptz,text,text)'::regprocedure
  )) NOT LIKE '%for share%'
  AND lower(pg_get_functiondef(
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'::regprocedure
  )) LIKE '%metric_partner_snapshot_captured%'
  AND lower(pg_get_functiondef(
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'::regprocedure
  )) NOT LIKE '%for share%'
  AND lower(pg_get_functiondef(
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)'::regprocedure
  )) LIKE '%business metric partner snapshot failed%',
  'billing mirror repair persists an exception-isolated content-free MVCC partner snapshot without row locks'
);

-- 57
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      '2020-04-01',
      'direct',
      '20000000-0000-4000-a050-000000000002'
    )
  $$,
  '22023',
  'invalid_metric_scope',
  'direct scope rejects a partner parameter instead of ignoring it'
);

-- 58
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      '2020-04-01', 'reseller', NULL
    )
  $$,
  '22023',
  'invalid_metric_scope',
  'the aggregate rejects unknown scope kinds'
);

-- 59
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      NULL, 'all', NULL
    )
  $$,
  '22023',
  'invalid_metric_month',
  'the aggregate rejects a null month'
);

-- 60
SELECT throws_ok(
  $$
    SELECT public.list_admin_monthly_business_metrics_v1(
      'infinity'::date, 'all', NULL
    )
  $$,
  '22023',
  'invalid_metric_month',
  'the aggregate rejects a non-finite month'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE metrics_050_empty AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '1999-02-01', 'all', NULL
) AS payload;

SET LOCAL TIME ZONE 'America/Indiana/Indianapolis';
CREATE TEMP TABLE metrics_050_non_utc_session AS
SELECT public.list_admin_monthly_business_metrics_v1(
  '2020-04-01', 'all', NULL
) AS payload;
RESET ROLE;

-- 61
SELECT ok(
  (
    SELECT jsonb_array_length(payload -> 'businesses') = 0
       AND jsonb_array_length(payload -> 'brand_totals') = 0
       AND jsonb_array_length(payload -> 'definitions') = 12
       AND NOT EXISTS (
         SELECT 1
         FROM jsonb_each(payload -> 'totals') AS count_row
         WHERE count_row.value <> '0'::jsonb
       )
    FROM metrics_050_empty
  ),
  'an empty UTC month returns definitions, exact zero totals, and empty scoped rows'
);

-- 62
SELECT ok(
  (
    SELECT payload #>> '{period,start}' =
             '2020-04-01T00:00:00+00:00'
       AND payload #>> '{period,end_exclusive}' =
             '2020-05-01T00:00:00+00:00'
    FROM metrics_050_non_utc_session
  ),
  'period metadata serializes as UTC even when the caller session is non-UTC'
);

-- 63
SELECT ok(
  (
    SELECT payload - ARRAY[
      'period',
      'scope',
      'definitions',
      'totals',
      'brand_totals',
      'businesses',
      'partner_options'
    ]::text[] = '{}'::jsonb
      AND (
        SELECT count(*) = 7
        FROM jsonb_object_keys(payload) AS top_level_key
      )
      AND (payload -> 'period') - ARRAY[
        'month', 'start', 'end_exclusive'
      ]::text[] = '{}'::jsonb
      AND (
        SELECT count(*) = 3
        FROM jsonb_object_keys(payload -> 'period') AS period_key
      )
      AND (payload -> 'scope') - ARRAY[
        'kind', 'partner_id'
      ]::text[] = '{}'::jsonb
      AND (
        SELECT count(*) = 2
        FROM jsonb_object_keys(payload -> 'scope') AS scope_key
      )
      AND (
        SELECT count(*) = 14
        FROM jsonb_object_keys(payload -> 'totals') AS count_key
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each(payload -> 'totals') AS count_row
        WHERE jsonb_typeof(count_row.value) <> 'number'
           OR (count_row.value #>> '{}')::numeric < 0
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload -> 'definitions') AS definition
        WHERE definition - ARRAY[
          'metric_key',
          'definition_version',
          'available_since',
          'supports_historical_backfill'
        ]::text[] <> '{}'::jsonb
          OR (
            SELECT count(*) <> 4
            FROM jsonb_object_keys(definition) AS definition_key
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload -> 'brand_totals') AS brand
        WHERE brand - ARRAY[
          'brand_kind',
          'partner_id_at_event',
          'partner_name',
          'partner_slug',
          'counts'
        ]::text[] <> '{}'::jsonb
          OR (
            SELECT count(*) <> 5
            FROM jsonb_object_keys(brand) AS brand_key
          )
          OR (
            SELECT count(*) <> 14
            FROM jsonb_object_keys(brand -> 'counts') AS count_key
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload -> 'businesses') AS business
        WHERE business - ARRAY[
          'business_id',
          'business_name',
          'partner_id_at_event',
          'partner_name',
          'partner_slug',
          'counts'
        ]::text[] <> '{}'::jsonb
          OR (
            SELECT count(*) <> 6
            FROM jsonb_object_keys(business) AS business_key
          )
          OR (
            SELECT count(*) <> 14
            FROM jsonb_object_keys(business -> 'counts') AS count_key
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(payload -> 'partner_options') AS option_row
        WHERE option_row - ARRAY[
          'partner_id', 'partner_name', 'partner_slug'
        ]::text[] <> '{}'::jsonb
          OR (
            SELECT count(*) <> 3
            FROM jsonb_object_keys(option_row) AS option_key
          )
      )
    FROM metrics_050_all
  )
  AND (
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(payload -> 'partner_options') AS option_row
      WHERE option_row ->> 'partner_id' =
        '20000000-0000-4000-a050-000000000001'
        AND option_row -> 'partner_name' = 'null'::jsonb
    )
    FROM metrics_050_deleted_partner
  ),
  'aggregate JSON has exact count-only shapes and retains deleted historical partner filter options'
);

-- 64
SELECT ok(
  (
    SELECT NOT EXISTS (
      SELECT 1
      FROM jsonb_each(payload -> 'totals') AS total_count
      WHERE (total_count.value #>> '{}')::bigint IS DISTINCT FROM (
        SELECT COALESCE(
          SUM((business -> 'counts' ->> total_count.key)::bigint),
          0
        )
        FROM jsonb_array_elements(payload -> 'businesses') AS business
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(payload -> 'brand_totals') AS brand
      CROSS JOIN LATERAL jsonb_each(brand -> 'counts') AS brand_count
      WHERE (brand_count.value #>> '{}')::bigint IS DISTINCT FROM (
        SELECT COALESCE(
          SUM((business -> 'counts' ->> brand_count.key)::bigint),
          0
        )
        FROM jsonb_array_elements(payload -> 'businesses') AS business
        WHERE business -> 'partner_id_at_event' =
          brand -> 'partner_id_at_event'
      )
    )
    FROM metrics_050_all
  ),
  'every overall and brand count reconciles to the same filtered business rows'
);

-- 65
SELECT throws_ok(
  $$
    SELECT public.record_business_metric_event_v1(
      '10000000-0000-4000-a050-000000000001',
      'booking_confirmed',
      1,
      now(),
      'ai-booking:70000000-0000-4000-a050-0000000000a4',
      NULL
    )
  $$,
  '23514',
  NULL,
  'booking metrics require a non-null AI or dashboard origin'
);

INSERT INTO public.billing_usage_periods (
  id, business_id, period_start, period_end, plan, included_sms_parts
) VALUES (
  '80000000-0000-4000-a050-000000000002',
  '10000000-0000-4000-a050-000000000001',
  '2020-06-01 00:00:00+00',
  '2020-07-01 00:00:00+00',
  'sms_only',
  500
);

-- Reuse the existing authenticated test role so no cluster-level role state is
-- created. All privilege/RLS changes are transaction-local and roll back.
REVOKE SELECT ON TABLE public.businesses FROM PUBLIC, authenticated;
ALTER TABLE public.billing_usage_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_usage_periods DISABLE ROW LEVEL SECURITY;
GRANT EXECUTE ON FUNCTION public.record_billing_usage_event(
  uuid, uuid, text, text, text, text, integer, integer, text, jsonb
) TO authenticated;
GRANT SELECT, INSERT ON TABLE public.billing_usage_events
  TO authenticated;
GRANT SELECT, UPDATE ON TABLE public.billing_usage_periods
  TO authenticated;

CREATE TEMP TABLE metrics_050_snapshot_failure_result (
  inserted boolean NOT NULL
);
GRANT INSERT ON TABLE metrics_050_snapshot_failure_result
  TO authenticated;

SET LOCAL ROLE authenticated;
INSERT INTO metrics_050_snapshot_failure_result (inserted)
SELECT public.record_billing_usage_event(
  '10000000-0000-4000-a050-000000000001',
  '80000000-0000-4000-a050-000000000002',
  'snapshot-failure-a050',
  'outbound',
  'sms',
  'ai_reply',
  1,
  0,
  NULL,
  NULL
);
RESET ROLE;

-- 66
SELECT ok(
  NOT has_column_privilege(
    'authenticated',
    'public.businesses',
    'partner_id',
    'SELECT'
  )
  AND (SELECT inserted FROM metrics_050_snapshot_failure_result)
  AND EXISTS (
    SELECT 1
    FROM public.billing_usage_events
    WHERE idempotency_key = 'snapshot-failure-a050'
      AND NOT metric_partner_snapshot_captured
      AND metric_partner_id_at_event IS NULL
  )
  AND (
    SELECT outbound_sms_parts = 1
    FROM public.billing_usage_periods
    WHERE id = '80000000-0000-4000-a050-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.business_metric_events AS metric_event
    JOIN public.billing_usage_events AS usage_event
      ON metric_event.source_key = 'billing-usage:' || usage_event.id::text
    WHERE usage_event.idempotency_key = 'snapshot-failure-a050'
  ),
  'a forced partner-snapshot permission failure cannot fail usage, counters, or leak a partial mirror'
);

SELECT * FROM finish();

ROLLBACK;
