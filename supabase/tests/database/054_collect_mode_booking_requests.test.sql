BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(72);

-- ---------------------------------------------------------------------------
-- Catalog and authorization contract
-- ---------------------------------------------------------------------------

-- 1
SELECT has_table(
  'public',
  'booking_requests',
  'collect-mode appointment requests have a durable ledger table'
);

-- 2
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.booking_requests'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'business_id', 'uuid',
    'contact_id', 'uuid',
    'conversation_id', 'uuid',
    'source_message_id', 'uuid',
    'requested_service', 'text',
    'requested_time_text', 'text',
    'customer_name', 'text',
    'customer_phone', 'text',
    'customer_email', 'text',
    'status', 'text',
    'handled_at', 'timestamp with time zone',
    'idempotency_key', 'text',
    'created_at', 'timestamp with time zone'
  ),
  'booking requests expose exactly the approved column types'
);

-- 3
SELECT is(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.booking_requests'::regclass
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  ARRAY[
    'business_id',
    'created_at',
    'id',
    'idempotency_key',
    'requested_service',
    'requested_time_text',
    'status'
  ]::name[],
  'request facts remain required while retained provenance is nullable'
);

-- 4
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      pg_get_expr(default_value.adbin, default_value.adrelid)
    )
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.booking_requests'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'gen_random_uuid()',
    'status', '''new''::text',
    'created_at', 'now()'
  ),
  'only request identity, initial status, and insertion time default'
);

-- 5
SELECT is(
  (
    SELECT array_agg(constraint_row.conname ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.booking_requests'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  ARRAY[
    'booking_requests_customer_email_not_blank',
    'booking_requests_customer_name_not_blank',
    'booking_requests_customer_phone_not_blank',
    'booking_requests_handled_shape',
    'booking_requests_idempotency_key_check',
    'booking_requests_service_not_blank',
    'booking_requests_status_check',
    'booking_requests_time_not_blank'
  ]::name[],
  'all request text, lifecycle, and key checks exist and are validated'
);

-- 6
SELECT is(
  (
    SELECT array_agg(
      constraint_row.conname || ':' || constraint_row.confdeltype::text
      ORDER BY constraint_row.conname
    )
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.booking_requests'::regclass
      AND constraint_row.contype = 'f'
  ),
  ARRAY[
    'booking_requests_business_id_fkey:c',
    'booking_requests_contact_id_fkey:n',
    'booking_requests_conversation_id_fkey:n',
    'booking_requests_source_message_id_fkey:n'
  ]::text[],
  'business deletion cascades while provenance deletion retains requests'
);

-- 7
SELECT is(
  (
    SELECT array_agg(index_class.relname ORDER BY index_class.relname)
    FROM pg_class AS index_class
    JOIN pg_index AS index_row
      ON index_row.indexrelid = index_class.oid
    WHERE index_row.indrelid = 'public.booking_requests'::regclass
  ),
  ARRAY[
    'booking_requests_business_created_idx',
    'booking_requests_business_idempotency_unique',
    'booking_requests_business_status_created_idx',
    'booking_requests_contact_idx',
    'booking_requests_conversation_idx',
    'booking_requests_pkey',
    'booking_requests_source_message_idx'
  ]::name[],
  'the exact primary, idempotency, queue, count, and retention index inventory exists'
);

-- 8
SELECT ok(
  (
    SELECT index_row.indisunique
       AND pg_get_indexdef(index_row.indexrelid)
         LIKE '%(business_id, idempotency_key)'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.booking_requests_business_idempotency_unique'::regclass
  ),
  'idempotency is unique per business'
);

-- 9
SELECT ok(
  pg_get_indexdef(
    'public.booking_requests_business_created_idx'::regclass
  ) LIKE '%(business_id, created_at DESC, id DESC)',
  'the owner list index supports stable newest-first reads'
);

-- 10
SELECT ok(
  pg_get_indexdef(
    'public.booking_requests_business_status_created_idx'::regclass
  ) LIKE '%(business_id, status, created_at DESC, id DESC)',
  'the status index supports exact new-request counts and stable reads'
);

-- 11
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_index AS index_row
    WHERE index_row.indexrelid IN (
      'public.booking_requests_contact_idx'::regclass,
      'public.booking_requests_conversation_idx'::regclass,
      'public.booking_requests_source_message_idx'::regclass
    )
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
        LIKE '%IS NOT NULL%'
  ),
  3,
  'all provenance indexes are partial over retained links'
);

-- 12
SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.booking_requests'::regclass
  ),
  'booking requests have row-level security enabled'
);

-- 13
SELECT ok(
  (
    SELECT count(*) = 1
       AND bool_and(policy_row.polname = 'booking_requests_select')
       AND bool_and(policy_row.polcmd = 'r')
       AND bool_and(
         policy_row.polroles = ARRAY[
           (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
         ]
       )
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.booking_requests'::regclass
  ),
  'booking requests expose exactly one authenticated owner-select policy'
);

-- 14
SELECT ok(
  has_table_privilege(
    'authenticated', 'public.booking_requests', 'SELECT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.booking_requests', 'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.booking_requests', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.booking_requests', 'DELETE'
  ),
  'authenticated owners receive read-only table privileges'
);

-- 15
SELECT ok(
  has_table_privilege('service_role', 'public.booking_requests', 'SELECT')
  AND has_table_privilege(
    'service_role', 'public.booking_requests', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.booking_requests', 'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.booking_requests', 'DELETE'
  )
  AND NOT has_table_privilege('anon', 'public.booking_requests', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.booking_requests', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.booking_requests', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.booking_requests', 'DELETE'),
  'service role is append/read only and anonymous clients have no access'
);

-- 16
SELECT ok(
  (
    SELECT array_agg(
             procedure_row.proname
             ORDER BY procedure_row.proname
           ) = ARRAY[
             'guard_booking_request_mutation',
             'guard_contact_booking_request_linkage',
             'guard_conversation_booking_request_linkage',
             'guard_message_booking_request_linkage',
             'scrub_booking_requests_on_business_cleanup',
             'unlink_booking_requests_before_contact_delete',
             'unlink_booking_requests_before_conversation_delete',
             'validate_booking_request_tenant'
           ]::name[]
       AND bool_and(
         procedure_row.prosecdef = (
           procedure_row.proname <> 'guard_booking_request_mutation'
         )
       )
       AND bool_and(
         procedure_row.proconfig = ARRAY['search_path=public, pg_temp']
       )
       AND bool_and(
         NOT has_function_privilege(
           'anon', procedure_row.oid, 'EXECUTE'
         )
       )
       AND bool_and(
         NOT has_function_privilege(
           'authenticated', procedure_row.oid, 'EXECUTE'
         )
       )
       AND bool_and(
         NOT has_function_privilege(
           'service_role', procedure_row.oid, 'EXECUTE'
         )
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'validate_booking_request_tenant',
        'guard_booking_request_mutation',
        'guard_contact_booking_request_linkage',
        'guard_conversation_booking_request_linkage',
        'guard_message_booking_request_linkage',
        'unlink_booking_requests_before_conversation_delete',
        'unlink_booking_requests_before_contact_delete',
        'scrub_booking_requests_on_business_cleanup'
      )
      AND procedure_row.pronargs = 0
  ),
  'the exact helper inventory pins search_path, uses the approved security modes, and denies direct API execution'
);

-- 17
SELECT ok(
  (
    SELECT array_agg(
             trigger_row.tgname
             ORDER BY trigger_row.tgname
           ) = ARRAY[
             'guard_booking_request_mutation',
             'guard_contact_booking_request_linkage',
             'guard_conversation_booking_request_linkage',
             'guard_message_booking_request_linkage',
             'scrub_booking_requests_on_business_cleanup',
             'unlink_booking_requests_before_contact_delete',
             'unlink_booking_requests_before_conversation_delete',
             'validate_booking_request_tenant'
           ]::name[]
       AND bool_and(
         trigger_row.tgfoid = to_regprocedure(
           format('public.%I()', trigger_row.tgname)
         )
       )
       AND bool_and(
         CASE trigger_row.tgname
           WHEN 'validate_booking_request_tenant' THEN
             trigger_row.tgrelid = 'public.booking_requests'::regclass
             AND trigger_row.tgtype = 23
           WHEN 'guard_booking_request_mutation' THEN
             trigger_row.tgrelid = 'public.booking_requests'::regclass
             AND trigger_row.tgtype = 19
           WHEN 'guard_contact_booking_request_linkage' THEN
             trigger_row.tgrelid = 'public.contacts'::regclass
             AND trigger_row.tgtype = 19
             AND pg_get_triggerdef(trigger_row.oid)
               LIKE '%UPDATE OF id, business_id ON public.contacts%'
           WHEN 'guard_conversation_booking_request_linkage' THEN
             trigger_row.tgrelid = 'public.conversations'::regclass
             AND trigger_row.tgtype = 19
             AND pg_get_triggerdef(trigger_row.oid)
               LIKE '%UPDATE OF id, business_id, contact_id, channel ON public.conversations%'
           WHEN 'guard_message_booking_request_linkage' THEN
             trigger_row.tgrelid = 'public.messages'::regclass
             AND trigger_row.tgtype = 19
             AND pg_get_triggerdef(trigger_row.oid)
               LIKE '%UPDATE OF id, business_id, conversation_id, role, channel ON public.messages%'
           WHEN 'unlink_booking_requests_before_conversation_delete' THEN
             trigger_row.tgrelid = 'public.conversations'::regclass
             AND trigger_row.tgtype = 11
           WHEN 'unlink_booking_requests_before_contact_delete' THEN
             trigger_row.tgrelid = 'public.contacts'::regclass
             AND trigger_row.tgtype = 11
           WHEN 'scrub_booking_requests_on_business_cleanup' THEN
             trigger_row.tgrelid = 'public.businesses'::regclass
             AND trigger_row.tgtype = 17
             AND pg_get_triggerdef(trigger_row.oid)
               LIKE '%UPDATE OF cleanup_pii_scrubbed_at ON public.businesses%'
             AND lower(pg_get_triggerdef(trigger_row.oid))
               LIKE '%old.cleanup_pii_scrubbed_at is null%'
             AND lower(pg_get_triggerdef(trigger_row.oid))
               LIKE '%new.cleanup_pii_scrubbed_at is not null%'
           ELSE false
         END
       )
    FROM pg_trigger AS trigger_row
    JOIN pg_proc AS procedure_row
      ON procedure_row.oid = trigger_row.tgfoid
    WHERE NOT trigger_row.tgisinternal
      AND procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'validate_booking_request_tenant',
        'guard_booking_request_mutation',
        'guard_contact_booking_request_linkage',
        'guard_conversation_booking_request_linkage',
        'guard_message_booking_request_linkage',
        'unlink_booking_requests_before_conversation_delete',
        'unlink_booking_requests_before_contact_delete',
        'scrub_booking_requests_on_business_cleanup'
      )
  ),
  'the exact trigger inventory preserves every relation, timing, event, column list, and cleanup predicate'
);

-- 18
SELECT ok(
  (
    SELECT procedure_row.prosecdef
       AND procedure_row.prorettype = 'timestamptz'::regtype
       AND procedure_row.proconfig = ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.mark_booking_request_handled(uuid,uuid)'::regprocedure
  )
  AND has_function_privilege(
    'authenticated',
    'public.mark_booking_request_handled(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.mark_booking_request_handled(uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.mark_booking_request_handled(uuid,uuid)',
    'EXECUTE'
  ),
  'the owner handling function is fixed-path, definer, and authenticated-only'
);

-- ---------------------------------------------------------------------------
-- Tenant fixtures and insert contract
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a054-000000000001',
    'request-owner-a-054@example.test'
  ),
  (
    '00000000-0000-4000-a054-000000000002',
    'request-owner-b-054@example.test'
  ),
  (
    '00000000-0000-4000-a054-000000000003',
    'request-owner-c-054@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a054-000000000001',
    name = 'Request Business A 054',
    slug = 'request-business-a-054'
WHERE owner_id = '00000000-0000-4000-a054-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a054-000000000002',
    name = 'Request Business B 054',
    slug = 'request-business-b-054'
WHERE owner_id = '00000000-0000-4000-a054-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a054-000000000003',
    name = 'Request Business C 054',
    slug = 'request-business-c-054'
WHERE owner_id = '00000000-0000-4000-a054-000000000003';

INSERT INTO public.contacts (
  id,
  business_id,
  name,
  phone_number,
  email,
  source_channel
) VALUES
  (
    '20000000-0000-4000-a054-000000000001',
    '10000000-0000-4000-a054-000000000001',
    'Request Contact A1',
    '+13175550101',
    'request-a1@example.test',
    'web_chat'
  ),
  (
    '20000000-0000-4000-a054-000000000002',
    '10000000-0000-4000-a054-000000000001',
    'Request Contact A2',
    '+13175550102',
    'request-a2@example.test',
    'web_chat'
  ),
  (
    '20000000-0000-4000-a054-000000000003',
    '10000000-0000-4000-a054-000000000001',
    'Request Contact A3',
    '+13175550103',
    'request-a3@example.test',
    'web_chat'
  ),
  (
    '20000000-0000-4000-a054-000000000004',
    NULL,
    'Request Contact B1',
    NULL,
    NULL,
    'web_chat'
  ),
  (
    '20000000-0000-4000-a054-000000000005',
    '10000000-0000-4000-a054-000000000003',
    'Request Contact C1',
    '+13175550105',
    'request-c1@example.test',
    'web_chat'
  );

-- Avoid pre-existing immutable contact-created metric linkage on the hard
-- delete fixture, matching the goal-event retention test precedent.
UPDATE public.contacts
SET business_id = '10000000-0000-4000-a054-000000000002'
WHERE id = '20000000-0000-4000-a054-000000000004';

INSERT INTO public.conversations (
  id,
  business_id,
  contact_id,
  channel
) VALUES
  (
    '30000000-0000-4000-a054-000000000001',
    '10000000-0000-4000-a054-000000000001',
    '20000000-0000-4000-a054-000000000001',
    'web_chat'
  ),
  (
    '30000000-0000-4000-a054-000000000002',
    '10000000-0000-4000-a054-000000000001',
    '20000000-0000-4000-a054-000000000002',
    'web_chat'
  ),
  (
    '30000000-0000-4000-a054-000000000003',
    '10000000-0000-4000-a054-000000000001',
    '20000000-0000-4000-a054-000000000003',
    'web_chat'
  ),
  (
    '30000000-0000-4000-a054-000000000004',
    '10000000-0000-4000-a054-000000000002',
    '20000000-0000-4000-a054-000000000004',
    'web_chat'
  ),
  (
    '30000000-0000-4000-a054-000000000005',
    '10000000-0000-4000-a054-000000000003',
    '20000000-0000-4000-a054-000000000005',
    'web_chat'
  );

INSERT INTO public.messages (
  id,
  conversation_id,
  business_id,
  role,
  content,
  channel
) VALUES
  (
    '40000000-0000-4000-a054-000000000001',
    '30000000-0000-4000-a054-000000000001',
    '10000000-0000-4000-a054-000000000001',
    'customer',
    'I need drain cleaning next Friday after lunch.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a054-000000000002',
    '30000000-0000-4000-a054-000000000001',
    '10000000-0000-4000-a054-000000000001',
    'assistant',
    'I can record that request.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a054-000000000003',
    '30000000-0000-4000-a054-000000000001',
    '10000000-0000-4000-a054-000000000001',
    'customer',
    'This message has the wrong stored channel.',
    'sms'
  ),
  (
    '40000000-0000-4000-a054-000000000004',
    '30000000-0000-4000-a054-000000000002',
    '10000000-0000-4000-a054-000000000001',
    'customer',
    'I want an appointment but do not know the details.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a054-000000000005',
    '30000000-0000-4000-a054-000000000003',
    '10000000-0000-4000-a054-000000000001',
    'customer',
    'Please have someone follow up about a tune-up.',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a054-000000000006',
    '30000000-0000-4000-a054-000000000004',
    '10000000-0000-4000-a054-000000000002',
    'customer',
    'Can I request an appointment?',
    'web_chat'
  ),
  (
    '40000000-0000-4000-a054-000000000007',
    '30000000-0000-4000-a054-000000000005',
    '10000000-0000-4000-a054-000000000003',
    'customer',
    'I need a private consultation tomorrow.',
    'web_chat'
  );

SET LOCAL ROLE service_role;

-- 19
SELECT lives_ok(
  $$
    INSERT INTO public.booking_requests (
      id,
      business_id,
      contact_id,
      conversation_id,
      source_message_id,
      requested_service,
      requested_time_text,
      customer_name,
      customer_phone,
      customer_email,
      idempotency_key
    ) VALUES (
      '50000000-0000-4000-a054-000000000001',
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      ' Drain cleaning ',
      'next Friday after lunch',
      ' Pat Customer ',
      ' (317) 555-0101 ',
      ' PAT@example.test ',
      'request:a1:054'
    )
  $$,
  'service role can insert a fully linked appointment request'
);

INSERT INTO public.booking_requests (
  id,
  business_id,
  contact_id,
  conversation_id,
  source_message_id,
  requested_service,
  requested_time_text,
  customer_name,
  customer_phone,
  customer_email,
  idempotency_key
) VALUES
  (
    '50000000-0000-4000-a054-000000000002',
    '10000000-0000-4000-a054-000000000001',
    '20000000-0000-4000-a054-000000000002',
    '30000000-0000-4000-a054-000000000002',
    '40000000-0000-4000-a054-000000000004',
    'not specified',
    'not specified',
    NULL,
    '+13175550102',
    NULL,
    'request:a2:054'
  ),
  (
    '50000000-0000-4000-a054-000000000003',
    '10000000-0000-4000-a054-000000000001',
    '20000000-0000-4000-a054-000000000003',
    '30000000-0000-4000-a054-000000000003',
    '40000000-0000-4000-a054-000000000005',
    'Tune-up',
    'Saturday morning',
    'Request Contact A3',
    NULL,
    'request-a3@example.test',
    'request:a3:054'
  ),
  (
    '50000000-0000-4000-a054-000000000005',
    '10000000-0000-4000-a054-000000000003',
    '20000000-0000-4000-a054-000000000005',
    '30000000-0000-4000-a054-000000000005',
    '40000000-0000-4000-a054-000000000007',
    'Private consultation',
    'tomorrow',
    'Request Contact C1',
    '+13175550105',
    'request-c1@example.test',
    'request:c1:054'
  );

RESET ROLE;

-- 20
SELECT results_eq(
  $$
    SELECT
      requested_service,
      requested_time_text,
      customer_name,
      customer_phone,
      customer_email
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000001'
  $$,
  $$
    VALUES (
      ' Drain cleaning '::text,
      'next Friday after lunch'::text,
      ' Pat Customer '::text,
      ' (317) 555-0101 '::text,
      ' PAT@example.test '::text
    )
  $$,
  'request text and identity snapshots preserve the supplied bytes'
);

-- 21
SELECT results_eq(
  $$
    SELECT requested_service, requested_time_text
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000002'
  $$,
  $$ VALUES ('not specified'::text, 'not specified'::text) $$,
  'partial-information fallback values persist as ordinary request text'
);

-- 22
SELECT ok(
  (
    SELECT count(*) = 4
       AND bool_and(status = 'new')
       AND bool_and(handled_at IS NULL)
       AND bool_and(created_at IS NOT NULL)
    FROM public.booking_requests
  ),
  'service-written requests receive the exact initial lifecycle defaults'
);

-- 23
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      E'\t\n', 'tomorrow', 'request:blank-service:054'
    )
  $$,
  '23514',
  NULL,
  'service text requires a non-whitespace character'
);

-- 24
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', E'\t\n', 'request:blank-time:054'
    )
  $$,
  '23514',
  NULL,
  'requested-time text requires a non-whitespace character'
);

-- 25
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, customer_name,
      idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', E'\t\n',
      'request:blank-snapshot:054'
    )
  $$,
  '23514',
  NULL,
  'present identity snapshots require a non-whitespace character'
);

-- 26
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, status, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', 'booked',
      'request:bad-status:054'
    )
  $$,
  '23514',
  NULL,
  'booking vocabulary cannot be stored as request status'
);

-- 27
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', ' request:untrimmed:054 '
    )
  $$,
  '23514',
  NULL,
  'idempotency keys reject surrounding whitespace'
);

-- 28
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', repeat('x', 257)
    )
  $$,
  '23514',
  NULL,
  'idempotency keys reject values longer than 256 characters'
);

-- 29
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', 'request:missing-links:054'
    )
  $$,
  '23514',
  'booking request requires contact, conversation, and source message linkage',
  'requests cannot be recorded before complete source provenance exists'
);

-- 30
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, status, handled_at,
      idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', 'handled', now(),
      'request:initial-handled:054'
    )
  $$,
  '23514',
  'booking request must begin in new status',
  'service inserts cannot manufacture already-handled requests'
);

-- 31
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000004',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000001',
      'Drain cleaning', 'tomorrow', 'request:foreign-contact:054'
    )
  $$,
  '23514',
  'booking request contact tenant mismatch',
  'requests reject contacts from another business'
);

-- 32
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000002',
      '40000000-0000-4000-a054-000000000004',
      'Drain cleaning', 'tomorrow', 'request:wrong-contact:054'
    )
  $$,
  '23514',
  'booking request conversation tenant mismatch',
  'requests reject conversations belonging to another contact'
);

-- 33
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000002',
      'Drain cleaning', 'tomorrow', 'request:assistant-source:054'
    )
  $$,
  '23514',
  'booking request source message tenant mismatch',
  'request source provenance must reference a customer message'
);

-- 34
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000004',
      'Drain cleaning', 'tomorrow', 'request:wrong-conversation:054'
    )
  $$,
  '23514',
  'booking request source message tenant mismatch',
  'request source provenance must match its conversation'
);

-- 35
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000001',
      '30000000-0000-4000-a054-000000000001',
      '40000000-0000-4000-a054-000000000003',
      'Drain cleaning', 'tomorrow', 'request:wrong-channel:054'
    )
  $$,
  '23514',
  'booking request source message tenant mismatch',
  'request source channel must match its conversation channel'
);

-- 36
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      '20000000-0000-4000-a054-000000000002',
      '30000000-0000-4000-a054-000000000002',
      '40000000-0000-4000-a054-000000000004',
      'Other service', 'later', 'request:a1:054'
    )
  $$,
  '23505',
  NULL,
  'one business cannot insert the same request key twice'
);

SET LOCAL ROLE service_role;

-- 37
SELECT lives_ok(
  $$
    INSERT INTO public.booking_requests (
      id, business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '50000000-0000-4000-a054-000000000004',
      '10000000-0000-4000-a054-000000000002',
      '20000000-0000-4000-a054-000000000004',
      '30000000-0000-4000-a054-000000000004',
      '40000000-0000-4000-a054-000000000006',
      'Estimate', 'next week', 'request:a1:054'
    )
  $$,
  'the same opaque key remains valid for a different business'
);

RESET ROLE;

-- 38
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET requested_time_text = 'a parsed timestamp'
    WHERE id = '50000000-0000-4000-a054-000000000001'
  $$,
  '55000',
  'booking request facts are immutable',
  'request facts cannot be rewritten after insertion'
);

-- 39
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET source_message_id = '40000000-0000-4000-a054-000000000004'
    WHERE id = '50000000-0000-4000-a054-000000000001'
  $$,
  '55000',
  'booking request provenance is immutable; retained linkages may only be cleared',
  'request provenance cannot be relinked to another source message'
);

-- 40
SELECT throws_ok(
  $$
    UPDATE public.contacts
    SET business_id = '10000000-0000-4000-a054-000000000002'
    WHERE id = '20000000-0000-4000-a054-000000000001'
  $$,
  '23514',
  'contact linkage is immutable while booking requests exist',
  'linked contacts cannot drift between businesses'
);

-- 41
SELECT throws_ok(
  $$
    UPDATE public.conversations
    SET channel = 'sms'
    WHERE id = '30000000-0000-4000-a054-000000000001'
  $$,
  '23514',
  'conversation linkage is immutable while booking requests exist',
  'linked conversation identity and channel cannot drift'
);

-- 42
SELECT throws_ok(
  $$
    UPDATE public.messages
    SET role = 'human_agent'
    WHERE id = '40000000-0000-4000-a054-000000000001'
  $$,
  '23514',
  'message linkage is immutable while booking requests exist',
  'linked message role and tenant identity cannot drift'
);

-- 43
SELECT lives_ok(
  $$
    UPDATE public.contacts
    SET name = NULL,
        email = NULL,
        phone_number = NULL,
        notes = NULL
    WHERE id = '20000000-0000-4000-a054-000000000002';

    UPDATE public.messages
    SET content = '[deleted]'
    WHERE id = '40000000-0000-4000-a054-000000000004'
  $$,
  'parent guards permit existing contact and message PII cleanup'
);

-- ---------------------------------------------------------------------------
-- Runtime RLS and owner handling
-- ---------------------------------------------------------------------------

-- Transaction-local setup for the businesses subquery used by owner RLS.
GRANT SELECT ON public.businesses TO authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a054-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- 44
SELECT is(
  (SELECT count(*)::integer FROM public.booking_requests),
  3,
  'an owner sees only their own appointment requests'
);

-- 45
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000001',
      'Forged', 'tomorrow', 'request:owner-forged:054'
    )
  $$,
  '42501',
  NULL,
  'owners cannot forge appointment requests'
);

-- 46
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET status = 'handled', handled_at = now()
  $$,
  '42501',
  NULL,
  'owners cannot update request rows directly'
);

-- 47
SELECT throws_ok(
  $$ DELETE FROM public.booking_requests $$,
  '42501',
  NULL,
  'owners cannot delete appointment requests'
);

-- 48
SELECT ok(
  public.mark_booking_request_handled(
    '10000000-0000-4000-a054-000000000001',
    '50000000-0000-4000-a054-000000000001'
  ) IS NOT NULL,
  'an owner can mark their new request handled through the narrow function'
);

-- 49
SELECT ok(
  (
    SELECT status = 'handled' AND handled_at IS NOT NULL
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000001'
  ),
  'the handling function records the terminal state with database time'
);

-- 50
SELECT is(
  public.mark_booking_request_handled(
    '10000000-0000-4000-a054-000000000001',
    '50000000-0000-4000-a054-000000000001'
  ),
  (
    SELECT handled_at
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000001'
  ),
  'repeated handling is idempotent and returns the original timestamp'
);

-- 51
SELECT throws_ok(
  $$
    SELECT public.mark_booking_request_handled(
      '10000000-0000-4000-a054-000000000002',
      '50000000-0000-4000-a054-000000000004'
    )
  $$,
  'P0002',
  'booking request not found',
  'a foreign request is indistinguishable from a missing request'
);

-- 52
SELECT throws_ok(
  $$
    SELECT public.mark_booking_request_handled(
      '10000000-0000-4000-a054-000000000001',
      '50000000-0000-4000-a054-000000000099'
    )
  $$,
  'P0002',
  'booking request not found',
  'a missing request uses the same owner-safe error'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a054-000000000002',
  true
);
SET LOCAL ROLE authenticated;

-- 53
SELECT is(
  (SELECT count(*)::integer FROM public.booking_requests),
  1,
  'a second owner sees only the second business request'
);

-- 54
SELECT throws_ok(
  $$
    SELECT public.mark_booking_request_handled(
      '10000000-0000-4000-a054-000000000001',
      '50000000-0000-4000-a054-000000000001'
    )
  $$,
  'P0002',
  'booking request not found',
  'a second owner cannot handle the first owner request'
);

RESET ROLE;
SET LOCAL ROLE anon;

-- 55
SELECT throws_ok(
  $$ SELECT count(*) FROM public.booking_requests $$,
  '42501',
  NULL,
  'anonymous clients cannot read appointment requests'
);

-- 56
SELECT throws_ok(
  $$
    SELECT public.mark_booking_request_handled(
      '10000000-0000-4000-a054-000000000001',
      '50000000-0000-4000-a054-000000000001'
    )
  $$,
  '42501',
  NULL,
  'anonymous clients cannot execute the handling function'
);

RESET ROLE;
SET LOCAL ROLE service_role;

-- 57
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET status = 'handled', handled_at = now()
    WHERE id = '50000000-0000-4000-a054-000000000002'
  $$,
  '42501',
  NULL,
  'service role cannot update appointment requests'
);

-- 58
SELECT throws_ok(
  $$
    DELETE FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000002'
  $$,
  '42501',
  NULL,
  'service role cannot delete appointment requests'
);

-- 59
SELECT throws_ok(
  $$
    SELECT public.mark_booking_request_handled(
      '10000000-0000-4000-a054-000000000001',
      '50000000-0000-4000-a054-000000000002'
    )
  $$,
  '42501',
  NULL,
  'service role cannot execute the owner handling function'
);

RESET ROLE;

-- 60
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET status = 'new', handled_at = NULL
    WHERE id = '50000000-0000-4000-a054-000000000001'
  $$,
  '55000',
  'booking request status is terminal once handled',
  'handled requests cannot be reopened'
);

-- 61
SELECT throws_ok(
  $$
    UPDATE public.booking_requests
    SET requested_service = '[deleted]',
        requested_time_text = '[deleted]',
        customer_name = NULL,
        customer_phone = NULL,
        customer_email = NULL
    WHERE id = '50000000-0000-4000-a054-000000000002'
  $$,
  '55000',
  'booking request facts are immutable',
  'request facts cannot be manually scrubbed before permanent cleanup'
);

-- ---------------------------------------------------------------------------
-- Message, conversation, contact, cleanup, and business retention
-- ---------------------------------------------------------------------------

-- 62
SELECT lives_ok(
  $$
    DELETE FROM public.messages
    WHERE id = '40000000-0000-4000-a054-000000000004'
  $$,
  'an individual source message can be deleted without deleting its request'
);

-- 63
SELECT ok(
  (
    SELECT source_message_id IS NULL
       AND conversation_id IS NOT NULL
       AND contact_id IS NOT NULL
       AND requested_service = 'not specified'
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000002'
  ),
  'source deletion clears only that provenance and retains request facts'
);

-- 64
SELECT lives_ok(
  $$
    DELETE FROM public.conversations
    WHERE id = '30000000-0000-4000-a054-000000000002'
  $$,
  'conversation deletion atomically detaches retained request linkage'
);

-- 65
SELECT ok(
  (
    SELECT contact_id IS NOT NULL
       AND conversation_id IS NULL
       AND source_message_id IS NULL
       AND idempotency_key = 'request:a2:054'
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000002'
  ),
  'conversation deletion retains contact and request truth without dangling links'
);

-- 66
SELECT lives_ok(
  $$
    DELETE FROM public.contacts
    WHERE id = '20000000-0000-4000-a054-000000000003'
  $$,
  'contact deletion atomically clears all retained request provenance'
);

-- 67
SELECT ok(
  (
    SELECT contact_id IS NULL
       AND conversation_id IS NULL
       AND source_message_id IS NULL
       AND requested_service = 'Tune-up'
       AND requested_time_text = 'Saturday morning'
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000003'
  ),
  'contact deletion preserves the request with no dangling provenance'
);

-- 68
SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET cleanup_pii_scrubbed_at = now()
    WHERE id = '10000000-0000-4000-a054-000000000003'
  $$,
  'permanent business cleanup can scrub retained appointment requests'
);

-- 69
SELECT ok(
  (
    SELECT requested_service = '[deleted]'
       AND requested_time_text = '[deleted]'
       AND customer_name IS NULL
       AND customer_phone IS NULL
       AND customer_email IS NULL
       AND status = 'new'
       AND handled_at IS NULL
       AND idempotency_key = 'request:c1:054'
       AND contact_id IS NOT NULL
       AND conversation_id IS NOT NULL
       AND source_message_id IS NOT NULL
    FROM public.booking_requests
    WHERE id = '50000000-0000-4000-a054-000000000005'
  ),
  'cleanup scrubs customer text while retaining anonymous lifecycle and provenance'
);

-- 70
SELECT throws_ok(
  $$
    INSERT INTO public.booking_requests (
      business_id, contact_id, conversation_id, source_message_id,
      requested_service, requested_time_text, idempotency_key
    ) VALUES (
      '10000000-0000-4000-a054-000000000003',
      '20000000-0000-4000-a054-000000000005',
      '30000000-0000-4000-a054-000000000005',
      '40000000-0000-4000-a054-000000000007',
      'Late PII', 'after cleanup', 'request:late-c1:054'
    )
  $$,
  '23514',
  'booking request business is unavailable',
  'new customer request data cannot race into a scrubbed tombstone'
);

-- 71
SELECT lives_ok(
  $$
    DELETE FROM public.businesses
    WHERE id = '10000000-0000-4000-a054-000000000002'
  $$,
  'hard business deletion can cascade through request fixtures'
);

-- 72
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.booking_requests
    WHERE business_id = '10000000-0000-4000-a054-000000000002'
  ),
  0,
  'hard business deletion removes its appointment-request history'
);

SELECT * FROM finish();

ROLLBACK;
