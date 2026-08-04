BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits fixtures through dblink. Refuse to run unless the server
-- has the disposable local Supabase shape or the runner explicitly attests a
-- disposable database with
-- PGOPTIONS='-c simplassist.disposable_test_database=on'.
DO $require_disposable_local_database$
DECLARE
  v_server_address inet := inet_server_addr();
  v_known_local_jwt boolean := current_setting(
    'app.settings.jwt_secret',
    true
  ) = 'super-secret-jwt-token-with-at-least-32-characters-long';
  v_explicit_disposable_attestation boolean := current_setting(
    'simplassist.disposable_test_database',
    true
  ) = 'on';
BEGIN
  IF current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('port') <> '5432'
     OR NOT (
       v_server_address IS NULL
       OR v_server_address <<= inet '127.0.0.0/8'
       OR v_server_address <<= inet '10.0.0.0/8'
       OR v_server_address <<= inet '172.16.0.0/12'
       OR v_server_address <<= inet '192.168.0.0/16'
       OR v_server_address <<= inet '::1/128'
       OR v_server_address <<= inet 'fc00::/7'
     )
     OR NOT (
       (
         current_setting('data_directory') = '/var/lib/postgresql/data'
         AND v_known_local_jwt
       )
       OR v_explicit_disposable_attestation
     ) THEN
    RAISE EXCEPTION
      'test_045_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(32);

-- dblink sessions commit independently from this pgTAP transaction. Fixed
-- fixture IDs plus remote setup/cleanup keep interrupted local reruns safe.
DO $local_setup$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
BEGIN
  PERFORM extensions.dblink_connect(
    'test_045_setup',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_provision',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_delete_waiter',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_claim_for_dismiss',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_dismiss_waiter',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_dismiss_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_claim_after_dismiss',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_restore_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_claim_after_restore',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_customer_delete',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_admin_delete',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_oauth_delete',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_oauth_complete',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_oauth_reassign',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_oauth_complete_reassign',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_settings_delete',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_045_oauth_complete_settings',
    v_connection_string
  );

  PERFORM extensions.dblink_exec(
    'test_045_setup',
    $remote_setup$
      DO $fixture$
      BEGIN
        DELETE FROM public.admin_action_events
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        )
           OR provisioning_job_id IN (
                '30000000-0000-4000-a045-000000000091',
                '30000000-0000-4000-a045-000000000093',
                '30000000-0000-4000-a045-000000000094',
                '30000000-0000-4000-a045-000000000095'
              );

        DELETE FROM public.partner_client_provisioning_jobs
        WHERE id IN (
          '30000000-0000-4000-a045-000000000091',
          '30000000-0000-4000-a045-000000000093',
          '30000000-0000-4000-a045-000000000094',
          '30000000-0000-4000-a045-000000000095'
        );

        DELETE FROM public.telnyx_resource_release_events
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_actions
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_reasons
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        UPDATE public.businesses
        SET active_telnyx_release_run_id = NULL
        WHERE id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_runs
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a045-000000000091',
          '00000000-0000-4000-a045-000000000092',
          '00000000-0000-4000-a045-000000000093',
          '00000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.partners
        WHERE id = '20000000-0000-4000-a045-000000000091';

        INSERT INTO public.partners (
          id,
          name,
          slug,
          custom_domain,
          domain_status,
          status
        ) VALUES (
          '20000000-0000-4000-a045-000000000091',
          'Lifecycle Concurrency Partner 045',
          'lifecycle-concurrency-partner-045',
          'lifecycle-concurrency-045.example.com',
          'connected',
          'active'
        );

        INSERT INTO auth.users (id, email)
        VALUES
          (
            '00000000-0000-4000-a045-000000000091',
            'lifecycle-concurrency-a045@example.test'
          ),
          (
            '00000000-0000-4000-a045-000000000092',
            'oauth-concurrency-a045@example.test'
          ),
          (
            '00000000-0000-4000-a045-000000000093',
            'oauth-reassignment-concurrency-a045@example.test'
          ),
          (
            '00000000-0000-4000-a045-000000000094',
            'oauth-settings-concurrency-a045@example.test'
          );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a045-000000000091',
            name = 'Lifecycle Concurrency 045',
            slug = 'lifecycle-concurrency-045',
            partner_id = '20000000-0000-4000-a045-000000000091',
            billing_mode = 'invoiced',
            partner_plan = 'sms_and_chat',
            billing_comped = false,
            billing_pilot = false,
            billing_exempt = false
        WHERE owner_id = '00000000-0000-4000-a045-000000000091';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a045-000000000092',
            name = 'OAuth Concurrency 045',
            slug = 'oauth-concurrency-045',
            partner_id = '20000000-0000-4000-a045-000000000091',
            billing_mode = 'invoiced',
            partner_plan = 'sms_and_chat',
            billing_comped = false,
            billing_pilot = false,
            billing_exempt = false
        WHERE owner_id = '00000000-0000-4000-a045-000000000092';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a045-000000000093',
            name = 'OAuth Reassignment Concurrency 045',
            slug = 'oauth-reassignment-concurrency-045',
            partner_id = '20000000-0000-4000-a045-000000000091',
            billing_mode = 'invoiced',
            partner_plan = 'sms_and_chat',
            billing_comped = false,
            billing_pilot = false,
            billing_exempt = false
        WHERE owner_id = '00000000-0000-4000-a045-000000000093';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a045-000000000094',
            name = 'OAuth Settings Concurrency 045',
            slug = 'oauth-settings-concurrency-045',
            partner_id = '20000000-0000-4000-a045-000000000091',
            billing_mode = 'invoiced',
            partner_plan = 'sms_and_chat',
            billing_comped = false,
            billing_pilot = false,
            billing_exempt = false
        WHERE owner_id = '00000000-0000-4000-a045-000000000094';

        INSERT INTO public.ai_settings (business_id)
        VALUES ('10000000-0000-4000-a045-000000000094');

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
          created_by_admin_id
        ) VALUES (
          '30000000-0000-4000-a045-000000000091',
          'lifecycle-concurrency-a045@example.test',
          'Lifecycle Concurrency 045',
          '20000000-0000-4000-a045-000000000091',
          'invoiced',
          'sms_and_chat',
          '00000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000091',
          'business_prepared',
          '90000000-0000-4000-a045-000000000091'
        );

        INSERT INTO public.partner_client_provisioning_jobs (
          id,
          email,
          requested_business_name,
          partner_id,
          billing_mode,
          partner_plan,
          status,
          last_error_code,
          dismissed_at,
          dismissed_by_admin_id,
          created_by_admin_id
        ) VALUES
          (
            '30000000-0000-4000-a045-000000000093',
            'claim-before-dismiss-a045@example.test',
            'Claim Before Dismiss 045',
            '20000000-0000-4000-a045-000000000091',
            'invoiced',
            'sms_and_chat',
            'needs_attention',
            'email_in_use',
            NULL,
            NULL,
            '90000000-0000-4000-a045-000000000091'
          ),
          (
            '30000000-0000-4000-a045-000000000094',
            'dismiss-before-claim-a045@example.test',
            'Dismiss Before Claim 045',
            '20000000-0000-4000-a045-000000000091',
            'invoiced',
            'sms_and_chat',
            'needs_attention',
            'email_in_use',
            NULL,
            NULL,
            '90000000-0000-4000-a045-000000000091'
          ),
          (
            '30000000-0000-4000-a045-000000000095',
            'restore-before-claim-a045@example.test',
            'Restore Before Claim 045',
            '20000000-0000-4000-a045-000000000091',
            'invoiced',
            'sms_and_chat',
            'dismissed',
            'email_in_use',
            now(),
            '90000000-0000-4000-a045-000000000091',
            '90000000-0000-4000-a045-000000000091'
          );

        INSERT INTO public.google_calendar_oauth_attempts (
          id,
          state_digest,
          origin_verifier_digest,
          handoff_digest,
          business_id,
          owner_user_id,
          origin_partner_id,
          origin_hostname,
          status,
          expires_at,
          handoff_expires_at,
          claimed_at
        ) VALUES
          (
            '40000000-0000-4000-a045-000000000092',
            repeat('a', 64),
            repeat('b', 64),
            repeat('c', 64),
            '10000000-0000-4000-a045-000000000092',
            '00000000-0000-4000-a045-000000000092',
            '20000000-0000-4000-a045-000000000091',
            'lifecycle-concurrency-045.example.com',
            'claimed',
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '40000000-0000-4000-a045-000000000093',
            repeat('d', 64),
            repeat('e', 64),
            repeat('f', 64),
            '10000000-0000-4000-a045-000000000093',
            '00000000-0000-4000-a045-000000000093',
            '20000000-0000-4000-a045-000000000091',
            'lifecycle-concurrency-045.example.com',
            'claimed',
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '40000000-0000-4000-a045-000000000094',
            repeat('1a', 32),
            repeat('2b', 32),
            repeat('3c', 32),
            '10000000-0000-4000-a045-000000000094',
            '00000000-0000-4000-a045-000000000094',
            '20000000-0000-4000-a045-000000000091',
            'lifecycle-concurrency-045.example.com',
            'claimed',
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          );
      END;
      $fixture$;
    $remote_setup$
  );

  PERFORM extensions.dblink_exec('test_045_provision', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_provision',
    $remote_claim$
      DO $claim$
      BEGIN
        PERFORM public.claim_partner_client_provisioning_operation(
          '30000000-0000-4000-a045-000000000091',
          'retry',
          '50000000-0000-4000-a045-000000000091',
          NULL,
          now()
        );
      END;
      $claim$;
    $remote_claim$
  );
END;
$local_setup$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_delete_waiter',
    $remote_delete$
      SELECT public.schedule_account_deletion(
        '10000000-0000-4000-a045-000000000091',
        '00000000-0000-4000-a045-000000000091',
        requested_at,
        requested_at + interval '60 days'
      )::text AS payload
      FROM (SELECT now() AS requested_at) AS request
    $remote_delete$
  ),
  1,
  'account deletion starts while provisioning owns the ordered job lock'
);

DO $wait_for_provisioning_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_provisioning_lock$;

SELECT is(
  extensions.dblink_is_busy('test_045_delete_waiter'),
  1,
  'account deletion waits for the provisioning operation to commit'
);

SELECT lives_ok(
  $local_assertion$
    SELECT extensions.dblink_exec(
      'test_045_setup',
      $remote_assertion$
        DO $business_lock$
        BEGIN
          PERFORM 1
          FROM public.businesses
          WHERE id = '10000000-0000-4000-a045-000000000091'
          FOR UPDATE NOWAIT;
        END;
        $business_lock$;
      $remote_assertion$
    )
  $local_assertion$,
  'the waiting deletion has not inverted lock order by acquiring the business before the job'
);

DO $commit_provisioning_operation$
BEGIN
  PERFORM extensions.dblink_exec('test_045_provision', 'COMMIT');
END;
$commit_provisioning_operation$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_delete_waiter')
      AS deletion_result(payload text)
  $$,
  '55000',
  'provisioning_in_progress',
  'deletion rechecks the committed lease and fails without changing lifecycle state'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL
       AND deletion_scheduled_for IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000091'
  )
  AND (
    SELECT operation_token =
             '50000000-0000-4000-a045-000000000091'
       AND operation_kind = 'retry'
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000091'
  ),
  'the committed provisioning lease survives and the business remains active'
);

-- A provisioning claim and dismissal serialize on the same job row. When the
-- claim commits first, dismissal must re-read the durable lease and fail rather
-- than hiding a job whose external-operation outcome is still live.
DO $start_claim_before_dismiss$
BEGIN
  PERFORM extensions.dblink_exec('test_045_claim_for_dismiss', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_claim_for_dismiss',
    $claim$
      DO $operation$
      BEGIN
        PERFORM public.claim_partner_client_provisioning_operation(
          '30000000-0000-4000-a045-000000000093',
          'retry',
          '50000000-0000-4000-a045-000000000093',
          NULL,
          now()
        );
      END;
      $operation$;
    $claim$
  );
END;
$start_claim_before_dismiss$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_dismiss_waiter',
    $dismiss$
      SELECT (
        public.dismiss_partner_client_provisioning_job(
          '30000000-0000-4000-a045-000000000093',
          '90000000-0000-4000-a045-000000000093'
        )
      ).status::text AS status
    $dismiss$
  ),
  1,
  'dismissal starts while a provisioning claim owns the job lock'
);

DO $wait_for_claim_before_dismiss$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_claim_before_dismiss$;

SELECT is(
  extensions.dblink_is_busy('test_045_dismiss_waiter'),
  1,
  'dismissal waits behind the in-flight provisioning claim'
);

DO $commit_claim_before_dismiss$
BEGIN
  PERFORM extensions.dblink_exec('test_045_claim_for_dismiss', 'COMMIT');
END;
$commit_claim_before_dismiss$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_dismiss_waiter')
      AS dismissal_result(status text)
  $$,
  '55000',
  'provisioning_in_progress',
  'claim-first dismissal rechecks the committed lease and fails closed'
);

SELECT ok(
  (
    SELECT status = 'needs_attention'
       AND operation_token =
             '50000000-0000-4000-a045-000000000093'::uuid
       AND operation_kind = 'retry'
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000093'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_dismissed'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000093'
  ),
  'claim-first keeps the visible job and creates no false dismissal audit'
);

-- Reverse the order. A committed dismissal must make the waiting claim fail
-- with job_dismissed, leaving no operation lease on the hidden row.
DO $start_dismiss_before_claim$
BEGIN
  PERFORM extensions.dblink_exec('test_045_dismiss_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_dismiss_owner',
    $dismiss$
      DO $operation$
      BEGIN
        PERFORM public.dismiss_partner_client_provisioning_job(
          '30000000-0000-4000-a045-000000000094',
          '90000000-0000-4000-a045-000000000094'
        );
      END;
      $operation$;
    $dismiss$
  );
END;
$start_dismiss_before_claim$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_claim_after_dismiss',
    $claim$
      SELECT (
        public.claim_partner_client_provisioning_operation(
          '30000000-0000-4000-a045-000000000094',
          'retry',
          '50000000-0000-4000-a045-000000000094',
          NULL,
          now()
        )
      ).status::text AS status
    $claim$
  ),
  1,
  'provisioning claim starts while dismissal owns the job lock'
);

DO $wait_for_dismiss_before_claim$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_dismiss_before_claim$;

SELECT is(
  extensions.dblink_is_busy('test_045_claim_after_dismiss'),
  1,
  'provisioning claim waits behind the in-flight dismissal'
);

DO $commit_dismiss_before_claim$
BEGIN
  PERFORM extensions.dblink_exec('test_045_dismiss_owner', 'COMMIT');
END;
$commit_dismiss_before_claim$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_claim_after_dismiss')
      AS claim_result(status text)
  $$,
  '55000',
  'job_dismissed',
  'dismiss-first provisioning claim rechecks status and fails closed'
);

SELECT ok(
  (
    SELECT status = 'dismissed'
       AND operation_token IS NULL
       AND operation_kind IS NULL
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000094'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_dismissed'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000094'
  ),
  'dismiss-first leaves one audited hidden row without a provisioning lease'
);

-- Restore is the only transition that makes a dismissed job claimable again.
-- A waiting claim must observe the committed needs_attention row, then acquire
-- its own fenced lease exactly once.
DO $start_restore_before_claim$
BEGIN
  PERFORM extensions.dblink_exec('test_045_restore_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_restore_owner',
    $restore$
      DO $operation$
      BEGIN
        PERFORM public.restore_partner_client_provisioning_job(
          '30000000-0000-4000-a045-000000000095',
          '90000000-0000-4000-a045-000000000095'
        );
      END;
      $operation$;
    $restore$
  );
END;
$start_restore_before_claim$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_claim_after_restore',
    $claim$
      SELECT (
        public.claim_partner_client_provisioning_operation(
          '30000000-0000-4000-a045-000000000095',
          'retry',
          '50000000-0000-4000-a045-000000000095',
          NULL,
          now()
        )
      ).status::text AS status
    $claim$
  ),
  1,
  'provisioning claim starts while restore owns the dismissed job lock'
);

DO $wait_for_restore_before_claim$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_restore_before_claim$;

SELECT is(
  extensions.dblink_is_busy('test_045_claim_after_restore'),
  1,
  'provisioning claim waits behind the in-flight restore'
);

DO $commit_restore_before_claim$
BEGIN
  PERFORM extensions.dblink_exec('test_045_restore_owner', 'COMMIT');
END;
$commit_restore_before_claim$;

SELECT is(
  (
    SELECT status
    FROM extensions.dblink_get_result('test_045_claim_after_restore')
      AS claim_result(status text)
  ),
  'needs_attention',
  'restore-first claim observes the restored status and acquires its lease'
);

SELECT ok(
  (
    SELECT status = 'needs_attention'
       AND dismissed_at IS NULL
       AND dismissed_by_admin_id IS NULL
       AND operation_token =
             '50000000-0000-4000-a045-000000000095'::uuid
       AND operation_kind = 'retry'
    FROM public.partner_client_provisioning_jobs
    WHERE id = '30000000-0000-4000-a045-000000000095'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE action = 'provisioning_job_restored'
      AND provisioning_job_id =
        '30000000-0000-4000-a045-000000000095'
  ),
  'restore-first leaves one audited visible job with the waiting claim lease'
);

DO $prepare_customer_admin_race$
BEGIN
  PERFORM payload
  FROM extensions.dblink_get_result('test_045_delete_waiter', false)
    AS drained_deletion_result(payload text);

  PERFORM extensions.dblink_exec(
    'test_045_setup',
    $clear_lease$
      UPDATE public.partner_client_provisioning_jobs
      SET operation_token = NULL,
          operation_kind = NULL,
          operation_started_at = NULL,
          operation_expires_at = NULL
      WHERE id = '30000000-0000-4000-a045-000000000091'
    $clear_lease$
  );

  PERFORM extensions.dblink_exec('test_045_customer_delete', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_customer_delete',
    $customer_schedule$
      DO $schedule$
      DECLARE
        v_requested_at timestamptz := now();
      BEGIN
        PERFORM public.schedule_account_deletion(
          '10000000-0000-4000-a045-000000000091',
          '00000000-0000-4000-a045-000000000091',
          v_requested_at,
          v_requested_at + interval '60 days'
        );
      END;
      $schedule$;
    $customer_schedule$
  );
END;
$prepare_customer_admin_race$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_admin_delete',
    $admin_schedule$
      SELECT public.schedule_admin_account_deletion(
        '10000000-0000-4000-a045-000000000091',
        'Lifecycle Concurrency 045',
        false,
        '90000000-0000-4000-a045-000000000092'
      )::text AS payload
    $admin_schedule$
  ),
  1,
  'admin scheduling starts while customer deletion owns the same lock order'
);

DO $wait_for_customer_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_customer_lock$;

SELECT is(
  extensions.dblink_is_busy('test_045_admin_delete'),
  1,
  'admin scheduling waits behind the in-flight customer deletion'
);

DO $commit_customer_deletion$
BEGIN
  PERFORM extensions.dblink_exec('test_045_customer_delete', 'COMMIT');
END;
$commit_customer_deletion$;

CREATE TEMP TABLE lifecycle_045_concurrent_admin_result AS
SELECT payload::jsonb AS payload
FROM extensions.dblink_get_result('test_045_admin_delete')
  AS admin_result(payload text);

SELECT ok(
  (
    SELECT NOT (payload ->> 'admin_event_created')::boolean
       AND NOT (payload ->> 'previously_scheduled_by_admin')::boolean
       AND payload #>> '{scheduled,stripe_action}' IS NULL
    FROM lifecycle_045_concurrent_admin_result
  )
  AND (
    SELECT deleted_at IS NOT NULL
       AND deletion_scheduled_for IS NOT NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.admin_action_events
    WHERE action = 'account_deletion_scheduled'
      AND business_id = '10000000-0000-4000-a045-000000000091'
  ),
  'customer-first scheduling wins idempotently without creating a false admin audit event'
);

DO $start_oauth_deletion$
BEGIN
  PERFORM extensions.dblink_exec('test_045_oauth_delete', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_oauth_delete',
    $oauth_delete$
      DO $schedule$
      DECLARE
        v_requested_at timestamptz := now();
      BEGIN
        PERFORM public.schedule_account_deletion(
          '10000000-0000-4000-a045-000000000092',
          '00000000-0000-4000-a045-000000000092',
          v_requested_at,
          v_requested_at + interval '60 days'
        );
      END;
      $schedule$;
    $oauth_delete$
  );
END;
$start_oauth_deletion$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_oauth_complete',
    $oauth_complete$
      SELECT public.complete_google_calendar_oauth_connection(
        '40000000-0000-4000-a045-000000000092',
        '10000000-0000-4000-a045-000000000092',
        '00000000-0000-4000-a045-000000000092',
        '20000000-0000-4000-a045-000000000091',
        'lifecycle-concurrency-045.example.com',
        'access-token-concurrency-a045',
        'refresh-token-concurrency-a045',
        now() + interval '1 hour',
        'oauth-concurrency-a045@example.test',
        'primary'
      )::text AS completed
    $oauth_complete$
  ),
  1,
  'OAuth completion starts while account deletion owns the business lock'
);

DO $wait_for_oauth_business_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_oauth_business_lock$;

SELECT is(
  extensions.dblink_is_busy('test_045_oauth_complete'),
  1,
  'OAuth completion waits behind deletion before any credential write'
);

DO $commit_oauth_deletion$
BEGIN
  PERFORM extensions.dblink_exec('test_045_oauth_delete', 'COMMIT');
END;
$commit_oauth_deletion$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_oauth_complete')
      AS completion_result(completed text)
  $$,
  '55000',
  'oauth_workspace_changed',
  'OAuth completion rechecks the committed deletion and fails closed'
);

SELECT ok(
  (
    SELECT deleted_at IS NOT NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000092'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000092'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '40000000-0000-4000-a045-000000000092'
  ),
  'deletion wins without a Calendar token and invalidates the staged OAuth attempt'
);

DO $start_oauth_reassignment$
BEGIN
  PERFORM extensions.dblink_exec('test_045_oauth_reassign', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_oauth_reassign',
    $oauth_reassign$
      UPDATE public.businesses
      SET partner_id = NULL
      WHERE id = '10000000-0000-4000-a045-000000000093'
    $oauth_reassign$
  );
END;
$start_oauth_reassignment$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_oauth_complete_reassign',
    $oauth_complete$
      SELECT public.complete_google_calendar_oauth_connection(
        '40000000-0000-4000-a045-000000000093',
        '10000000-0000-4000-a045-000000000093',
        '00000000-0000-4000-a045-000000000093',
        '20000000-0000-4000-a045-000000000091',
        'lifecycle-concurrency-045.example.com',
        'reassignment-access-token-a045',
        'reassignment-refresh-token-a045',
        now() + interval '1 hour',
        'oauth-reassignment-a045@example.test',
        'primary'
      )::text AS completed
    $oauth_complete$
  ),
  1,
  'OAuth completion starts while partner reassignment owns the business lock'
);

DO $wait_for_oauth_reassignment_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_oauth_reassignment_lock$;

SELECT is(
  extensions.dblink_is_busy('test_045_oauth_complete_reassign'),
  1,
  'OAuth completion waits behind partner reassignment before writing credentials'
);

DO $commit_oauth_reassignment$
BEGIN
  PERFORM extensions.dblink_exec('test_045_oauth_reassign', 'COMMIT');
END;
$commit_oauth_reassignment$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_oauth_complete_reassign')
      AS completion_result(completed text)
  $$,
  '55000',
  'oauth_workspace_changed',
  'OAuth completion rechecks the committed partner reassignment and fails closed'
);

SELECT ok(
  (
    SELECT partner_id IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a045-000000000093'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000093'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '40000000-0000-4000-a045-000000000093'
  ),
  'reassignment wins without a Calendar token and invalidates the claimed attempt'
);

DO $start_settings_delete$
BEGIN
  PERFORM extensions.dblink_exec('test_045_settings_delete', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_045_settings_delete',
    $settings_delete$
      DELETE FROM public.ai_settings
      WHERE business_id = '10000000-0000-4000-a045-000000000094'
    $settings_delete$
  );
END;
$start_settings_delete$;

SELECT is(
  extensions.dblink_send_query(
    'test_045_oauth_complete_settings',
    $oauth_complete$
      SELECT public.complete_google_calendar_oauth_connection(
        '40000000-0000-4000-a045-000000000094',
        '10000000-0000-4000-a045-000000000094',
        '00000000-0000-4000-a045-000000000094',
        '20000000-0000-4000-a045-000000000091',
        'lifecycle-concurrency-045.example.com',
        'settings-race-access-token-a045',
        'settings-race-refresh-token-a045',
        now() + interval '1 hour',
        'oauth-settings-race-a045@example.test',
        'primary'
      )::text AS completed
    $oauth_complete$
  ),
  1,
  'OAuth completion starts while settings deletion owns the required row lock'
);

DO $wait_for_settings_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_settings_lock$;

SELECT is(
  extensions.dblink_is_busy('test_045_oauth_complete_settings'),
  1,
  'OAuth completion waits behind settings deletion before writing credentials'
);

DO $commit_settings_delete$
BEGIN
  PERFORM extensions.dblink_exec('test_045_settings_delete', 'COMMIT');
END;
$commit_settings_delete$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_045_oauth_complete_settings')
      AS completion_result(completed text)
  $$,
  '55000',
  'google_calendar_settings_missing',
  'OAuth completion rechecks the committed settings deletion and fails closed'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a045-000000000094'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a045-000000000094'
  )
  AND EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '40000000-0000-4000-a045-000000000094'
      AND status = 'claimed'
      AND authorization_code IS NULL
  ),
  'settings deletion wins without a token and preserves the claimed attempt for expiry cleanup'
);

DO $remote_cleanup$
BEGIN
  PERFORM completed
  FROM extensions.dblink_get_result('test_045_oauth_complete', false)
    AS drained_completion_result(completed text);

  PERFORM extensions.dblink_exec(
    'test_045_setup',
    $cleanup_sql$
      DO $cleanup$
      BEGIN
        DELETE FROM public.admin_action_events
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        )
           OR provisioning_job_id IN (
                '30000000-0000-4000-a045-000000000091',
                '30000000-0000-4000-a045-000000000093',
                '30000000-0000-4000-a045-000000000094',
                '30000000-0000-4000-a045-000000000095'
              );

        DELETE FROM public.partner_client_provisioning_jobs
        WHERE id IN (
          '30000000-0000-4000-a045-000000000091',
          '30000000-0000-4000-a045-000000000093',
          '30000000-0000-4000-a045-000000000094',
          '30000000-0000-4000-a045-000000000095'
        );

        DELETE FROM public.telnyx_resource_release_events
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_actions
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_reasons
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        UPDATE public.businesses
        SET active_telnyx_release_run_id = NULL
        WHERE id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.telnyx_resource_release_runs
        WHERE business_id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a045-000000000091',
          '10000000-0000-4000-a045-000000000092',
          '10000000-0000-4000-a045-000000000093',
          '10000000-0000-4000-a045-000000000094'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a045-000000000091',
          '00000000-0000-4000-a045-000000000092',
          '00000000-0000-4000-a045-000000000093',
          '00000000-0000-4000-a045-000000000094'
        );

        DELETE FROM public.partners
        WHERE id = '20000000-0000-4000-a045-000000000091';
      END;
      $cleanup$;
    $cleanup_sql$
  );

  PERFORM extensions.dblink_disconnect('test_045_provision');
  PERFORM extensions.dblink_disconnect('test_045_delete_waiter');
  PERFORM extensions.dblink_disconnect('test_045_claim_for_dismiss');
  PERFORM extensions.dblink_disconnect('test_045_dismiss_waiter');
  PERFORM extensions.dblink_disconnect('test_045_dismiss_owner');
  PERFORM extensions.dblink_disconnect('test_045_claim_after_dismiss');
  PERFORM extensions.dblink_disconnect('test_045_restore_owner');
  PERFORM extensions.dblink_disconnect('test_045_claim_after_restore');
  PERFORM extensions.dblink_disconnect('test_045_customer_delete');
  PERFORM extensions.dblink_disconnect('test_045_admin_delete');
  PERFORM extensions.dblink_disconnect('test_045_oauth_delete');
  PERFORM extensions.dblink_disconnect('test_045_oauth_complete');
  PERFORM extensions.dblink_disconnect('test_045_oauth_reassign');
  PERFORM extensions.dblink_disconnect('test_045_oauth_complete_reassign');
  PERFORM extensions.dblink_disconnect('test_045_settings_delete');
  PERFORM extensions.dblink_disconnect('test_045_oauth_complete_settings');
  PERFORM extensions.dblink_disconnect('test_045_setup');
END;
$remote_cleanup$;

SELECT * FROM finish();

ROLLBACK;
