-- SimplAssist proactive-widget migrations 065-066 preflight.
--
-- Safe output contract: every row contains only a fixed check name, a status,
-- an aggregate count, and fixed guidance. No tenant, owner, hostname, session,
-- message, contact, provider, or billing identifier is selected.
--
-- Run only after separately proving the intended Supabase target. This report
-- is valid only at the exact contiguous migration tip 064; any newer migration
-- fails closed and requires a newly reviewed report.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
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
      AS reviewed_tip_count
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
migration_065_object_health AS (
  SELECT count(*)::bigint AS present_count
  FROM pg_attribute AS attribute
  WHERE attribute.attrelid = to_regclass('public.widget_configs')
    AND attribute.attname = 'proactive_invitation_enabled'
    AND NOT attribute.attisdropped
),
migration_066_object_health AS (
  SELECT
    CASE
      WHEN to_regclass('public.widget_engagement_events') IS NULL
      THEN 0 ELSE 1
    END::bigint AS relation_present_count,
    (
      SELECT count(*)::bigint
      FROM (
        VALUES
          (
            'public.record_widget_engagement_event(uuid,text,text,text,text,integer)'
          ),
          ('public.acquire_widget_telemetry_ingress_capacity(text)'),
          (
            'public.acquire_widget_telemetry_capacity(uuid,text,text,text,text)'
          ),
          ('public.purge_widget_engagement_events()')
      ) AS expected(identity)
      WHERE to_regprocedure(expected.identity) IS NOT NULL
    ) AS function_present_count
),
endpoint_constraint_health AS (
  SELECT count(*)::bigint AS failure_count
  FROM (
    VALUES
      (
        'public.widget_ingress_rate_buckets',
        'widget_ingress_rate_buckets_endpoint_check',
        ARRAY[
          '%''config''%', '%''chat''%', '%''end''%', '%''lead''%'
        ]::text[],
        'CHECKendpoint=ANYARRAY[''config'',''chat'',''end'',''lead'']'
      ),
      (
        'public.widget_request_rate_buckets',
        'widget_request_rate_buckets_endpoint_check',
        ARRAY[
          '%''config''%', '%''chat''%', '%''end''%', '%''lead''%',
          '%''preview_chat''%', '%''preview_end''%'
        ]::text[],
        'CHECKendpoint=ANYARRAY[''config'',''chat'',''end'',''lead'',''preview_chat'',''preview_end'']'
      )
  ) AS expected(
    relation_name,
    constraint_name,
    required_patterns,
    normalized_definition
  )
  LEFT JOIN pg_constraint AS constraint_row
    ON constraint_row.conrelid = to_regclass(expected.relation_name)
   AND constraint_row.conname = expected.constraint_name
  WHERE constraint_row.oid IS NULL
    OR NOT constraint_row.convalidated
    OR pg_get_constraintdef(constraint_row.oid) LIKE '%''telemetry''%'
    OR replace(
      regexp_replace(
        pg_get_constraintdef(constraint_row.oid),
        '[[:space:]()]',
        '',
        'g'
      ),
      '::text',
      ''
    ) IS DISTINCT FROM expected.normalized_definition
    OR EXISTS (
      SELECT 1
      FROM unnest(expected.required_patterns) AS pattern(value)
      WHERE pg_get_constraintdef(constraint_row.oid) NOT LIKE pattern.value
    )
),
widget_config_security_health AS (
  SELECT count(*)::bigint AS failure_count
  FROM (VALUES (1)) AS required(marker)
  LEFT JOIN pg_class AS class
    ON class.oid = to_regclass('public.widget_configs')
  WHERE class.oid IS NULL
    OR class.relkind <> 'r'
    OR NOT class.relrowsecurity
    OR NOT EXISTS (
      SELECT 1
      FROM pg_attribute AS attribute
      WHERE attribute.attrelid = class.oid
        AND attribute.attname = 'welcome_message'
        AND attribute.atttypid = 'text'::regtype
        AND NOT attribute.attisdropped
    )
    OR (
      SELECT count(*)
      FROM pg_policy AS policy
      WHERE policy.polrelid = class.oid
    ) <> 4
    OR EXISTS (
      SELECT 1
      FROM (
        VALUES
          ('widget_configs_delete'),
          ('widget_configs_insert'),
          ('widget_configs_select'),
          ('widget_configs_update')
      ) AS expected(policy_name)
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_policy AS policy
        WHERE policy.polrelid = class.oid
          AND policy.polname = expected.policy_name
      )
    )
),
widget_config_health AS (
  SELECT
    count(*)::bigint AS total_count,
    count(*) FILTER (WHERE widget.is_active)::bigint AS active_count,
    count(*) FILTER (
      WHERE widget.is_active
        AND (
          widget.allowed_hostnames IS NULL
          OR cardinality(widget.allowed_hostnames) = 0
          OR NOT public.is_valid_widget_hostname_allowlist(
            widget.allowed_hostnames
          )
        )
    )::bigint AS invalid_active_count
  FROM public.widget_configs AS widget
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
    'proactive_pre_migration'::text AS phase,
    'migration_ledger_exact_064'::text AS check_name,
    CASE
      WHEN malformed_versions = 0
        AND versions_outside_reviewed_tip = 0
        AND reviewed_versions = 64
        AND reviewed_tip_count = 1
        AND (SELECT missing_versions FROM ledger_gaps) = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END AS status,
    (
      malformed_versions + versions_outside_reviewed_tip
      + (64 - LEAST(reviewed_versions, 64))
      + (SELECT missing_versions FROM ledger_gaps)
      + CASE WHEN reviewed_tip_count = 1 THEN 0 ELSE 1 END
    )::bigint AS observed_count,
    'Ledger must be contiguous from 001 through exact tip 064 with no future migration.'::text
      AS detail
  FROM ledger_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'migration_065_preference_column_absent',
    CASE WHEN present_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    present_count,
    'The proactive preference must be absent before applying migration 065.'
  FROM migration_065_object_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'migration_066_telemetry_objects_absent',
    CASE
      WHEN relation_present_count = 0 AND function_present_count = 0
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    relation_present_count + function_present_count,
    'The telemetry relation and four service functions must be absent before migration 066.'
  FROM migration_066_object_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'pre_066_widget_endpoint_constraints',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Both endpoint constraints must retain their reviewed pre-066 values and exclude telemetry.'
  FROM endpoint_constraint_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'widget_config_security_prerequisites',
    CASE WHEN failure_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    failure_count,
    'Widget settings require the exact four owner policies, RLS, and the existing welcome-message privilege baseline.'
  FROM widget_config_security_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'active_widget_allowlist_prerequisites',
    CASE WHEN invalid_active_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    invalid_active_count,
    'Active widget configurations require a nonempty canonical hostname allowlist before the default-on preference backfill.'
  FROM widget_config_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'widget_config_inventory', 'PASS',
    total_count,
    'Aggregate widget configuration rows that migration 065 will backfill; no business identity is emitted.'
  FROM widget_config_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'active_widget_inventory', 'PASS',
    active_count,
    'Aggregate active widget configurations; no hostname or business identity is emitted.'
  FROM widget_config_health

  UNION ALL
  SELECT
    'proactive_pre_migration', 'database_cron_pre_066_exact_jobs',
    CASE
      WHEN total_jobs = 2
        AND valid_cleanup_jobs = 1
        AND valid_reaper_jobs = 1
      THEN 'PASS' ELSE 'BLOCKER'
    END,
    total_jobs,
    'Exactly webhook cleanup daily and reply-reservation reaping minutely must exist before migration 066 adds the third job.'
  FROM cron_health
)
SELECT phase, check_name, status, observed_count, detail
FROM report_rows
ORDER BY check_name;

ROLLBACK;
