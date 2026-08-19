-- SimplAssist Phase 4 post-migration report.
--
-- Safe output contract: every row contains only a fixed check name, a status,
-- an aggregate count, and fixed guidance. No tenant, owner, provider, billing,
-- Checkout URL, or other customer identifier is selected.
--
-- Run only after separately proving the intended Supabase target and after all
-- migrations through 064 have committed. Any BLOCKER stops the release.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '5s';
SET LOCAL search_path = pg_catalog, public;

WITH RECURSIVE
ledger AS (
  SELECT
    version,
    CASE
      WHEN version ~ '^[0-9]{3}$' THEN version::integer
      ELSE NULL
    END AS migration_number
  FROM supabase_migrations.schema_migrations
),
ledger_health AS (
  SELECT
    count(*) FILTER (WHERE migration_number IS NULL)::bigint
      AS malformed_versions,
    count(*) FILTER (
      WHERE migration_number IS NOT NULL
        AND migration_number NOT BETWEEN 1 AND 64
    )::bigint AS versions_outside_reviewed_tip,
    count(*) FILTER (WHERE migration_number BETWEEN 1 AND 64)::bigint
      AS reviewed_versions,
    count(*) FILTER (WHERE migration_number = 64)::bigint
      AS phase4_tip_count
  FROM ledger
),
ledger_gaps AS (
  SELECT count(*)::bigint AS missing_versions
  FROM generate_series(1, 64) AS expected(version_number)
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger
    WHERE ledger.migration_number = expected.version_number
  )
),
expected_relations(relation_name) AS (
  VALUES
    ('public.business_plan_family_locks'),
    ('public.ai_reply_usage_periods'),
    ('public.ai_reply_reservations'),
    ('public.ai_reply_reservation_attempts'),
    ('public.anthropic_provider_calls'),
    ('public.widget_offline_lead_submissions'),
    ('public.widget_ingress_rate_buckets'),
    ('public.widget_request_rate_buckets'),
    ('public.widget_request_capacity_leases'),
    ('public.calendar_provider_operations'),
    ('public.chat_only_checkout_attempts')
),
missing_relations AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_relations AS expected
  LEFT JOIN pg_class AS class
    ON class.oid = to_regclass(expected.relation_name)
  WHERE class.oid IS NULL OR class.relkind <> 'r'
),
expected_named_constraints(relation_name, constraint_name) AS (
  VALUES
    (
      'public.telnyx_resource_release_actions',
      'telnyx_release_actions_phone_previous_status_required'
    ),
    ('public.subscriptions', 'subscriptions_chat_only_has_no_setup_fee'),
    ('public.widget_configs', 'widget_configs_allowed_hostnames_valid'),
    (
      'public.widget_configs',
      'widget_configs_active_requires_allowed_hostname'
    ),
    (
      'public.google_calendar_tokens',
      'google_calendar_tokens_provider_namespace_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_kind_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_status_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_time_order'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_calendar_id_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_fingerprint_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_attempt_count_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_reconciliation_attempt_count_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_provider_time_order'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_failure_reason_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_event_ids_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_evidence_valid'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_kind_shape'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_claim_shape'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_reconciliation_claim_shape'
    ),
    (
      'public.calendar_provider_operations',
      'calendar_provider_operations_lifecycle_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_state_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_session_id_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_customer_id_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_subscription_id_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_url_shape'
    ),
    (
      'public.chat_only_checkout_attempts',
      'chat_only_checkout_attempt_time_shape'
    )
),
constraint_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_named_constraints AS expected
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conrelid = to_regclass(expected.relation_name)
   AND constraint_row.conname = expected.constraint_name
  WHERE constraint_row.oid IS NULL OR NOT constraint_row.convalidated
),
constraint_definition_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      (
        'public.telnyx_resource_release_actions',
        'telnyx_release_actions_phone_previous_status_required',
        ARRAY[
          '%phone_number_assignment%', '%phone_number%',
          '%previous_resource_status IS NOT NULL%'
        ]::text[]
      ),
      (
        'public.subscriptions',
        'subscriptions_chat_only_has_no_setup_fee',
        ARRAY[
          '%plan <> ''chat_only''%', '%stripe_setup_fee_price_id IS NULL%',
          '%setup_fee_paid_at IS NULL%'
        ]::text[]
      ),
      (
        'public.widget_configs',
        'widget_configs_allowed_hostnames_valid',
        ARRAY['%is_valid_widget_hostname_allowlist(allowed_hostnames)%']::text[]
      ),
      (
        'public.widget_configs',
        'widget_configs_active_requires_allowed_hostname',
        ARRAY['%NOT is_active%', '%cardinality(allowed_hostnames) > 0%']::text[]
      ),
      (
        'public.google_calendar_tokens',
        'google_calendar_tokens_provider_namespace_valid',
        ARRAY[
          '%google_email = lower(btrim(google_email))%',
          '%length(google_email)%3%254%',
          '%calendar_id = btrim(calendar_id)%',
          '%length(calendar_id)%1%1024%',
          '%[^[:space:]@]+@[^[:space:]@]+%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_event_ids_valid',
        ARRAY[
          '%length(deterministic_google_event_id) >= 5%',
          '%length(deterministic_google_event_id) <= 1024%',
          '%^[0-9a-v]+$%',
          '%length(target_google_event_id) <= 1024%',
          '%length(provider_event_id) <= 1024%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_evidence_valid',
        ARRAY[
          '%operation_marker_verified%', '%provider_status%',
          '%provider_etag_sha256%', '%provider_absence_verified%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_kind_shape',
        ARRAY[
          '%operation_kind = ''create''%', '%operation_kind = ''update''%',
          '%operation_kind = ''delete''%', '%linked_booking_id IS NULL%',
          '%deterministic_google_event_id%', '%target_google_event_id%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_claim_shape',
        ARRAY[
          '%claim_token IS NULL%', '%claimed_at IS NULL%',
          '%claim_expires_at IS NULL%', '%claim_expires_at > claimed_at%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_reconciliation_claim_shape',
        ARRAY[
          '%reconciliation_claim_token IS NULL%',
          '%reconciliation_claimed_at IS NULL%',
          '%reconciliation_claim_expires_at IS NULL%',
          '%reconciliation_claim_expires_at > reconciliation_claimed_at%',
          '%holding%', '%provider_applied%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations',
        'calendar_provider_operations_lifecycle_shape',
        ARRAY[
          '%status = ''holding''%', '%status = ''provider_applied''%',
          '%status = ''finalized''%', '%status = ''failed''%',
          '%provider_submission_started_at IS NOT NULL%',
          '%provider_applied_at IS NOT NULL%',
          '%reconciliation_claim_token IS NULL%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_state_shape',
        ARRAY[
          '%state = ''creating''%', '%state = ''open''%',
          '%state = ''completed''%', '%state = ''expired''%',
          '%stripe_checkout_session_id%', '%stripe_subscription_id%',
          '%completed_at%', '%expired_at%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_session_id_shape',
        ARRAY[
          '%stripe_checkout_session_id%', '%cs_[A-Za-z0-9_]+%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_customer_id_shape',
        ARRAY['%stripe_customer_id%', '%cus_[A-Za-z0-9]+%']::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_subscription_id_shape',
        ARRAY['%stripe_subscription_id%', '%sub_[A-Za-z0-9]+%']::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_url_shape',
        ARRAY[
          '%checkout_url%', '%https://%', '%char_length(checkout_url)%4096%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts',
        'chat_only_checkout_attempt_time_shape',
        ARRAY[
          '%claim_expires_at >= claimed_at%',
          '%checkout_session_expires_at > created_at%'
        ]::text[]
      )
  ) AS expected(relation_name, constraint_name, required_patterns)
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conrelid = to_regclass(expected.relation_name)
   AND constraint_row.conname = expected.constraint_name
  WHERE constraint_row.oid IS NULL
    OR EXISTS (
      SELECT 1
      FROM unnest(expected.required_patterns) AS pattern(value)
      WHERE pg_get_constraintdef(constraint_row.oid) NOT LIKE pattern.value
    )
),
critical_unvalidated_constraints AS (
  SELECT count(*)::bigint AS failure_count
  FROM pg_constraint AS constraint_row
  WHERE constraint_row.conrelid IN (
      SELECT to_regclass(relation_name) FROM expected_relations
    )
    AND NOT constraint_row.convalidated
),
expected_indexes(index_name, must_be_unique) AS (
  VALUES
    ('public.idx_ai_reply_periods_business_period', false),
    ('public.idx_ai_reply_reservations_period_status_expiry', false),
    ('public.idx_ai_reply_reservations_business_status_expiry', false),
    ('public.idx_ai_reply_reservations_global_expiry', false),
    ('public.idx_ai_reply_attempts_status_expiry', false),
    ('public.anthropic_provider_calls_provider_request_unique', true),
    ('public.idx_anthropic_provider_calls_business_created', false),
    ('public.idx_anthropic_provider_calls_reservation', false),
    ('public.idx_widget_ingress_rate_buckets_window', false),
    ('public.idx_widget_request_rate_buckets_window', false),
    ('public.idx_widget_request_capacity_leases_active_business', false),
    ('public.idx_widget_request_capacity_leases_active_session', false),
    ('public.calendar_bookings_active_slot_lookup_idx', false),
    ('public.calendar_provider_operations_create_event_unique', true),
    ('public.calendar_provider_operations_live_slot_idx', false),
    ('public.calendar_provider_operations_reconciliation_idx', false),
    ('public.calendar_provider_operations_live_target_unique', true),
    ('public.chat_only_checkout_attempts_one_live_per_business', true),
    ('public.chat_only_checkout_attempts_subscription_unique', true),
    ('public.chat_only_checkout_attempts_state_expiry_idx', false)
),
index_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_indexes AS expected
  LEFT JOIN pg_class AS index_class
    ON index_class.oid = to_regclass(expected.index_name)
  LEFT JOIN pg_index AS index_row
    ON index_row.indexrelid = index_class.oid
  WHERE index_class.oid IS NULL
    OR index_class.relkind <> 'i'
    OR NOT index_row.indisvalid
    OR NOT index_row.indisready
    OR index_row.indisunique IS DISTINCT FROM expected.must_be_unique
),
index_definition_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      (
        'public.calendar_bookings_active_slot_lookup_idx',
        ARRAY[
          '%business_id, google_calendar_id, starts_at, ends_at%',
          '%status = ANY (ARRAY[''pending''::text, ''confirmed''::text])%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations_create_event_unique',
        ARRAY[
          '%UNIQUE INDEX%',
          '%business_id, google_calendar_id, deterministic_google_event_id%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations_live_slot_idx',
        ARRAY[
          '%business_id, google_calendar_id, desired_starts_at, desired_ends_at%',
          '%status = ANY (ARRAY[''holding''::text, ''provider_applied''::text])%'
        ]::text[]
      ),
      (
        'public.calendar_provider_operations_reconciliation_idx',
        ARRAY['%reconciliation_attempted_at%', '%created_at%']::text[]
      ),
      (
        'public.calendar_provider_operations_live_target_unique',
        ARRAY[
          '%UNIQUE INDEX%',
          '%business_id, google_calendar_id, provider_target_event_id%',
          '%status = ANY (ARRAY[''holding''::text, ''provider_applied''::text])%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts_one_live_per_business',
        ARRAY[
          '%UNIQUE INDEX%',
          '%(business_id)%',
          '%state = ANY (ARRAY[''creating''::text, ''open''::text])%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts_subscription_unique',
        ARRAY[
          '%UNIQUE INDEX%',
          '%(stripe_subscription_id)%',
          '%stripe_subscription_id IS NOT NULL%'
        ]::text[]
      ),
      (
        'public.chat_only_checkout_attempts_state_expiry_idx',
        ARRAY[
          '%state, checkout_session_expires_at, business_id%'
        ]::text[]
      )
  ) AS expected(index_name, required_patterns)
  WHERE to_regclass(expected.index_name) IS NULL
    OR EXISTS (
      SELECT 1
      FROM unnest(expected.required_patterns) AS pattern(value)
      WHERE pg_get_indexdef(to_regclass(expected.index_name))
        NOT LIKE pattern.value
    )
),
expected_private_relations(relation_name, service_may_write) AS (
  VALUES
    ('public.business_plan_family_locks', true),
    ('public.ai_reply_usage_periods', false),
    ('public.ai_reply_reservations', false),
    ('public.ai_reply_reservation_attempts', false),
    ('public.anthropic_provider_calls', false),
    ('public.widget_offline_lead_submissions', false),
    ('public.widget_ingress_rate_buckets', false),
    ('public.widget_request_rate_buckets', false),
    ('public.widget_request_capacity_leases', false),
    ('public.calendar_provider_operations', false),
    ('public.chat_only_checkout_attempts', false)
),
private_relation_security_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_private_relations AS expected
  LEFT JOIN pg_class AS class
    ON class.oid = to_regclass(expected.relation_name)
  WHERE class.oid IS NULL
    OR NOT class.relrowsecurity
    OR EXISTS (
      SELECT 1 FROM pg_policy AS policy WHERE policy.polrelid = class.oid
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(class.relacl, acldefault('r', class.relowner)))
        AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type IN (
          'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES',
          'TRIGGER'
        )
    )
    OR COALESCE(has_table_privilege('anon', class.oid, 'SELECT'), false)
    OR COALESCE(has_table_privilege('anon', class.oid, 'INSERT'), false)
    OR COALESCE(has_table_privilege('anon', class.oid, 'UPDATE'), false)
    OR COALESCE(has_table_privilege('anon', class.oid, 'DELETE'), false)
    OR COALESCE(
      has_table_privilege('authenticated', class.oid, 'SELECT'), false
    )
    OR COALESCE(
      has_table_privilege('authenticated', class.oid, 'INSERT'), false
    )
    OR COALESCE(
      has_table_privilege('authenticated', class.oid, 'UPDATE'), false
    )
    OR COALESCE(
      has_table_privilege('authenticated', class.oid, 'DELETE'), false
    )
    OR NOT COALESCE(
      has_table_privilege('service_role', class.oid, 'SELECT'), false
    )
    OR COALESCE(
      has_table_privilege('service_role', class.oid, 'DELETE'), false
    )
    OR COALESCE(
      has_table_privilege('service_role', class.oid, 'TRUNCATE'), false
    )
    OR COALESCE(
      has_table_privilege('service_role', class.oid, 'REFERENCES'), false
    )
    OR COALESCE(
      has_table_privilege('service_role', class.oid, 'TRIGGER'), false
    )
    OR (
      expected.service_may_write
      AND (
        NOT COALESCE(
          has_table_privilege('service_role', class.oid, 'INSERT'), false
        )
        OR NOT COALESCE(
          has_table_privilege('service_role', class.oid, 'UPDATE'), false
        )
      )
    )
    OR (
      NOT expected.service_may_write
      AND (
        COALESCE(
          has_table_privilege('service_role', class.oid, 'INSERT'), false
        )
        OR COALESCE(
          has_table_privilege('service_role', class.oid, 'UPDATE'), false
        )
        OR COALESCE(
          has_table_privilege('service_role', class.oid, 'DELETE'), false
        )
      )
    )
),
widget_schema_boundary_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    SELECT
      attribute.attnotnull,
      attribute.atttypid,
      pg_get_expr(default_value.adbin, default_value.adrelid)
        AS default_expression
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = to_regclass('public.widget_configs')
      AND attribute.attname = 'allowed_hostnames'
      AND NOT attribute.attisdropped
  ) AS allowlist
  RIGHT JOIN (VALUES (1)) AS required(marker) ON true
  WHERE allowlist.atttypid IS NULL
    OR allowlist.atttypid <> 'text[]'::regtype
    OR NOT allowlist.attnotnull
    OR allowlist.default_expression IS DISTINCT FROM 'ARRAY[]::text[]'
),
widget_validator_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      ('public.is_valid_widget_hostname(text)'),
      ('public.is_valid_widget_hostname_allowlist(text[])'),
      ('public.widget_hostname_from_website_url(text)')
  ) AS expected(identity)
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.identity)
  WHERE procedure.oid IS NULL
    OR procedure.provolatile <> 'i'
    OR NOT procedure.proisstrict
    OR procedure.prosecdef
    OR procedure.proconfig IS DISTINCT FROM
       ARRAY['search_path=public, pg_temp']::text[]
),
google_token_grant_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    SELECT catalog.oid
    FROM pg_class AS catalog
    WHERE catalog.oid = to_regclass('public.google_calendar_tokens')
  ) AS class
  RIGHT JOIN (VALUES (1)) AS required(marker) ON true
  WHERE class.oid IS NULL
    OR (
      NOT COALESCE(
        has_table_privilege('service_role', class.oid, 'UPDATE'), false
      )
      OR NOT COALESCE(
        has_table_privilege('service_role', class.oid, 'DELETE'), false
      )
      OR COALESCE(
        has_table_privilege('authenticated', class.oid, 'INSERT'), false
      )
      OR COALESCE(
        has_table_privilege('authenticated', class.oid, 'UPDATE'), false
      )
      OR COALESCE(
        has_table_privilege('authenticated', class.oid, 'DELETE'), false
      )
      OR COALESCE(
        has_table_privilege('anon', class.oid, 'INSERT'), false
      )
      OR COALESCE(
        has_table_privilege('anon', class.oid, 'UPDATE'), false
      )
      OR COALESCE(
        has_table_privilege('anon', class.oid, 'DELETE'), false
      )
    )
),
expected_service_functions(identity, expected_definer) AS (
  VALUES
    ('public.infer_business_plan_family(uuid)', false),
    ('public.claim_business_plan_family(uuid,text,text)', false),
    ('public.claim_direct_checkout_plan(uuid,text,boolean)', false),
    (
      'public.save_direct_onboarding_plan_intent(uuid,uuid,text,text)',
      false
    ),
    ('public.finalize_chat_only_onboarding_if_paid(uuid,text,text)', false),
    ('public.reserve_ai_reply(uuid,text,text,text,uuid)', true),
    ('public.get_current_ai_reply_usage(uuid)', true),
    ('public.get_completed_ai_reply(uuid,text,text,text)', true),
    ('public.finalize_ai_reply(uuid,uuid,uuid)', true),
    ('public.release_ai_reply(uuid,uuid,text)', true),
    ('public.reap_expired_ai_reply_reservations(integer)', true),
    (
      'public.record_anthropic_provider_call(uuid,uuid,uuid,text,text,text,boolean,text,text,bigint,bigint,bigint,bigint,integer,text,integer,integer,boolean,text)',
      true
    ),
    (
      'public.record_widget_offline_lead(uuid,text,uuid,text,text,text,text,text)',
      true
    ),
    ('public.acquire_widget_ingress_capacity(text,text)', true),
    (
      'public.acquire_widget_request_capacity(uuid,text,text,text,text,text)',
      true
    ),
    ('public.release_widget_request_capacity(uuid)', true),
    (
      'public.acquire_calendar_provider_operation(uuid,uuid,text,text,timestamptz,timestamptz,uuid,text,text,text,uuid)',
      true
    ),
    (
      'public.mark_calendar_provider_submission_started(uuid,uuid,uuid)',
      true
    ),
    (
      'public.mark_calendar_provider_operation_applied(uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb)',
      true
    ),
    (
      'public.mark_calendar_provider_delete_applied(uuid,uuid,uuid,text)',
      true
    ),
    ('public.finalize_calendar_provider_operation(uuid,uuid)', true),
    (
      'public.resolve_calendar_provider_operation_absent(uuid,uuid,uuid)',
      true
    ),
    ('public.fail_calendar_provider_operation(uuid,uuid,uuid,text)', true),
    (
      'public.claim_next_calendar_provider_operation_reconciliation(uuid)',
      true
    ),
    ('public.disconnect_google_calendar_token(uuid)', true),
    (
      'public.persist_google_calendar_token_refresh_if_unchanged(uuid,uuid,text,timestamptz)',
      true
    ),
    (
      'public.disconnect_google_calendar_token_if_unchanged(uuid,uuid)',
      true
    ),
    (
      'public.mark_calendar_booking_submission_started(uuid,uuid,uuid,timestamptz)',
      true
    ),
    (
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)',
      true
    ),
    ('public.claim_calendar_booking_reconciliation(uuid,uuid,uuid)', true),
    ('public.fail_calendar_booking(uuid,uuid,uuid,text)', true),
    (
      'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
      true
    ),
    (
      'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)',
      true
    ),
    (
      'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)',
      true
    ),
    (
      'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)',
      true
    ),
    (
      'public.record_chat_only_checkout_session(uuid,uuid,text,text,text,timestamptz)',
      true
    ),
    (
      'public.release_chat_only_checkout_attempt_claim(uuid,uuid)',
      true
    ),
    (
      'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)',
      true
    ),
    (
      'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)',
      true
    )
),
function_boundary_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_service_functions AS expected
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.identity)
  WHERE procedure.oid IS NULL
    OR procedure.prosecdef IS DISTINCT FROM expected.expected_definer
    OR procedure.proconfig IS DISTINCT FROM
       ARRAY['search_path=public, pg_temp']::text[]
    OR NOT COALESCE(
      has_function_privilege('service_role', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('anon', procedure.oid, 'EXECUTE'), false
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
),
internal_function_boundary_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES ('public.reconcile_linked_ai_reply_reservations(uuid)')
  ) AS expected(identity)
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.identity)
  WHERE procedure.oid IS NULL
    OR NOT procedure.prosecdef
    OR procedure.proconfig IS DISTINCT FROM
       ARRAY['search_path=public, pg_temp']::text[]
    OR COALESCE(
      has_function_privilege('service_role', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('anon', procedure.oid, 'EXECUTE'), false
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
),
expected_triggers(relation_name, trigger_name, function_identity) AS (
  VALUES
    (
      'public.businesses',
      'guard_business_onboarding_plan_intent_family',
      'public.guard_business_onboarding_plan_intent_family()'
    ),
    (
      'public.messages',
      'guard_message_ai_reply_reservation_proof',
      'public.guard_message_ai_reply_reservation_proof()'
    ),
    (
      'public.messages',
      'guard_metered_message_immutability',
      'public.guard_metered_message_immutability()'
    ),
    (
      'public.google_calendar_tokens',
      'rotate_google_calendar_token_credential_version',
      'public.rotate_google_calendar_token_credential_version()'
    ),
    (
      'public.google_calendar_tokens',
      'guard_google_calendar_token_delete',
      'public.guard_google_calendar_token_delete()'
    ),
    (
      'public.businesses',
      'guard_hot_lead_cleanup_inflight',
      'public.guard_hot_lead_cleanup_inflight()'
    ),
    (
      'public.businesses',
      'guard_business_chat_checkout_attempt_authority',
      'public.guard_business_chat_checkout_attempt_authority()'
    ),
    (
      'public.businesses',
      'guard_business_delete_chat_checkout_attempt_authority',
      'public.guard_business_chat_checkout_attempt_authority()'
    )
),
trigger_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_triggers AS expected
  LEFT JOIN pg_trigger AS trigger_row
    ON trigger_row.tgrelid = to_regclass(expected.relation_name)
   AND trigger_row.tgname = expected.trigger_name
   AND NOT trigger_row.tgisinternal
  WHERE trigger_row.oid IS NULL
    OR trigger_row.tgenabled <> 'O'
    OR trigger_row.tgfoid IS DISTINCT FROM
       to_regprocedure(expected.function_identity)
),
trigger_function_security_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      ('public.guard_business_onboarding_plan_intent_family()'),
      ('public.guard_message_ai_reply_reservation_proof()'),
      ('public.guard_metered_message_immutability()'),
      ('public.rotate_google_calendar_token_credential_version()'),
      ('public.guard_google_calendar_token_delete()'),
      ('public.guard_hot_lead_cleanup_inflight()'),
      ('public.guard_business_chat_checkout_attempt_authority()')
  ) AS expected(identity)
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.identity)
  WHERE procedure.oid IS NULL
    OR NOT procedure.prosecdef
    OR procedure.proconfig IS DISTINCT FROM
       ARRAY['search_path=public, pg_temp']::text[]
    OR COALESCE(
      has_function_privilege('service_role', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE'), false
    )
    OR COALESCE(
      has_function_privilege('anon', procedure.oid, 'EXECUTE'), false
    )
    OR EXISTS (
      SELECT 1
      FROM aclexplode(COALESCE(
        procedure.proacl,
        acldefault('f', procedure.proowner)
      )) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    )
),
expected_provider_columns(column_name, formatted_type) AS (
  VALUES
    ('id', 'uuid'),
    ('business_id', 'uuid'),
    ('operation_kind', 'text'),
    ('google_calendar_id', 'text'),
    ('desired_starts_at', 'timestamp with time zone'),
    ('desired_ends_at', 'timestamp with time zone'),
    ('linked_booking_id', 'uuid'),
    ('deterministic_google_event_id', 'text'),
    ('target_google_event_id', 'text'),
    ('provider_target_event_id', 'text'),
    ('request_fingerprint', 'text'),
    ('status', 'text'),
    ('claim_token', 'uuid'),
    ('claimed_at', 'timestamp with time zone'),
    ('claim_expires_at', 'timestamp with time zone'),
    ('claim_released_at', 'timestamp with time zone'),
    ('reconciliation_review_after_at', 'timestamp with time zone'),
    ('attempt_count', 'integer'),
    ('provider_submission_started_at', 'timestamp with time zone'),
    ('provider_event_id', 'text'),
    ('provider_starts_at', 'timestamp with time zone'),
    ('provider_ends_at', 'timestamp with time zone'),
    ('provider_evidence', 'jsonb'),
    ('provider_applied_at', 'timestamp with time zone'),
    ('finalized_at', 'timestamp with time zone'),
    ('failed_at', 'timestamp with time zone'),
    ('failure_reason', 'text'),
    ('reconciliation_claim_token', 'uuid'),
    ('reconciliation_claimed_at', 'timestamp with time zone'),
    ('reconciliation_claim_expires_at', 'timestamp with time zone'),
    ('reconciliation_attempt_count', 'integer'),
    ('reconciliation_attempted_at', 'timestamp with time zone'),
    ('created_at', 'timestamp with time zone'),
    ('updated_at', 'timestamp with time zone')
),
actual_provider_columns AS (
  SELECT
    attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid =
        to_regclass('public.calendar_provider_operations')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
provider_column_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_provider_columns AS expected
  FULL JOIN actual_provider_columns AS actual USING (column_name)
  WHERE expected.column_name IS NULL
    OR actual.column_name IS NULL
    OR expected.formatted_type IS DISTINCT FROM actual.formatted_type
),
provider_column_semantic_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      (
        'provider_target_event_id', 's',
        'COALESCE(target_google_event_id, deterministic_google_event_id)'
      ),
      ('status', '', '''holding''::text'),
      ('attempt_count', '', '1'),
      ('reconciliation_attempt_count', '', '0')
  ) AS expected(column_name, generated_kind, default_expression)
  LEFT JOIN pg_attribute AS attribute
    ON attribute.attrelid = to_regclass('public.calendar_provider_operations')
   AND attribute.attname = expected.column_name
   AND NOT attribute.attisdropped
  LEFT JOIN pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE attribute.attnum IS NULL
    OR attribute.attgenerated::text IS DISTINCT FROM expected.generated_kind
    OR pg_get_expr(default_value.adbin, default_value.adrelid)
       IS DISTINCT FROM expected.default_expression
),
expected_checkout_columns(column_name, formatted_type) AS (
  VALUES
    ('id', 'uuid'),
    ('business_id', 'uuid'),
    ('plan', 'text'),
    ('checkout_mode', 'text'),
    ('stripe_price_id', 'text'),
    ('request_fingerprint', 'text'),
    ('state', 'text'),
    ('claim_token', 'uuid'),
    ('claimed_at', 'timestamp with time zone'),
    ('claim_expires_at', 'timestamp with time zone'),
    ('attempt_count', 'integer'),
    ('stripe_checkout_session_id', 'text'),
    ('stripe_customer_id', 'text'),
    ('stripe_subscription_id', 'text'),
    ('checkout_url', 'text'),
    ('checkout_session_expires_at', 'timestamp with time zone'),
    ('completed_at', 'timestamp with time zone'),
    ('expired_at', 'timestamp with time zone'),
    ('created_at', 'timestamp with time zone'),
    ('updated_at', 'timestamp with time zone')
),
actual_checkout_columns AS (
  SELECT
    attribute.attname AS column_name,
    format_type(attribute.atttypid, attribute.atttypmod) AS formatted_type
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid =
        to_regclass('public.chat_only_checkout_attempts')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
),
checkout_column_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM expected_checkout_columns AS expected
  FULL JOIN actual_checkout_columns AS actual USING (column_name)
  WHERE expected.column_name IS NULL
    OR actual.column_name IS NULL
    OR expected.formatted_type IS DISTINCT FROM actual.formatted_type
),
credential_shape_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    SELECT
      attribute.attnotnull,
      attribute.atttypid,
      pg_get_expr(default_value.adbin, default_value.adrelid)
        AS default_expression
    FROM pg_attribute AS attribute
    LEFT JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid =
          to_regclass('public.google_calendar_tokens')
      AND attribute.attname = 'credential_version'
  ) AS credential
  RIGHT JOIN (VALUES (1)) AS required(marker) ON true
  WHERE credential.atttypid IS NULL
    OR credential.atttypid <> 'uuid'::regtype
    OR NOT credential.attnotnull
    OR credential.default_expression IS DISTINCT FROM 'gen_random_uuid()'
),
plan_family_evidence AS (
  SELECT
    evidence.business_id,
    bool_or(evidence.family = 'chat_only') AS has_chat_evidence,
    bool_or(evidence.family = 'sms') AS has_sms_evidence
  FROM (
    SELECT
      subscription.business_id,
      CASE WHEN candidate.plan = 'chat_only' THEN 'chat_only' ELSE 'sms' END
        AS family
    FROM public.subscriptions AS subscription
    CROSS JOIN LATERAL (
      VALUES (subscription.plan), (subscription.pending_plan)
    ) AS candidate(plan)
    WHERE candidate.plan IN (
      'chat_only', 'sms_only', 'sms_and_chat', 'full'
    )

    UNION ALL
    SELECT
      job.business_id,
      CASE WHEN job.partner_plan = 'chat_only' THEN 'chat_only' ELSE 'sms' END
    FROM public.partner_client_provisioning_jobs AS job
    WHERE job.partner_plan IN (
      'chat_only', 'sms_only', 'sms_and_chat', 'full'
    )

    UNION ALL
    SELECT
      business.id,
      CASE
        WHEN business.partner_plan = 'chat_only' THEN 'chat_only'
        ELSE 'sms'
      END
    FROM public.businesses AS business
    WHERE business.partner_plan IN (
      'chat_only', 'sms_only', 'sms_and_chat', 'full'
    )

    UNION ALL
    SELECT
      usage_period.business_id,
      CASE WHEN usage_period.plan = 'chat_only' THEN 'chat_only' ELSE 'sms' END
    FROM public.billing_usage_periods AS usage_period
    WHERE usage_period.plan IN (
      'chat_only', 'sms_only', 'sms_and_chat', 'full'
    )

    UNION ALL
    SELECT business.id, 'sms'
    FROM public.businesses AS business
    WHERE (
      business.billing_mode = 'stripe'
      AND business.partner_plan IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription
        WHERE subscription.business_id = business.id
      )
      AND (
        business.billing_pilot
        OR business.billing_comped
        OR business.billing_exempt
      )
    ) OR business.telnyx_brand_id IS NOT NULL
      OR business.telnyx_campaign_id IS NOT NULL
      OR business.telnyx_messaging_profile_id IS NOT NULL
      OR business.telnyx_voice_application_id IS NOT NULL
      OR business.active_telnyx_release_run_id IS NOT NULL
      OR business.telnyx_resource_state IN (
        'active', 'parked', 'release_pending', 'releasing', 'blocked',
        'protected_hold'
      )

    UNION ALL
    SELECT phone_number.business_id, 'sms'
    FROM public.phone_numbers AS phone_number
    WHERE phone_number.business_id IS NOT NULL
      AND phone_number.resource_status <> 'released'
      AND (
        phone_number.is_active
        OR phone_number.telnyx_phone_number_id IS NOT NULL
      )

    UNION ALL
    SELECT resource.business_id, 'sms'
    FROM public.telnyx_managed_resources AS resource
    WHERE resource.business_id IS NOT NULL
      AND resource.local_claim_active
      AND resource.ownership_state <> 'released'
  ) AS evidence
  GROUP BY evidence.business_id
),
plan_family_lock_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM plan_family_evidence AS evidence
  LEFT JOIN public.business_plan_family_locks AS family_lock
    ON family_lock.business_id = evidence.business_id
  WHERE (evidence.has_chat_evidence AND evidence.has_sms_evidence)
    OR (
      evidence.has_chat_evidence
      AND NOT evidence.has_sms_evidence
      AND family_lock.family IS DISTINCT FROM 'chat_only'
    )
    OR (
      evidence.has_sms_evidence
      AND NOT evidence.has_chat_evidence
      AND family_lock.family IS DISTINCT FROM 'sms'
    )
),
content_free_provider_shape_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid =
        to_regclass('public.calendar_provider_operations')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attname IN (
      'customer_email', 'customer_name', 'event_summary',
      'event_description', 'event_location', 'attendees',
      'provider_payload', 'raw_response'
    )
),
content_free_reply_shape_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = to_regclass('public.anthropic_provider_calls')
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attname IN (
      'content', 'message', 'prompt', 'response', 'tool_input', 'tool_result',
      'metadata', 'request_body', 'response_body'
    )
),
critical_source_contracts(group_name, identity, required_patterns, forbidden_patterns) AS (
  VALUES
    (
      'migration_063_function_lock_boundaries',
      'public.acquire_calendar_provider_operation(uuid,uuid,text,text,timestamptz,timestamptz,uuid,text,text,text,uuid)',
      ARRAY[
        '%FROM public.businesses AS business%',
        '%FOR UPDATE%',
        '%FROM public.calendar_bookings AS booking%',
        '%FROM public.calendar_provider_operations AS operation%',
        '%calendar_provider_operation_busy%',
        '%calendar_provider_slot_unavailable%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_063_function_lock_boundaries',
      'public.reserve_calendar_booking(uuid,uuid,uuid,uuid,timestamptz,timestamptz,uuid,text,text,text)',
      ARRAY[
        '%FROM public.businesses AS business%',
        '%FOR UPDATE%',
        '%FROM public.google_calendar_tokens AS token%',
        '%FROM public.calendar_provider_operations AS operation%',
        '%operation.status IN (''holding'', ''provider_applied'')%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_063_function_lock_boundaries',
      'public.confirm_calendar_booking(uuid,uuid,text,timestamptz,timestamptz,uuid)',
      ARRAY[
        '%FROM public.businesses AS business%',
        '%FOR UPDATE%',
        '%operation.provider_target_event_id = btrim(p_google_event_id)%',
        '%operation.status IN (''holding'', ''provider_applied'')%',
        '%calendar_booking_slot_unavailable%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_063_function_namespace_boundaries',
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)',
      ARRAY[
        '%SELECT business.*%',
        '%FOR UPDATE%',
        '%lower(btrim(v_existing_token.google_email))%',
        '%lower(btrim(p_google_email))%',
        '%calendar_provider_oauth_namespace_busy%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_063_function_namespace_boundaries',
      'public.disconnect_google_calendar_token(uuid)',
      ARRAY[
        '%FROM public.businesses AS business%',
        '%UPDATE public.calendar_provider_operations%',
        '%DELETE FROM public.google_calendar_tokens%',
        '%calendar_provider_operation_busy%'
      ]::text[],
      ARRAY['%reconciliation_review_after_at <=%']::text[]
    ),
    (
      'migration_063_function_reconciliation_boundaries',
      'public.claim_next_calendar_provider_operation_reconciliation(uuid)',
      ARRAY[
        '%reconciliation_attempted_at ASC NULLS FIRST%',
        '%operation.created_at%',
        '%operation.id%',
        '%reconciliation_claim_expires_at <= v_now%'
      ]::text[],
      ARRAY['%reconciliation_review_after_at <=%']::text[]
    ),
    (
      'migration_063_function_reconciliation_boundaries',
      'public.guard_hot_lead_cleanup_inflight()',
      ARRAY[
        '%booking.status = ''pending''%',
        '%operation.status IN (''holding'', ''provider_applied'')%',
        '%account cleanup is waiting for a calendar provider operation%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_064_function_evidence_boundaries',
      'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)',
      ARRAY[
        '%FOR UPDATE%',
        '%business_plan_family_locks%',
        '%claim_business_plan_family%',
        '%onboarding_selected_plan IS DISTINCT FROM ''chat_only''%',
        '%v_business.operations_suspended_at IS NOT NULL%',
        '%FROM public.subscriptions%',
        '%chat_only_checkout_attempt_conflict%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_064_function_evidence_boundaries',
      'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)',
      ARRAY[
        '%FOR UPDATE%',
        '%v_attempt.stripe_price_id <> p_stripe_price_id%',
        '%v_attempt.request_fingerprint <> p_request_fingerprint%',
        '%sync_stripe_subscription_if_business_active%',
        '%stripe_subscription_id = COALESCE%',
        '%WHEN p_stripe_checkout_session_id IS NOT NULL THEN ''completed''%',
        '%completed_at = CASE%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_064_function_evidence_boundaries',
      'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)',
      ARRAY[
        '%FOR UPDATE%',
        '%subscription.stripe_checkout_session_id%',
        '%subscription.stripe_customer_id%',
        '%subscription.stripe_subscription_id%'
      ]::text[],
      ARRAY[]::text[]
    ),
    (
      'migration_064_function_evidence_boundaries',
      'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)',
      ARRAY[
        '%FOR UPDATE%',
        '%stripe_subscription_id IS NOT NULL%'
      ]::text[],
      ARRAY[
        '%v_attempt.checkout_session_expires_at < v_now%',
        '%v_attempt.checkout_session_expires_at <= v_now%'
      ]::text[]
    )
),
source_contract_results AS (
  SELECT
    expected.group_name,
    count(*) FILTER (
      WHERE procedure.oid IS NULL
        OR EXISTS (
          SELECT 1
          FROM unnest(expected.required_patterns) AS pattern(value)
          WHERE pg_get_functiondef(procedure.oid) NOT LIKE pattern.value
        )
        OR EXISTS (
          SELECT 1
          FROM unnest(expected.forbidden_patterns) AS pattern(value)
          WHERE pg_get_functiondef(procedure.oid) LIKE pattern.value
        )
    )::bigint AS failure_count
  FROM critical_source_contracts AS expected
  LEFT JOIN pg_proc AS procedure
    ON procedure.oid = to_regprocedure(expected.identity)
  GROUP BY expected.group_name
),
source_order_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      (
        strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.mark_calendar_provider_submission_started(uuid,uuid,uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) > 0
        AND strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.mark_calendar_provider_submission_started(uuid,uuid,uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) < strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.mark_calendar_provider_submission_started(uuid,uuid,uuid)'
          )), ''),
          'FROM public.calendar_provider_operations AS operation'
        )
      ),
      (
        strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.claim_calendar_booking_reconciliation(uuid,uuid,uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) > 0
        AND strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.claim_calendar_booking_reconciliation(uuid,uuid,uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) < strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.claim_calendar_booking_reconciliation(uuid,uuid,uuid)'
          )), ''),
          'FROM public.calendar_bookings AS booking'
        )
      ),
      (
        strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.disconnect_google_calendar_token(uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) > 0
        AND strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.disconnect_google_calendar_token(uuid)'
          )), ''),
          'FROM public.businesses AS business'
        ) < strpos(
          COALESCE(pg_get_functiondef(to_regprocedure(
            'public.disconnect_google_calendar_token(uuid)'
          )), ''),
          'DELETE FROM public.google_calendar_tokens'
        )
      )
  ) AS ordered_contract(is_valid)
  WHERE is_valid IS NOT TRUE
),
checkout_authority_trigger_failures AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    SELECT pg_get_triggerdef(trigger_row.oid) AS definition
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = to_regclass('public.businesses')
      AND trigger_row.tgname =
          'guard_business_chat_checkout_attempt_authority'
      AND NOT trigger_row.tgisinternal
  ) AS trigger_contract
  RIGHT JOIN (VALUES (1)) AS required(marker) ON true
  WHERE trigger_contract.definition IS NULL
    OR trigger_contract.definition NOT LIKE
       '%BEFORE UPDATE OF owner_id, deleted_at, billing_mode, partner_id, partner_plan%'
    OR trigger_contract.definition NOT LIKE
       '%billing_pilot, billing_comped, billing_exempt ON public.businesses%'
),
active_widget_health AS (
  SELECT
    count(*)::bigint AS active_widget_count,
    COALESCE(sum(cardinality(widget.allowed_hostnames)), 0)::bigint
      AS allowed_hostname_count,
    count(*) FILTER (
      WHERE cardinality(widget.allowed_hostnames) = 0
        OR NOT public.is_valid_widget_hostname_allowlist(
          widget.allowed_hostnames
        )
    )::bigint AS invalid_widget_count
  FROM public.widget_configs AS widget
  WHERE widget.is_active
),
active_booking_overlaps AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.calendar_bookings AS first_booking
  JOIN public.calendar_bookings AS second_booking
    ON second_booking.business_id = first_booking.business_id
   AND second_booking.google_calendar_id = first_booking.google_calendar_id
   AND second_booking.id > first_booking.id
   AND second_booking.status IN ('pending', 'confirmed')
   AND second_booking.starts_at < first_booking.ends_at
   AND second_booking.ends_at > first_booking.starts_at
  WHERE first_booking.status IN ('pending', 'confirmed')
),
invalid_provider_namespace AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.google_calendar_tokens AS token
  WHERE token.google_email IS NULL
    OR token.google_email <> lower(btrim(token.google_email))
    OR length(token.google_email) NOT BETWEEN 3 AND 254
    OR token.google_email ~ '[[:cntrl:]]'
    OR token.google_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
    OR token.calendar_id IS NULL
    OR token.calendar_id <> btrim(token.calendar_id)
    OR length(token.calendar_id) NOT BETWEEN 1 AND 1024
    OR token.calendar_id ~ '[[:cntrl:]]'
),
calendar_live_conflicts AS (
  SELECT (
    (
      SELECT count(*)
      FROM public.calendar_provider_operations AS first_operation
      JOIN public.calendar_provider_operations AS second_operation
        ON second_operation.business_id = first_operation.business_id
       AND second_operation.google_calendar_id =
           first_operation.google_calendar_id
       AND second_operation.id > first_operation.id
       AND second_operation.status IN ('holding', 'provider_applied')
       AND second_operation.operation_kind <> 'delete'
       AND COALESCE(
         second_operation.provider_starts_at,
         second_operation.desired_starts_at
       ) < COALESCE(
         first_operation.provider_ends_at,
         first_operation.desired_ends_at
       )
       AND COALESCE(
         second_operation.provider_ends_at,
         second_operation.desired_ends_at
       ) > COALESCE(
         first_operation.provider_starts_at,
         first_operation.desired_starts_at
       )
      WHERE first_operation.status IN ('holding', 'provider_applied')
        AND first_operation.operation_kind <> 'delete'
    ) + (
      SELECT count(*)
      FROM public.calendar_provider_operations AS operation
      JOIN public.calendar_bookings AS booking
        ON booking.business_id = operation.business_id
       AND booking.google_calendar_id = operation.google_calendar_id
       AND booking.status IN ('pending', 'confirmed')
       AND (
         operation.linked_booking_id IS NULL
         OR operation.linked_booking_id <> booking.id
       )
       AND operation.operation_kind <> 'delete'
       AND COALESCE(
         operation.provider_starts_at,
         operation.desired_starts_at
       ) < booking.ends_at
       AND COALESCE(
         operation.provider_ends_at,
         operation.desired_ends_at
       ) > booking.starts_at
      WHERE operation.status IN ('holding', 'provider_applied')
    ) + (
      SELECT count(*)
      FROM public.calendar_provider_operations AS operation
      JOIN public.calendar_bookings AS booking
        ON booking.business_id = operation.business_id
       AND booking.google_calendar_id = operation.google_calendar_id
       AND booking.status IN ('pending', 'confirmed')
       AND (
         operation.linked_booking_id IS NULL
         OR operation.linked_booking_id <> booking.id
       )
       AND operation.provider_target_event_id = COALESCE(
         booking.google_event_id,
         replace(booking.id::text, '-', '')
       )
      WHERE operation.status IN ('holding', 'provider_applied')
    )
  )::bigint AS conflict_count
),
provider_backlog AS (
  SELECT
    count(*) FILTER (
      WHERE operation.status IN ('holding', 'provider_applied')
    )::bigint AS unresolved_count,
    count(*) FILTER (
      WHERE operation.status IN ('holding', 'provider_applied')
        AND operation.reconciliation_review_after_at <= statement_timestamp()
    )::bigint AS overdue_count,
    count(*) FILTER (
      WHERE operation.status IN ('holding', 'provider_applied')
        AND operation.claim_token IS NOT NULL
        AND operation.claim_expires_at <= statement_timestamp()
    )::bigint AS expired_worker_claim_count,
    count(*) FILTER (
      WHERE operation.status IN ('holding', 'provider_applied')
        AND NOT EXISTS (
          SELECT 1
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id = operation.business_id
        )
    )::bigint AS missing_credential_count
  FROM public.calendar_provider_operations AS operation
),
reply_reservation_health AS (
  SELECT
    count(*) FILTER (
      WHERE reservation.status = 'reserved'
    )::bigint AS active_count,
    count(*) FILTER (
      WHERE reservation.status = 'reserved'
        AND reservation.expires_at <=
            statement_timestamp() - interval '2 minutes'
        AND NOT EXISTS (
          SELECT 1
          FROM public.messages AS assistant
          WHERE assistant.ai_reply_reservation_id = reservation.id
            AND assistant.ai_reply_reservation_attempt_token =
                reservation.attempt_token
        )
    )::bigint AS overdue_unlinked_count,
    count(*) FILTER (
      WHERE reservation.status <> 'completed'
        AND reservation.updated_at <=
            statement_timestamp() - interval '2 minutes'
        AND EXISTS (
          SELECT 1
          FROM public.messages AS assistant
          WHERE assistant.ai_reply_reservation_id = reservation.id
            AND assistant.ai_reply_reservation_attempt_token =
                reservation.attempt_token
            AND assistant.business_id = reservation.business_id
            AND assistant.role = 'assistant'
            AND assistant.channel = 'web_chat'
        )
    )::bigint AS overdue_linked_count,
    count(*) FILTER (
      WHERE current_attempt.status IS DISTINCT FROM reservation.status
    )::bigint AS attempt_mismatch_count
  FROM public.ai_reply_reservations AS reservation
  LEFT JOIN public.ai_reply_reservation_attempts AS current_attempt
    ON current_attempt.reservation_id = reservation.id
   AND current_attempt.attempt_count = reservation.attempt_count
   AND current_attempt.attempt_token = reservation.attempt_token
),
cleanup_health AS (
  SELECT
    count(*)::bigint AS eligible_count,
    count(*) FILTER (
      WHERE EXISTS (
        SELECT 1
        FROM public.calendar_bookings AS booking
        WHERE booking.business_id = business.id
          AND booking.status = 'pending'
      )
      OR EXISTS (
        SELECT 1
        FROM public.calendar_provider_operations AS operation
        WHERE operation.business_id = business.id
          AND operation.status IN ('holding', 'provider_applied')
      )
    )::bigint AS provider_blocked_count
  FROM public.businesses AS business
  WHERE business.deleted_at IS NOT NULL
    AND business.deletion_scheduled_for < statement_timestamp()
),
checkout_attempt_health AS (
  SELECT
    count(*) FILTER (
      WHERE attempt.state IN ('creating', 'open')
    )::bigint AS live_count,
    count(*) FILTER (
      WHERE attempt.state = 'creating'
        AND attempt.claim_expires_at <=
            statement_timestamp() - interval '2 minutes'
    )::bigint AS stale_creating_count,
    count(*) FILTER (
      WHERE attempt.state = 'open'
        AND attempt.checkout_session_expires_at <=
            statement_timestamp() - interval '2 minutes'
        AND attempt.stripe_subscription_id IS NULL
    )::bigint AS stale_open_count,
    count(*) FILTER (
      WHERE attempt.state = 'completed'
        AND NOT EXISTS (
          SELECT 1
          FROM public.subscriptions AS subscription
          WHERE subscription.business_id = attempt.business_id
            AND subscription.plan = 'chat_only'
            AND subscription.stripe_checkout_session_id =
                attempt.stripe_checkout_session_id
            AND subscription.stripe_customer_id = attempt.stripe_customer_id
            AND subscription.stripe_subscription_id =
                attempt.stripe_subscription_id
        )
    )::bigint AS completed_binding_mismatch_count,
    count(*) FILTER (
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.business_plan_family_locks AS family_lock
        WHERE family_lock.business_id = attempt.business_id
          AND family_lock.family = 'chat_only'
      )
    )::bigint AS family_lock_mismatch_count
  FROM public.chat_only_checkout_attempts AS attempt
),
checkout_live_duplicates AS (
  SELECT count(*)::bigint AS conflict_count
  FROM (
    SELECT attempt.business_id
    FROM public.chat_only_checkout_attempts AS attempt
    WHERE attempt.state IN ('creating', 'open')
    GROUP BY attempt.business_id
    HAVING count(*) > 1
  ) AS duplicate
),
cron_health AS (
  SELECT
    count(*)::bigint AS total_jobs,
    count(*) FILTER (
      WHERE job.jobname = 'cleanup_processed_webhook_events'
        AND job.active
        AND job.schedule = '0 3 * * *'
        AND job.command LIKE
          '%DELETE FROM processed_webhook_events%processed_at < now() - interval ''7 days''%'
    )::bigint AS valid_cleanup_jobs,
    count(*) FILTER (
      WHERE job.jobname = 'reap_expired_ai_reply_reservations'
        AND job.active
        AND job.schedule = '* * * * *'
        AND job.command LIKE
          '%SELECT public.reap_expired_ai_reply_reservations(500)%'
    )::bigint AS valid_reaper_jobs
  FROM cron.job AS job
),
report_rows AS (
  SELECT
    'post_migration'::text AS phase,
    'migration_ledger_exact_tip'::text AS check_name,
    CASE
      WHEN malformed_versions = 0
        AND versions_outside_reviewed_tip = 0
        AND reviewed_versions = 64
        AND phase4_tip_count = 1
        AND (SELECT missing_versions FROM ledger_gaps) = 0
      THEN 'PASS'
      ELSE 'BLOCKER'
    END AS status,
    (
      malformed_versions + versions_outside_reviewed_tip
      + (64 - LEAST(reviewed_versions, 64))
      + (SELECT missing_versions FROM ledger_gaps)
      + CASE WHEN phase4_tip_count = 1 THEN 0 ELSE 1 END
    )::bigint AS observed_count,
    'Ledger must be contiguous from 001 through the exact reviewed tip 064.'::text
      AS detail
  FROM ledger_health

  UNION ALL
  SELECT
    'post_migration', 'expected_relation_catalog',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Missing or wrong-kind Phase 4 prerequisite and private relations.'
  FROM missing_relations

  UNION ALL
  SELECT
    'post_migration', 'expected_validated_constraints',
    CASE
      WHEN named.failure_count = 0
        AND definition.failure_count = 0
        AND unvalidated.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    named.failure_count + definition.failure_count + unvalidated.failure_count,
    'Missing, definition-drifted, or unvalidated constraints on critical relations.'
  FROM constraint_failures AS named
  CROSS JOIN constraint_definition_failures AS definition
  CROSS JOIN critical_unvalidated_constraints AS unvalidated

  UNION ALL
  SELECT
    'post_migration', 'expected_index_catalog',
    CASE
      WHEN catalog.failure_count = 0 AND definition.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    catalog.failure_count + definition.failure_count,
    'Missing, invalid, uniqueness-drifted, or definition-drifted operational indexes.'
  FROM index_failures AS catalog
  CROSS JOIN index_definition_failures AS definition

  UNION ALL
  SELECT
    'post_migration', 'private_relation_rls_and_grants',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Private tables require RLS, no policies or public grants, and exact service access.'
  FROM private_relation_security_failures

  UNION ALL
  SELECT
    'post_migration', 'service_function_boundaries',
    CASE
      WHEN service.failure_count = 0 AND internal.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    service.failure_count + internal.failure_count,
    'Missing or privilege/search-path/security-mode-drifted service and internal functions.'
  FROM function_boundary_failures AS service
  CROSS JOIN internal_function_boundary_failures AS internal

  UNION ALL
  SELECT
    'post_migration', 'migration_061_widget_schema_boundaries',
    CASE
      WHEN schema.failure_count = 0 AND validators.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    schema.failure_count + validators.failure_count,
    'Exact fail-closed allowlist column and immutable canonical validator identities.'
  FROM widget_schema_boundary_failures AS schema
  CROSS JOIN widget_validator_failures AS validators

  UNION ALL
  SELECT
    'post_migration', 'migration_063_google_token_grants',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Service cleanup retains guarded writes while browser credential mutations stay revoked.'
  FROM google_token_grant_failures

  UNION ALL
  SELECT
    'post_migration', 'trigger_catalog_and_boundaries',
    CASE
      WHEN catalog.failure_count = 0 AND security.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    catalog.failure_count + security.failure_count,
    'Required active triggers must use pinned, uncallable definer functions.'
  FROM trigger_failures AS catalog
  CROSS JOIN trigger_function_security_failures AS security

  UNION ALL
  SELECT
    'post_migration', 'migration_063_provider_table_shape',
    CASE
      WHEN columns.failure_count = 0
        AND semantics.failure_count = 0
        AND credentials.failure_count = 0
        AND content.failure_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    columns.failure_count + semantics.failure_count
      + credentials.failure_count + content.failure_count,
    'Exact provider ledger columns, credential generation, and content-free shape.'
  FROM provider_column_failures AS columns
  CROSS JOIN provider_column_semantic_failures AS semantics
  CROSS JOIN credential_shape_failures AS credentials
  CROSS JOIN content_free_provider_shape_failures AS content

  UNION ALL
  SELECT
    'post_migration', 'migration_064_checkout_table_shape',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'The private Checkout ledger must expose exactly its reviewed lifecycle columns.'
  FROM checkout_column_failures

  UNION ALL
  SELECT
    'post_migration', 'plan_family_lock_invariants',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Businesses with mixed evidence or a missing or mismatched durable family lock.'
  FROM plan_family_lock_failures

  UNION ALL
  SELECT
    'post_migration', source.group_name,
    CASE
      WHEN source.failure_count = 0
        AND (
          source.group_name <> 'migration_063_function_lock_boundaries'
          OR ordering.failure_count = 0
        )
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    source.failure_count + CASE
      WHEN source.group_name = 'migration_063_function_lock_boundaries'
      THEN ordering.failure_count ELSE 0
    END,
    'Critical lock, namespace, reconciliation, and provider-evidence source contracts.'
  FROM source_contract_results AS source
  CROSS JOIN source_order_failures AS ordering

  UNION ALL
  SELECT
    'post_migration', 'migration_064_authority_trigger_fields',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Active attempts fence billing authority while acquisition separately rejects suspension.'
  FROM checkout_authority_trigger_failures

  UNION ALL
  SELECT
    'post_migration', 'active_widget_allowlist_invariants',
    CASE WHEN invalid_widget_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    invalid_widget_count,
    'Active widgets with an empty, duplicate, malformed, or over-broad allowlist.'
  FROM active_widget_health

  UNION ALL
  SELECT
    'post_migration', 'active_widget_inventory', 'PASS',
    active_widget_count,
    'Aggregate active widget configurations; no hostname or business identity is emitted.'
  FROM active_widget_health

  UNION ALL
  SELECT
    'post_migration', 'active_widget_hostname_inventory', 'PASS',
    allowed_hostname_count,
    'Aggregate exact allowed-hostname entries across active widget configurations.'
  FROM active_widget_health

  UNION ALL
  SELECT
    'post_migration', 'calendar_active_booking_conflicts',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Pairs of overlapping pending or confirmed bookings in one business calendar.'
  FROM active_booking_overlaps

  UNION ALL
  SELECT
    'post_migration', 'calendar_invalid_provider_namespaces',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Credential rows outside the normalized bounded provider namespace.'
  FROM invalid_provider_namespace

  UNION ALL
  SELECT
    'post_migration', 'calendar_live_provider_conflicts',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Live operation-to-operation or operation-to-booking target and slot conflicts.'
  FROM calendar_live_conflicts

  UNION ALL
  SELECT
    'post_migration', 'calendar_provider_unresolved_backlog', 'PASS',
    unresolved_count,
    'Aggregate holding or provider-applied operations requiring exact reconciliation.'
  FROM provider_backlog

  UNION ALL
  SELECT
    'post_migration', 'calendar_provider_overdue_backlog',
    CASE WHEN overdue_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    overdue_count,
    'Unresolved provider operations past the 48-hour review SLA; authority remains held.'
  FROM provider_backlog

  UNION ALL
  SELECT
    'post_migration', 'calendar_provider_expired_claim_inventory', 'PASS',
    expired_worker_claim_count,
    'Aggregate unresolved provider operations with a recoverable expired worker lease.'
  FROM provider_backlog

  UNION ALL
  SELECT
    'post_migration', 'calendar_provider_missing_credentials',
    CASE WHEN missing_credential_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    missing_credential_count,
    'Unresolved provider operations without their retained credential namespace.'
  FROM provider_backlog

  UNION ALL
  SELECT
    'post_migration', 'reply_reservation_active_inventory', 'PASS',
    active_count,
    'Aggregate active reply reservations at the report snapshot.'
  FROM reply_reservation_health

  UNION ALL
  SELECT
    'post_migration', 'reply_provider_ledger_content_shape',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Provider-call accounting contains no prompt, response, tool, or arbitrary metadata columns.'
  FROM content_free_reply_shape_failures

  UNION ALL
  SELECT
    'post_migration', 'reply_reservation_overdue_unlinked',
    CASE WHEN overdue_unlinked_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    overdue_unlinked_count,
    'Expired reservations without assistant proof beyond two reaper intervals.'
  FROM reply_reservation_health

  UNION ALL
  SELECT
    'post_migration', 'reply_reservation_overdue_linked',
    CASE WHEN overdue_linked_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    overdue_linked_count,
    'Persisted assistant proofs not finalized beyond two reaper intervals.'
  FROM reply_reservation_health

  UNION ALL
  SELECT
    'post_migration', 'reply_reservation_attempt_alignment',
    CASE WHEN attempt_mismatch_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    attempt_mismatch_count,
    'Logical reservation state mismatches against its current attempt.'
  FROM reply_reservation_health

  UNION ALL
  SELECT
    'post_migration', 'cleanup_eligible_inventory', 'PASS',
    eligible_count,
    'Aggregate businesses currently past the deletion grace period.'
  FROM cleanup_health

  UNION ALL
  SELECT
    'post_migration', 'cleanup_provider_blocked_backlog',
    CASE WHEN provider_blocked_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    provider_blocked_count,
    'Cleanup-eligible businesses intentionally fenced by unresolved calendar work.'
  FROM cleanup_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_live_attempt_inventory', 'PASS',
    live_count,
    'Aggregate creating or open Chat-only Checkout attempts.'
  FROM checkout_attempt_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_stale_creating_backlog',
    CASE WHEN stale_creating_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    stale_creating_count,
    'Creating attempts with an expired worker lease requiring exact idempotent recovery.'
  FROM checkout_attempt_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_stale_open_backlog',
    CASE WHEN stale_open_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    stale_open_count,
    'Open Sessions past provider expiry without bound Subscription evidence.'
  FROM checkout_attempt_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_completed_binding_invariants',
    CASE
      WHEN completed_binding_mismatch_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    completed_binding_mismatch_count,
    'Completed attempts lacking the exact local Checkout, Customer, and Subscription binding.'
  FROM checkout_attempt_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_family_lock_invariants',
    CASE WHEN family_lock_mismatch_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    family_lock_mismatch_count,
    'Checkout attempts without the durable Chat-only family claim.'
  FROM checkout_attempt_health

  UNION ALL
  SELECT
    'post_migration', 'checkout_singleflight_invariants',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Businesses with more than one creating or open Checkout attempt.'
  FROM checkout_live_duplicates

  UNION ALL
  SELECT
    'post_migration', 'database_cron_exact_jobs',
    CASE
      WHEN total_jobs = 2
        AND valid_cleanup_jobs = 1
        AND valid_reaper_jobs = 1
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    total_jobs,
    'Exactly webhook cleanup daily and reply-reservation reaping minutely are approved.'
  FROM cron_health
)
SELECT phase, check_name, status, observed_count, detail
FROM report_rows
ORDER BY check_name;

ROLLBACK;
