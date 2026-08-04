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
      'test_048_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(16);

-- dblink sessions commit independently from this pgTAP transaction. Fixed
-- fixture IDs plus remote setup/cleanup keep interrupted local reruns safe.
DO $local_setup$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
BEGIN
  PERFORM extensions.dblink_connect('test_048_setup', v_connection_string);
  PERFORM extensions.dblink_connect(
    'test_048_identical_suspend_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_identical_suspend_waiter',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_suspend_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_reactivate_waiter',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_ai_pause_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_texting_pause_waiter',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_booking_pause_owner',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_048_booking_resume_waiter',
    v_connection_string
  );

  PERFORM extensions.dblink_exec(
    'test_048_setup',
    $remote_setup$
      DO $fixture$
      BEGIN
        DELETE FROM public.admin_action_events
        WHERE business_id IN (
          '10000000-0000-4000-a048-000000000091',
          '10000000-0000-4000-a048-000000000092',
          '10000000-0000-4000-a048-000000000093',
          '10000000-0000-4000-a048-000000000094'
        );

        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a048-000000000091',
          '10000000-0000-4000-a048-000000000092',
          '10000000-0000-4000-a048-000000000093',
          '10000000-0000-4000-a048-000000000094'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a048-000000000091',
          '00000000-0000-4000-a048-000000000092',
          '00000000-0000-4000-a048-000000000093',
          '00000000-0000-4000-a048-000000000094'
        );

        INSERT INTO auth.users (id, email)
        VALUES
          (
            '00000000-0000-4000-a048-000000000091',
            'identical-suspend-concurrency-a048@example.test'
          ),
          (
            '00000000-0000-4000-a048-000000000092',
            'suspend-reactivate-concurrency-a048@example.test'
          ),
          (
            '00000000-0000-4000-a048-000000000093',
            'different-pauses-concurrency-a048@example.test'
          ),
          (
            '00000000-0000-4000-a048-000000000094',
            'pause-resume-concurrency-a048@example.test'
          );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a048-000000000091',
            name = 'Identical Suspend Concurrency 048',
            slug = 'identical-suspend-concurrency-048'
        WHERE owner_id = '00000000-0000-4000-a048-000000000091';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a048-000000000092',
            name = 'Suspend Reactivate Concurrency 048',
            slug = 'suspend-reactivate-concurrency-048'
        WHERE owner_id = '00000000-0000-4000-a048-000000000092';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a048-000000000093',
            name = 'Different Pauses Concurrency 048',
            slug = 'different-pauses-concurrency-048'
        WHERE owner_id = '00000000-0000-4000-a048-000000000093';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a048-000000000094',
            name = 'Pause Resume Concurrency 048',
            slug = 'pause-resume-concurrency-048'
        WHERE owner_id = '00000000-0000-4000-a048-000000000094';
      END;
      $fixture$;
    $remote_setup$
  );
END;
$local_setup$;

-- Two identical suspends serialize on the business row. The waiter must
-- observe the committed suspended state and return an unaudited no-op.
DO $start_identical_suspend_owner$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_048_identical_suspend_owner',
    'BEGIN'
  );
  PERFORM extensions.dblink_exec(
    'test_048_identical_suspend_owner',
    $suspend$
      DO $operation$
      BEGIN
        PERFORM public.set_admin_business_operations_suspension(
          '10000000-0000-4000-a048-000000000091',
          true,
          'First identical suspension',
          '90000000-0000-4000-a048-000000000091'
        );
      END;
      $operation$;
    $suspend$
  );
END;
$start_identical_suspend_owner$;

SELECT is(
  extensions.dblink_send_query(
    'test_048_identical_suspend_waiter',
    $suspend$
      SELECT public.set_admin_business_operations_suspension(
        '10000000-0000-4000-a048-000000000091',
        true,
        'Second identical suspension',
        '90000000-0000-4000-a048-000000000092'
      )::text AS payload
    $suspend$
  ),
  1,
  'a second identical suspension starts while the first owns the business lock'
);

DO $wait_for_identical_suspend_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_identical_suspend_lock$;

SELECT is(
  extensions.dblink_is_busy('test_048_identical_suspend_waiter'),
  1,
  'the second identical suspension waits for the first transition to commit'
);

DO $commit_identical_suspend_owner$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_048_identical_suspend_owner',
    'COMMIT'
  );
END;
$commit_identical_suspend_owner$;

CREATE TEMP TABLE controls_048_identical_suspend_result AS
SELECT payload::jsonb AS payload
FROM extensions.dblink_get_result('test_048_identical_suspend_waiter')
  AS result(payload text);

SELECT ok(
  (
    SELECT NOT (payload ->> 'changed')::boolean
       AND payload->>'admin_event_id' IS NULL
       AND payload->>'operations_suspended_at' IS NOT NULL
    FROM controls_048_identical_suspend_result
  ),
  'the identical waiter returns the committed snapshot as an unaudited no-op'
);

SELECT ok(
  (
    SELECT operations_suspended_at IS NOT NULL
       AND ai_replies_paused_at IS NULL
       AND texting_paused_at IS NULL
       AND bookings_paused_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000091'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000091'
      AND action = 'account_operations_suspended'
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000091'
      AND summary = '{"reason":"First identical suspension"}'::jsonb
  ),
  'two identical suspends produce one state transition and one audit event'
);

-- Suspend followed concurrently by reactivate must run in lock order. The
-- reactivation re-reads the committed suspension and performs a real second
-- transition rather than returning a stale no-op.
DO $start_suspend_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_suspend_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_048_suspend_owner',
    $suspend$
      DO $operation$
      BEGIN
        PERFORM public.set_admin_business_operations_suspension(
          '10000000-0000-4000-a048-000000000092',
          true,
          'Concurrent suspension reason',
          '90000000-0000-4000-a048-000000000093'
        );
      END;
      $operation$;
    $suspend$
  );
END;
$start_suspend_owner$;

SELECT is(
  extensions.dblink_send_query(
    'test_048_reactivate_waiter',
    $reactivate$
      SELECT public.set_admin_business_operations_suspension(
        '10000000-0000-4000-a048-000000000092',
        false,
        'Concurrent reactivation reason',
        '90000000-0000-4000-a048-000000000094'
      )::text AS payload
    $reactivate$
  ),
  1,
  'reactivation starts while suspension owns the business lock'
);

DO $wait_for_suspend_owner_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_suspend_owner_lock$;

SELECT is(
  extensions.dblink_is_busy('test_048_reactivate_waiter'),
  1,
  'reactivation waits behind the in-flight suspension'
);

DO $commit_suspend_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_suspend_owner', 'COMMIT');
END;
$commit_suspend_owner$;

CREATE TEMP TABLE controls_048_reactivate_result AS
SELECT payload::jsonb AS payload
FROM extensions.dblink_get_result('test_048_reactivate_waiter')
  AS result(payload text);

SELECT ok(
  (
    SELECT (payload ->> 'changed')::boolean
       AND payload->>'admin_event_id' IS NOT NULL
       AND payload->>'operations_suspended_at' IS NULL
    FROM controls_048_reactivate_result
  ),
  'the waiting reactivation observes suspension and returns the active snapshot'
);

SELECT ok(
  (
    SELECT operations_suspended_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000092'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000092'
      AND action = 'account_operations_suspended'
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000093'
      AND summary = '{"reason":"Concurrent suspension reason"}'::jsonb
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000092'
      AND action = 'account_operations_reactivated'
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000094'
      AND summary = '{"reason":"Concurrent reactivation reason"}'::jsonb
  ),
  'suspend then reactivate serializes to active with both transitions audited'
);

-- Pausing different services concurrently must not replace the sibling field
-- that was committed while the second operation waited for the row lock.
DO $start_ai_pause_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_ai_pause_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_048_ai_pause_owner',
    $pause$
      DO $operation$
      BEGIN
        PERFORM public.set_admin_business_service_pause(
          '10000000-0000-4000-a048-000000000093',
          'ai_replies',
          true,
          NULL,
          '90000000-0000-4000-a048-000000000095'
        );
      END;
      $operation$;
    $pause$
  );
END;
$start_ai_pause_owner$;

SELECT is(
  extensions.dblink_send_query(
    'test_048_texting_pause_waiter',
    $pause$
      SELECT public.set_admin_business_service_pause(
        '10000000-0000-4000-a048-000000000093',
        'texting',
        true,
        'Concurrent texting pause',
        '90000000-0000-4000-a048-000000000096'
      )::text AS payload
    $pause$
  ),
  1,
  'a texting pause starts while an AI pause owns the business lock'
);

DO $wait_for_ai_pause_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_ai_pause_lock$;

SELECT is(
  extensions.dblink_is_busy('test_048_texting_pause_waiter'),
  1,
  'the texting pause waits behind the in-flight AI pause'
);

DO $commit_ai_pause_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_ai_pause_owner', 'COMMIT');
END;
$commit_ai_pause_owner$;

CREATE TEMP TABLE controls_048_texting_pause_result AS
SELECT payload::jsonb AS payload
FROM extensions.dblink_get_result('test_048_texting_pause_waiter')
  AS result(payload text);

SELECT ok(
  (
    SELECT (payload ->> 'changed')::boolean
       AND payload->>'admin_event_id' IS NOT NULL
       AND payload->>'ai_replies_paused_at' IS NOT NULL
       AND payload->>'texting_paused_at' IS NOT NULL
       AND payload->>'bookings_paused_at' IS NULL
    FROM controls_048_texting_pause_result
  ),
  'the waiting texting pause returns a snapshot preserving the AI pause'
);

SELECT ok(
  (
    SELECT operations_suspended_at IS NULL
       AND ai_replies_paused_at IS NOT NULL
       AND texting_paused_at IS NOT NULL
       AND bookings_paused_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000093'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000093'
      AND action = 'account_service_paused'
      AND summary = '{"service":"ai_replies"}'::jsonb
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000095'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000093'
      AND action = 'account_service_paused'
      AND summary =
            '{"service":"texting","reason":"Concurrent texting pause"}'::jsonb
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000096'
  ),
  'two different service pauses preserve both timestamps and both audits'
);

-- Pause then resume of one service must also serialize. The waiter must see
-- the newly paused field, clear it, and retain both transition audits.
DO $start_booking_pause_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_booking_pause_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_048_booking_pause_owner',
    $pause$
      DO $operation$
      BEGIN
        PERFORM public.set_admin_business_service_pause(
          '10000000-0000-4000-a048-000000000094',
          'bookings',
          true,
          'Concurrent booking pause',
          '90000000-0000-4000-a048-000000000097'
        );
      END;
      $operation$;
    $pause$
  );
END;
$start_booking_pause_owner$;

SELECT is(
  extensions.dblink_send_query(
    'test_048_booking_resume_waiter',
    $resume$
      SELECT public.set_admin_business_service_pause(
        '10000000-0000-4000-a048-000000000094',
        'bookings',
        false,
        NULL,
        '90000000-0000-4000-a048-000000000098'
      )::text AS payload
    $resume$
  ),
  1,
  'a booking resume starts while the booking pause owns the business lock'
);

DO $wait_for_booking_pause_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_booking_pause_lock$;

SELECT is(
  extensions.dblink_is_busy('test_048_booking_resume_waiter'),
  1,
  'the booking resume waits behind the in-flight booking pause'
);

DO $commit_booking_pause_owner$
BEGIN
  PERFORM extensions.dblink_exec('test_048_booking_pause_owner', 'COMMIT');
END;
$commit_booking_pause_owner$;

CREATE TEMP TABLE controls_048_booking_resume_result AS
SELECT payload::jsonb AS payload
FROM extensions.dblink_get_result('test_048_booking_resume_waiter')
  AS result(payload text);

SELECT ok(
  (
    SELECT (payload ->> 'changed')::boolean
       AND payload->>'admin_event_id' IS NOT NULL
       AND payload->>'bookings_paused_at' IS NULL
    FROM controls_048_booking_resume_result
  ),
  'the waiting booking resume observes the pause and returns a resumed snapshot'
);

SELECT ok(
  (
    SELECT operations_suspended_at IS NULL
       AND ai_replies_paused_at IS NULL
       AND texting_paused_at IS NULL
       AND bookings_paused_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a048-000000000094'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000094'
      AND action = 'account_service_paused'
      AND summary =
            '{"service":"bookings","reason":"Concurrent booking pause"}'::jsonb
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000097'
  )
  AND (
    SELECT count(*) = 1
    FROM public.admin_action_events
    WHERE business_id = '10000000-0000-4000-a048-000000000094'
      AND action = 'account_service_resumed'
      AND summary = '{"service":"bookings"}'::jsonb
      AND actor_admin_user_id =
            '90000000-0000-4000-a048-000000000098'
  ),
  'pause then resume serializes without a lost state transition or audit'
);

DO $remote_cleanup$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_048_setup',
    $cleanup_sql$
      DO $cleanup$
      BEGIN
        DELETE FROM public.admin_action_events
        WHERE business_id IN (
          '10000000-0000-4000-a048-000000000091',
          '10000000-0000-4000-a048-000000000092',
          '10000000-0000-4000-a048-000000000093',
          '10000000-0000-4000-a048-000000000094'
        );

        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a048-000000000091',
          '10000000-0000-4000-a048-000000000092',
          '10000000-0000-4000-a048-000000000093',
          '10000000-0000-4000-a048-000000000094'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a048-000000000091',
          '00000000-0000-4000-a048-000000000092',
          '00000000-0000-4000-a048-000000000093',
          '00000000-0000-4000-a048-000000000094'
        );
      END;
      $cleanup$;
    $cleanup_sql$
  );

  PERFORM extensions.dblink_disconnect('test_048_identical_suspend_owner');
  PERFORM extensions.dblink_disconnect('test_048_identical_suspend_waiter');
  PERFORM extensions.dblink_disconnect('test_048_suspend_owner');
  PERFORM extensions.dblink_disconnect('test_048_reactivate_waiter');
  PERFORM extensions.dblink_disconnect('test_048_ai_pause_owner');
  PERFORM extensions.dblink_disconnect('test_048_texting_pause_waiter');
  PERFORM extensions.dblink_disconnect('test_048_booking_pause_owner');
  PERFORM extensions.dblink_disconnect('test_048_booking_resume_waiter');
  PERFORM extensions.dblink_disconnect('test_048_setup');
END;
$remote_cleanup$;

SELECT * FROM finish();

ROLLBACK;
