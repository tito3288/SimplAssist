BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This file commits fixture work through dblink. Refuse to run unless the
-- server has the local Supabase container shape and either the known local
-- JWT marker or an explicit disposable-database attestation supplied by the
-- test runner (PGOPTIONS='-c simplassist.disposable_test_database=on').
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
      'test_029_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(14);

CREATE TEMP TABLE account_deletion_029_concurrency_state (
  name text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

-- Centralized finally routine. Worker transactions are canceled, drained,
-- rolled back, and disconnected before committed fixture rows are removed.
-- The deletion order mirrors the later Telnyx lifecycle concurrency suites so
-- ON DELETE RESTRICT audit rows cannot strand a test business after failure.
CREATE FUNCTION pg_temp.cleanup_029_account_deletion_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_029_a_cleanup',
    'test_029_a_webhook',
    'test_029_b_webhook',
    'test_029_b_cleanup'
  ] LOOP
    IF v_connection_name = ANY(COALESCE(
      extensions.dblink_get_connections(),
      ARRAY[]::text[]
    )) THEN
      BEGIN
        IF extensions.dblink_is_busy(v_connection_name) = 1 THEN
          PERFORM extensions.dblink_cancel_query(v_connection_name);
        END IF;

        -- These two connections can own an asynchronous result. Draining both
        -- the row and libpq's end marker makes ROLLBACK deterministic.
        IF v_connection_name IN (
          'test_029_a_cleanup',
          'test_029_b_webhook'
        ) THEN
          BEGIN
            PERFORM result
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS pending_result(result text);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;

          BEGIN
            PERFORM result
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS drained_result(result text);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;
        END IF;

        BEGIN
          PERFORM extensions.dblink_exec(v_connection_name, 'ROLLBACK');
        EXCEPTION
          WHEN OTHERS THEN
            v_cleanup_ok := false;
        END;

        PERFORM extensions.dblink_disconnect(v_connection_name);
      EXCEPTION
        WHEN OTHERS THEN
          v_cleanup_ok := false;
          BEGIN
            PERFORM extensions.dblink_disconnect(v_connection_name);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;
      END;
    END IF;
  END LOOP;

  IF 'test_029_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_029_setup',
        $remote_fixture_cleanup$
          DO $fixture_cleanup$
          BEGIN
            DELETE FROM public.telnyx_resource_release_events
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.telnyx_resource_release_actions
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.telnyx_resource_release_reasons
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            UPDATE public.businesses
            SET active_telnyx_release_run_id = NULL
            WHERE id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.telnyx_resource_release_runs
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.telnyx_managed_resources
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.phone_numbers
            WHERE business_id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );

            DELETE FROM auth.users
            WHERE id IN (
              '00000000-0000-4000-a000-000000000011',
              '00000000-0000-4000-a000-000000000012'
            );

            DELETE FROM public.businesses
            WHERE id IN (
              '10000000-0000-4000-a000-000000000011',
              '10000000-0000-4000-a000-000000000012'
            );
          END;
          $fixture_cleanup$;
        $remote_fixture_cleanup$
      );
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
    END;

    BEGIN
      PERFORM extensions.dblink_disconnect('test_029_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

-- Execute both lock-order races inside one exception boundary. Every observed
-- result is copied into local temporary state before the remote fixtures are
-- removed, leaving the pgTAP assertions side-effect free.
DO $orchestrate_account_deletion_races$
DECLARE
  -- Local Supabase dev-stack default password; the disposable guard above
  -- prevents these dblink connections from targeting a production database.
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_boolean boolean;
  v_integer integer;
  v_bigint bigint;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect('test_029_setup', v_connection_string);
    PERFORM extensions.dblink_connect(
      'test_029_a_webhook',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_029_a_cleanup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_029_b_cleanup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_029_b_webhook',
      v_connection_string
    );

    -- Up-front dependency-aware cleanup makes an interrupted local re-run
    -- safe even after migration 034 added durable Telnyx release audit rows.
    PERFORM extensions.dblink_exec(
      'test_029_setup',
      $remote_setup$
        DO $fixture$
        BEGIN
          DELETE FROM public.telnyx_resource_release_events
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.telnyx_resource_release_actions
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.telnyx_resource_release_reasons
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          UPDATE public.businesses
          SET active_telnyx_release_run_id = NULL
          WHERE id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.telnyx_resource_release_runs
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.telnyx_managed_resources
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.phone_numbers
          WHERE business_id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          DELETE FROM auth.users
          WHERE id IN (
            '00000000-0000-4000-a000-000000000011',
            '00000000-0000-4000-a000-000000000012'
          );

          DELETE FROM public.businesses
          WHERE id IN (
            '10000000-0000-4000-a000-000000000011',
            '10000000-0000-4000-a000-000000000012'
          );

          INSERT INTO auth.users (id, email)
          VALUES
            (
              '00000000-0000-4000-a000-000000000011',
              'concurrency-a@example.test'
            ),
            (
              '00000000-0000-4000-a000-000000000012',
              'concurrency-b@example.test'
            );

          UPDATE public.businesses
          SET id = '10000000-0000-4000-a000-000000000011',
              name = 'Concurrency Test A',
              slug = 'account-deletion-concurrency-a'
          WHERE owner_id = '00000000-0000-4000-a000-000000000011';

          UPDATE public.businesses
          SET id = '10000000-0000-4000-a000-000000000012',
              name = 'Concurrency Test B',
              slug = 'account-deletion-concurrency-b'
          WHERE owner_id = '00000000-0000-4000-a000-000000000012';

          INSERT INTO public.subscriptions (
            business_id,
            stripe_customer_id,
            stripe_subscription_id,
            plan,
            status,
            stripe_price_id
          ) VALUES
            (
              '10000000-0000-4000-a000-000000000011',
              'cus_concurrency_a',
              'sub_concurrency_a',
              'sms_only',
              'active',
              'price_concurrency_a'
            ),
            (
              '10000000-0000-4000-a000-000000000012',
              'cus_concurrency_b',
              'sub_concurrency_b',
              'sms_only',
              'active',
              'price_concurrency_b'
            );
        END;
        $fixture$;
      $remote_setup$
    );

    -- -----------------------------------------------------------------------
    -- Commit order A: webhook first, deletion/cleanup second
    -- -----------------------------------------------------------------------
    PERFORM extensions.dblink_exec('test_029_a_webhook', 'BEGIN');
    PERFORM extensions.dblink_exec('test_029_a_cleanup', 'BEGIN');

    SELECT result
    INTO v_boolean
    FROM extensions.dblink(
      'test_029_a_webhook',
      $remote_sync_a$
        SELECT public.sync_stripe_subscription_if_business_active(
          '10000000-0000-4000-a000-000000000011',
          'cus_concurrency_a',
          'sub_concurrency_a',
          'sms_only',
          'active',
          now(),
          now() + interval '30 days',
          'price_concurrency_a',
          NULL,
          NULL,
          NULL,
          false,
          now()
        )
      $remote_sync_a$
    ) AS remote_result(result boolean);
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_webhook', jsonb_build_object('result', v_boolean));

    v_integer := extensions.dblink_send_query(
      'test_029_a_cleanup',
      $remote_schedule_a$
        SELECT public.schedule_account_deletion(
          '10000000-0000-4000-a000-000000000011',
          '00000000-0000-4000-a000-000000000011',
          timestamptz '2099-01-01 00:00:00+00',
          timestamptz '2099-03-02 00:00:00+00'
        )
      $remote_schedule_a$
    );
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_send', jsonb_build_object('result', v_integer));

    PERFORM pg_sleep(0.1);
    v_integer := extensions.dblink_is_busy('test_029_a_cleanup');
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_busy', jsonb_build_object('result', v_integer));

    SELECT deleted_at IS NULL
    INTO v_boolean
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000011';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_not_partially_visible', jsonb_build_object('result', v_boolean));

    PERFORM extensions.dblink_exec('test_029_a_webhook', 'COMMIT');

    PERFORM result
    FROM extensions.dblink_get_result('test_029_a_cleanup')
      AS remote_result(result jsonb);
    PERFORM result
    FROM extensions.dblink_get_result('test_029_a_cleanup', false)
      AS drained_result(result jsonb);

    PERFORM extensions.dblink_exec(
      'test_029_a_cleanup',
      $remote_expire_a$
        DO $expire_fixture$
        DECLARE
          v_deleted_at timestamptz := now() - interval '60 days 1 second';
          v_release_at timestamptz := v_deleted_at + interval '60 days';
        BEGIN
          UPDATE public.businesses
          SET deleted_at = v_deleted_at,
              deletion_scheduled_for = v_release_at
          WHERE id = '10000000-0000-4000-a000-000000000011';

          UPDATE public.telnyx_resource_release_reasons
          SET triggered_at = v_deleted_at,
              release_at = v_release_at,
              updated_at = now()
          WHERE business_id = '10000000-0000-4000-a000-000000000011'
            AND reason_type = 'account_deletion'
            AND status = 'active';

          UPDATE public.telnyx_resource_release_runs
          SET effective_release_at = v_release_at,
              updated_at = now()
          WHERE business_id = '10000000-0000-4000-a000-000000000011'
            AND status = 'parked';
        END;
        $expire_fixture$;
      $remote_expire_a$
    );

    PERFORM result
    FROM extensions.dblink(
      'test_029_a_cleanup',
      $remote_cleanup_a$
        SELECT public.cleanup_expired_business(
          '10000000-0000-4000-a000-000000000011'
        )
      $remote_cleanup_a$
    ) AS remote_result(result uuid);

    PERFORM extensions.dblink_exec('test_029_a_cleanup', 'COMMIT');

    SELECT count(*)::bigint
    INTO v_bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000011';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_subscription_count', jsonb_build_object('result', v_bigint));

    SELECT COALESCE(
      bool_and(
        desired_action = 'cancel'
        AND stripe_subscription_id = 'sub_concurrency_a'
      ),
      false
    )
    INTO v_boolean
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000011';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_action_valid', jsonb_build_object('result', v_boolean));

    SELECT result
    INTO v_boolean
    FROM extensions.dblink(
      'test_029_a_webhook',
      $remote_post_cleanup_a$
        SELECT public.sync_stripe_subscription_if_business_active(
          '10000000-0000-4000-a000-000000000011',
          'cus_concurrency_a',
          'sub_concurrency_a',
          'sms_only',
          'active',
          now(),
          now() + interval '30 days',
          'price_concurrency_a',
          NULL,
          NULL,
          NULL,
          false,
          now()
        )
      $remote_post_cleanup_a$
    ) AS remote_result(result boolean);
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('a_post_cleanup_sync', jsonb_build_object('result', v_boolean));

    SELECT count(*)::bigint
    INTO v_bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000011';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES (
      'a_post_cleanup_subscription_count',
      jsonb_build_object('result', v_bigint)
    );

    -- -----------------------------------------------------------------------
    -- Commit order B: deletion/cleanup first, webhook second
    -- -----------------------------------------------------------------------
    PERFORM extensions.dblink_exec('test_029_b_cleanup', 'BEGIN');

    PERFORM result
    FROM extensions.dblink(
      'test_029_b_cleanup',
      $remote_schedule_b$
        SELECT public.schedule_account_deletion(
          '10000000-0000-4000-a000-000000000012',
          '00000000-0000-4000-a000-000000000012',
          timestamptz '2099-01-01 00:00:00+00',
          timestamptz '2099-03-02 00:00:00+00'
        )
      $remote_schedule_b$
    ) AS remote_result(result jsonb);

    PERFORM extensions.dblink_exec(
      'test_029_b_cleanup',
      $remote_expire_b$
        DO $expire_fixture$
        DECLARE
          v_deleted_at timestamptz := now() - interval '60 days 1 second';
          v_release_at timestamptz := v_deleted_at + interval '60 days';
        BEGIN
          UPDATE public.businesses
          SET deleted_at = v_deleted_at,
              deletion_scheduled_for = v_release_at
          WHERE id = '10000000-0000-4000-a000-000000000012';

          UPDATE public.telnyx_resource_release_reasons
          SET triggered_at = v_deleted_at,
              release_at = v_release_at,
              updated_at = now()
          WHERE business_id = '10000000-0000-4000-a000-000000000012'
            AND reason_type = 'account_deletion'
            AND status = 'active';

          UPDATE public.telnyx_resource_release_runs
          SET effective_release_at = v_release_at,
              updated_at = now()
          WHERE business_id = '10000000-0000-4000-a000-000000000012'
            AND status = 'parked';
        END;
        $expire_fixture$;
      $remote_expire_b$
    );

    PERFORM result
    FROM extensions.dblink(
      'test_029_b_cleanup',
      $remote_cleanup_b$
        SELECT public.cleanup_expired_business(
          '10000000-0000-4000-a000-000000000012'
        )
      $remote_cleanup_b$
    ) AS remote_result(result uuid);

    v_integer := extensions.dblink_send_query(
      'test_029_b_webhook',
      $remote_sync_b$
        SELECT public.sync_stripe_subscription_if_business_active(
          '10000000-0000-4000-a000-000000000012',
          'cus_concurrency_b',
          'sub_concurrency_b',
          'sms_only',
          'active',
          now(),
          now() + interval '30 days',
          'price_concurrency_b',
          NULL,
          NULL,
          NULL,
          false,
          now()
        )
      $remote_sync_b$
    );
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_send', jsonb_build_object('result', v_integer));

    PERFORM pg_sleep(0.1);
    v_integer := extensions.dblink_is_busy('test_029_b_webhook');
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_busy', jsonb_build_object('result', v_integer));

    SELECT count(*)::bigint
    INTO v_bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000012';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_visible_subscription_count', jsonb_build_object('result', v_bigint));

    PERFORM extensions.dblink_exec('test_029_b_cleanup', 'COMMIT');

    SELECT result
    INTO v_boolean
    FROM extensions.dblink_get_result('test_029_b_webhook')
      AS remote_result(result boolean);
    PERFORM result
    FROM extensions.dblink_get_result('test_029_b_webhook', false)
      AS drained_result(result boolean);
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_webhook', jsonb_build_object('result', v_boolean));

    SELECT count(*)::bigint
    INTO v_bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000012';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_subscription_count', jsonb_build_object('result', v_bigint));

    SELECT COALESCE(
      bool_and(
        desired_action = 'cancel'
        AND stripe_subscription_id = 'sub_concurrency_b'
      ),
      false
    )
    INTO v_boolean
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000012';
    INSERT INTO account_deletion_029_concurrency_state (name, payload)
    VALUES ('b_action_valid', jsonb_build_object('result', v_boolean));

    v_cleanup_ok := pg_temp.cleanup_029_account_deletion_concurrency();
    IF NOT v_cleanup_ok THEN
      RAISE EXCEPTION 'test_029_concurrency_cleanup_failed'
        USING ERRCODE = '55000';
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        PERFORM pg_temp.cleanup_029_account_deletion_concurrency();
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING
            'test_029_concurrency_finally_failed [%] %',
            SQLSTATE,
            SQLERRM;
      END;
      RAISE;
  END;
END;
$orchestrate_account_deletion_races$;

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_webhook'
  ),
  true,
  'webhook-first transaction synchronizes while the business is active'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::integer
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_send'
  ),
  1,
  'webhook-first race starts deletion on a second connection'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::integer
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_busy'
  ),
  1,
  'deletion waits while the webhook transaction holds the business lock'
);

SELECT ok(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_not_partially_visible'
  ),
  'the waiting deletion is not partially visible'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::bigint
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_subscription_count'
  ),
  0::bigint,
  'webhook-first commit order ends with no local subscription row'
);

SELECT ok(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_action_valid'
  ),
  'webhook-first order retains the durable cancellation linkage'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_post_cleanup_sync'
  ),
  false,
  'post-cleanup webhook is skipped after webhook-first serialization'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::bigint
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_post_cleanup_subscription_count'
  ),
  0::bigint,
  'post-cleanup webhook cannot create a zombie row in webhook-first order'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::integer
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_send'
  ),
  1,
  'cleanup-first race starts a webhook on a second connection'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::integer
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_busy'
  ),
  1,
  'webhook waits while cleanup holds the business lock'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::bigint
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_visible_subscription_count'
  ),
  1::bigint,
  'uncommitted cleanup is not partially visible'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_webhook'
  ),
  false,
  'cleanup-first webhook rechecks state and reports a deleted-business skip'
);

SELECT is(
  (
    SELECT (payload ->> 'result')::bigint
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_subscription_count'
  ),
  0::bigint,
  'cleanup-first commit order cannot create a zombie subscription row'
);

SELECT ok(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_action_valid'
  ),
  'cleanup-first order retains the durable cancellation linkage'
);

SELECT * FROM finish();

ROLLBACK;
