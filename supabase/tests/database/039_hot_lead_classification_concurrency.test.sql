BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- dblink workers commit outside this pgTAP transaction. Refuse to run unless
-- the target is the disposable local Supabase database (or the runner makes
-- the same explicit disposable-database attestation used by other races).
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
      'test_039_hot_lead_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(29);

CREATE TEMP TABLE hot_lead_039_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  text_value text,
  uuid_value uuid,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_039_hot_lead_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_039_lead_b',
    'test_039_lead_a'
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

  IF 'test_039_lead_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_039_lead_setup',
        $metric_cleanup_sql$
          DO $metric_cleanup$
          BEGIN
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'DISABLE TRIGGER reject_business_metric_events_mutation';
            DELETE FROM public.business_metric_events
            WHERE business_id =
              '10000000-0000-4000-a039-000000000091';
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'ENABLE TRIGGER reject_business_metric_events_mutation';
          END;
          $metric_cleanup$;
        $metric_cleanup_sql$
      );
      PERFORM extensions.dblink_exec(
        'test_039_lead_setup',
        $cleanup_sql$
          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a039-000000000091'
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_039_lead_setup');
    EXCEPTION WHEN OTHERS THEN
      v_cleanup_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('test_039_lead_setup');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_hot_lead_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send_result integer;
  v_busy_result integer;
  v_booking_id uuid;
  v_claim_token uuid;
  v_status text;
  v_error_state text;
  v_count bigint;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_039_lead_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_039_lead_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_039_lead_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_039_lead_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a039-000000000091';

          INSERT INTO auth.users (id, email)
          VALUES (
            '00000000-0000-4000-a039-000000000091',
            'hot-lead-concurrency-039@example.test'
          );

          UPDATE public.businesses
          SET id = '10000000-0000-4000-a039-000000000091',
              name = 'Hot Lead Concurrency 039',
              slug = 'hot-lead-concurrency-039'
          WHERE owner_id = '00000000-0000-4000-a039-000000000091';

          INSERT INTO public.contacts (
            id,
            business_id,
            name,
            phone_number,
            source_channel,
            lead_score
          ) VALUES
            (
              '20000000-0000-4000-a039-000000000091',
              '10000000-0000-4000-a039-000000000091',
              'Booking Race',
              '+13175550391',
              'sms',
              0
            ),
            (
              '20000000-0000-4000-a039-000000000092',
              '10000000-0000-4000-a039-000000000091',
              'Promotion Race',
              '+13175550392',
              'sms',
              0
            ),
            (
              '20000000-0000-4000-a039-000000000093',
              '10000000-0000-4000-a039-000000000091',
              'Cleanup Race',
              '+13175550393',
              'sms',
              0
            );

          INSERT INTO public.conversations (
            id,
            business_id,
            contact_id,
            channel,
            status,
            is_ai_handling
          ) VALUES
            (
              '30000000-0000-4000-a039-000000000091',
              '10000000-0000-4000-a039-000000000091',
              '20000000-0000-4000-a039-000000000091',
              'sms',
              'active',
              true
            ),
            (
              '30000000-0000-4000-a039-000000000092',
              '10000000-0000-4000-a039-000000000091',
              '20000000-0000-4000-a039-000000000092',
              'sms',
              'active',
              true
            ),
            (
              '30000000-0000-4000-a039-000000000093',
              '10000000-0000-4000-a039-000000000091',
              '20000000-0000-4000-a039-000000000093',
              'sms',
              'active',
              true
            );

          INSERT INTO public.messages (
            id,
            conversation_id,
            business_id,
            role,
            content,
            channel
          ) VALUES
            (
              '40000000-0000-4000-a039-000000000091',
              '30000000-0000-4000-a039-000000000091',
              '10000000-0000-4000-a039-000000000091',
              'customer',
              'Please book the estimate for tomorrow.',
              'sms'
            ),
            (
              '40000000-0000-4000-a039-000000000092',
              '30000000-0000-4000-a039-000000000092',
              '10000000-0000-4000-a039-000000000091',
              'customer',
              'This is urgent.',
              'sms'
            ),
            (
              '40000000-0000-4000-a039-000000000093',
              '30000000-0000-4000-a039-000000000093',
              '10000000-0000-4000-a039-000000000091',
              'customer',
              'Please reserve this cleanup-race appointment.',
              'sms'
            );
        END;
        $fixture$;
      $fixture_sql$
    );

    PERFORM extensions.dblink_exec(
      'test_039_lead_a',
      'SET ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'test_039_lead_b',
      'SET ROLE service_role'
    );

    -- Worker A inserts the pending reservation and retains its row/unique-index
    -- locks. Worker B races with a different claim for the same source message.
    PERFORM extensions.dblink_exec('test_039_lead_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_039_lead_b', 'BEGIN');

    SELECT result.id, result.status, result.operation_claim_token
    INTO v_booking_id, v_status, v_claim_token
    FROM extensions.dblink(
      'test_039_lead_a',
      $reserve_a$
        SELECT booking.id, booking.status, booking.operation_claim_token
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000091',
          p_conversation_id => '30000000-0000-4000-a039-000000000091',
          p_source_message_id => '40000000-0000-4000-a039-000000000091',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Estimate - Booking Race',
          p_request_fingerprint =>
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          p_starts_at => '2039-09-10T14:00:00Z',
          p_ends_at => '2039-09-10T14:30:00Z',
          p_claim_token => '50000000-0000-4000-a039-000000000091'
        ) AS booking
      $reserve_a$
    ) AS result(id uuid, status text, operation_claim_token uuid);

    INSERT INTO hot_lead_039_concurrency_state (
      name,
      uuid_value
    ) VALUES
      ('first_booking_id', v_booking_id),
      ('first_claim_token', v_claim_token);

    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('first_status', v_status);

    v_send_result := extensions.dblink_send_query(
      'test_039_lead_b',
      $reserve_b$
        SELECT booking.id, booking.status, booking.operation_claim_token
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000091',
          p_conversation_id => '30000000-0000-4000-a039-000000000091',
          p_source_message_id => '40000000-0000-4000-a039-000000000091',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Estimate - Booking Race',
          p_request_fingerprint =>
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          p_starts_at => '2039-09-10T14:00:00Z',
          p_ends_at => '2039-09-10T14:30:00Z',
          p_claim_token => '50000000-0000-4000-a039-000000000092'
        ) AS booking
      $reserve_b$
    );

    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_039_lead_b');

    INSERT INTO hot_lead_039_concurrency_state (name, integer_value) VALUES
      ('reserve_send_result', v_send_result),
      ('reserve_loser_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_039_lead_a', 'COMMIT');

    SELECT result.id, result.status, result.operation_claim_token
    INTO v_booking_id, v_status, v_claim_token
    FROM extensions.dblink_get_result('test_039_lead_b')
      AS result(id uuid, status text, operation_claim_token uuid);

    BEGIN
      PERFORM result.id
      FROM extensions.dblink_get_result('test_039_lead_b', false)
        AS result(id uuid, status text, operation_claim_token uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM extensions.dblink_exec('test_039_lead_b', 'COMMIT');

    INSERT INTO hot_lead_039_concurrency_state (name, uuid_value) VALUES
      ('fresh_loser_booking_id', v_booking_id),
      ('fresh_loser_returned_claim', v_claim_token);
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('fresh_loser_status', v_status);

    SELECT count(*)::bigint
    INTO v_count
    FROM public.calendar_bookings
    WHERE business_id = '10000000-0000-4000-a039-000000000091'
      AND source_message_id = '40000000-0000-4000-a039-000000000091';
    INSERT INTO hot_lead_039_concurrency_state (name, bigint_value)
    VALUES ('reservation_count', v_count);

    -- Make the first lease stale, then prove a third worker atomically takes it.
    PERFORM extensions.dblink_exec(
      'test_039_lead_setup',
      $stale_claim$
        UPDATE public.calendar_bookings
        SET operation_claimed_at = clock_timestamp() - interval '6 minutes'
        WHERE business_id = '10000000-0000-4000-a039-000000000091'
          AND source_message_id =
                '40000000-0000-4000-a039-000000000091'
      $stale_claim$
    );

    SELECT result.id, result.status, result.operation_claim_token
    INTO v_booking_id, v_status, v_claim_token
    FROM extensions.dblink(
      'test_039_lead_a',
      $reserve_stale$
        SELECT booking.id, booking.status, booking.operation_claim_token
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000091',
          p_conversation_id => '30000000-0000-4000-a039-000000000091',
          p_source_message_id => '40000000-0000-4000-a039-000000000091',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Estimate - Booking Race',
          p_request_fingerprint =>
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          p_starts_at => '2039-09-10T14:00:00Z',
          p_ends_at => '2039-09-10T14:30:00Z',
          p_claim_token => '50000000-0000-4000-a039-000000000093'
        ) AS booking
      $reserve_stale$
    ) AS result(id uuid, status text, operation_claim_token uuid);

    INSERT INTO hot_lead_039_concurrency_state (name, uuid_value)
    VALUES ('stale_takeover_claim', v_claim_token);

    -- The displaced token cannot confirm or fail the reclaimed reservation.
    v_error_state := NULL;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink(
        'test_039_lead_b',
        format(
          $losing_confirm$
            SELECT booking.id
            FROM public.confirm_calendar_booking(
              p_business_id =>
                '10000000-0000-4000-a039-000000000091',
              p_booking_id => %L,
              p_claim_token => '50000000-0000-4000-a039-000000000091',
              p_google_event_id => 'google-event-losing-039',
              p_starts_at => '2039-09-10T14:00:00Z',
              p_ends_at => '2039-09-10T14:30:00Z'
            ) AS booking
          $losing_confirm$,
          v_booking_id
        )
      ) AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('losing_confirm_error', v_error_state);

    v_error_state := NULL;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink(
        'test_039_lead_b',
        format(
          $losing_fail$
            SELECT booking.id
            FROM public.fail_calendar_booking(
              p_business_id =>
                '10000000-0000-4000-a039-000000000091',
              p_booking_id => %L,
              p_claim_token => '50000000-0000-4000-a039-000000000091',
              p_failure_reason =>
                'losing worker must not overwrite the lease'
            ) AS booking
          $losing_fail$,
          v_booking_id
        )
      ) AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('losing_fail_error', v_error_state);

    -- Resolve the real booking ID from the durable row instead of assuming its
    -- generated UUID. The winning claim confirms and promotes HOT atomically.
    SELECT id
    INTO v_booking_id
    FROM public.calendar_bookings
    WHERE business_id = '10000000-0000-4000-a039-000000000091'
      AND source_message_id = '40000000-0000-4000-a039-000000000091';

    SELECT result.status
    INTO v_status
    FROM extensions.dblink(
      'test_039_lead_a',
      format(
        $confirm_winner$
          SELECT booking.status
          FROM public.confirm_calendar_booking(
            p_business_id => '10000000-0000-4000-a039-000000000091',
            p_booking_id => %L,
            p_claim_token => '50000000-0000-4000-a039-000000000093',
            p_google_event_id => 'google-event-winner-039',
            p_starts_at => '2039-09-10T14:00:00Z',
            p_ends_at => '2039-09-10T14:30:00Z'
          ) AS booking
        $confirm_winner$,
        v_booking_id
      )
    ) AS result(status text);
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('confirmed_status', v_status);

    SELECT result.status
    INTO v_status
    FROM extensions.dblink(
      'test_039_lead_a',
      format(
        $confirm_same$
          SELECT booking.status
          FROM public.confirm_calendar_booking(
            p_business_id => '10000000-0000-4000-a039-000000000091',
            p_booking_id => %L,
            p_claim_token => '50000000-0000-4000-a039-000000000093',
            p_google_event_id => 'google-event-winner-039',
            p_starts_at => '2039-09-10T14:00:00Z',
            p_ends_at => '2039-09-10T14:30:00Z'
          ) AS booking
        $confirm_same$,
        v_booking_id
      )
    ) AS result(status text);
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('same_event_status', v_status);

    v_error_state := NULL;
    BEGIN
      PERFORM result.status
      FROM extensions.dblink(
        'test_039_lead_a',
        format(
          $confirm_conflict$
            SELECT booking.status
            FROM public.confirm_calendar_booking(
              p_business_id =>
                '10000000-0000-4000-a039-000000000091',
              p_booking_id => %L,
              p_claim_token => '50000000-0000-4000-a039-000000000093',
              p_google_event_id => 'google-event-conflict-039',
              p_starts_at => '2039-09-10T14:00:00Z',
              p_ends_at => '2039-09-10T14:30:00Z'
            ) AS booking
          $confirm_conflict$,
          v_booking_id
        )
      ) AS result(status text);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('conflicting_event_error', v_error_state);

    SELECT count(*)::bigint
    INTO v_count
    FROM public.lead_events
    WHERE contact_id = '20000000-0000-4000-a039-000000000091'
      AND event_type = 'became_hot';
    INSERT INTO hot_lead_039_concurrency_state (name, bigint_value)
    VALUES ('booking_hot_event_count', v_count);

    SELECT contact.lead_status
    INTO v_status
    FROM public.contacts AS contact
    WHERE contact.id = '20000000-0000-4000-a039-000000000091';
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('booking_contact_status', v_status);

    -- Two independent HOT promotions serialize on the contact row. The first
    -- worker emits the audit event; the waiter observes HOT and emits nothing.
    PERFORM extensions.dblink_exec('test_039_lead_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_039_lead_b', 'BEGIN');

    PERFORM result.promoted
    FROM extensions.dblink(
      'test_039_lead_a',
      $promote_a$
        SELECT 1::integer AS promoted
        FROM public.promote_contact_lead_status(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000092',
          p_new_status => 'hot',
          p_reason => 'urgent_with_identity',
          p_conversation_id => '30000000-0000-4000-a039-000000000092',
          p_source_message_id => '40000000-0000-4000-a039-000000000092',
          p_calendar_booking_id => NULL,
          p_emit_event => true
        )
      $promote_a$
    ) AS result(promoted integer);

    v_send_result := extensions.dblink_send_query(
      'test_039_lead_b',
      $promote_b$
        SELECT 1::integer AS promoted
        FROM public.promote_contact_lead_status(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000092',
          p_new_status => 'hot',
          p_reason => 'urgent_with_identity',
          p_conversation_id => '30000000-0000-4000-a039-000000000092',
          p_source_message_id => '40000000-0000-4000-a039-000000000092',
          p_calendar_booking_id => NULL,
          p_emit_event => true
        )
      $promote_b$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_039_lead_b');

    INSERT INTO hot_lead_039_concurrency_state (name, integer_value) VALUES
      ('promotion_send_result', v_send_result),
      ('promotion_loser_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_039_lead_a', 'COMMIT');

    PERFORM result.promoted
    FROM extensions.dblink_get_result('test_039_lead_b')
      AS result(promoted integer);
    BEGIN
      PERFORM result.promoted
      FROM extensions.dblink_get_result('test_039_lead_b', false)
        AS result(promoted integer);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('test_039_lead_b', 'COMMIT');

    SELECT count(*)::bigint
    INTO v_count
    FROM public.lead_events
    WHERE contact_id = '20000000-0000-4000-a039-000000000092'
      AND event_type = 'became_hot';
    INSERT INTO hot_lead_039_concurrency_state (name, bigint_value)
    VALUES ('promotion_hot_event_count', v_count);

    SELECT contact.lead_status
    INTO v_status
    FROM public.contacts AS contact
    WHERE contact.id = '20000000-0000-4000-a039-000000000092';
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('promotion_contact_status', v_status);

    -- A reservation holds the business lock until commit. Terminal cleanup
    -- waits, then observes the fresh pending lease and aborts instead of
    -- deleting linkage underneath an in-flight Google provider operation.
    PERFORM extensions.dblink_exec('test_039_lead_a', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'test_039_lead_a',
      $cleanup_race_reserve$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_contact_id => '20000000-0000-4000-a039-000000000093',
          p_conversation_id => '30000000-0000-4000-a039-000000000093',
          p_source_message_id => '40000000-0000-4000-a039-000000000093',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Estimate - Cleanup Race',
          p_request_fingerprint =>
            'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
          p_starts_at => '2039-09-11T14:00:00Z',
          p_ends_at => '2039-09-11T14:30:00Z',
          p_claim_token => '50000000-0000-4000-a039-000000000094'
        ) AS booking
      $cleanup_race_reserve$
    ) AS result(id uuid);

    PERFORM extensions.dblink_exec('test_039_lead_b', 'RESET ROLE');
    PERFORM extensions.dblink_exec('test_039_lead_b', 'BEGIN');
    v_send_result := extensions.dblink_send_query(
      'test_039_lead_b',
      $cleanup_race_tombstone$
        UPDATE public.businesses
        SET owner_id = NULL
        WHERE id = '10000000-0000-4000-a039-000000000091'
        RETURNING id
      $cleanup_race_tombstone$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_039_lead_b');
    INSERT INTO hot_lead_039_concurrency_state (name, integer_value) VALUES
      ('cleanup_send_result', v_send_result),
      ('cleanup_waiter_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_039_lead_a', 'COMMIT');

    v_error_state := NULL;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink_get_result('test_039_lead_b')
        AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink_get_result('test_039_lead_b', false)
        AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('cleanup_error', v_error_state);
    BEGIN
      PERFORM extensions.dblink_exec('test_039_lead_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    INSERT INTO hot_lead_039_concurrency_state (name, boolean_value)
    SELECT
      'cleanup_fence_state',
      business.owner_id IS NOT NULL
        AND booking.status = 'pending'
        AND booking.operation_claim_token =
              '50000000-0000-4000-a039-000000000094'::uuid
    FROM public.businesses AS business
    JOIN public.calendar_bookings AS booking
      ON booking.business_id = business.id
     AND booking.source_message_id =
           '40000000-0000-4000-a039-000000000093'
    WHERE business.id = '10000000-0000-4000-a039-000000000091';

    PERFORM extensions.dblink_exec(
      'test_039_lead_setup',
      $age_cleanup_race_claim$
        UPDATE public.calendar_bookings
        SET operation_claimed_at = clock_timestamp() - interval '11 minutes'
        WHERE source_message_id =
              '40000000-0000-4000-a039-000000000093'
      $age_cleanup_race_claim$
    );

    PERFORM extensions.dblink_exec('test_039_lead_a', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'test_039_lead_a',
      $reconcile_cleanup_claim$
        SELECT booking.id
        FROM public.claim_calendar_booking_reconciliation(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_booking_id => (
            SELECT id
            FROM public.calendar_bookings
            WHERE source_message_id =
                  '40000000-0000-4000-a039-000000000093'
          ),
          p_claim_token => '50000000-0000-4000-a039-000000000094'
        ) AS booking
      $reconcile_cleanup_claim$
    ) AS result(id uuid);

    PERFORM extensions.dblink_exec('test_039_lead_b', 'BEGIN');
    v_send_result := extensions.dblink_send_query(
      'test_039_lead_b',
      $reconcile_cleanup_tombstone$
        UPDATE public.businesses
        SET owner_id = NULL
        WHERE id = '10000000-0000-4000-a039-000000000091'
        RETURNING id
      $reconcile_cleanup_tombstone$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_039_lead_b');
    INSERT INTO hot_lead_039_concurrency_state (name, integer_value) VALUES
      ('reconcile_cleanup_send_result', v_send_result),
      ('reconcile_cleanup_waiter_busy', v_busy_result);

    PERFORM extensions.dblink_exec('test_039_lead_a', 'COMMIT');

    v_error_state := NULL;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink_get_result('test_039_lead_b')
        AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
    END;
    BEGIN
      PERFORM result.id
      FROM extensions.dblink_get_result('test_039_lead_b', false)
        AS result(id uuid);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    INSERT INTO hot_lead_039_concurrency_state (name, text_value)
    VALUES ('reconcile_cleanup_error', v_error_state);
    BEGIN
      PERFORM extensions.dblink_exec('test_039_lead_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    INSERT INTO hot_lead_039_concurrency_state (name, boolean_value)
    SELECT
      'reconcile_cleanup_fence_state',
      business.owner_id IS NOT NULL
        AND booking.status = 'pending'
        AND booking.reconciliation_attempt_count = 1
        AND booking.reconciliation_attempted_at IS NOT NULL
        AND booking.operation_claimed_at >
              clock_timestamp() - interval '1 minute'
    FROM public.businesses AS business
    JOIN public.calendar_bookings AS booking
      ON booking.business_id = business.id
     AND booking.source_message_id =
           '40000000-0000-4000-a039-000000000093'
    WHERE business.id = '10000000-0000-4000-a039-000000000091';

    PERFORM result.id
    FROM extensions.dblink(
      'test_039_lead_a',
      $cleanup_race_release$
        SELECT booking.id
        FROM public.fail_calendar_booking(
          p_business_id => '10000000-0000-4000-a039-000000000091',
          p_booking_id => (
            SELECT id
            FROM public.calendar_bookings
            WHERE source_message_id =
                  '40000000-0000-4000-a039-000000000093'
          ),
          p_claim_token => '50000000-0000-4000-a039-000000000094',
          p_failure_reason => 'cleanup concurrency test complete'
        ) AS booking
      $cleanup_race_release$
    ) AS result(id uuid);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM pg_temp.cleanup_039_hot_lead_concurrency();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'test_039_hot_lead_concurrency_finally_failed [%] %',
        SQLSTATE,
        SQLERRM;
    END;
    RAISE;
  END;
END;
$orchestrate_hot_lead_races$;

SELECT is(
  integer_value,
  1,
  'a second worker starts a simultaneous reservation'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reserve_send_result';

SELECT is(
  integer_value,
  1,
  'the competing reservation waits on the uncommitted source-message fence'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reserve_loser_busy';

SELECT is(
  text_value,
  'pending',
  'the first reservation is pending'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'first_status';

SELECT is(
  uuid_value,
  '50000000-0000-4000-a039-000000000091'::uuid,
  'the first reservation owns its requested claim'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'first_claim_token';

SELECT is(
  uuid_value,
  (
    SELECT uuid_value
    FROM hot_lead_039_concurrency_state
    WHERE name = 'first_booking_id'
  ),
  'the fresh losing reservation reuses the winning booking'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'fresh_loser_booking_id';

SELECT is(
  uuid_value,
  '50000000-0000-4000-a039-000000000091'::uuid,
  'the fresh losing reservation receives the existing claim, not its own'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'fresh_loser_returned_claim';

SELECT is(
  text_value,
  'pending',
  'the fresh losing reservation leaves the existing operation pending'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'fresh_loser_status';

SELECT is(
  bigint_value,
  1::bigint,
  'the simultaneous reservations produce exactly one booking row'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reservation_count';

SELECT is(
  uuid_value,
  '50000000-0000-4000-a039-000000000093'::uuid,
  'a reservation older than five minutes is reclaimed by the new token'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'stale_takeover_claim';

SELECT is(
  text_value,
  '42501',
  'the displaced claim cannot confirm the reclaimed booking'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'losing_confirm_error';

SELECT is(
  text_value,
  '42501',
  'the displaced claim cannot fail the reclaimed booking'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'losing_fail_error';

SELECT is(
  text_value,
  'confirmed',
  'the active claimant confirms the booking'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'confirmed_status';

SELECT is(
  text_value,
  'confirmed',
  'repeating confirmation with the same Google event is idempotent'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'same_event_status';

SELECT is(
  text_value,
  '23514',
  'a confirmed booking rejects a conflicting Google event id'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'conflicting_event_error';

SELECT is(
  text_value,
  'hot',
  'booking confirmation promotes the linked contact to HOT'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'booking_contact_status';

SELECT is(
  bigint_value,
  1::bigint,
  'booking confirmation emits one became-hot audit event'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'booking_hot_event_count';

SELECT is(
  integer_value,
  1,
  'a second worker starts a concurrent HOT promotion'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'promotion_send_result';

SELECT is(
  integer_value,
  1,
  'the second HOT promotion waits on the locked contact'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'promotion_loser_busy';

SELECT is(
  text_value,
  'hot',
  'the concurrent promotion leaves the contact HOT'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'promotion_contact_status';

SELECT is(
  bigint_value,
  1::bigint,
  'concurrent first-HOT promotions emit exactly one audit event'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'promotion_hot_event_count';

SELECT is(
  integer_value,
  1,
  'terminal cleanup starts while a reservation holds the business lock'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'cleanup_send_result';

SELECT is(
  integer_value,
  1,
  'terminal cleanup waits for the in-flight reservation transaction'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'cleanup_waiter_busy';

SELECT is(
  text_value,
  '55000',
  'terminal cleanup aborts after observing the fresh provider lease'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'cleanup_error';

SELECT is(
  boolean_value,
  true,
  'the cleanup race preserves the active owner and pending booking linkage'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'cleanup_fence_state';

SELECT is(
  integer_value,
  1,
  'terminal cleanup starts while reconciliation holds the business lock'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reconcile_cleanup_send_result';

SELECT is(
  integer_value,
  1,
  'terminal cleanup waits for reconciliation to renew the provider lease'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reconcile_cleanup_waiter_busy';

SELECT is(
  text_value,
  '55000',
  'cleanup aborts after observing the reconciler-renewed lease'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reconcile_cleanup_error';

SELECT is(
  boolean_value,
  true,
  'reconciliation renewal survives the concurrent cleanup attempt'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'reconcile_cleanup_fence_state';

DO $cleanup_committed_fixture$
DECLARE
  v_cleanup_ok boolean;
BEGIN
  v_cleanup_ok := pg_temp.cleanup_039_hot_lead_concurrency();
  INSERT INTO hot_lead_039_concurrency_state (name, boolean_value)
  VALUES ('cleanup_ok', v_cleanup_ok);
END;
$cleanup_committed_fixture$;

SELECT is(
  boolean_value
    AND NOT EXISTS (
      SELECT 1
      FROM auth.users
      WHERE id = '00000000-0000-4000-a039-000000000091'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.businesses
      WHERE id = '10000000-0000-4000-a039-000000000091'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.calendar_bookings
      WHERE business_id = '10000000-0000-4000-a039-000000000091'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.lead_events
      WHERE business_id = '10000000-0000-4000-a039-000000000091'
    ),
  true,
  'all remote sessions and committed concurrency fixtures are cleaned'
)
FROM hot_lead_039_concurrency_state
WHERE name = 'cleanup_ok';

SELECT * FROM finish();

ROLLBACK;
