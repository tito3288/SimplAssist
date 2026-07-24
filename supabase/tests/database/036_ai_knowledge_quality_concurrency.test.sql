BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits a disposable fixture through dblink. Refuse to run
-- against anything except the local Supabase database (or a runner that
-- explicitly attests that its database is disposable).
DO $require_disposable_local_database$
DECLARE
  v_server_address inet := inet_server_addr();
  v_is_superuser boolean := (
    SELECT role.rolsuper
    FROM pg_roles AS role
    WHERE role.rolname = current_user
  );
  v_known_local_jwt boolean := current_setting(
    'app.settings.jwt_secret',
    true
  ) = 'super-secret-jwt-token-with-at-least-32-characters-long';
  v_explicit_disposable_attestation boolean := current_setting(
    'simplassist.disposable_test_database',
    true
  ) = 'on';
BEGIN
  IF NOT coalesce(v_is_superuser, false)
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
         AND
         current_setting('data_directory') = '/var/lib/postgresql/data'
         AND v_known_local_jwt
       )
       OR v_explicit_disposable_attestation
     ) THEN
    RAISE EXCEPTION
      'test_036_quality_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(13);

CREATE TEMP TABLE quality_036_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  text_value text,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_036_quality_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_036_quality_b',
    'test_036_quality_a'
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
      END;
    END IF;
  END LOOP;

  IF 'test_036_quality_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_036_quality_setup',
        $cleanup_sql$
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a036-000000000091'
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_036_quality_setup');
    EXCEPTION WHEN OTHERS THEN
      v_cleanup_ok := false;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_quality_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send_result integer;
  v_busy_result integer;
  v_error_state text;
  v_count bigint;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_036_quality_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_036_quality_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_036_quality_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_036_quality_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a036-000000000091';

          INSERT INTO public.businesses (
            id, owner_id, name, slug, business_type, onboarding_completed_at
          ) VALUES (
            '10000000-0000-4000-a036-000000000091',
            NULL,
            'Knowledge Quality Concurrency',
            'knowledge-quality-concurrency-036',
            'general',
            now()
          );

          INSERT INTO public.services (id, business_id, name) VALUES
            ('20000000-0000-4000-a036-000000000091', '10000000-0000-4000-a036-000000000091', 'One'),
            ('20000000-0000-4000-a036-000000000092', '10000000-0000-4000-a036-000000000091', 'Two'),
            ('20000000-0000-4000-a036-000000000093', '10000000-0000-4000-a036-000000000091', 'Three'),
            ('20000000-0000-4000-a036-000000000094', '10000000-0000-4000-a036-000000000091', 'Four');

          INSERT INTO public.faqs (id, business_id, question, answer) VALUES
            ('30000000-0000-4000-a036-000000000091', '10000000-0000-4000-a036-000000000091', 'One?', 'One.'),
            ('30000000-0000-4000-a036-000000000092', '10000000-0000-4000-a036-000000000091', 'Two?', 'Two.'),
            ('30000000-0000-4000-a036-000000000093', '10000000-0000-4000-a036-000000000091', 'Three?', 'Three.'),
            ('30000000-0000-4000-a036-000000000094', '10000000-0000-4000-a036-000000000091', 'Four?', 'Four.');
        END;
        $fixture$;
      $fixture_sql$
    );

    -- Service race: both workers start from four. The business-row lock makes
    -- the second worker re-check after the first commits at three.
    PERFORM extensions.dblink_exec('test_036_quality_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_036_quality_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_036_quality_a',
      $delete_service_a$
        DELETE FROM public.services
        WHERE id = '20000000-0000-4000-a036-000000000094'
      $delete_service_a$
    );
    v_send_result := extensions.dblink_send_query(
      'test_036_quality_b',
      $delete_service_b$
        DELETE FROM public.services
        WHERE id = '20000000-0000-4000-a036-000000000093'
        RETURNING id
      $delete_service_b$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_036_quality_b');
    INSERT INTO quality_036_concurrency_state (name, integer_value) VALUES
      ('service_send', v_send_result),
      ('service_busy', v_busy_result);
    PERFORM extensions.dblink_exec('test_036_quality_a', 'COMMIT');

    v_error_state := NULL;
    BEGIN
      PERFORM deleted_id
      FROM extensions.dblink_get_result('test_036_quality_b')
        AS deleted_service(deleted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    BEGIN
      PERFORM deleted_id
      FROM extensions.dblink_get_result('test_036_quality_b', false)
        AS drained_service(deleted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    INSERT INTO quality_036_concurrency_state (name, text_value)
    VALUES ('service_error', v_error_state);
    BEGIN
      PERFORM extensions.dblink_exec('test_036_quality_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    SELECT count(*)::bigint INTO v_count
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a036-000000000091'
      AND is_active IS TRUE;
    INSERT INTO quality_036_concurrency_state (name, bigint_value)
    VALUES ('service_count', v_count);

    -- Repeat the same boundary for FAQs.
    PERFORM extensions.dblink_exec('test_036_quality_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_036_quality_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_036_quality_a',
      $delete_faq_a$
        DELETE FROM public.faqs
        WHERE id = '30000000-0000-4000-a036-000000000094'
      $delete_faq_a$
    );
    v_send_result := extensions.dblink_send_query(
      'test_036_quality_b',
      $delete_faq_b$
        DELETE FROM public.faqs
        WHERE id = '30000000-0000-4000-a036-000000000093'
        RETURNING id
      $delete_faq_b$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_036_quality_b');
    INSERT INTO quality_036_concurrency_state (name, integer_value) VALUES
      ('faq_send', v_send_result),
      ('faq_busy', v_busy_result);
    PERFORM extensions.dblink_exec('test_036_quality_a', 'COMMIT');

    v_error_state := NULL;
    BEGIN
      PERFORM deleted_id
      FROM extensions.dblink_get_result('test_036_quality_b')
        AS deleted_faq(deleted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    BEGIN
      PERFORM deleted_id
      FROM extensions.dblink_get_result('test_036_quality_b', false)
        AS drained_faq(deleted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    INSERT INTO quality_036_concurrency_state (name, text_value)
    VALUES ('faq_error', v_error_state);
    BEGIN
      PERFORM extensions.dblink_exec('test_036_quality_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    SELECT count(*)::bigint INTO v_count
    FROM public.faqs
    WHERE business_id = '10000000-0000-4000-a036-000000000091'
      AND is_active IS TRUE;
    INSERT INTO quality_036_concurrency_state (name, bigint_value)
    VALUES ('faq_count', v_count);

    -- Concurrent normalized duplicates use the same lock. The waiting insert
    -- must observe the winner after commit and fail with 23505.
    PERFORM extensions.dblink_exec('test_036_quality_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_036_quality_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_036_quality_a',
      $insert_service_a$
        INSERT INTO public.services (id, business_id, name)
        VALUES (
          '20000000-0000-4000-a036-000000000095',
          '10000000-0000-4000-a036-000000000091',
          'Concurrent Service'
        )
      $insert_service_a$
    );
    v_send_result := extensions.dblink_send_query(
      'test_036_quality_b',
      $insert_service_b$
        INSERT INTO public.services (id, business_id, name)
        VALUES (
          '20000000-0000-4000-a036-000000000096',
          '10000000-0000-4000-a036-000000000091',
          ' concurrent   SERVICE '
        )
        RETURNING id
      $insert_service_b$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_036_quality_b');
    INSERT INTO quality_036_concurrency_state (name, integer_value) VALUES
      ('duplicate_send', v_send_result),
      ('duplicate_busy', v_busy_result);
    PERFORM extensions.dblink_exec('test_036_quality_a', 'COMMIT');

    v_error_state := NULL;
    BEGIN
      PERFORM inserted_id
      FROM extensions.dblink_get_result('test_036_quality_b')
        AS inserted_service(inserted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    BEGIN
      PERFORM inserted_id
      FROM extensions.dblink_get_result('test_036_quality_b', false)
        AS drained_duplicate(inserted_id uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    INSERT INTO quality_036_concurrency_state (name, text_value)
    VALUES ('duplicate_error', v_error_state);
    BEGIN
      PERFORM extensions.dblink_exec('test_036_quality_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    SELECT count(*)::bigint INTO v_count
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a036-000000000091'
      AND public.normalize_ai_knowledge_key(name) = 'concurrent service';
    INSERT INTO quality_036_concurrency_state (name, bigint_value)
    VALUES ('duplicate_count', v_count);

    v_cleanup_ok := pg_temp.cleanup_036_quality_concurrency();
    INSERT INTO quality_036_concurrency_state (name, boolean_value)
    VALUES ('cleanup', v_cleanup_ok);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM pg_temp.cleanup_036_quality_concurrency();
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    RAISE;
  END;
END;
$orchestrate_quality_races$;

SELECT is(integer_value, 1, 'the simultaneous service delete starts')
FROM quality_036_concurrency_state WHERE name = 'service_send';
SELECT is(integer_value, 1, 'the second service delete waits on the business lock')
FROM quality_036_concurrency_state WHERE name = 'service_busy';
SELECT is(text_value, '23514', 'the second service delete is rejected at the floor')
FROM quality_036_concurrency_state WHERE name = 'service_error';
SELECT is(bigint_value, 3::bigint, 'concurrent service deletes settle at three')
FROM quality_036_concurrency_state WHERE name = 'service_count';

SELECT is(integer_value, 1, 'the simultaneous FAQ delete starts')
FROM quality_036_concurrency_state WHERE name = 'faq_send';
SELECT is(integer_value, 1, 'the second FAQ delete waits on the business lock')
FROM quality_036_concurrency_state WHERE name = 'faq_busy';
SELECT is(text_value, '23514', 'the second FAQ delete is rejected at the floor')
FROM quality_036_concurrency_state WHERE name = 'faq_error';
SELECT is(bigint_value, 3::bigint, 'concurrent FAQ deletes settle at three')
FROM quality_036_concurrency_state WHERE name = 'faq_count';

SELECT is(integer_value, 1, 'the simultaneous normalized duplicate insert starts')
FROM quality_036_concurrency_state WHERE name = 'duplicate_send';
SELECT is(integer_value, 1, 'the duplicate insert waits on the business lock')
FROM quality_036_concurrency_state WHERE name = 'duplicate_busy';
SELECT is(text_value, '23505', 'the waiting normalized duplicate is rejected')
FROM quality_036_concurrency_state WHERE name = 'duplicate_error';
SELECT is(bigint_value, 1::bigint, 'exactly one normalized service key survives')
FROM quality_036_concurrency_state WHERE name = 'duplicate_count';

SELECT is(boolean_value, true, 'finally cleanup removes the committed fixture')
FROM quality_036_concurrency_state WHERE name = 'cleanup';

SELECT * FROM finish();

ROLLBACK;
