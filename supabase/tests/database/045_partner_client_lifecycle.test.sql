BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(129);

-- ---------------------------------------------------------------------------
-- Provisioning dismissal and operation-lease catalog
-- ---------------------------------------------------------------------------

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.partner_client_provisioning_jobs'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'email', 'text',
    'requested_business_name', 'text',
    'partner_id', 'uuid',
    'billing_mode', 'text',
    'partner_plan', 'text',
    'auth_user_id', 'uuid',
    'business_id', 'uuid',
    'status', 'text',
    'last_error_code', 'text',
    'setup_email_sent_at', 'timestamp with time zone',
    'invite_attempt_count', 'integer',
    'dismissed_at', 'timestamp with time zone',
    'dismissed_by_admin_id', 'uuid',
    'operation_token', 'uuid',
    'operation_kind', 'text',
    'operation_started_at', 'timestamp with time zone',
    'operation_expires_at', 'timestamp with time zone',
    'created_by_admin_id', 'uuid',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'provisioning jobs have the exact lifecycle column types'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.partner_client_provisioning_jobs'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  21,
  'provisioning jobs have no extra or missing lifecycle columns'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT attribute.attnotnull
      AND default_value.oid IS NULL
    )
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid =
      'public.partner_client_provisioning_jobs'::regclass
      AND attribute.attname IN (
        'dismissed_at',
        'dismissed_by_admin_id',
        'operation_token',
        'operation_kind',
        'operation_started_at',
        'operation_expires_at'
      )
  ),
  'all dismissal and operation fields are nullable without defaults'
);

SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.partner_client_provisioning_jobs'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  ARRAY[
    'partner_client_provisioning_jobs_billing_mode_check',
    'partner_client_provisioning_jobs_invite_attempt_count_check',
    'partner_client_provisioning_jobs_partner_plan_check',
    'partner_client_provisioning_jobs_requested_business_name_check',
    'partner_client_provisioning_jobs_status_check',
    'provisioning_dismissed_shape',
    'provisioning_email_canonical',
    'provisioning_operation_shape'
  ]::name[],
  'provisioning jobs retain their checks and add exact dismissal/lease shapes'
);

SELECT ok(
  (
    SELECT NOT index_row.indisunique
       AND pg_get_indexdef(index_row.indexrelid)
         LIKE '%(operation_expires_at)%WHERE (operation_token IS NOT NULL)%'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.partner_client_provisioning_jobs_operation_idx'::regclass
  ),
  'provisioning operation expiry has the exact partial queue index'
);

SELECT has_trigger(
  'public',
  'partner_client_provisioning_jobs',
  'set_updated_at_partner_client_provisioning_jobs',
  'provisioning lifecycle writes continue maintaining updated_at'
);

SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid =
      'public.partner_client_provisioning_jobs'::regclass
  ),
  'provisioning jobs retain row-level security'
);

SELECT policies_are(
  'public',
  'partner_client_provisioning_jobs',
  ARRAY[]::name[],
  'provisioning jobs still expose no customer policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid =
      'public.partner_client_provisioning_jobs'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC retains no provisioning-table privilege'
);

SELECT table_privs_are(
  'public',
  'partner_client_provisioning_jobs',
  'anon',
  ARRAY[]::name[],
  'anon retains no provisioning-table privileges'
);

SELECT table_privs_are(
  'public',
  'partner_client_provisioning_jobs',
  'authenticated',
  ARRAY[]::name[],
  'authenticated retains no provisioning-table privileges'
);

SELECT table_privs_are(
  'public',
  'partner_client_provisioning_jobs',
  'service_role',
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role retains exact provisioning CRUD privileges'
);

-- ---------------------------------------------------------------------------
-- PII-lean admin action events
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'admin_action_events',
  'admin lifecycle actions have a private durable audit table'
);

SELECT col_is_pk(
  'public',
  'admin_action_events',
  'id',
  'admin action event ids are the primary key'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.admin_action_events'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'actor_admin_user_id', 'uuid',
    'action', 'text',
    'business_id', 'uuid',
    'provisioning_job_id', 'uuid',
    'deletion_scheduled_for', 'timestamp with time zone',
    'summary', 'jsonb',
    'created_at', 'timestamp with time zone'
  ),
  'admin action events have the exact approved column types'
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
  'admin action events have no extra or missing columns'
);

SELECT is(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.admin_action_events'::regclass
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  ARRAY[
    'action',
    'actor_admin_user_id',
    'created_at',
    'id',
    'summary'
  ]::name[],
  'only durable event identity, action, time, and sanitized summary are required'
);

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
    WHERE attribute.attrelid = 'public.admin_action_events'::regclass
  ),
  jsonb_build_object(
    'id', 'gen_random_uuid()',
    'summary', '''{}''::jsonb',
    'created_at', 'now()'
  ),
  'admin action events have only the approved database defaults'
);

SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  ARRAY[
    'admin_action_events_action_check',
    'admin_action_events_summary_check',
    'admin_action_summary_shape',
    'admin_action_target_shape'
  ]::name[],
  'admin action values and sanitized summary shapes are database constrained'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.admin_action_events'::regclass
      AND constraint_row.contype = 'f'
  ),
  0,
  'admin action identifiers intentionally survive deletion without foreign keys'
);

SELECT ok(
  to_regclass('public.admin_action_deletion_once') IS NOT NULL
  AND to_regclass('public.admin_action_events_business_idx') IS NOT NULL
  AND to_regclass('public.admin_action_events_job_idx') IS NOT NULL,
  'admin action events have exact deduplication and lookup indexes'
);

SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.admin_action_events'::regclass
  ),
  'admin action events have row-level security enabled'
);

SELECT policies_are(
  'public',
  'admin_action_events',
  ARRAY[]::name[],
  'admin action events intentionally expose no customer policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid = 'public.admin_action_events'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC has no admin-action-table privilege'
);

SELECT table_privs_are(
  'public',
  'admin_action_events',
  'anon',
  ARRAY[]::name[],
  'anon has no admin-action-table privileges'
);

SELECT table_privs_are(
  'public',
  'admin_action_events',
  'authenticated',
  ARRAY[]::name[],
  'authenticated has no admin-action-table privileges'
);

SELECT table_privs_are(
  'public',
  'admin_action_events',
  'service_role',
  ARRAY['INSERT', 'SELECT']::name[],
  'service_role has append-only admin-action privileges'
);

SELECT lives_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      business_id,
      deletion_scheduled_for,
      summary
    ) VALUES (
      '90000000-0000-4000-a045-000000000001',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000001',
      now() + interval '30 days',
      jsonb_build_object(
        'business_id', '10000000-0000-4000-a045-000000000001',
        'business_name', 'Lifecycle Fixture',
        'billing_mode', 'invoiced',
        'partner_slug', 'lifecycle-partner',
        'resource_counts', jsonb_build_object(
          'auth_users', 1,
          'provisioning_jobs', 1,
          'assigned_phone_rows', 0,
          'google_calendar_token_rows', 0,
          'configuration_rows', 4,
          'contact_rows_to_scrub', 2,
          'message_rows_to_scrub', 3
        )
      )
    )
  $$,
  'the exact PII-lean deletion summary whitelist is accepted'
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
      '90000000-0000-4000-a045-000000000002',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000002',
      now() + interval '30 days',
      jsonb_build_object(
        'business_id', '10000000-0000-4000-a045-000000000002',
        'business_name', 'Lifecycle Fixture',
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
        ),
        'email', 'must-not-enter-audit@example.test'
      )
    )
  $$,
  '23514',
  NULL,
  'deletion audit rejects extra top-level keys including email'
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
      '90000000-0000-4000-a045-000000000003',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000003',
      now() + interval '30 days',
      jsonb_build_object(
        'business_id', '10000000-0000-4000-a045-000000000099',
        'business_name', 'Lifecycle Fixture',
        'billing_mode', 'comped',
        'partner_slug', 'lifecycle-partner',
        'resource_counts', jsonb_build_object(
          'auth_users', 1,
          'provisioning_jobs', 1,
          'assigned_phone_rows', 0,
          'google_calendar_token_rows', 0,
          'configuration_rows', 0,
          'contact_rows_to_scrub', 0,
          'message_rows_to_scrub', 0
        )
      )
    )
  $$,
  '23514',
  NULL,
  'deletion audit summary business id must equal its event target'
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
      '90000000-0000-4000-a045-000000000004',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000004',
      now() + interval '30 days',
      jsonb_build_object(
        'business_id', '10000000-0000-4000-a045-000000000004',
        'business_name', 'Lifecycle Fixture',
        'billing_mode', 'stripe',
        'partner_slug', NULL,
        'resource_counts', jsonb_build_object(
          'auth_users', 1,
          'provisioning_jobs', 0,
          'assigned_phone_rows', 0,
          'google_calendar_token_rows', 0,
          'configuration_rows', 0,
          'contact_rows_to_scrub', 0,
          'message_rows_to_scrub', 0,
          'raw_provider_payloads', 1
        )
      )
    )
  $$,
  '23514',
  NULL,
  'deletion audit rejects resource-count keys outside the exact whitelist'
);

SELECT lives_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      provisioning_job_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a045-000000000005',
      'provisioning_job_dismissed',
      '30000000-0000-4000-a045-000000000005',
      '{}'::jsonb
    )
  $$,
  'provisioning lifecycle audit accepts only an empty summary'
);

SELECT throws_ok(
  $$
    INSERT INTO public.admin_action_events (
      actor_admin_user_id,
      action,
      provisioning_job_id,
      summary
    ) VALUES (
      '90000000-0000-4000-a045-000000000006',
      'provisioning_job_restored',
      '30000000-0000-4000-a045-000000000006',
      '{"last_error_code":"email_in_use"}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'provisioning lifecycle audit cannot retain error or PII detail'
);

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
      '90000000-0000-4000-a045-000000000007',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000007',
      now() + interval '30 days',
      jsonb_set(
        summary - 'business_name',
        '{business_id}',
        to_jsonb('10000000-0000-4000-a045-000000000007'::text)
      )
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  $$,
  '23514',
  NULL,
  'deletion audit requires every top-level whitelisted key'
);

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
      '90000000-0000-4000-a045-000000000008',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000008',
      now() + interval '30 days',
      jsonb_set(
        jsonb_set(
          summary,
          '{business_id}',
          to_jsonb('10000000-0000-4000-a045-000000000008'::text)
        ),
        '{resource_counts,auth_users}',
        '-1'::jsonb
      )
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  $$,
  '23514',
  NULL,
  'deletion audit resource counts cannot be negative'
);

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
      '90000000-0000-4000-a045-000000000009',
      'account_deletion_scheduled',
      '10000000-0000-4000-a045-000000000009',
      now() + interval '30 days',
      jsonb_set(
        jsonb_set(
          summary,
          '{business_id}',
          to_jsonb('10000000-0000-4000-a045-000000000009'::text)
        ),
        '{resource_counts,auth_users}',
        '1.5'::jsonb
      )
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  $$,
  '23514',
  NULL,
  'deletion audit resource counts must be integers'
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
      '90000000-0000-4000-a045-000000000010',
      'provisioning_job_dismissed',
      '10000000-0000-4000-a045-000000000010',
      '30000000-0000-4000-a045-000000000010',
      '{}'::jsonb
    )
  $$,
  '23514',
  NULL,
  'a provisioning action cannot also target a business deletion'
);

-- ---------------------------------------------------------------------------
-- Canonical Google Calendar OAuth handoff attempts
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'google_calendar_oauth_attempts',
  'Google Calendar uses a private durable cross-host attempt table'
);

SELECT col_is_pk(
  'public',
  'google_calendar_oauth_attempts',
  'id',
  'Google Calendar OAuth attempt ids are the primary key'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'state_digest', 'text',
    'origin_verifier_digest', 'text',
    'handoff_digest', 'text',
    'business_id', 'uuid',
    'owner_user_id', 'uuid',
    'origin_partner_id', 'uuid',
    'origin_hostname', 'text',
    'status', 'text',
    'authorization_code', 'text',
    'sanitized_result', 'text',
    'expires_at', 'timestamp with time zone',
    'handoff_expires_at', 'timestamp with time zone',
    'claimed_at', 'timestamp with time zone',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'OAuth attempts have the exact approved column types'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  16,
  'OAuth attempts have no extra or missing columns'
);

SELECT is(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  ARRAY[
    'business_id',
    'created_at',
    'expires_at',
    'id',
    'origin_hostname',
    'origin_verifier_digest',
    'owner_user_id',
    'state_digest',
    'status',
    'updated_at'
  ]::name[],
  'only stable OAuth attempt identity and ownership fields are required'
);

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
    WHERE attribute.attrelid =
      'public.google_calendar_oauth_attempts'::regclass
  ),
  jsonb_build_object(
    'id', 'gen_random_uuid()',
    'status', '''initiated''::text',
    'created_at', 'now()',
    'updated_at', 'now()'
  ),
  'OAuth attempts have only the approved database defaults'
);

SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  ARRAY[
    'google_calendar_oauth_attempt_expiry',
    'google_calendar_oauth_attempt_shape',
    'google_calendar_oauth_attempts_authorization_code_check',
    'google_calendar_oauth_attempts_handoff_digest_check',
    'google_calendar_oauth_attempts_origin_hostname_check',
    'google_calendar_oauth_attempts_origin_verifier_digest_check',
    'google_calendar_oauth_attempts_sanitized_result_check',
    'google_calendar_oauth_attempts_state_digest_check',
    'google_calendar_oauth_attempts_status_check'
  ]::name[],
  'OAuth digests, state machine, result, and expiry are all constrained'
);

SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND constraint_row.contype = 'u'
  ),
  ARRAY[
    'google_calendar_oauth_attempts_handoff_digest_key',
    'google_calendar_oauth_attempts_state_digest_key'
  ]::name[],
  'raw-state and handoff digests are independently single-use'
);

SELECT ok(
  (
    SELECT bool_and(
      constraint_row.confdeltype = 'c'
      AND constraint_row.confrelid IN (
        'public.businesses'::regclass,
        'auth.users'::regclass,
        'public.partners'::regclass
      )
    )
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND constraint_row.contype = 'f'
  )
  AND (
    SELECT count(*) = 3
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.google_calendar_oauth_attempts'::regclass
      AND constraint_row.contype = 'f'
  ),
  'business, owner, and partner deletion each cascade OAuth attempts'
);

SELECT ok(
  to_regclass('public.google_calendar_oauth_attempts_expiry_idx') IS NOT NULL,
  'OAuth attempts have an expiry queue index'
);

SELECT has_trigger(
  'public',
  'google_calendar_oauth_attempts',
  'set_updated_at_google_calendar_oauth_attempts',
  'OAuth attempt writes maintain updated_at'
);

SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid =
      'public.google_calendar_oauth_attempts'::regclass
  ),
  'OAuth attempts have row-level security enabled'
);

SELECT policies_are(
  'public',
  'google_calendar_oauth_attempts',
  ARRAY[]::name[],
  'OAuth attempts intentionally expose no customer policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid =
      'public.google_calendar_oauth_attempts'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC has no OAuth-attempt-table privilege'
);

SELECT table_privs_are(
  'public',
  'google_calendar_oauth_attempts',
  'anon',
  ARRAY[]::name[],
  'anon has no OAuth-attempt-table privileges'
);

SELECT table_privs_are(
  'public',
  'google_calendar_oauth_attempts',
  'authenticated',
  ARRAY[]::name[],
  'authenticated has no OAuth-attempt-table privileges'
);

SELECT table_privs_are(
  'public',
  'google_calendar_oauth_attempts',
  'service_role',
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has exact OAuth-attempt CRUD privileges'
);

-- ---------------------------------------------------------------------------
-- Exact service RPC catalog and execution boundary
-- ---------------------------------------------------------------------------

SELECT is(
  (
    SELECT jsonb_object_agg(
      procedure_row.proname,
      pg_get_function_result(procedure_row.oid)
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.claim_partner_client_provisioning_operation(uuid,text,uuid,uuid,timestamptz)'::regprocedure,
      'public.dismiss_partner_client_provisioning_job(uuid,uuid,timestamptz)'::regprocedure,
      'public.restore_partner_client_provisioning_job(uuid,uuid)'::regprocedure,
      'public.get_account_deletion_preview(uuid)'::regprocedure,
      'public.schedule_admin_account_deletion(uuid,text,boolean,uuid)'::regprocedure,
      'public.purge_expired_google_calendar_oauth_attempts(timestamptz)'::regprocedure,
      'public.create_google_calendar_oauth_attempt(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.stage_google_calendar_oauth_handoff(text,text,text,text,timestamptz)'::regprocedure,
      'public.claim_google_calendar_oauth_handoff(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
    ])
  ),
  jsonb_build_object(
    'claim_partner_client_provisioning_operation',
      'partner_client_provisioning_jobs',
    'dismiss_partner_client_provisioning_job',
      'partner_client_provisioning_jobs',
    'restore_partner_client_provisioning_job',
      'partner_client_provisioning_jobs',
    'get_account_deletion_preview', 'jsonb',
    'schedule_admin_account_deletion', 'jsonb',
    'purge_expired_google_calendar_oauth_attempts', 'integer',
    'create_google_calendar_oauth_attempt', 'uuid',
    'stage_google_calendar_oauth_handoff', 'jsonb',
    'claim_google_calendar_oauth_handoff', 'jsonb',
    'complete_google_calendar_oauth_connection', 'boolean'
  ),
  'public lifecycle RPCs have the exact approved signatures and returns'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT procedure_row.prosecdef
      AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.claim_partner_client_provisioning_operation(uuid,text,uuid,uuid,timestamptz)'::regprocedure,
      'public.dismiss_partner_client_provisioning_job(uuid,uuid,timestamptz)'::regprocedure,
      'public.restore_partner_client_provisioning_job(uuid,uuid)'::regprocedure,
      'public.lock_account_provisioning_jobs(uuid,uuid,timestamptz)'::regprocedure,
      'public.discard_unattempted_partner_stripe_action(uuid,timestamptz)'::regprocedure,
      'public.account_deletion_preview_json(uuid)'::regprocedure,
      'public.account_deletion_audit_summary_json(uuid)'::regprocedure,
      'public.get_account_deletion_preview(uuid)'::regprocedure,
      'public.schedule_admin_account_deletion(uuid,text,boolean,uuid)'::regprocedure,
      'public.purge_expired_google_calendar_oauth_attempts(timestamptz)'::regprocedure,
      'public.create_google_calendar_oauth_attempt(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.stage_google_calendar_oauth_handoff(text,text,text,text,timestamptz)'::regprocedure,
      'public.claim_google_calendar_oauth_handoff(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure,
      'public.schedule_account_deletion(uuid,uuid,timestamptz,timestamptz)'::regprocedure,
      'public.prepare_account_reactivation(uuid,uuid)'::regprocedure,
      'public.complete_account_reactivation(uuid,uuid,bigint,uuid)'::regprocedure,
      'public.cleanup_expired_business(uuid)'::regprocedure
    ])
  ),
  'every callable lifecycle function is security-invoker with a fixed search path'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      procedure_row.proname,
      procedure_row.pronargdefaults
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.claim_partner_client_provisioning_operation(uuid,text,uuid,uuid,timestamptz)'::regprocedure,
      'public.dismiss_partner_client_provisioning_job(uuid,uuid,timestamptz)'::regprocedure,
      'public.lock_account_provisioning_jobs(uuid,uuid,timestamptz)'::regprocedure,
      'public.discard_unattempted_partner_stripe_action(uuid,timestamptz)'::regprocedure,
      'public.purge_expired_google_calendar_oauth_attempts(timestamptz)'::regprocedure,
      'public.claim_google_calendar_oauth_handoff(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
    ])
  ),
  jsonb_build_object(
    'claim_partner_client_provisioning_operation', 2,
    'dismiss_partner_client_provisioning_job', 1,
    'lock_account_provisioning_jobs', 1,
    'discard_unattempted_partner_stripe_action', 1,
    'purge_expired_google_calendar_oauth_attempts', 1,
    'claim_google_calendar_oauth_handoff', 1,
    'complete_google_calendar_oauth_connection', 1
  ),
  'only the approved trailing RPC arguments have defaults'
);

SELECT ok(
  (
    SELECT bool_and(
      has_function_privilege(
        'service_role',
        procedure_row.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'anon',
        procedure_row.oid,
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        procedure_row.oid,
        'EXECUTE'
      )
    )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid = ANY (ARRAY[
      'public.claim_partner_client_provisioning_operation(uuid,text,uuid,uuid,timestamptz)'::regprocedure,
      'public.dismiss_partner_client_provisioning_job(uuid,uuid,timestamptz)'::regprocedure,
      'public.restore_partner_client_provisioning_job(uuid,uuid)'::regprocedure,
      'public.lock_account_provisioning_jobs(uuid,uuid,timestamptz)'::regprocedure,
      'public.discard_unattempted_partner_stripe_action(uuid,timestamptz)'::regprocedure,
      'public.account_deletion_preview_json(uuid)'::regprocedure,
      'public.account_deletion_audit_summary_json(uuid)'::regprocedure,
      'public.get_account_deletion_preview(uuid)'::regprocedure,
      'public.schedule_admin_account_deletion(uuid,text,boolean,uuid)'::regprocedure,
      'public.purge_expired_google_calendar_oauth_attempts(timestamptz)'::regprocedure,
      'public.create_google_calendar_oauth_attempt(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.stage_google_calendar_oauth_handoff(text,text,text,text,timestamptz)'::regprocedure,
      'public.claim_google_calendar_oauth_handoff(text,text,uuid,uuid,uuid,text,timestamptz)'::regprocedure,
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure,
      'public.schedule_account_deletion(uuid,uuid,timestamptz,timestamptz)'::regprocedure,
      'public.prepare_account_reactivation(uuid,uuid)'::regprocedure,
      'public.complete_account_reactivation(uuid,uuid,bigint,uuid)'::regprocedure,
      'public.cleanup_expired_business(uuid)'::regprocedure
    ])
  ),
  'service_role alone can execute every exposed lifecycle function'
);

SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.invalidate_google_calendar_oauth_attempts()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_account_deletion_business_transition()',
    'EXECUTE'
  ),
  'trigger-only lifecycle functions are not service-callable'
);

-- ---------------------------------------------------------------------------
-- Partner and Stripe account-deletion regressions
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id,
  name,
  slug,
  custom_domain,
  domain_status,
  status
) VALUES (
  '20000000-0000-4000-a045-000000000001',
  'Lifecycle Partner 045',
  'lifecycle-partner-045',
  'lifecycle-partner-045.example.com',
  'connected',
  'active'
);

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a045-000000000001',
    'partner-deletion-a045@example.test'
  ),
  (
    '00000000-0000-4000-a045-000000000002',
    'stripe-deletion-a045@example.test'
  ),
  (
    '00000000-0000-4000-a045-000000000003',
    'oversized-name-deletion-a045@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a045-000000000001',
    name = 'Partner Deletion 045',
    slug = 'partner-deletion-045',
    partner_id = '20000000-0000-4000-a045-000000000001',
    billing_mode = 'invoiced',
    partner_plan = 'sms_and_chat',
    billing_comped = false,
    billing_pilot = false,
    billing_exempt = false
WHERE owner_id = '00000000-0000-4000-a045-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a045-000000000002',
    name = 'Stripe Deletion 045',
    slug = 'stripe-deletion-045'
WHERE owner_id = '00000000-0000-4000-a045-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a045-000000000003',
    name = repeat('N', 9000),
    slug = 'oversized-name-deletion-045'
WHERE owner_id = '00000000-0000-4000-a045-000000000003';

SELECT throws_ok(
  $$
    SELECT public.queue_account_deletion_stripe_action(
      '10000000-0000-4000-a045-000000000001',
      'sub_forbidden_partner_a045',
      'pause'
    )
  $$,
  '55000',
  'partner_stripe_action_forbidden',
  'the durable Stripe queue cannot create work for a partner-managed business'
);

SELECT throws_ok(
  $$
    SELECT public.discard_unattempted_partner_stripe_action(
      '10000000-0000-4000-a045-000000000002',
      now()
    )
  $$,
  '55000',
  'stripe_action_discard_requires_partner_mode',
  'the partner discard helper cannot erase work for a Stripe-mode business'
);

UPDATE public.businesses
SET email = 'audit-customer-a045@example.test',
    phone_number = '+13175550450'
WHERE id = '10000000-0000-4000-a045-000000000002';

INSERT INTO public.contacts (
  id,
  business_id,
  name,
  phone_number,
  email,
  source_channel,
  notes
) VALUES (
  '50000000-0000-4000-a045-000000000001',
  '10000000-0000-4000-a045-000000000002',
  'Audit Contact Secret',
  '+13175550451',
  'audit-contact-a045@example.test',
  'web_chat',
  'private audit note must not be copied'
);

INSERT INTO public.conversations (
  id,
  business_id,
  contact_id,
  channel
) VALUES (
  '60000000-0000-4000-a045-000000000001',
  '10000000-0000-4000-a045-000000000002',
  '50000000-0000-4000-a045-000000000001',
  'web_chat'
);

INSERT INTO public.messages (
  id,
  business_id,
  conversation_id,
  role,
  content,
  channel
) VALUES (
  '70000000-0000-4000-a045-000000000001',
  '10000000-0000-4000-a045-000000000002',
  '60000000-0000-4000-a045-000000000001',
  'customer',
  'private message content must not be copied',
  'web_chat'
);

INSERT INTO public.partner_client_provisioning_jobs (
  id,
  email,
  requested_business_name,
  partner_id,
  billing_mode,
  partner_plan,
  auth_user_id,
  business_id,
  status,
  last_error_code,
  created_by_admin_id
) VALUES
  (
    '30000000-0000-4000-a045-000000000001',
    'partner-deletion-a045@example.test',
    'Partner Deletion 045',
    '20000000-0000-4000-a045-000000000001',
    'invoiced',
    'sms_and_chat',
    '00000000-0000-4000-a045-000000000001',
    '10000000-0000-4000-a045-000000000001',
    'setup_email_sent',
    NULL,
    '90000000-0000-4000-a045-000000000001'
  ),
  (
    '30000000-0000-4000-a045-000000000002',
    'failed-operation-a045@example.test',
    'Failed Operation 045',
    '20000000-0000-4000-a045-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    NULL,
    'needs_attention',
    'email_in_use',
    '90000000-0000-4000-a045-000000000001'
  ),
  (
    '30000000-0000-4000-a045-000000000003',
    'recent-pending-a045@example.test',
    'Recent Pending 045',
    '20000000-0000-4000-a045-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    NULL,
    'pending',
    NULL,
    '90000000-0000-4000-a045-000000000001'
  );

SELECT throws_ok(
  $$
    UPDATE public.partner_client_provisioning_jobs
    SET status = 'dismissed',
        dismissed_at = now(),
        dismissed_by_admin_id =
          '90000000-0000-4000-a045-000000000001',
        operation_token =
          '40000000-0000-4000-a045-000000000098',
        operation_kind = 'retry',
        operation_started_at = now(),
        operation_expires_at = now() + interval '15 minutes'
    WHERE id = '30000000-0000-4000-a045-000000000003'
  $$,
  '23514',
  NULL,
  'a dismissed job cannot retain even a structurally valid operation lease'
);

SELECT throws_ok(
  $$
    UPDATE public.partner_client_provisioning_jobs
    SET status = 'dismissed',
        dismissed_at = now(),
        dismissed_by_admin_id =
          '90000000-0000-4000-a045-000000000001',
        setup_email_sent_at = now()
    WHERE id = '30000000-0000-4000-a045-000000000003'
  $$,
  '23514',
  NULL,
  'a dismissed job is structurally forbidden from retaining setup-email resources'
);

SELECT throws_ok(
  $$
    UPDATE public.partner_client_provisioning_jobs
    SET operation_token =
          '40000000-0000-4000-a045-000000000097',
        operation_kind = 'retry',
        operation_started_at = now(),
        operation_expires_at = now() + interval '16 minutes'
    WHERE id = '30000000-0000-4000-a045-000000000003'
  $$,
  '23514',
  NULL,
  'a direct provisioning write cannot establish a lease beyond the fifteen-minute heartbeat window'
);

SELECT ok(
  (
    SELECT operation_token =
             '40000000-0000-4000-a045-000000000001'::uuid
       AND operation_kind = 'retry'
       AND operation_started_at = now()
       AND operation_expires_at = now() + interval '15 minutes'
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000001',
      NULL,
      now()
    )
  ),
  'claim acquires one exact database-fenced fifteen-minute operation lease'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000002',
      NULL,
      now() + interval '1 minute'
    )
  $$,
  '55000',
  'provisioning_in_progress',
  'a fresh operation lease cannot be stolen'
);

UPDATE public.partner_client_provisioning_jobs
SET operation_started_at = now() - interval '20 minutes',
    operation_expires_at = now() - interval '5 minutes'
WHERE id = '30000000-0000-4000-a045-000000000002';

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000002',
      NULL,
      now()
    )
  $$,
  '55000',
  'provisioning_outcome_unknown',
  'an expired operation cannot be abandoned without reconciliation'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000002',
      '40000000-0000-4000-a045-000000000099',
      now()
    )
  $$,
  '55000',
  'provisioning_outcome_unknown',
  'an expired operation requires its exact prior fencing token'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000001',
      '40000000-0000-4000-a045-000000000001',
      now()
    )
  $$,
  '55000',
  'auth_identity_mismatch',
  'an expired fencing token cannot be reused as its replacement lease token'
);

SELECT ok(
  (
    SELECT operation_token =
             '40000000-0000-4000-a045-000000000002'::uuid
       AND operation_kind = 'retry'
       AND operation_started_at = now()
       AND operation_expires_at = now() + interval '15 minutes'
    FROM public.claim_partner_client_provisioning_operation(
      '30000000-0000-4000-a045-000000000002',
      'retry',
      '40000000-0000-4000-a045-000000000002',
      '40000000-0000-4000-a045-000000000001',
      now()
    )
  ),
  'the exact reconciled token permits a replacement lease'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000002',
      '90000000-0000-4000-a045-000000000002',
      now() + interval '1 minute'
    )
  $$,
  '55000',
  'provisioning_in_progress',
  'dismissal cannot race an active provisioning operation'
);

UPDATE public.partner_client_provisioning_jobs
SET operation_token = NULL,
    operation_kind = NULL,
    operation_started_at = NULL,
    operation_expires_at = NULL
WHERE id = '30000000-0000-4000-a045-000000000002';

SELECT is(
  (
    public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000002',
      '90000000-0000-4000-a045-000000000002',
      now()
    )
  ).status,
  'dismissed',
  'an unbound failed job can be dismissed'
);

SELECT ok(
  (
    SELECT dismissed_at = now()
       AND dismissed_by_admin_id =
         '90000000-0000-4000-a045-000000000002'
       AND last_error_code = 'email_in_use'
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000002'
  )
  AND EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_dismissed'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000002'
      AND actor_admin_user_id =
        '90000000-0000-4000-a045-000000000002'
      AND summary = '{}'::jsonb
  ),
  'dismissal records its administrator and one PII-free audit event'
);

SELECT is(
  (
    public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000002',
      '90000000-0000-4000-a045-000000000002',
      now()
    )
  ).status,
  'dismissed',
  'repeated dismissal is idempotent'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_dismissed'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000002'
  ),
  1,
  'idempotent dismissal does not duplicate its audit event'
);

CREATE TEMP TABLE lifecycle_045_restored_job AS
SELECT *
FROM public.restore_partner_client_provisioning_job(
  '30000000-0000-4000-a045-000000000002',
  '90000000-0000-4000-a045-000000000003'
);

SELECT ok(
  (
    SELECT status = 'needs_attention'
       AND dismissed_at IS NULL
       AND dismissed_by_admin_id IS NULL
       AND last_error_code = 'email_in_use'
    FROM lifecycle_045_restored_job
  )
  AND EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_restored'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000002'
      AND actor_admin_user_id =
        '90000000-0000-4000-a045-000000000003'
      AND summary = '{}'::jsonb
  ),
  'restore makes the failed job visible and records a PII-free audit event'
);

SELECT is(
  (
    public.restore_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000002',
      '90000000-0000-4000-a045-000000000003'
    )
  ).status,
  'needs_attention',
  'repeated restore is idempotent'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_restored'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000002'
  ),
  1,
  'idempotent restore does not duplicate its audit event'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000001',
      '90000000-0000-4000-a045-000000000002',
      now()
    )
  $$,
  '55000',
  'provisioning_has_resources',
  'a job linked to an Auth user or business cannot be silently dismissed'
);

SELECT throws_ok(
  $$
    SELECT *
    FROM public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000003',
      '90000000-0000-4000-a045-000000000002',
      now()
    )
  $$,
  '55000',
  'job_not_dismissible',
  'a recent pending job is not considered stuck'
);

SELECT is(
  (
    public.dismiss_partner_client_provisioning_job(
      '30000000-0000-4000-a045-000000000003',
      '90000000-0000-4000-a045-000000000002',
      now() + interval '16 minutes'
    )
  ).status,
  'dismissed',
  'a resource-free pending job becomes dismissible after fifteen minutes'
);

CREATE TEMP TABLE lifecycle_045_state (
  name text PRIMARY KEY,
  uuid_value uuid,
  payload jsonb
);

INSERT INTO public.ai_settings (business_id)
VALUES ('10000000-0000-4000-a045-000000000001')
ON CONFLICT (business_id) DO NOTHING;

-- The database validates assignment identity for canonical attempts, while
-- the application remains responsible for comparing the unassigned hostname
-- to NEXT_PUBLIC_APP_URL because configuration is not stored in this schema.
INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a045-000000000004',
    'canonical-oauth-a045@example.test'
  ),
  (
    '00000000-0000-4000-a045-000000000005',
    'canonical-oauth-new-owner-a045@example.test'
  );

DELETE FROM public.businesses
WHERE owner_id = '00000000-0000-4000-a045-000000000005';

UPDATE public.businesses
SET id = '10000000-0000-4000-a045-000000000004',
    name = 'Canonical OAuth 045',
    slug = 'canonical-oauth-045'
WHERE owner_id = '00000000-0000-4000-a045-000000000004';

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_canonical',
  public.create_google_calendar_oauth_attempt(
    repeat('7', 64),
    repeat('8', 64),
    '10000000-0000-4000-a045-000000000004',
    '00000000-0000-4000-a045-000000000004',
    NULL,
    'canonical-oauth-045.example.com',
    now() + interval '10 minutes'
  );

SELECT ok(
  (
    SELECT status = 'initiated'
       AND origin_partner_id IS NULL
       AND origin_hostname = 'canonical-oauth-045.example.com'
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_canonical'
  ),
  'an unassigned canonical workspace can create an exact-host OAuth attempt'
);

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_canonical_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('7', 64),
    repeat('9', 64),
    'canonical-google-code-a045',
    NULL,
    now() + interval '5 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_canonical_claimed',
  public.claim_google_calendar_oauth_handoff(
    repeat('9', 64),
    repeat('8', 64),
    '10000000-0000-4000-a045-000000000004',
    '00000000-0000-4000-a045-000000000004',
    NULL,
    'canonical-oauth-045.example.com'
  );

SELECT ok(
  (
    SELECT payload -> 'origin_partner_id' = 'null'::jsonb
       AND payload ->> 'origin_hostname' =
             'canonical-oauth-045.example.com'
    FROM lifecycle_045_state
    WHERE name = 'oauth_canonical_staged'
  )
  AND (
    SELECT payload ->> 'authorization_code' =
             'canonical-google-code-a045'
       AND payload ->> 'sanitized_result' IS NULL
    FROM lifecycle_045_state
    WHERE name = 'oauth_canonical_claimed'
  )
  AND (
    SELECT status = 'claimed'
       AND authorization_code IS NULL
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_canonical'
  ),
  'canonical staging and claim bind the original browser and return the code once'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_google_calendar_oauth_connection(
        %L::uuid,
        '10000000-0000-4000-a045-000000000004',
        '00000000-0000-4000-a045-000000000004',
        NULL,
        'canonical-oauth-045.example.com',
        'canonical-access-a045',
        'canonical-refresh-a045',
        now() + interval '1 hour',
        'canonical-calendar-a045@example.test',
        'primary'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM lifecycle_045_state
      WHERE name = 'oauth_canonical'
    )
  ),
  '55000',
  'google_calendar_settings_missing',
  'completion refuses to write credentials without the existing settings row'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000004'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a045-000000000004'
  )
  AND EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_canonical'
      AND attempt.status = 'claimed'
  ),
  'missing settings rolls back credentials and preserves the claimed attempt for expiry cleanup'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_owner_change',
  public.create_google_calendar_oauth_attempt(
    repeat('78', 32),
    repeat('89', 32),
    '10000000-0000-4000-a045-000000000004',
    '00000000-0000-4000-a045-000000000004',
    NULL,
    'canonical-oauth-045.example.com',
    now() + interval '10 minutes'
  );

UPDATE public.businesses
SET owner_id = '00000000-0000-4000-a045-000000000005'
WHERE id = '10000000-0000-4000-a045-000000000004';

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_owner_change'
  ),
  'changing workspace ownership invalidates every outstanding OAuth attempt'
);

UPDATE public.businesses
SET owner_id = '00000000-0000-4000-a045-000000000004'
WHERE id = '10000000-0000-4000-a045-000000000004';

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_stage_partner_drift',
  public.create_google_calendar_oauth_attempt(
    repeat('ab', 32),
    repeat('bc', 32),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

UPDATE public.partners
SET status = 'inactive'
WHERE id = '20000000-0000-4000-a045-000000000001';

SELECT throws_ok(
  $$
    SELECT public.stage_google_calendar_oauth_handoff(
      repeat('ab', 32),
      repeat('cd', 32),
      'stage-drift-google-code-a045',
      NULL,
      now() + interval '5 minutes'
    )
  $$,
  '55000',
  'oauth_workspace_changed',
  'callback staging fails closed if the partner becomes inactive'
);

UPDATE public.partners
SET status = 'active'
WHERE id = '20000000-0000-4000-a045-000000000001';

DELETE FROM public.google_calendar_oauth_attempts
WHERE id = (
  SELECT uuid_value
  FROM lifecycle_045_state
  WHERE name = 'oauth_stage_partner_drift'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_claim_partner_drift',
  public.create_google_calendar_oauth_attempt(
    repeat('de', 32),
    repeat('ef', 32),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_claim_partner_drift_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('de', 32),
    repeat('01', 32),
    'claim-drift-google-code-a045',
    NULL,
    now() + interval '5 minutes'
  );

UPDATE public.partners
SET domain_status = 'pending'
WHERE id = '20000000-0000-4000-a045-000000000001';

SELECT throws_ok(
  $$
    SELECT public.claim_google_calendar_oauth_handoff(
      repeat('01', 32),
      repeat('ef', 32),
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      '20000000-0000-4000-a045-000000000001',
      'lifecycle-partner-045.example.com'
    )
  $$,
  '55000',
  'oauth_workspace_changed',
  'original-host claim fails closed if the partner domain disconnects'
);

UPDATE public.partners
SET domain_status = 'connected'
WHERE id = '20000000-0000-4000-a045-000000000001';

DELETE FROM public.google_calendar_oauth_attempts
WHERE id = (
  SELECT uuid_value
  FROM lifecycle_045_state
  WHERE name = 'oauth_claim_partner_drift'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_complete_partner_drift',
  public.create_google_calendar_oauth_attempt(
    repeat('12', 32),
    repeat('23', 32),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_complete_partner_drift_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('12', 32),
    repeat('34', 32),
    'complete-drift-google-code-a045',
    NULL,
    now() + interval '5 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_complete_partner_drift_claimed',
  public.claim_google_calendar_oauth_handoff(
    repeat('34', 32),
    repeat('23', 32),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com'
  );

UPDATE public.partners
SET custom_domain = 'changed-lifecycle-partner-045.example.com'
WHERE id = '20000000-0000-4000-a045-000000000001';

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_google_calendar_oauth_connection(
        %L::uuid,
        '10000000-0000-4000-a045-000000000001',
        '00000000-0000-4000-a045-000000000001',
        '20000000-0000-4000-a045-000000000001',
        'lifecycle-partner-045.example.com',
        'drift-access-a045',
        'drift-refresh-a045',
        now() + interval '1 hour',
        'drift-calendar-a045@example.test',
        'primary'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM lifecycle_045_state
      WHERE name = 'oauth_complete_partner_drift'
    )
  ),
  '55000',
  'oauth_workspace_changed',
  'credential completion fails closed if the exact partner domain changes'
);

UPDATE public.partners
SET custom_domain = 'lifecycle-partner-045.example.com'
WHERE id = '20000000-0000-4000-a045-000000000001';

DELETE FROM public.google_calendar_oauth_attempts
WHERE id = (
  SELECT uuid_value
  FROM lifecycle_045_state
  WHERE name = 'oauth_complete_partner_drift'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_expired_handoff',
  public.create_google_calendar_oauth_attempt(
    repeat('45', 32),
    repeat('56', 32),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_expired_handoff_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('45', 32),
    repeat('67', 32),
    'expired-handoff-google-code-a045',
    NULL,
    now() + interval '2 minutes'
  );

SELECT throws_ok(
  $$
    SELECT public.claim_google_calendar_oauth_handoff(
      repeat('67', 32),
      repeat('56', 32),
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      '20000000-0000-4000-a045-000000000001',
      'lifecycle-partner-045.example.com',
      now() + interval '3 minutes'
    )
  $$,
  '55000',
  'oauth_handoff_invalid_or_expired',
  'an expired handoff cannot be claimed even while the outer attempt remains live'
);

DELETE FROM public.google_calendar_oauth_attempts
WHERE id = (
  SELECT uuid_value
  FROM lifecycle_045_state
  WHERE name = 'oauth_expired_handoff'
);

SELECT throws_ok(
  $$
    SELECT public.create_google_calendar_oauth_attempt(
      repeat('0', 64),
      repeat('1', 64),
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      '20000000-0000-4000-a045-000000000001',
      'lookalike-lifecycle-partner-045.example.com',
      now() + interval '10 minutes'
    )
  $$,
  '55000',
  'oauth_workspace_changed',
  'OAuth creation rejects a partner-host mismatch before storing state'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_success',
  public.create_google_calendar_oauth_attempt(
    repeat('a', 64),
    repeat('b', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

SELECT ok(
  (
    SELECT attempt.status = 'initiated'
       AND attempt.state_digest = repeat('a', 64)
       AND attempt.origin_verifier_digest = repeat('b', 64)
       AND attempt.handoff_digest IS NULL
       AND attempt.authorization_code IS NULL
       AND attempt.origin_partner_id =
         '20000000-0000-4000-a045-000000000001'
       AND attempt.origin_hostname =
         'lifecycle-partner-045.example.com'
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_success'
  ),
  'OAuth creation stores only digests and exact workspace/origin identity'
);

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('a', 64),
    repeat('c', 64),
    'one-use-google-code-a045',
    NULL,
    now() + interval '5 minutes'
  );

SELECT ok(
  (
    SELECT payload ->> 'origin_hostname' =
             'lifecycle-partner-045.example.com'
       AND payload ->> 'sanitized_result' IS NULL
    FROM lifecycle_045_state
    WHERE name = 'oauth_staged'
  )
  AND (
    SELECT status = 'handoff_ready'
       AND handoff_digest = repeat('c', 64)
       AND authorization_code = 'one-use-google-code-a045'
       AND sanitized_result IS NULL
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_success'
  ),
  'canonical callback staging retains the code only in one expiring handoff'
);

SELECT throws_ok(
  $$
    SELECT public.stage_google_calendar_oauth_handoff(
      repeat('a', 64),
      repeat('d', 64),
      'replayed-google-code-a045',
      NULL,
      now() + interval '5 minutes'
    )
  $$,
  '55000',
  'oauth_attempt_invalid_or_expired',
  'OAuth state is single-use at callback staging'
);

SELECT throws_ok(
  $$
    SELECT public.claim_google_calendar_oauth_handoff(
      repeat('c', 64),
      repeat('9', 64),
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      '20000000-0000-4000-a045-000000000001',
      'lifecycle-partner-045.example.com',
      now()
    )
  $$,
  '55000',
  'oauth_handoff_invalid_or_expired',
  'the handoff claim requires the original browser verifier'
);

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_claimed',
  public.claim_google_calendar_oauth_handoff(
    repeat('c', 64),
    repeat('b', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now()
  );

SELECT ok(
  (
    SELECT payload ->> 'authorization_code' =
             'one-use-google-code-a045'
       AND payload ->> 'sanitized_result' IS NULL
    FROM lifecycle_045_state
    WHERE name = 'oauth_claimed'
  )
  AND (
    SELECT status = 'claimed'
       AND authorization_code IS NULL
       AND claimed_at = now()
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_success'
  ),
  'claim returns the authorization code once and scrubs it from durable state'
);

SELECT throws_ok(
  $$
    SELECT public.claim_google_calendar_oauth_handoff(
      repeat('c', 64),
      repeat('b', 64),
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      '20000000-0000-4000-a045-000000000001',
      'lifecycle-partner-045.example.com',
      now()
    )
  $$,
  '55000',
  'oauth_handoff_invalid_or_expired',
  'a claimed handoff cannot return its authorization code twice'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_google_calendar_oauth_connection(
        %L::uuid,
        '10000000-0000-4000-a045-000000000001',
        '00000000-0000-4000-a045-000000000001',
        '20000000-0000-4000-a045-000000000001',
        'wrong-lifecycle-partner-045.example.com',
        'access-a045',
        'refresh-a045',
        now() + interval '1 hour',
        'calendar-a045@example.test',
        'primary'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM lifecycle_045_state
      WHERE name = 'oauth_success'
    )
  ),
  '55000',
  'oauth_attempt_invalid_or_expired',
  'connection completion revalidates the exact originating workspace'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  ),
  0,
  'a failed completion validation writes no Google credentials'
);

SELECT is(
  public.complete_google_calendar_oauth_connection(
    (
      SELECT uuid_value
      FROM lifecycle_045_state
      WHERE name = 'oauth_success'
    ),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    'access-a045',
    'refresh-a045',
    now() + interval '1 hour',
    'calendar-a045@example.test',
    'primary'
  ),
  true,
  'a claimed exact-workspace attempt can complete atomically'
);

SELECT ok(
  (
    SELECT access_token = 'access-a045'
       AND refresh_token = 'refresh-a045'
       AND google_email = 'calendar-a045@example.test'
       AND calendar_id = 'primary'
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND (
    SELECT booking_enabled IS TRUE
       AND booking_mode = 'schedule_direct'
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_success'
  ),
  'completion writes the token/settings and consumes the OAuth attempt'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_google_calendar_oauth_connection(
        %L::uuid,
        '10000000-0000-4000-a045-000000000001',
        '00000000-0000-4000-a045-000000000001',
        '20000000-0000-4000-a045-000000000001',
        'lifecycle-partner-045.example.com',
        'replayed-access-a045',
        'replayed-refresh-a045',
        now() + interval '1 hour',
        'calendar-a045@example.test',
        'primary'
      )
    $sql$,
    (
      SELECT uuid_value
      FROM lifecycle_045_state
      WHERE name = 'oauth_success'
    )
  ),
  '55000',
  'oauth_attempt_invalid_or_expired',
  'a completed OAuth attempt cannot write credentials twice'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_partner_change',
  public.create_google_calendar_oauth_attempt(
    repeat('d', 64),
    repeat('e', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

UPDATE public.businesses
SET partner_id = NULL
WHERE id = '10000000-0000-4000-a045-000000000001';

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_partner_change'
  ),
  'changing workspace partner assignment invalidates outstanding OAuth state'
);

UPDATE public.businesses
SET partner_id = '20000000-0000-4000-a045-000000000001'
WHERE id = '10000000-0000-4000-a045-000000000001';

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_failed',
  public.create_google_calendar_oauth_attempt(
    repeat('f', 64),
    repeat('1', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_failed_staged',
  public.stage_google_calendar_oauth_handoff(
    repeat('f', 64),
    repeat('2', 64),
    NULL,
    'access_denied',
    now() + interval '5 minutes'
  );

SELECT ok(
  (
    SELECT status = 'failed'
       AND authorization_code IS NULL
       AND sanitized_result = 'access_denied'
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_failed'
  ),
  'provider failure stages only its approved sanitized result'
);

INSERT INTO lifecycle_045_state (name, payload)
SELECT
  'oauth_failed_claimed',
  public.claim_google_calendar_oauth_handoff(
    repeat('2', 64),
    repeat('1', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now()
  );

SELECT ok(
  (
    SELECT payload -> 'authorization_code' = 'null'::jsonb
       AND payload ->> 'sanitized_result' = 'access_denied'
    FROM lifecycle_045_state
    WHERE name = 'oauth_failed_claimed'
  )
  AND (
    SELECT status = 'claimed'
       AND authorization_code IS NULL
       AND sanitized_result = 'access_denied'
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_failed'
  ),
  'original-host claim receives sanitized failure without any provider code'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_expiry',
  public.create_google_calendar_oauth_attempt(
    repeat('3', 64),
    repeat('4', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '2 minutes'
  );

SELECT is(
  public.purge_expired_google_calendar_oauth_attempts(
    now() + interval '3 minutes'
  ),
  1,
  'expiry purge removes only attempts whose bounded lifetime has elapsed'
);

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status
) VALUES (
  '10000000-0000-4000-a045-000000000002',
  'cus_deletion_a045',
  'sub_deletion_a045',
  'sms_and_chat',
  'active'
);

INSERT INTO lifecycle_045_state (name, uuid_value)
SELECT
  'oauth_deletion',
  public.create_google_calendar_oauth_attempt(
    repeat('5', 64),
    repeat('6', 64),
    '10000000-0000-4000-a045-000000000001',
    '00000000-0000-4000-a045-000000000001',
    '20000000-0000-4000-a045-000000000001',
    'lifecycle-partner-045.example.com',
    now() + interval '10 minutes'
  );

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      now(),
      now() + interval '60 days'
    )
  $$,
  'a no-subscription partner account enters the normal deletion grace period'
);

SELECT ok(
  (
    SELECT partner_id = '20000000-0000-4000-a045-000000000001'
       AND partner_plan = 'sms_and_chat'
       AND billing_mode = 'invoiced'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000001'
      AND business_id = '10000000-0000-4000-a045-000000000001'
      AND auth_user_id = '00000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts AS attempt
    JOIN lifecycle_045_state AS state
      ON state.uuid_value = attempt.id
    WHERE state.name = 'oauth_deletion'
  ),
  'grace preserves partner/provisioning/token data, invalidates OAuth state, and creates no Stripe work'
);

CREATE TEMP TABLE lifecycle_045_partner_reactivation AS
SELECT public.prepare_account_reactivation(
  '10000000-0000-4000-a045-000000000001',
  '00000000-0000-4000-a045-000000000001'
) AS payload;

SELECT ok(
  (
    SELECT payload -> 'stripe_action' = 'null'::jsonb
       AND payload ->> 'reactivation_reservation_token' IS NOT NULL
    FROM lifecycle_045_partner_reactivation
  ),
  'partner reactivation reserves the existing Telnyx lifecycle without creating Stripe work'
);

CREATE TEMP TABLE lifecycle_045_partner_reactivated AS
SELECT public.complete_account_reactivation(
  '10000000-0000-4000-a045-000000000001',
  '00000000-0000-4000-a045-000000000001',
  NULL,
  (payload ->> 'reactivation_reservation_token')::uuid
) AS completed
FROM lifecycle_045_partner_reactivation;

SELECT ok(
  (SELECT completed FROM lifecycle_045_partner_reactivated)
  AND (
    SELECT deleted_at IS NULL
       AND deletion_scheduled_for IS NULL
       AND partner_id = '20000000-0000-4000-a045-000000000001'
       AND partner_plan = 'sms_and_chat'
       AND billing_mode = 'invoiced'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000001'
  ),
  'partner reactivation restores the account while preserving assignment and provisioning state'
);

-- Migration 044 prevents this state through supported synchronization paths.
-- Keep an adversarial direct fixture to prove lifecycle code never treats a
-- stale local subscription as permission to perform partner-mode Stripe work.
INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status
) VALUES (
  '10000000-0000-4000-a045-000000000001',
  'cus_stale_partner_a045',
  'sub_stale_partner_a045',
  'sms_and_chat',
  'active'
);

SELECT throws_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      now(),
      now() + interval '60 days'
    )
  $$,
  '55000',
  'partner_subscription_conflict',
  'partner scheduling fails closed on stale subscription authority without calling Stripe'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL
       AND deletion_scheduled_for IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000001'
  )
  AND EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
      AND stripe_subscription_id = 'sub_stale_partner_a045'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  ),
  'failed partner scheduling preserves the active account and its stale pointer for operator reconciliation'
);

SELECT throws_ok(
  $$
    SELECT public.prepare_account_reactivation(
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001'
    )
  $$,
  '55000',
  'partner_subscription_conflict',
  'partner reactivation fails closed on stale subscription authority instead of calling Stripe'
);

DELETE FROM public.subscriptions
WHERE business_id = '10000000-0000-4000-a045-000000000001';

CREATE TEMP TABLE lifecycle_045_partner_rescheduled AS
SELECT public.schedule_account_deletion(
  '10000000-0000-4000-a045-000000000001',
  '00000000-0000-4000-a045-000000000001',
  now(),
  now() + interval '60 days'
) AS payload;

SELECT ok(
  (
    SELECT payload -> 'stripe_action' = 'null'::jsonb
    FROM lifecycle_045_partner_rescheduled
  )
  AND (
    SELECT deleted_at IS NOT NULL
       AND partner_id = '20000000-0000-4000-a045-000000000001'
       AND partner_plan = 'sms_and_chat'
       AND billing_mode = 'invoiced'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000001'
  ),
  'partner scheduling proceeds normally after stale subscription reconciliation'
);

INSERT INTO public.account_deletion_stripe_actions (
  business_id,
  stripe_subscription_id,
  desired_action
) VALUES (
  '10000000-0000-4000-a045-000000000001',
  'sub_never_attempted_partner_a045',
  'pause'
);

CREATE TEMP TABLE lifecycle_045_partner_safe_action_retry AS
SELECT public.schedule_account_deletion(
  '10000000-0000-4000-a045-000000000001',
  '00000000-0000-4000-a045-000000000001',
  now(),
  now() + interval '60 days'
) AS payload;

SELECT is(
  jsonb_build_object(
    'stripe_action', (
      SELECT payload -> 'stripe_action'
      FROM lifecycle_045_partner_safe_action_retry
    ),
    'durable_action_exists', EXISTS (
      SELECT 1
      FROM public.account_deletion_stripe_actions
      WHERE business_id = '10000000-0000-4000-a045-000000000001'
    )
  ),
  jsonb_build_object(
    'stripe_action', NULL,
    'durable_action_exists', false
  ),
  'partner scheduling may discard only a never-claimed, never-attempted stale Stripe action'
);

INSERT INTO public.account_deletion_stripe_actions (
  business_id,
  stripe_subscription_id,
  desired_action,
  lease_token,
  lease_owner,
  lease_expires_at,
  attempt_count,
  last_attempted_at
) VALUES (
  '10000000-0000-4000-a045-000000000001',
  'sub_claimed_partner_a045',
  'pause',
  '80000000-0000-4000-a045-000000000001',
  'test-worker-a045',
  now() + interval '5 minutes',
  1,
  now()
);

SELECT throws_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      now(),
      now() + interval '60 days'
    )
  $$,
  '55000',
  'stripe_action_in_progress',
  'partner scheduling cannot erase a currently leased Stripe action'
);

UPDATE public.account_deletion_stripe_actions
SET lease_expires_at = now() - interval '1 second'
WHERE business_id = '10000000-0000-4000-a045-000000000001';

SELECT throws_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a045-000000000001',
      '00000000-0000-4000-a045-000000000001',
      now(),
      now() + interval '60 days'
    )
  $$,
  '55000',
  'stripe_action_outcome_unknown',
  'an expired claimed Stripe action remains blocked pending operator reconciliation'
);

DELETE FROM public.account_deletion_stripe_actions
WHERE business_id = '10000000-0000-4000-a045-000000000001';

SELECT ok(
  (
    SELECT preview ->> 'business_name' = 'Stripe Deletion 045'
       AND preview ->> 'billing_mode' = 'stripe'
       AND preview ->> 'subscription_status' = 'active'
       AND (preview ->> 'requires_live_acknowledgement')::boolean
    FROM (
      SELECT public.get_account_deletion_preview(
        '10000000-0000-4000-a045-000000000002'
      ) AS preview
    ) AS loaded
  ),
  'admin preview derives live-account friction from locked database state'
);

SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a045-000000000002',
      'stripe deletion 045',
      true,
      '90000000-0000-4000-a045-000000000010'
    )
  $$,
  '55000',
  'confirmation_mismatch',
  'admin scheduling requires the exact case-sensitive business name'
);

SELECT throws_ok(
  $$
    SELECT public.schedule_admin_account_deletion(
      '10000000-0000-4000-a045-000000000002',
      'Stripe Deletion 045',
      false,
      '90000000-0000-4000-a045-000000000010'
    )
  $$,
  '55000',
  'live_ack_required',
  'admin scheduling cannot bypass the elevated live-resource acknowledgement'
);

CREATE TEMP TABLE lifecycle_045_admin_schedule AS
SELECT public.schedule_admin_account_deletion(
  '10000000-0000-4000-a045-000000000002',
  'Stripe Deletion 045',
  true,
  '90000000-0000-4000-a045-000000000010'
) AS payload;

SELECT ok(
  (
    SELECT payload #>> '{scheduled,stripe_action,desired_action}' = 'pause'
       AND payload #>>
             '{scheduled,stripe_action,stripe_subscription_id}' =
         'sub_deletion_a045'
       AND (payload ->> 'admin_event_created')::boolean
       AND NOT (
         payload ->> 'previously_scheduled_by_admin'
       )::boolean
    FROM lifecycle_045_admin_schedule
  )
  AND EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE action = 'account_deletion_scheduled'
      AND business_id = '10000000-0000-4000-a045-000000000002'
      AND actor_admin_user_id =
        '90000000-0000-4000-a045-000000000010'
      AND summary ->> 'business_name' = 'Stripe Deletion 045'
      AND summary ->> 'billing_mode' = 'stripe'
  ),
  'authorized admin scheduling queues the original Stripe pause and appends its constrained audit event'
);

SELECT ok(
  (
    SELECT summary #>> '{resource_counts,contact_rows_to_scrub}' = '1'
       AND summary #>> '{resource_counts,message_rows_to_scrub}' = '1'
       AND summary::text NOT LIKE '%audit-customer-a045@example.test%'
       AND summary::text NOT LIKE '%audit-contact-a045@example.test%'
       AND summary::text NOT LIKE '%+13175550450%'
       AND summary::text NOT LIKE '%+13175550451%'
       AND summary::text NOT LIKE '%Audit Contact Secret%'
       AND summary::text NOT LIKE '%private audit note%'
       AND summary::text NOT LIKE '%private message content%'
    FROM public.admin_action_events
    WHERE action = 'account_deletion_scheduled'
      AND business_id = '10000000-0000-4000-a045-000000000002'
  ),
  'generated deletion audit stores counts but no customer email, phone, contact, note, or message payload'
);

SELECT ok(
  (
    SELECT NOT (payload ->> 'admin_event_created')::boolean
       AND (payload ->> 'previously_scheduled_by_admin')::boolean
       AND payload #>> '{scheduled,stripe_action,desired_action}' = 'pause'
    FROM (
      SELECT public.schedule_admin_account_deletion(
        '10000000-0000-4000-a045-000000000002',
        'Stripe Deletion 045',
        true,
        '90000000-0000-4000-a045-000000000010'
      ) AS payload
    ) AS scheduled_again
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE action = 'account_deletion_scheduled'
      AND business_id = '10000000-0000-4000-a045-000000000002'
  ),
  'repeated admin scheduling is idempotent and cannot duplicate audit history'
);

CREATE TEMP TABLE lifecycle_045_oversized_name_schedule AS
SELECT public.schedule_admin_account_deletion(
  '10000000-0000-4000-a045-000000000003',
  repeat('N', 9000),
  false,
  '90000000-0000-4000-a045-000000000010'
) AS payload;

SELECT ok(
  (
    SELECT (payload ->> 'admin_event_created')::boolean
    FROM lifecycle_045_oversized_name_schedule
  )
  AND (
    SELECT length(summary ->> 'business_name') = 9000
       AND summary ->> 'business_name' = repeat('N', 9000)
    FROM public.admin_action_events
    WHERE action = 'account_deletion_scheduled'
      AND business_id = '10000000-0000-4000-a045-000000000003'
  ),
  'exact locked business names cannot make an otherwise valid deletion unschedulable'
);

DO $expire_deletion_fixtures$
DECLARE
  v_deleted_at timestamptz := now() - interval '60 days 1 second';
  v_release_at timestamptz := now() - interval '1 second';
BEGIN
  UPDATE public.businesses
  SET deleted_at = v_deleted_at,
      deletion_scheduled_for = v_release_at
  WHERE id IN (
    '10000000-0000-4000-a045-000000000001',
    '10000000-0000-4000-a045-000000000002'
  );

  UPDATE public.telnyx_resource_release_reasons
  SET triggered_at = v_deleted_at,
      release_at = v_release_at,
      updated_at = now()
  WHERE business_id IN (
    '10000000-0000-4000-a045-000000000001',
    '10000000-0000-4000-a045-000000000002'
  )
    AND reason_type = 'account_deletion'
    AND status = 'active';

  UPDATE public.telnyx_resource_release_runs
  SET effective_release_at = v_release_at,
      updated_at = now()
  WHERE business_id IN (
    '10000000-0000-4000-a045-000000000001',
    '10000000-0000-4000-a045-000000000002'
  )
    AND status = 'parked';
END;
$expire_deletion_fixtures$;

-- Bypass the ordinary deleted-business subscription guard to model manual
-- corruption. Terminal cleanup must preserve this only local Stripe pointer
-- and fail before any irreversible scrub or provider-side assumption.
SET LOCAL session_replication_role = replica;

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status
) VALUES (
  '10000000-0000-4000-a045-000000000001',
  'cus_terminal_stale_partner_a045',
  'sub_terminal_stale_partner_a045',
  'sms_and_chat',
  'active'
);

SET LOCAL session_replication_role = origin;

SELECT throws_ok(
  $$
    SELECT public.cleanup_expired_business(
      '10000000-0000-4000-a045-000000000001'
    )
  $$,
  '55000',
  'partner_subscription_conflict',
  'terminal partner cleanup preserves anomalous subscription linkage for operator reconciliation'
);

DELETE FROM public.subscriptions
WHERE business_id = '10000000-0000-4000-a045-000000000001';

SELECT is(
  public.cleanup_expired_business(
    '10000000-0000-4000-a045-000000000001'
  ),
  '00000000-0000-4000-a045-000000000001'::uuid,
  'terminal partner cleanup returns the linked Auth user without Stripe state'
);

SELECT ok(
  (
    SELECT owner_id IS NULL
       AND cleanup_auth_user_id =
         '00000000-0000-4000-a045-000000000001'
       AND cleanup_pii_scrubbed_at IS NOT NULL
       AND partner_id IS NULL
       AND partner_plan IS NULL
       AND billing_mode = 'stripe'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000001'
       OR business_id = '10000000-0000-4000-a045-000000000001'
       OR auth_user_id = '00000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE business_id = '10000000-0000-4000-a045-000000000001'
  ),
  'terminal partner cleanup clears assignment, provisioning, and Calendar state without a Stripe action'
);

SELECT is(
  public.cleanup_expired_business(
    '10000000-0000-4000-a045-000000000002'
  ),
  '00000000-0000-4000-a045-000000000002'::uuid,
  'terminal Stripe cleanup still returns its linked Auth user'
);

SELECT ok(
  (
    SELECT desired_action = 'cancel'
       AND stripe_subscription_id = 'sub_deletion_a045'
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a045-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a045-000000000002'
  )
  AND (
    SELECT owner_id IS NULL
       AND cleanup_pii_scrubbed_at IS NOT NULL
       AND partner_id IS NULL
       AND partner_plan IS NULL
       AND billing_mode = 'stripe'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000002'
  ),
  'Stripe cleanup preserves the existing durable cancel path while scrubbing locally'
);

SELECT * FROM finish();
ROLLBACK;
