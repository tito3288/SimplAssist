BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits a fixture and one winning intent through dblink. Refuse
-- to run unless the server has the local Supabase container shape and either
-- the known local JWT marker or an explicit disposable-database attestation
-- supplied by the test runner
-- (PGOPTIONS='-c simplassist.disposable_test_database=on').
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
      'test_035_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(7);

CREATE TEMP TABLE create_intent_035_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  text_value text,
  boolean_value boolean
) ON COMMIT DROP;

-- Every remote session and committed fixture is cleaned from one finally
-- routine. A failed assertion cannot leave an open transaction or test row.
CREATE FUNCTION pg_temp.cleanup_035_create_intent_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_035_intent_b',
    'test_035_intent_a'
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
          PERFORM intent_id
          FROM extensions.dblink_get_result(
            v_connection_name,
            false
          ) AS pending_result(intent_id uuid);
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        BEGIN
          PERFORM intent_id
          FROM extensions.dblink_get_result(
            v_connection_name,
            false
          ) AS drained_result(intent_id uuid);
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

  IF 'test_035_intent_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_035_intent_setup',
        $cleanup_sql$
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a035-000000000091'
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_035_intent_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect('test_035_intent_setup');
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_create_intent_race$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send_result integer;
  v_busy_result integer;
  v_visible_count bigint;
  v_error_state text;
  v_error_message text;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_035_intent_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_035_intent_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_035_intent_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_035_intent_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a035-000000000091';

          INSERT INTO public.businesses (
            id,
            owner_id,
            name,
            slug,
            business_type
          ) VALUES (
            '10000000-0000-4000-a035-000000000091',
            NULL,
            'Create Intent Concurrency',
            'create-intent-concurrency-035',
            'general'
          );
        END;
        $fixture$;
      $fixture_sql$
    );

    PERFORM extensions.dblink_exec('test_035_intent_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_035_intent_b', 'BEGIN');

    PERFORM extensions.dblink_exec(
      'test_035_intent_a',
      $winner_sql$
        INSERT INTO public.telnyx_registration_events (
          business_id,
          event_type,
          telnyx_resource_type,
          status
        ) VALUES (
          '10000000-0000-4000-a035-000000000091',
          'messaging_profile_create_intent',
          'messaging_profile',
          'started'
        )
      $winner_sql$
    );

    v_send_result := extensions.dblink_send_query(
      'test_035_intent_b',
      $loser_sql$
        INSERT INTO public.telnyx_registration_events (
          business_id,
          event_type,
          telnyx_resource_type,
          status
        ) VALUES (
          '10000000-0000-4000-a035-000000000091',
          'messaging_profile_create_intent',
          'messaging_profile',
          'started'
        )
        RETURNING id
      $loser_sql$
    );

    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_035_intent_b');

    SELECT count(*)::bigint
    INTO v_visible_count
    FROM public.telnyx_registration_events
    WHERE business_id = '10000000-0000-4000-a035-000000000091'
      AND event_type = 'messaging_profile_create_intent'
      AND status = 'started';

    INSERT INTO create_intent_035_concurrency_state (
      name,
      integer_value
    ) VALUES
      ('send_result', v_send_result),
      ('busy_result', v_busy_result);

    INSERT INTO create_intent_035_concurrency_state (
      name,
      bigint_value
    ) VALUES ('visible_before_commit', v_visible_count);

    PERFORM extensions.dblink_exec('test_035_intent_a', 'COMMIT');

    BEGIN
      PERFORM intent_id
      FROM extensions.dblink_get_result('test_035_intent_b')
        AS duplicate_result(intent_id uuid);
    EXCEPTION
      WHEN OTHERS THEN
        v_error_state := SQLSTATE;
        v_error_message := SQLERRM;
    END;

    INSERT INTO create_intent_035_concurrency_state (
      name,
      text_value
    ) VALUES
      ('loser_sqlstate', v_error_state),
      ('loser_message', v_error_message);

    SELECT count(*)::bigint
    INTO v_visible_count
    FROM public.telnyx_registration_events
    WHERE business_id = '10000000-0000-4000-a035-000000000091'
      AND event_type = 'messaging_profile_create_intent'
      AND status = 'started';

    INSERT INTO create_intent_035_concurrency_state (
      name,
      bigint_value
    ) VALUES ('visible_after_race', v_visible_count);

    v_cleanup_ok := pg_temp.cleanup_035_create_intent_concurrency();

    INSERT INTO create_intent_035_concurrency_state (
      name,
      boolean_value
    ) VALUES ('cleanup_ok', v_cleanup_ok);
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        PERFORM pg_temp.cleanup_035_create_intent_concurrency();
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING
            'test_035_concurrency_finally_failed [%] %',
            SQLSTATE,
            SQLERRM;
      END;
      RAISE;
  END;
END;
$orchestrate_create_intent_race$;

SELECT is(
  integer_value,
  1,
  'the second transaction starts a simultaneous duplicate-intent insert'
)
FROM create_intent_035_concurrency_state
WHERE name = 'send_result';

SELECT is(
  integer_value,
  1,
  'the duplicate intent waits on the uncommitted unique-index owner'
)
FROM create_intent_035_concurrency_state
WHERE name = 'busy_result';

SELECT is(
  bigint_value,
  0::bigint,
  'neither uncommitted intent is visible outside the two workers'
)
FROM create_intent_035_concurrency_state
WHERE name = 'visible_before_commit';

SELECT is(
  text_value,
  '23505',
  'the losing simultaneous insert receives a unique-violation SQLSTATE'
)
FROM create_intent_035_concurrency_state
WHERE name = 'loser_sqlstate';

SELECT is(
  text_value,
  'duplicate key value violates unique constraint "telnyx_registration_events_active_create_intent_unique"',
  'the race is rejected by the intended create-intent fence'
)
FROM create_intent_035_concurrency_state
WHERE name = 'loser_message';

SELECT is(
  bigint_value,
  1::bigint,
  'exactly one unresolved create intent survives the race'
)
FROM create_intent_035_concurrency_state
WHERE name = 'visible_after_race';

SELECT is(
  boolean_value,
  true,
  'finally cleanup removes the committed fixture and closes every worker'
)
FROM create_intent_035_concurrency_state
WHERE name = 'cleanup_ok';

SELECT * FROM finish();

ROLLBACK;
