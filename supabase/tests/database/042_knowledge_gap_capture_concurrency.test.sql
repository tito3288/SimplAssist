BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- dblink workers commit outside this pgTAP transaction. Refuse to run unless
-- the target is the disposable local Supabase database (or an explicitly
-- attested disposable runner).
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
  IF current_user <> 'postgres'
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
         current_database() = 'postgres'
         AND current_setting('data_directory') = '/var/lib/postgresql/data'
         AND v_known_local_jwt
       )
       OR v_explicit_disposable_attestation
     ) THEN
    RAISE EXCEPTION
      'test_042_knowledge_gap_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(11);

CREATE TEMP TABLE gap_042_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  uuid_value uuid,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_042_gap_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_042_gap_b',
    'test_042_gap_a'
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
          PERFORM extensions.dblink_exec(v_connection_name, 'ROLLBACK');
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;

        PERFORM extensions.dblink_disconnect(v_connection_name);
      EXCEPTION WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect(v_connection_name);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END;
    END IF;
  END LOOP;

  IF 'test_042_gap_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_042_gap_setup',
        $cleanup_sql$
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a042-000000000091'
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_042_gap_setup');
    EXCEPTION WHEN OTHERS THEN
      v_cleanup_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('test_042_gap_setup');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_gap_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send_result integer;
  v_busy_result integer;
  v_gap_a uuid;
  v_gap_b uuid;
  v_count bigint;
  v_occurrence_count bigint;
  v_source_message_id uuid;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_042_gap_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_042_gap_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_042_gap_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_042_gap_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a042-000000000091';

          INSERT INTO public.businesses (
            id,
            owner_id,
            name,
            slug,
            business_type
          )
          VALUES (
            '10000000-0000-4000-a042-000000000091',
            NULL,
            'Knowledge Gap Concurrency 042',
            'knowledge-gap-concurrency-042',
            'general'
          );

          INSERT INTO public.conversations (
            id,
            business_id,
            channel
          )
          VALUES (
            '20000000-0000-4000-a042-000000000091',
            '10000000-0000-4000-a042-000000000091',
            'sms'
          );

          INSERT INTO public.messages (
            id,
            conversation_id,
            business_id,
            role,
            content,
            channel
          )
          VALUES
            (
              '30000000-0000-4000-a042-000000000091',
              '20000000-0000-4000-a042-000000000091',
              '10000000-0000-4000-a042-000000000091',
              'customer',
              'Do you offer free trials?',
              'sms'
            ),
            (
              '30000000-0000-4000-a042-000000000092',
              '20000000-0000-4000-a042-000000000091',
              '10000000-0000-4000-a042-000000000091',
              'customer',
              E' DO YOU\tOFFER FREE TRIALS? ',
              'sms'
            ),
            (
              '30000000-0000-4000-a042-000000000093',
              '20000000-0000-4000-a042-000000000091',
              '10000000-0000-4000-a042-000000000091',
              'customer',
              'Do you offer coupons?',
              'sms'
            );
        END;
        $fixture$;
      $fixture_sql$
    );

    -- Two distinct customer messages with the same normalized question race.
    -- The partial unique index serializes them into one open aggregate.
    PERFORM extensions.dblink_exec('test_042_gap_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_042_gap_b', 'BEGIN');

    SELECT gap_id
    INTO v_gap_a
    FROM extensions.dblink(
      'test_042_gap_a',
      $capture_a$
        SELECT public.record_knowledge_gap(
          '10000000-0000-4000-a042-000000000091',
          '30000000-0000-4000-a042-000000000091',
          'I do not see free trials mentioned.'
        )
      $capture_a$
    ) AS captured_a(gap_id uuid);

    v_send_result := extensions.dblink_send_query(
      'test_042_gap_b',
      $capture_b$
        SELECT public.record_knowledge_gap(
          '10000000-0000-4000-a042-000000000091',
          '30000000-0000-4000-a042-000000000092',
          'Trial information is not in our current info.'
        )
      $capture_b$
    );

    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_042_gap_b');

    INSERT INTO gap_042_concurrency_state (name, integer_value)
    VALUES
      ('distinct_send', v_send_result),
      ('distinct_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_042_gap_a', 'COMMIT');

    SELECT gap_id
    INTO v_gap_b
    FROM extensions.dblink_get_result('test_042_gap_b')
      AS captured_b(gap_id uuid);

    PERFORM gap_id
    FROM extensions.dblink_get_result('test_042_gap_b', false)
      AS drained_b(gap_id uuid);

    PERFORM extensions.dblink_exec('test_042_gap_b', 'COMMIT');

    SELECT
      count(*),
      max(occurrence_count),
      max(source_message_id::text)::uuid
    INTO
      v_count,
      v_occurrence_count,
      v_source_message_id
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000091'
      AND normalized_question = 'do you offer free trials?'
      AND status = 'open';

    INSERT INTO gap_042_concurrency_state (name, uuid_value)
    VALUES
      ('distinct_gap_a', v_gap_a),
      ('distinct_gap_b', v_gap_b),
      ('distinct_latest_source', v_source_message_id);

    INSERT INTO gap_042_concurrency_state (name, bigint_value)
    VALUES
      ('distinct_count', v_count),
      ('distinct_occurrences', v_occurrence_count);

    -- Two delivery retries for the same durable message also serialize, but
    -- the second caller must not inflate the aggregate count.
    PERFORM extensions.dblink_exec('test_042_gap_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_042_gap_b', 'BEGIN');

    SELECT gap_id
    INTO v_gap_a
    FROM extensions.dblink(
      'test_042_gap_a',
      $same_source_a$
        SELECT public.record_knowledge_gap(
          '10000000-0000-4000-a042-000000000091',
          '30000000-0000-4000-a042-000000000093',
          'I do not see coupons mentioned.'
        )
      $same_source_a$
    ) AS captured_same_a(gap_id uuid);

    v_send_result := extensions.dblink_send_query(
      'test_042_gap_b',
      $same_source_b$
        SELECT public.record_knowledge_gap(
          '10000000-0000-4000-a042-000000000091',
          '30000000-0000-4000-a042-000000000093',
          'A retry must not replace the first response.'
        )
      $same_source_b$
    );

    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_042_gap_b');

    INSERT INTO gap_042_concurrency_state (name, integer_value)
    VALUES
      ('same_send', v_send_result),
      ('same_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_042_gap_a', 'COMMIT');

    SELECT gap_id
    INTO v_gap_b
    FROM extensions.dblink_get_result('test_042_gap_b')
      AS captured_same_b(gap_id uuid);

    PERFORM gap_id
    FROM extensions.dblink_get_result('test_042_gap_b', false)
      AS drained_same_b(gap_id uuid);

    PERFORM extensions.dblink_exec('test_042_gap_b', 'COMMIT');

    SELECT count(*), max(occurrence_count)
    INTO v_count, v_occurrence_count
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000091'
      AND normalized_question = 'do you offer coupons?'
      AND status = 'open';

    INSERT INTO gap_042_concurrency_state (name, uuid_value)
    VALUES
      ('same_gap_a', v_gap_a),
      ('same_gap_b', v_gap_b);

    INSERT INTO gap_042_concurrency_state (name, bigint_value)
    VALUES
      ('same_count', v_count),
      ('same_occurrences', v_occurrence_count);

    v_cleanup_ok := pg_temp.cleanup_042_gap_concurrency();
    INSERT INTO gap_042_concurrency_state (name, boolean_value)
    VALUES ('cleanup', v_cleanup_ok);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cleanup_042_gap_concurrency();
    RAISE;
  END;
END;
$orchestrate_gap_races$;

-- 1
SELECT is(
  (
    SELECT integer_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_send'
  ),
  1,
  'the distinct-message contender is dispatched'
);

-- 2
SELECT is(
  (
    SELECT integer_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_busy'
  ),
  1,
  'the second normalized capture waits on the open unique key'
);

-- 3
SELECT is(
  (
    SELECT uuid_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_gap_a'
  ),
  (
    SELECT uuid_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_gap_b'
  ),
  'both normalized captures return the same aggregate id'
);

-- 4
SELECT is(
  (
    SELECT bigint_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_count'
  ),
  1::bigint,
  'concurrent normalized captures leave one open aggregate'
);

-- 5
SELECT is(
  (
    SELECT bigint_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_occurrences'
  ),
  2::bigint,
  'both distinct source messages contribute one occurrence'
);

-- 6
SELECT is(
  (
    SELECT uuid_value
    FROM gap_042_concurrency_state
    WHERE name = 'distinct_latest_source'
  ),
  '30000000-0000-4000-a042-000000000092'::uuid,
  'the waiter refreshes the aggregate to the latest source message'
);

-- 7
SELECT is(
  (
    SELECT integer_value
    FROM gap_042_concurrency_state
    WHERE name = 'same_send'
  ),
  1,
  'the same-source retry contender is dispatched'
);

-- 8
SELECT is(
  (
    SELECT integer_value
    FROM gap_042_concurrency_state
    WHERE name = 'same_busy'
  ),
  1,
  'the concurrent same-source retry waits on the open unique key'
);

-- 9
SELECT is(
  (
    SELECT uuid_value
    FROM gap_042_concurrency_state
    WHERE name = 'same_gap_a'
  ),
  (
    SELECT uuid_value
    FROM gap_042_concurrency_state
    WHERE name = 'same_gap_b'
  ),
  'concurrent same-source retries return the same aggregate id'
);

-- 10
SELECT results_eq(
  $$
    SELECT
      (SELECT bigint_value
       FROM gap_042_concurrency_state
       WHERE name = 'same_count'),
      (SELECT bigint_value
       FROM gap_042_concurrency_state
       WHERE name = 'same_occurrences')
  $$,
  $$
    VALUES (1::bigint, 1::bigint)
  $$,
  'concurrent same-source retries leave one single-occurrence aggregate'
);

-- 11
SELECT is(
  (
    SELECT boolean_value
    FROM gap_042_concurrency_state
    WHERE name = 'cleanup'
  ),
  true,
  'concurrency fixtures and dblink sessions are cleaned up'
);

SELECT * FROM finish();

ROLLBACK;
