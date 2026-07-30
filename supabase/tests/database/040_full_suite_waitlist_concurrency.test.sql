BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits its fixture and winning claim through dblink. Refuse to
-- run unless the server has the disposable local Supabase shape, or the test
-- runner explicitly attests that the target database is disposable with
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
      'test_040_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(8);

CREATE TEMP TABLE waitlist_040_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_040_waitlist_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_040_waitlist_b',
    'test_040_waitlist_a'
  ] LOOP
    IF v_connection_name = ANY(COALESCE(
      extensions.dblink_get_connections(),
      ARRAY[]::text[]
    )) THEN
      BEGIN
        IF extensions.dblink_is_busy(v_connection_name) = 1 THEN
          PERFORM extensions.dblink_cancel_query(v_connection_name);
        END IF;

        BEGIN
          PERFORM claim_count
          FROM extensions.dblink_get_result(v_connection_name, false)
            AS pending_result(claim_count bigint);
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        BEGIN
          PERFORM claim_count
          FROM extensions.dblink_get_result(v_connection_name, false)
            AS drained_result(claim_count bigint);
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        BEGIN
          PERFORM extensions.dblink_exec(v_connection_name, 'ROLLBACK');
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
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

  IF 'test_040_waitlist_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_040_waitlist_setup',
        $cleanup_sql$
          DELETE FROM public.waitlist_signups
          WHERE id = '40000000-0000-4000-a040-000000000090'
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_040_waitlist_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect(
            'test_040_waitlist_setup'
          );
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_waitlist_claim_race$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_first_claim_count bigint;
  v_second_claim_count bigint;
  v_send_result integer;
  v_busy_result integer;
  v_visible_claims bigint;
  v_winner_retained boolean;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_040_waitlist_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_040_waitlist_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_040_waitlist_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_040_waitlist_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.waitlist_signups
          WHERE id = '40000000-0000-4000-a040-000000000090';

          INSERT INTO public.waitlist_signups (id, email, feature_interest)
          VALUES (
            '40000000-0000-4000-a040-000000000090',
            'claim-race@example.test',
            'full_suite'
          );
        END;
        $fixture$;
      $fixture_sql$
    );

    PERFORM extensions.dblink_exec('test_040_waitlist_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_040_waitlist_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_040_waitlist_a',
      'SET ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'test_040_waitlist_b',
      'SET ROLE service_role'
    );

    SELECT claim_count
    INTO v_first_claim_count
    FROM extensions.dblink(
      'test_040_waitlist_a',
      $first_claim_sql$
        SELECT count(*)::bigint
        FROM public.claim_waitlist_launch_send(
          '40000000-0000-4000-a040-000000000090',
          '40000000-0000-4000-a040-000000000091'
        )
      $first_claim_sql$
    ) AS first_claim(claim_count bigint);

    v_send_result := extensions.dblink_send_query(
      'test_040_waitlist_b',
      $second_claim_sql$
        SELECT count(*)::bigint
        FROM public.claim_waitlist_launch_send(
          '40000000-0000-4000-a040-000000000090',
          '40000000-0000-4000-a040-000000000092'
        )
      $second_claim_sql$
    );

    PERFORM pg_sleep(0.1);
    v_busy_result :=
      extensions.dblink_is_busy('test_040_waitlist_b');

    SELECT count(*)::bigint
    INTO v_visible_claims
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000090'
      AND launch_send_claim_token IS NOT NULL;

    PERFORM extensions.dblink_exec('test_040_waitlist_a', 'COMMIT');

    SELECT claim_count
    INTO v_second_claim_count
    FROM extensions.dblink_get_result('test_040_waitlist_b')
      AS second_claim(claim_count bigint);

    -- Drain libpq's end-of-results marker before issuing another command on
    -- the same connection.
    PERFORM claim_count
    FROM extensions.dblink_get_result(
      'test_040_waitlist_b',
      false
    ) AS drained_second_claim(claim_count bigint);

    PERFORM extensions.dblink_exec('test_040_waitlist_b', 'COMMIT');

    SELECT launch_send_claim_token =
             '40000000-0000-4000-a040-000000000091'::uuid
       AND launch_send_claimed_at IS NOT NULL
       AND notified_at IS NULL
       AND unsubscribed_at IS NULL
    INTO v_winner_retained
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000090';

    INSERT INTO waitlist_040_concurrency_state (
      name,
      bigint_value
    ) VALUES
      ('first_claim_count', v_first_claim_count),
      ('visible_before_commit', v_visible_claims),
      ('second_claim_count', v_second_claim_count);

    INSERT INTO waitlist_040_concurrency_state (
      name,
      integer_value
    ) VALUES
      ('send_result', v_send_result),
      ('busy_result', v_busy_result);

    INSERT INTO waitlist_040_concurrency_state (
      name,
      boolean_value
    ) VALUES ('winner_retained', v_winner_retained);

    v_cleanup_ok := pg_temp.cleanup_040_waitlist_concurrency();

    INSERT INTO waitlist_040_concurrency_state (
      name,
      boolean_value
    ) VALUES ('cleanup_ok', v_cleanup_ok);
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        PERFORM pg_temp.cleanup_040_waitlist_concurrency();
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING
            'test_040_concurrency_finally_failed [%] %',
            SQLSTATE,
            SQLERRM;
      END;
      RAISE;
  END;
END;
$orchestrate_waitlist_claim_race$;

SELECT is(
  (
    SELECT bigint_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'first_claim_count'
  ),
  1::bigint,
  'the first worker acquires the launch-send claim'
);

SELECT is(
  (
    SELECT integer_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'send_result'
  ),
  1,
  'the second worker starts a simultaneous claim attempt'
);

SELECT is(
  (
    SELECT integer_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'busy_result'
  ),
  1,
  'the second claim waits on the first uncommitted row update'
);

SELECT is(
  (
    SELECT bigint_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'visible_before_commit'
  ),
  0::bigint,
  'the uncommitted winning claim is not partially visible'
);

SELECT is(
  (
    SELECT bigint_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'second_claim_count'
  ),
  0::bigint,
  'the simultaneous losing worker receives no claimed recipient'
);

SELECT ok(
  (
    SELECT boolean_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'winner_retained'
  ),
  'exactly the winning token remains on the pending signup'
);

SELECT is(
  (
    SELECT
      (SELECT bigint_value
       FROM waitlist_040_concurrency_state
       WHERE name = 'first_claim_count')
      +
      (SELECT bigint_value
       FROM waitlist_040_concurrency_state
       WHERE name = 'second_claim_count')
  ),
  1::bigint,
  'simultaneous launch-send claims produce exactly one winner'
);

SELECT ok(
  (
    SELECT boolean_value
    FROM waitlist_040_concurrency_state
    WHERE name = 'cleanup_ok'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000090'
  ),
  'the committed race fixture is removed after the test'
);

SELECT * FROM finish();

ROLLBACK;
