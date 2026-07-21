BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(6);

-- dblink sessions commit independently from this pgTAP transaction. Fixed
-- fixture IDs plus up-front and final cleanup make interrupted local reruns
-- safe. This follows the migration-029 concurrency-test connection pattern.
DO $local_setup$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
BEGIN
  PERFORM extensions.dblink_connect('test_033_setup', v_connection_string);
  PERFORM extensions.dblink_connect('test_033_ein_a', v_connection_string);
  PERFORM extensions.dblink_connect('test_033_ein_b', v_connection_string);

  PERFORM extensions.dblink_exec(
    'test_033_setup',
    $remote_setup$
      DO $fixture$
      BEGIN
        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a000-000000000337',
          '10000000-0000-4000-a000-000000000338'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a000-000000000337',
          '00000000-0000-4000-a000-000000000338'
        );

        INSERT INTO auth.users (id, email)
        VALUES
          (
            '00000000-0000-4000-a000-000000000337',
            'brand-link-concurrency-a@example.test'
          ),
          (
            '00000000-0000-4000-a000-000000000338',
            'brand-link-concurrency-b@example.test'
          );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a000-000000000337',
            name = 'Brand Link Concurrency A',
            slug = 'brand-link-concurrency-a'
        WHERE owner_id = '00000000-0000-4000-a000-000000000337';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a000-000000000338',
            name = 'Brand Link Concurrency B',
            slug = 'brand-link-concurrency-b'
        WHERE owner_id = '00000000-0000-4000-a000-000000000338';
      END;
      $fixture$;
    $remote_setup$
  );

  PERFORM extensions.dblink_exec('test_033_ein_a', 'BEGIN');
  PERFORM extensions.dblink_exec('test_033_ein_b', 'BEGIN');

  PERFORM extensions.dblink_exec(
    'test_033_ein_a',
    $remote_first_write$
      UPDATE public.businesses
      SET ein = '33-0000033'
      WHERE id = '10000000-0000-4000-a000-000000000337'
    $remote_first_write$
  );
END;
$local_setup$;

SELECT is(
  extensions.dblink_send_query(
    'test_033_ein_b',
    $remote_second_write$
      UPDATE public.businesses
      SET ein = '33-0000033'
      WHERE id = '10000000-0000-4000-a000-000000000338'
      RETURNING ein
    $remote_second_write$
  ),
  1,
  'a second transaction starts a simultaneous duplicate-EIN write'
);

DO $wait_for_unique_index$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_unique_index$;

SELECT is(
  extensions.dblink_is_busy('test_033_ein_b'),
  1,
  'the duplicate writer waits on the uncommitted unique-index owner'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.businesses
    WHERE ein = '33-0000033'
      AND id IN (
        '10000000-0000-4000-a000-000000000337',
        '10000000-0000-4000-a000-000000000338'
      )
  ),
  0::bigint,
  'neither uncommitted write is partially visible'
);

DO $commit_first_writer$
BEGIN
  PERFORM extensions.dblink_exec('test_033_ein_a', 'COMMIT');
END;
$commit_first_writer$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_033_ein_b')
      AS duplicate_result(ein text)
  $$,
  '23505',
  NULL,
  'the losing simultaneous writer receives a unique violation'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.businesses
    WHERE ein = '33-0000033'
      AND id IN (
        '10000000-0000-4000-a000-000000000337',
        '10000000-0000-4000-a000-000000000338'
      )
  ),
  1::bigint,
  'exactly one retained business owns the EIN after the race'
);

SELECT ok(
  (
    SELECT ein = '33-0000033'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000337'
  )
  AND (
    SELECT ein IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000338'
  ),
  'the committed winner retains the EIN and the rejected account remains clear'
);

DO $remote_cleanup$
BEGIN
  -- Drain libpq's end-of-results marker after throws_ok consumed the
  -- expected duplicate-key result, so the connection can be reused.
  PERFORM ein
  FROM extensions.dblink_get_result('test_033_ein_b', false)
    AS drained_duplicate_result(ein text);

  PERFORM extensions.dblink_exec('test_033_ein_b', 'ROLLBACK');

  PERFORM extensions.dblink_exec(
    'test_033_setup',
    $cleanup_sql$
      DELETE FROM auth.users
      WHERE id IN (
        '00000000-0000-4000-a000-000000000337',
        '00000000-0000-4000-a000-000000000338'
      )
    $cleanup_sql$
  );

  PERFORM extensions.dblink_disconnect('test_033_ein_a');
  PERFORM extensions.dblink_disconnect('test_033_ein_b');
  PERFORM extensions.dblink_disconnect('test_033_setup');
END;
$remote_cleanup$;

SELECT * FROM finish();

ROLLBACK;
