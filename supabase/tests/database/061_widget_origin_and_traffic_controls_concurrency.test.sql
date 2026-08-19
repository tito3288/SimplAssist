BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- This test commits fixture and worker transactions through dblink. Refuse to
-- run unless the target has the known disposable local Supabase shape, or the
-- runner explicitly attests that the database is disposable with
-- PGOPTIONS='-c simplassist.disposable_test_database=on'.
DO $require_disposable_local_database$
DECLARE
  v_server_address inet := inet_server_addr();
  v_known_local_jwt boolean := current_setting(
    'app.settings.jwt_secret', true
  ) = 'super-secret-jwt-token-with-at-least-32-characters-long';
  v_explicit_disposable_attestation boolean := current_setting(
    'simplassist.disposable_test_database', true
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
      'test_061_widget_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(10);

CREATE TEMP TABLE widget_061_concurrency_state (
  key text PRIMARY KEY,
  text_value text,
  integer_value integer,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_061_widget_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection text;
  v_ok boolean := true;
BEGIN
  FOREACH v_connection IN ARRAY ARRAY[
    'widget_061_worker_a',
    'widget_061_worker_b'
  ] LOOP
    IF v_connection = ANY(COALESCE(
      extensions.dblink_get_connections(), ARRAY[]::text[]
    )) THEN
      BEGIN
        IF extensions.dblink_is_busy(v_connection) = 1 THEN
          PERFORM extensions.dblink_cancel_query(v_connection);
        END IF;
        BEGIN
          PERFORM outcome
          FROM extensions.dblink_get_result(v_connection, false)
            AS pending(outcome text);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        BEGIN
          PERFORM extensions.dblink_exec(v_connection, 'ROLLBACK');
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        PERFORM extensions.dblink_disconnect(v_connection);
      EXCEPTION WHEN OTHERS THEN
        v_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect(v_connection);
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
      END;
    END IF;
  END LOOP;

  IF 'widget_061_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(), ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'widget_061_setup',
        $cleanup$
          DELETE FROM public.businesses
          WHERE id = '61000000-0000-4000-a061-000000000091'
            AND owner_id IS NULL
            AND name = 'Widget Concurrency 061'
        $cleanup$
      );
      PERFORM extensions.dblink_disconnect('widget_061_setup');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('widget_061_setup');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END IF;

  RETURN v_ok;
END;
$$;

DO $orchestrate_widget_capacity_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_same_session_a text;
  v_same_session_b text;
  v_same_session_busy integer;
  v_same_session_allowed integer;
  v_same_session_limited integer;
  v_same_session_leases integer;
  v_boundary_a text;
  v_boundary_b text;
  v_boundary_busy integer;
  v_boundary_prefill integer;
  v_boundary_allowed integer;
  v_boundary_limited integer;
  v_boundary_leases integer;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'widget_061_setup', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'widget_061_worker_a', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'widget_061_worker_b', v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'widget_061_setup',
      $fixture$
        DELETE FROM public.businesses
        WHERE id = '61000000-0000-4000-a061-000000000091'
          AND owner_id IS NULL
          AND name = 'Widget Concurrency 061';

        INSERT INTO public.businesses (
          id, name, email, business_type, slug, website_url
        ) VALUES (
          '61000000-0000-4000-a061-000000000091',
          'Widget Concurrency 061',
          'widget-concurrency-a061@example.test',
          'general',
          'widget-concurrency-a061',
          'https://allowed-concurrency.example'
        );

        INSERT INTO public.widget_configs (
          business_id, is_active, allowed_hostnames
        ) VALUES (
          '61000000-0000-4000-a061-000000000091',
          true,
          ARRAY['allowed-concurrency.example']
        );
      $fixture$
    );

    -- Same-session race. Worker A retains the business row lock until it
    -- commits, so worker B must wait and then observe A's live session lease.
    PERFORM extensions.dblink_exec('widget_061_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'widget_061_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'widget_061_worker_a', $$SET LOCAL statement_timeout = '5s'$$
    );
    PERFORM extensions.dblink_exec('widget_061_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'widget_061_worker_b', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'widget_061_worker_b', $$SET LOCAL statement_timeout = '5s'$$
    );

    PERFORM extensions.dblink_send_query(
      'widget_061_worker_a',
      $same_session_a$
        SELECT public.acquire_widget_request_capacity(
          '61000000-0000-4000-a061-000000000091',
          'allowed-concurrency.example',
          'same_session_061',
          'chat',
          repeat('A', 43),
          repeat('B', 43)
        )->>'status'
      $same_session_a$
    );

    WHILE extensions.dblink_is_busy('widget_061_worker_a') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_same_session_a
    FROM extensions.dblink_get_result('widget_061_worker_a')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('widget_061_worker_a', false)
      AS drained_result(outcome text);

    PERFORM extensions.dblink_send_query(
      'widget_061_worker_b',
      $same_session_b$
        SELECT public.acquire_widget_request_capacity(
          '61000000-0000-4000-a061-000000000091',
          'allowed-concurrency.example',
          'same_session_061',
          'chat',
          repeat('C', 43),
          repeat('D', 43)
        )->>'status'
      $same_session_b$
    );

    PERFORM pg_sleep(0.1);
    v_same_session_busy := extensions.dblink_is_busy(
      'widget_061_worker_b'
    );

    PERFORM extensions.dblink_exec('widget_061_worker_a', 'COMMIT');

    WHILE extensions.dblink_is_busy('widget_061_worker_b') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_same_session_b
    FROM extensions.dblink_get_result('widget_061_worker_b')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('widget_061_worker_b', false)
      AS drained_result(outcome text);
    PERFORM extensions.dblink_exec('widget_061_worker_b', 'COMMIT');

    SELECT
      count(*) FILTER (WHERE outcome = 'allowed')::integer,
      count(*) FILTER (WHERE outcome = 'concurrency_limited')::integer
    INTO v_same_session_allowed, v_same_session_limited
    FROM unnest(ARRAY[v_same_session_a, v_same_session_b]) AS race(outcome);

    SELECT lease_count
    INTO v_same_session_leases
    FROM extensions.dblink(
      'widget_061_setup',
      $same_session_lease_count$
        SELECT count(*)::integer
        FROM public.widget_request_capacity_leases
        WHERE business_id = '61000000-0000-4000-a061-000000000091'
          AND released_at IS NULL
          AND expires_at > statement_timestamp()
      $same_session_lease_count$
    ) AS result(lease_count integer);

    INSERT INTO widget_061_concurrency_state (
      key, text_value, integer_value, boolean_value
    ) VALUES
      ('same_session_busy', NULL, v_same_session_busy, NULL),
      ('same_session_allowed', NULL, v_same_session_allowed, NULL),
      ('same_session_limited', NULL, v_same_session_limited, NULL),
      ('same_session_leases', NULL, v_same_session_leases, NULL);

    -- Reset the first race, then prefill seven distinct live sessions. Two
    -- more distinct sessions race for the one remaining business-wide slot.
    PERFORM extensions.dblink_exec(
      'widget_061_setup',
      $reset_first_race$
        UPDATE public.widget_request_capacity_leases
        SET released_at = statement_timestamp()
        WHERE business_id = '61000000-0000-4000-a061-000000000091'
          AND released_at IS NULL;

        DELETE FROM public.widget_request_rate_buckets
        WHERE business_id = '61000000-0000-4000-a061-000000000091';
      $reset_first_race$
    );

    PERFORM extensions.dblink_exec(
      'widget_061_setup',
      $prefill_sql$
        DO $prefill$
        DECLARE
          v_index integer;
          v_decision jsonb;
        BEGIN
          FOR v_index IN 1..7 LOOP
            v_decision := public.acquire_widget_request_capacity(
              '61000000-0000-4000-a061-000000000091',
              'allowed-concurrency.example',
              'prefill_session_' || lpad(v_index::text, 2, '0'),
              'chat',
              repeat('P', 43),
              rpad('prefill_request_' || v_index::text, 43, 'x')
            );
            IF v_decision->>'status' <> 'allowed' THEN
              RAISE EXCEPTION 'unexpected_widget_prefill_denial_%', v_index;
            END IF;
          END LOOP;
        END;
        $prefill$;
      $prefill_sql$
    );

    SELECT lease_count
    INTO v_boundary_prefill
    FROM extensions.dblink(
      'widget_061_setup',
      $boundary_prefill_count$
        SELECT count(*)::integer
        FROM public.widget_request_capacity_leases
        WHERE business_id = '61000000-0000-4000-a061-000000000091'
          AND released_at IS NULL
          AND expires_at > statement_timestamp()
      $boundary_prefill_count$
    ) AS result(lease_count integer);

    PERFORM extensions.dblink_exec('widget_061_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'widget_061_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'widget_061_worker_a', $$SET LOCAL statement_timeout = '5s'$$
    );
    PERFORM extensions.dblink_exec('widget_061_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'widget_061_worker_b', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'widget_061_worker_b', $$SET LOCAL statement_timeout = '5s'$$
    );

    PERFORM extensions.dblink_send_query(
      'widget_061_worker_a',
      $boundary_a$
        SELECT public.acquire_widget_request_capacity(
          '61000000-0000-4000-a061-000000000091',
          'allowed-concurrency.example',
          'boundary_session_a_061',
          'chat',
          repeat('Q', 43),
          repeat('R', 43)
        )->>'status'
      $boundary_a$
    );

    WHILE extensions.dblink_is_busy('widget_061_worker_a') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_boundary_a
    FROM extensions.dblink_get_result('widget_061_worker_a')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('widget_061_worker_a', false)
      AS drained_result(outcome text);

    PERFORM extensions.dblink_send_query(
      'widget_061_worker_b',
      $boundary_b$
        SELECT public.acquire_widget_request_capacity(
          '61000000-0000-4000-a061-000000000091',
          'allowed-concurrency.example',
          'boundary_session_b_061',
          'chat',
          repeat('S', 43),
          repeat('T', 43)
        )->>'status'
      $boundary_b$
    );

    PERFORM pg_sleep(0.1);
    v_boundary_busy := extensions.dblink_is_busy('widget_061_worker_b');

    PERFORM extensions.dblink_exec('widget_061_worker_a', 'COMMIT');

    WHILE extensions.dblink_is_busy('widget_061_worker_b') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_boundary_b
    FROM extensions.dblink_get_result('widget_061_worker_b')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('widget_061_worker_b', false)
      AS drained_result(outcome text);
    PERFORM extensions.dblink_exec('widget_061_worker_b', 'COMMIT');

    SELECT
      count(*) FILTER (WHERE outcome = 'allowed')::integer,
      count(*) FILTER (WHERE outcome = 'concurrency_limited')::integer
    INTO v_boundary_allowed, v_boundary_limited
    FROM unnest(ARRAY[v_boundary_a, v_boundary_b]) AS race(outcome);

    SELECT lease_count
    INTO v_boundary_leases
    FROM extensions.dblink(
      'widget_061_setup',
      $boundary_lease_count$
        SELECT count(*)::integer
        FROM public.widget_request_capacity_leases
        WHERE business_id = '61000000-0000-4000-a061-000000000091'
          AND released_at IS NULL
          AND expires_at > statement_timestamp()
      $boundary_lease_count$
    ) AS result(lease_count integer);

    INSERT INTO widget_061_concurrency_state (
      key, text_value, integer_value, boolean_value
    ) VALUES
      ('boundary_prefill', NULL, v_boundary_prefill, NULL),
      ('boundary_busy', NULL, v_boundary_busy, NULL),
      ('boundary_allowed', NULL, v_boundary_allowed, NULL),
      ('boundary_limited', NULL, v_boundary_limited, NULL),
      ('boundary_leases', NULL, v_boundary_leases, NULL);

    v_cleanup_ok := pg_temp.cleanup_061_widget_concurrency();
    INSERT INTO widget_061_concurrency_state (
      key, text_value, integer_value, boolean_value
    ) VALUES ('cleanup', NULL, NULL, v_cleanup_ok);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM pg_temp.cleanup_061_widget_concurrency();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'test_061_widget_concurrency_finally_failed [%] %',
        SQLSTATE,
        SQLERRM;
    END;
    RAISE;
  END;
END;
$orchestrate_widget_capacity_races$;

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'same_session_busy'),
  1,
  'same-session contenders serialize on the shared business lock'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'same_session_allowed'),
  1,
  'exactly one same-session contender acquires a lease'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'same_session_limited'),
  1,
  'exactly one same-session contender is concurrency limited'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'same_session_leases'),
  1,
  'the same-session race leaves exactly one active lease'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'boundary_prefill'),
  7,
  'the business-wide boundary race starts with seven active leases'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'boundary_busy'),
  1,
  'business-boundary contenders serialize on the shared business lock'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'boundary_allowed'),
  1,
  'only the one remaining business-wide lease slot is admitted'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'boundary_limited'),
  1,
  'the other distinct session is concurrency limited at the boundary'
);

SELECT is(
  (SELECT integer_value FROM widget_061_concurrency_state
   WHERE key = 'boundary_leases'),
  8,
  'the business-wide race never exceeds eight active leases'
);

SELECT is(
  (SELECT boolean_value FROM widget_061_concurrency_state
   WHERE key = 'cleanup'),
  true,
  'committed widget concurrency fixtures and sessions are cleaned up'
);

SELECT * FROM finish();
ROLLBACK;
