-- SimplAssist Phase 4 pre-migration report.
--
-- Safe output contract: every row contains only a fixed check name, a status,
-- an aggregate count, and fixed guidance. No tenant, owner, provider, billing,
-- or Checkout identifier is selected. Run this only after separately proving
-- the intended Supabase target and Stripe mode.
--
-- This report intentionally references no migration-064 relation or function.
-- Its data reads use only objects established before the Phase 4 migration tip.

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
ledger_summary AS (
  SELECT
    count(*) FILTER (WHERE migration_number IS NULL)::bigint
      AS malformed_versions,
    count(*) FILTER (WHERE migration_number > 64)::bigint
      AS versions_after_phase4,
    count(*) FILTER (WHERE migration_number = 64)::bigint
      AS phase4_tip_applied,
    COALESCE(max(migration_number) FILTER (
      WHERE migration_number BETWEEN 1 AND 64
    ), 0) AS highest_known_version
  FROM ledger
),
ledger_gaps AS (
  SELECT count(*)::bigint AS missing_versions
  FROM ledger_summary AS summary
  CROSS JOIN LATERAL generate_series(
    1,
    summary.highest_known_version
  ) AS expected(version_number)
  WHERE NOT EXISTS (
    SELECT 1
    FROM ledger
    WHERE ledger.migration_number = expected.version_number
  )
),
phone_release_conflicts AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.telnyx_resource_release_actions AS action
  WHERE action.resource_type IN ('phone_number_assignment', 'phone_number')
    AND action.previous_resource_status IS NULL
),
family_evidence AS (
  SELECT
    business.id AS business_id,
    (
      EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription
        WHERE subscription.business_id = business.id
          AND (
            subscription.plan = 'chat_only'
            OR subscription.pending_plan = 'chat_only'
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.partner_client_provisioning_jobs AS job
        WHERE job.business_id = business.id
          AND job.partner_plan = 'chat_only'
      )
      OR business.partner_plan = 'chat_only'
      OR EXISTS (
        SELECT 1
        FROM public.billing_usage_periods AS usage_period
        WHERE usage_period.business_id = business.id
          AND usage_period.plan = 'chat_only'
      )
    ) AS has_chat_evidence,
    (
      EXISTS (
        SELECT 1
        FROM public.subscriptions AS subscription
        WHERE subscription.business_id = business.id
          AND (
            subscription.plan IN ('sms_only', 'sms_and_chat', 'full')
            OR subscription.pending_plan IN (
              'sms_only', 'sms_and_chat', 'full'
            )
          )
      )
      OR business.partner_plan IN ('sms_only', 'sms_and_chat', 'full')
      OR (
        business.billing_mode = 'stripe'
        AND business.partner_plan IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.subscriptions AS override_subscription
          WHERE override_subscription.business_id = business.id
        )
        AND (
          business.billing_pilot
          OR business.billing_comped
          OR business.billing_exempt
        )
      )
      OR business.telnyx_brand_id IS NOT NULL
      OR business.telnyx_campaign_id IS NOT NULL
      OR business.telnyx_messaging_profile_id IS NOT NULL
      OR business.telnyx_voice_application_id IS NOT NULL
      OR business.active_telnyx_release_run_id IS NOT NULL
      OR business.telnyx_resource_state IN (
        'active', 'parked', 'release_pending', 'releasing', 'blocked',
        'protected_hold'
      )
      OR EXISTS (
        SELECT 1
        FROM public.partner_client_provisioning_jobs AS job
        WHERE job.business_id = business.id
          AND job.partner_plan IN ('sms_only', 'sms_and_chat', 'full')
      )
      OR EXISTS (
        SELECT 1
        FROM public.billing_usage_periods AS usage_period
        WHERE usage_period.business_id = business.id
          AND usage_period.plan IN ('sms_only', 'sms_and_chat', 'full')
      )
      OR EXISTS (
        SELECT 1
        FROM public.phone_numbers AS phone_number
        WHERE phone_number.business_id = business.id
          AND phone_number.resource_status <> 'released'
          AND (
            phone_number.is_active
            OR phone_number.telnyx_phone_number_id IS NOT NULL
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.telnyx_managed_resources AS resource
        WHERE resource.business_id = business.id
          AND resource.local_claim_active
          AND resource.ownership_state <> 'released'
      )
    ) AS has_sms_evidence
  FROM public.businesses AS business
),
family_conflicts AS (
  SELECT count(*)::bigint AS conflict_count
  FROM family_evidence
  WHERE has_chat_evidence AND has_sms_evidence
),
chat_setup_fee_conflicts AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.subscriptions AS subscription
  WHERE subscription.plan = 'chat_only'
    AND (
      subscription.stripe_setup_fee_price_id IS NOT NULL
      OR subscription.setup_fee_paid_at IS NOT NULL
    )
),
active_widget_urls AS (
  SELECT btrim(business.website_url) AS website_url
  FROM public.widget_configs AS widget
  JOIN public.businesses AS business ON business.id = widget.business_id
  WHERE widget.is_active
),
widget_url_authorities AS (
  SELECT
    website_url,
    CASE
      WHEN website_url IS NULL
        OR website_url = ''
        OR char_length(website_url) > 2048
        OR website_url ~ '[[:space:][:cntrl:]]'
        OR website_url LIKE '%,%'
        OR website_url LIKE '%@%'
        OR website_url LIKE '%[%'
        OR website_url LIKE '%]%'
        OR (
          website_url ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
          AND website_url !~* '^https?://'
        )
      THEN NULL
      ELSE split_part(
        split_part(
          split_part(
            regexp_replace(website_url, '^https?://', '', 'i'),
            '/', 1
          ),
          '?', 1
        ),
        '#', 1
      )
    END AS authority
  FROM active_widget_urls
),
widget_host_parts AS (
  SELECT
    authority,
    CASE
      WHEN authority IS NULL
        OR authority = ''
        OR authority LIKE '%@%'
        OR length(authority) - length(replace(authority, ':', '')) > 1
      THEN NULL
      WHEN strpos(authority, ':') > 0
      THEN lower(
        CASE
          WHEN right(left(authority, strpos(authority, ':') - 1), 1) = '.'
          THEN left(left(authority, strpos(authority, ':') - 1), -1)
          ELSE left(authority, strpos(authority, ':') - 1)
        END
      )
      ELSE lower(
        CASE
          WHEN right(authority, 1) = '.' THEN left(authority, -1)
          ELSE authority
        END
      )
    END AS hostname,
    CASE
      WHEN authority IS NOT NULL AND strpos(authority, ':') > 0
      THEN substring(authority FROM strpos(authority, ':') + 1)
      ELSE NULL
    END AS port
  FROM widget_url_authorities
),
widget_hostname_conflicts AS (
  SELECT count(*)::bigint AS conflict_count
  FROM widget_host_parts AS host
  WHERE host.hostname IS NULL
    OR host.hostname = ''
    OR char_length(host.hostname) > 253
    OR host.hostname ~ '[^a-z0-9.-]'
    OR EXISTS (
      SELECT 1
      FROM regexp_split_to_table(host.hostname, '\.') AS label(value)
      WHERE label.value = ''
        OR char_length(label.value) > 63
        OR label.value !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
    )
    OR CASE
      WHEN host.port IS NULL THEN false
      WHEN host.port ~ '^[0-9]+$' AND char_length(host.port) <= 5
      THEN host.port::integer NOT BETWEEN 1 AND 65535
      ELSE true
    END
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
pending_booking_without_token AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.calendar_bookings AS booking
  WHERE booking.status = 'pending'
    AND NOT EXISTS (
      SELECT 1
      FROM public.google_calendar_tokens AS token
      WHERE token.business_id = booking.business_id
    )
),
invalid_provider_namespace AS (
  SELECT count(*)::bigint AS conflict_count
  FROM public.google_calendar_tokens AS token
  WHERE NULLIF(btrim(token.google_email), '') IS NULL
    OR length(btrim(token.google_email)) > 254
    OR btrim(token.google_email) ~ '[[:cntrl:]]'
    OR lower(btrim(token.google_email)) !~
       '^[^[:space:]@]+@[^[:space:]@]+$'
    OR NULLIF(btrim(token.calendar_id), '') IS NULL
    OR length(btrim(token.calendar_id)) > 1024
    OR btrim(token.calendar_id) ~ '[[:cntrl:]]'
),
cleanup_eligible AS (
  SELECT count(*)::bigint AS eligible_count
  FROM public.businesses AS business
  WHERE business.deleted_at IS NOT NULL
    AND business.deletion_scheduled_for < statement_timestamp()
),
cron_state AS (
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
    'pre_migration'::text AS phase,
    'migration_ledger_format'::text AS check_name,
    CASE WHEN malformed_versions = 0 THEN 'PASS' ELSE 'BLOCKER' END AS status,
    malformed_versions AS observed_count,
    'Count of non-three-digit migration ledger versions.'::text AS detail
  FROM ledger_summary

  UNION ALL
  SELECT
    'pre_migration', 'migration_ledger_contiguous',
    CASE WHEN missing_versions = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    missing_versions,
    'Count of gaps from migration 001 through the highest applied known version.'
  FROM ledger_gaps

  UNION ALL
  SELECT
    'pre_migration', 'migration_ledger_unknown_future',
    CASE WHEN versions_after_phase4 = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    versions_after_phase4,
    'Count of applied migrations newer than the reviewed Phase 4 tip.'
  FROM ledger_summary

  UNION ALL
  SELECT
    'pre_migration', 'migration_064_not_yet_applied',
    CASE WHEN phase4_tip_applied = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    phase4_tip_applied,
    'Use the post-migration report when migration 064 is already applied.'
  FROM ledger_summary

  UNION ALL
  SELECT
    'pre_migration', 'migration_056_phone_release_prerequisite',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Phone release actions missing a restorable previous status.'
  FROM phone_release_conflicts

  UNION ALL
  SELECT
    'pre_migration', 'migration_059_plan_family_conflicts',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Businesses with simultaneous Chat-only and SMS-family durable evidence.'
  FROM family_conflicts

  UNION ALL
  SELECT
    'pre_migration', 'migration_059_chat_setup_fee_conflicts',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Chat-only subscription rows carrying SMS setup-fee history.'
  FROM chat_setup_fee_conflicts

  UNION ALL
  SELECT
    'pre_migration', 'migration_061_active_widget_hostname_derivability',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Active widgets whose current website URL cannot yield one canonical hostname.'
  FROM widget_hostname_conflicts

  UNION ALL
  SELECT
    'pre_migration', 'migration_062_active_booking_overlaps',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Pairs of overlapping pending or confirmed slots in one business calendar.'
  FROM active_booking_overlaps

  UNION ALL
  SELECT
    'pre_migration', 'migration_063_pending_booking_without_token',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Pending bookings without a retained Google credential namespace.'
  FROM pending_booking_without_token

  UNION ALL
  SELECT
    'pre_migration', 'migration_063_invalid_provider_namespace',
    CASE WHEN conflict_count = 0 THEN 'PASS' ELSE 'BLOCKER' END,
    conflict_count,
    'Google credential rows with a missing, malformed, or unbounded namespace.'
  FROM invalid_provider_namespace

  UNION ALL
  SELECT
    'pre_migration', 'cleanup_eligible_inventory', 'PASS',
    eligible_count,
    'Aggregate businesses currently past the deletion grace period; review scheduler overlap.'
  FROM cleanup_eligible

  UNION ALL
  SELECT
    'pre_migration', 'database_cron_exact_jobs',
    CASE
      WHEN EXISTS (SELECT 1 FROM ledger WHERE migration_number = 60)
        AND total_jobs = 2
        AND valid_cleanup_jobs = 1
        AND valid_reaper_jobs = 1
      THEN 'PASS'
      WHEN NOT EXISTS (SELECT 1 FROM ledger WHERE migration_number = 60)
        AND total_jobs = 1
        AND valid_cleanup_jobs = 1
        AND valid_reaper_jobs = 0
      THEN 'PASS'
      ELSE 'BLOCKER'
    END,
    total_jobs,
    'Expected only webhook cleanup, plus the reply reaper once migration 060 is applied.'
  FROM cron_state
)
SELECT phase, check_name, status, observed_count, detail
FROM report_rows
ORDER BY check_name;

ROLLBACK;
