BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

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
      'test_062_calendar_slot_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(13);

CREATE TEMP TABLE calendar_062_concurrency_state (
  key text PRIMARY KEY,
  text_value text,
  integer_value integer,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_062_calendar_slot_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection text;
  v_ok boolean := true;
BEGIN
  FOREACH v_connection IN ARRAY ARRAY[
    'calendar_062_worker_a',
    'calendar_062_worker_b'
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
          PERFORM outcome
          FROM extensions.dblink_get_result(v_connection, false)
            AS drained(outcome text);
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

  IF 'calendar_062_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(), ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'calendar_062_setup',
        $metric_cleanup_sql$
          DO $metric_cleanup$
          BEGIN
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'DISABLE TRIGGER reject_business_metric_events_mutation';
            DELETE FROM public.business_metric_events
            WHERE business_id =
              '10000000-0000-4000-a062-000000000091';
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'ENABLE TRIGGER reject_business_metric_events_mutation';
          END;
          $metric_cleanup$;
        $metric_cleanup_sql$
      );
      PERFORM extensions.dblink_exec(
        'calendar_062_setup',
        $cleanup$
          DELETE FROM public.calendar_bookings
          WHERE business_id =
            '10000000-0000-4000-a062-000000000091';

          DELETE FROM public.google_calendar_tokens
          WHERE id = '62000000-0000-4000-a062-000000000091'
            AND business_id =
              '10000000-0000-4000-a062-000000000091';

          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a062-000000000091'
        $cleanup$
      );
      PERFORM extensions.dblink_disconnect('calendar_062_setup');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('calendar_062_setup');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END IF;

  RETURN v_ok;
END;
$$;

DO $orchestrate_calendar_slot_race$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send_result integer;
  v_busy integer;
  v_loser_outcome text;
  v_active_count integer;
  v_loser_count integer;
  v_winner_source text;
  v_confirm_send_result integer;
  v_confirm_busy integer;
  v_confirm_loser_outcome text;
  v_confirmed_winner_count integer;
  v_confirm_loser_count integer;
  v_confirm_active_count integer;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'calendar_062_setup', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'calendar_062_worker_a', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'calendar_062_worker_b', v_connection_string
    );

    -- A failed prior disposable run may have committed the contact-created
    -- metric before cleanup. Remove only this exact fixture's append-only
    -- events before deleting and recreating its auth/business tree.
    PERFORM extensions.dblink_exec(
      'calendar_062_setup',
      $preflight_metric_cleanup_sql$
        DO $preflight_metric_cleanup$
        BEGIN
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'DISABLE TRIGGER reject_business_metric_events_mutation';
          DELETE FROM public.business_metric_events
          WHERE business_id =
            '10000000-0000-4000-a062-000000000091';
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'ENABLE TRIGGER reject_business_metric_events_mutation';
        END;
        $preflight_metric_cleanup$;
      $preflight_metric_cleanup_sql$
    );

    PERFORM extensions.dblink_exec(
      'calendar_062_setup',
      $fixture$
        DELETE FROM auth.users
        WHERE id = '00000000-0000-4000-a062-000000000091';

        INSERT INTO auth.users (id, email)
        VALUES (
          '00000000-0000-4000-a062-000000000091',
          'calendar-slot-concurrency-a062@example.test'
        );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a062-000000000091',
            name = 'Calendar Slot Concurrency 062',
            slug = 'calendar-slot-concurrency-a062'
        WHERE owner_id = '00000000-0000-4000-a062-000000000091';

        INSERT INTO public.google_calendar_tokens (
          id,
          business_id,
          access_token,
          refresh_token,
          token_expiry,
          calendar_id,
          google_email,
          created_at,
          updated_at
        ) VALUES (
          '62000000-0000-4000-a062-000000000091',
          '10000000-0000-4000-a062-000000000091',
          'fixture-access-a062-91',
          'fixture-refresh-a062-91',
          '2099-01-01 00:00:00+00',
          'primary',
          'calendar-slot-concurrency-a062@example.test',
          '2039-01-01 00:00:00+00',
          '2039-01-01 00:00:00+00'
        );

        INSERT INTO public.contacts (
          id, business_id, name, email, source_channel, lead_score
        ) VALUES (
          '20000000-0000-4000-a062-000000000091',
          '10000000-0000-4000-a062-000000000091',
          'Calendar Slot Race',
          'calendar-slot-race-a062@example.test',
          'web_chat',
          0
        );

        INSERT INTO public.conversations (
          id, business_id, contact_id, channel, status, is_ai_handling
        ) VALUES (
          '30000000-0000-4000-a062-000000000091',
          '10000000-0000-4000-a062-000000000091',
          '20000000-0000-4000-a062-000000000091',
          'web_chat',
          'active',
          true
        );

        INSERT INTO public.messages (
          id, conversation_id, business_id, role, content, channel
        ) VALUES
          (
            '40000000-0000-4000-a062-000000000091',
            '30000000-0000-4000-a062-000000000091',
            '10000000-0000-4000-a062-000000000091',
            'customer',
            'First worker reserves this slot.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a062-000000000092',
            '30000000-0000-4000-a062-000000000091',
            '10000000-0000-4000-a062-000000000091',
            'customer',
            'Second worker races for this slot.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a062-000000000093',
            '30000000-0000-4000-a062-000000000091',
            '10000000-0000-4000-a062-000000000091',
            'customer',
            'Confirm this provider-shifted slot.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a062-000000000094',
            '30000000-0000-4000-a062-000000000091',
            '10000000-0000-4000-a062-000000000091',
            'customer',
            'Race the provider confirmation.',
            'web_chat'
          );
      $fixture$
    );

    PERFORM extensions.dblink_exec(
      'calendar_062_worker_a', 'SET ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'calendar_062_worker_b', 'SET ROLE service_role'
    );

    PERFORM extensions.dblink_exec(
      'calendar_062_worker_b',
      $helper$
        CREATE FUNCTION pg_temp.reserve_calendar_slot_062_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a062-000000000091',
            p_contact_id => '20000000-0000-4000-a062-000000000091',
            p_conversation_id => '30000000-0000-4000-a062-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a062-000000000092',
            p_starts_at => '2039-09-10T14:15:00Z',
            p_ends_at => '2039-09-10T14:45:00Z',
            p_claim_token => '50000000-0000-4000-a062-000000000092',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Losing Overlap',
            p_request_fingerprint =>
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
          );
          RETURN 'allowed';
        EXCEPTION
          WHEN SQLSTATE '23P01' THEN
            IF SQLERRM = 'calendar_booking_slot_unavailable' THEN
              RETURN 'slot_unavailable';
            END IF;
            RAISE;
        END;
        $function$;
      $helper$
    );

    PERFORM extensions.dblink_exec(
      'calendar_062_worker_b',
      $confirm_helper$
        CREATE FUNCTION pg_temp.reserve_calendar_slot_062_confirm_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a062-000000000091',
            p_contact_id => '20000000-0000-4000-a062-000000000091',
            p_conversation_id => '30000000-0000-4000-a062-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a062-000000000094',
            p_starts_at => '2039-09-10T16:45:00Z',
            p_ends_at => '2039-09-10T17:15:00Z',
            p_claim_token => '50000000-0000-4000-a062-000000000094',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Confirmation Race Loser',
            p_request_fingerprint =>
              'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
          );
          RETURN 'allowed';
        EXCEPTION
          WHEN SQLSTATE '23P01' THEN
            IF SQLERRM = 'calendar_booking_slot_unavailable' THEN
              RETURN 'slot_unavailable';
            END IF;
            RAISE;
        END;
        $function$;
      $confirm_helper$
    );

    PERFORM extensions.dblink_exec('calendar_062_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_062_worker_b', 'BEGIN');

    PERFORM result.id
    FROM extensions.dblink(
      'calendar_062_worker_a',
      $winner$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a062-000000000091',
          p_contact_id => '20000000-0000-4000-a062-000000000091',
          p_conversation_id => '30000000-0000-4000-a062-000000000091',
          p_source_message_id => '40000000-0000-4000-a062-000000000091',
          p_starts_at => '2039-09-10T14:00:00Z',
          p_ends_at => '2039-09-10T14:30:00Z',
          p_claim_token => '50000000-0000-4000-a062-000000000091',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Winning Slot',
          p_request_fingerprint =>
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
        ) AS booking
      $winner$
    ) AS result(id uuid);

    v_send_result := extensions.dblink_send_query(
      'calendar_062_worker_b',
      'SELECT pg_temp.reserve_calendar_slot_062_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_062_worker_b');

    PERFORM extensions.dblink_exec('calendar_062_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_loser_outcome
    FROM extensions.dblink_get_result('calendar_062_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_062_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_062_worker_b', 'COMMIT');

    SELECT count(*)::integer,
           count(*) FILTER (
             WHERE booking.source_message_id =
               '40000000-0000-4000-a062-000000000092'
           )::integer,
           min(booking.source_message_id::text)
    INTO v_active_count, v_loser_count, v_winner_source
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = '10000000-0000-4000-a062-000000000091'
      AND booking.status IN ('pending', 'confirmed');

    INSERT INTO calendar_062_concurrency_state (
      key, integer_value
    ) VALUES
      ('send_result', v_send_result),
      ('loser_busy', v_busy),
      ('active_count', v_active_count),
      ('loser_count', v_loser_count);
    INSERT INTO calendar_062_concurrency_state (key, text_value) VALUES
      ('loser_outcome', v_loser_outcome),
      ('winner_source', v_winner_source);

    -- Seed a pending booking outside either worker transaction. Worker A then
    -- confirms it at provider-returned times while retaining the business
    -- mutex. Worker B must wait and lose its overlapping new reservation.
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_062_setup',
      $confirm_seed$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a062-000000000091',
          p_contact_id => '20000000-0000-4000-a062-000000000091',
          p_conversation_id => '30000000-0000-4000-a062-000000000091',
          p_source_message_id => '40000000-0000-4000-a062-000000000093',
          p_starts_at => '2039-09-10T16:00:00Z',
          p_ends_at => '2039-09-10T16:30:00Z',
          p_claim_token => '50000000-0000-4000-a062-000000000093',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Provider Shift Winner',
          p_request_fingerprint =>
            'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        ) AS booking
      $confirm_seed$
    ) AS result(id uuid);

    PERFORM extensions.dblink_exec('calendar_062_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_062_worker_b', 'BEGIN');

    PERFORM result.id
    FROM extensions.dblink(
      'calendar_062_worker_a',
      $confirm_winner$
        SELECT booking.id
        FROM public.confirm_calendar_booking(
          p_business_id => '10000000-0000-4000-a062-000000000091',
          p_booking_id => (
            SELECT candidate.id
            FROM public.calendar_bookings AS candidate
            WHERE candidate.source_message_id =
              '40000000-0000-4000-a062-000000000093'
          ),
          p_google_event_id => 'google-confirm-race-a062',
          p_starts_at => '2039-09-10T16:30:00Z',
          p_ends_at => '2039-09-10T17:00:00Z',
          p_claim_token => '50000000-0000-4000-a062-000000000093'
        ) AS booking
      $confirm_winner$
    ) AS result(id uuid);

    v_confirm_send_result := extensions.dblink_send_query(
      'calendar_062_worker_b',
      'SELECT pg_temp.reserve_calendar_slot_062_confirm_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_confirm_busy := extensions.dblink_is_busy('calendar_062_worker_b');

    PERFORM extensions.dblink_exec('calendar_062_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_confirm_loser_outcome
    FROM extensions.dblink_get_result('calendar_062_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_062_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_062_worker_b', 'COMMIT');

    SELECT
      count(*) FILTER (
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000093'
          AND booking.status = 'confirmed'
      )::integer,
      count(*) FILTER (
        WHERE booking.source_message_id =
          '40000000-0000-4000-a062-000000000094'
      )::integer,
      count(*) FILTER (
        WHERE booking.google_calendar_id = 'primary'
          AND booking.status IN ('pending', 'confirmed')
          AND booking.starts_at < '2039-09-10T17:15:00Z'::timestamptz
          AND booking.ends_at > '2039-09-10T16:30:00Z'::timestamptz
      )::integer
    INTO
      v_confirmed_winner_count,
      v_confirm_loser_count,
      v_confirm_active_count
    FROM public.calendar_bookings AS booking
    WHERE booking.business_id = '10000000-0000-4000-a062-000000000091';

    INSERT INTO calendar_062_concurrency_state (
      key, integer_value
    ) VALUES
      ('confirm_send_result', v_confirm_send_result),
      ('confirm_loser_busy', v_confirm_busy),
      ('confirmed_winner_count', v_confirmed_winner_count),
      ('confirm_loser_count', v_confirm_loser_count),
      ('confirm_active_count', v_confirm_active_count);
    INSERT INTO calendar_062_concurrency_state (key, text_value)
    VALUES ('confirm_loser_outcome', v_confirm_loser_outcome);
  EXCEPTION WHEN OTHERS THEN
    v_cleanup_ok := pg_temp.cleanup_062_calendar_slot_concurrency();
    RAISE;
  END;

  v_cleanup_ok := pg_temp.cleanup_062_calendar_slot_concurrency();
  INSERT INTO calendar_062_concurrency_state (key, boolean_value)
  VALUES ('cleanup_ok', v_cleanup_ok);
END;
$orchestrate_calendar_slot_race$;

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'send_result'),
  1,
  'the overlapping reservation race is dispatched'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'loser_busy'),
  1,
  'the second worker waits on the first business-row reservation lock'
);

SELECT is(
  (SELECT text_value FROM calendar_062_concurrency_state
   WHERE key = 'loser_outcome'),
  'slot_unavailable',
  'the serialized loser receives the typed slot-unavailable decision'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'active_count'),
  1,
  'only one overlapping active booking is persisted'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'loser_count'),
  0,
  'the losing source message leaves no booking row'
);

SELECT is(
  (SELECT text_value FROM calendar_062_concurrency_state
   WHERE key = 'winner_source'),
  '40000000-0000-4000-a062-000000000091',
  'the first committed reservation remains the winner'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'confirm_send_result'),
  1,
  'the confirmation-versus-reservation race is dispatched'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'confirm_loser_busy'),
  1,
  'an overlapping reservation waits for provider confirmation to commit'
);

SELECT is(
  (SELECT text_value FROM calendar_062_concurrency_state
   WHERE key = 'confirm_loser_outcome'),
  'slot_unavailable',
  'the reservation loses after the provider confirmation moves into its slot'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'confirmed_winner_count'),
  1,
  'the provider-shifted booking is confirmed exactly once'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'confirm_loser_count'),
  0,
  'the confirmation-race loser leaves no booking row'
);

SELECT is(
  (SELECT integer_value FROM calendar_062_concurrency_state
   WHERE key = 'confirm_active_count'),
  1,
  'only one active booking occupies the provider-confirmed time range'
);

SELECT ok(
  (SELECT boolean_value FROM calendar_062_concurrency_state
   WHERE key = 'cleanup_ok')
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE id = '62000000-0000-4000-a062-000000000091'
  ),
  'calendar slot race fixtures and dblink sessions are cleaned up'
);

SELECT * FROM finish();

ROLLBACK;
