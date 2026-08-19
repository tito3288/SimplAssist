BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- dblink workers commit outside this pgTAP transaction. Refuse any database
-- that is not the disposable local Supabase instance (or explicitly attested
-- by the same guarded database-test runner used by the other race suites).
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
      'test_063_calendar_provider_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(87);

CREATE TEMP TABLE calendar_063_concurrency_state (
  key text PRIMARY KEY,
  text_value text,
  integer_value integer,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_063_calendar_provider_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection text;
  v_ok boolean := true;
BEGIN
  FOREACH v_connection IN ARRAY ARRAY[
    'calendar_063_worker_a',
    'calendar_063_worker_b'
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
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        BEGIN
          PERFORM outcome
          FROM extensions.dblink_get_result(v_connection, false)
            AS drained(outcome text);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        BEGIN
          PERFORM extensions.dblink_exec(v_connection, 'ROLLBACK');
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
        PERFORM extensions.dblink_disconnect(v_connection);
      EXCEPTION WHEN OTHERS THEN
        v_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect(v_connection);
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END;
    END IF;
  END LOOP;

  IF 'calendar_063_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(), ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'calendar_063_setup',
        $metric_cleanup_sql$
          DO $metric_cleanup$
          BEGIN
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'DISABLE TRIGGER reject_business_metric_events_mutation';
            DELETE FROM public.business_metric_events
            WHERE business_id =
              '10000000-0000-4000-a063-000000000091';
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'ENABLE TRIGGER reject_business_metric_events_mutation';
          END;
          $metric_cleanup$;
        $metric_cleanup_sql$
      );
      PERFORM extensions.dblink_exec(
        'calendar_063_setup',
        $cleanup_sql$
          DELETE FROM public.calendar_provider_operations
          WHERE business_id =
            '10000000-0000-4000-a063-000000000091';

          DELETE FROM public.calendar_bookings
          WHERE business_id =
            '10000000-0000-4000-a063-000000000091';

          DELETE FROM public.google_calendar_tokens
          WHERE id = '62000000-0000-4000-a063-000000000091'
            AND business_id =
              '10000000-0000-4000-a063-000000000091';

          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a063-000000000091';
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('calendar_063_setup');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('calendar_063_setup');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END IF;

  RETURN v_ok;
END;
$$;

DO $orchestrate_calendar_provider_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_send integer;
  v_busy integer;
  v_outcome text;
  v_text text;
  v_count integer;
  v_boolean boolean;
  v_boolean_two boolean;
  v_expected_version uuid;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'calendar_063_setup', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'calendar_063_worker_a', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'calendar_063_worker_b', v_connection_string
    );

    -- A killed earlier run may have committed the append-only contact metric.
    -- Remove only this exact fixture before recreating its auth/business tree.
    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $preflight_metric_cleanup_sql$
        DO $preflight_metric_cleanup$
        BEGIN
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'DISABLE TRIGGER reject_business_metric_events_mutation';
          DELETE FROM public.business_metric_events
          WHERE business_id =
            '10000000-0000-4000-a063-000000000091';
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'ENABLE TRIGGER reject_business_metric_events_mutation';
        END;
        $preflight_metric_cleanup$;
      $preflight_metric_cleanup_sql$
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $fixture_sql$
        DELETE FROM public.calendar_provider_operations
        WHERE business_id = '10000000-0000-4000-a063-000000000091';

        DELETE FROM public.calendar_bookings
        WHERE business_id = '10000000-0000-4000-a063-000000000091';

        DELETE FROM public.google_calendar_tokens
        WHERE business_id = '10000000-0000-4000-a063-000000000091';

        DELETE FROM auth.users
        WHERE id = '00000000-0000-4000-a063-000000000091';

        INSERT INTO auth.users (id, email)
        VALUES (
          '00000000-0000-4000-a063-000000000091',
          'calendar-provider-concurrency-a063@example.test'
        );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a063-000000000091',
            name = 'Calendar Provider Concurrency 063',
            slug = 'calendar-provider-concurrency-a063',
            primary_goal = 'book'
        WHERE owner_id = '00000000-0000-4000-a063-000000000091';

        INSERT INTO public.ai_settings (
          business_id,
          booking_enabled,
          booking_mode
        ) VALUES (
          '10000000-0000-4000-a063-000000000091',
          false,
          'collect_info'
        );

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
          '62000000-0000-4000-a063-000000000091',
          '10000000-0000-4000-a063-000000000091',
          'fixture-access-a063-91',
          'fixture-refresh-a063-91',
          '2099-01-01 00:00:00+00',
          'primary',
          'calendar-provider-concurrency-a063@example.test',
          '2063-01-01 00:00:00+00',
          '2063-01-01 00:00:00+00'
        );

        INSERT INTO public.contacts (
          id, business_id, name, email, source_channel, lead_score
        ) VALUES (
          '20000000-0000-4000-a063-000000000091',
          '10000000-0000-4000-a063-000000000091',
          'Calendar Provider Race',
          'calendar-provider-race-a063@example.test',
          'web_chat',
          0
        );

        INSERT INTO public.conversations (
          id, business_id, contact_id, channel, status, is_ai_handling
        ) VALUES (
          '30000000-0000-4000-a063-000000000091',
          '10000000-0000-4000-a063-000000000091',
          '20000000-0000-4000-a063-000000000091',
          'web_chat',
          'active',
          true
        );

        INSERT INTO public.messages (
          id, conversation_id, business_id, role, content, channel
        ) VALUES
          (
            '40000000-0000-4000-a063-000000000091',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Dashboard operation wins the slot race.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000092',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'AI reservation wins the slot race.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000093',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Reserve after provider finalization.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000094',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'AI booking wins before disconnect.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000095',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Disconnect wins before AI booking.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000096',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Worker reaches the AI provider fence first.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000097',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Reconciler rotates the AI claim first.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000098',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'AI reservation wins before OAuth replacement.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000099',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'OAuth replacement wins before AI reservation.',
            'web_chat'
          ),
          (
            '40000000-0000-4000-a063-000000000100',
            '30000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            'customer',
            'Confirm at provider-returned shifted authority.',
            'web_chat'
          );

        INSERT INTO public.google_calendar_oauth_attempts (
          id,
          state_digest,
          origin_verifier_digest,
          handoff_digest,
          business_id,
          owner_user_id,
          origin_partner_id,
          origin_hostname,
          status,
          authorization_code,
          sanitized_result,
          expires_at,
          handoff_expires_at,
          claimed_at
        ) VALUES
          (
            '65000000-0000-4000-a063-000000000091',
            repeat('1', 64),
            repeat('a', 64),
            repeat('3', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000092',
            repeat('2', 64),
            repeat('b', 64),
            repeat('4', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000093',
            repeat('3', 64),
            repeat('c', 64),
            repeat('5', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000094',
            repeat('4', 64),
            repeat('d', 64),
            repeat('6', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000095',
            repeat('5', 64),
            repeat('e', 64),
            repeat('7', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000096',
            repeat('6', 64),
            repeat('f', 64),
            repeat('8', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          ),
          (
            '65000000-0000-4000-a063-000000000097',
            repeat('7', 64),
            repeat('0', 64),
            repeat('9', 64),
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'claimed',
            NULL,
            NULL,
            now() + interval '10 minutes',
            now() + interval '5 minutes',
            now()
          );

      $fixture_sql$
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_worker_a', 'SET ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'calendar_063_worker_b', 'SET ROLE service_role'
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_worker_b',
      $helpers_sql$
        CREATE FUNCTION pg_temp.reserve_063_dashboard_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a063-000000000091',
            p_starts_at => '2063-09-10 14:10:00+00',
            p_ends_at => '2063-09-10 14:20:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000091',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Dashboard race loser',
            p_request_fingerprint => repeat('a', 64)
          );
          RETURN 'allowed';
        EXCEPTION WHEN SQLSTATE '23P01' THEN
          IF SQLERRM = 'calendar_booking_slot_unavailable' THEN
            RETURN 'slot_unavailable';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.acquire_063_ai_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000092',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'create',
            p_google_calendar_id => 'primary',
            p_starts_at => '2063-09-10 15:10:00+00',
            p_ends_at => '2063-09-10 15:20:00+00',
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => 'abcde0630000092',
            p_target_google_event_id => NULL,
            p_request_fingerprint => repeat('b', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000092'
          );
          RETURN 'allowed';
        EXCEPTION WHEN SQLSTATE '23P01' THEN
          IF SQLERRM = 'calendar_provider_slot_unavailable' THEN
            RETURN 'slot_unavailable';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.acquire_063_target_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000094',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'delete',
            p_google_calendar_id => 'primary',
            p_starts_at => NULL,
            p_ends_at => NULL,
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => NULL,
            p_target_google_event_id => 'abcde0630000093',
            p_request_fingerprint => repeat('d', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000094'
          );
          RETURN 'allowed';
        EXCEPTION WHEN SQLSTATE '55P03' THEN
          IF SQLERRM = 'calendar_provider_operation_busy' THEN
            RETURN 'busy';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.reserve_063_finalize_waiter()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a063-000000000093',
            p_starts_at => '2063-09-10 17:10:00+00',
            p_ends_at => '2063-09-10 17:20:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000093',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Finalization waiter',
            p_request_fingerprint => repeat('e', 64)
          );
          RETURN 'allowed';
        END;
        $function$;

        CREATE FUNCTION pg_temp.disconnect_063_waiter()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.disconnect_google_calendar_token(
            '10000000-0000-4000-a063-000000000091'
          );
          RETURN 'disconnected';
        EXCEPTION WHEN SQLSTATE '55P03' THEN
          IF SQLERRM = 'calendar_provider_operation_busy' THEN
            RETURN 'busy';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.acquire_063_disconnect_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000097',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'create',
            p_google_calendar_id => 'primary',
            p_starts_at => '2063-09-10 19:00:00+00',
            p_ends_at => '2063-09-10 19:30:00+00',
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => 'abcde0630000097',
            p_target_google_event_id => NULL,
            p_request_fingerprint => repeat('a', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000097'
          );
          RETURN 'allowed';
        EXCEPTION WHEN SQLSTATE '55000' THEN
          IF SQLERRM = 'calendar_provider_operation_business_unavailable' THEN
            RETURN 'business_unavailable';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.reserve_063_disconnect_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a063-000000000095',
            p_starts_at => '2063-09-10 21:00:00+00',
            p_ends_at => '2063-09-10 21:30:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000095',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Disconnect-first AI loser',
            p_request_fingerprint => repeat('b', 64)
          );
          RETURN 'allowed';
        EXCEPTION WHEN SQLSTATE '23514' THEN
          IF SQLERRM = 'calendar booking business is not active' THEN
            RETURN 'business_inactive';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.oauth_063_operation_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.complete_google_calendar_oauth_connection(
            '65000000-0000-4000-a063-000000000091',
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'op-first-mismatch-access-a063',
            'op-first-mismatch-refresh-a063',
            '2099-01-01 00:00:00+00',
            'different-google-account@example.test',
            'primary'
          );
          RETURN 'completed';
        EXCEPTION WHEN SQLSTATE '55P03' THEN
          IF SQLERRM = 'calendar_provider_oauth_namespace_busy' THEN
            RETURN 'namespace_busy';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.acquire_063_callback_waiter()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000089',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'create',
            p_google_calendar_id => 'secondary',
            p_starts_at => '2063-09-10 12:30:00+00',
            p_ends_at => '2063-09-10 13:00:00+00',
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => 'abcde0630000089',
            p_target_google_event_id => NULL,
            p_request_fingerprint => repeat('f', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000089'
          );
          RETURN 'allowed';
        END;
        $function$;

        CREATE FUNCTION pg_temp.claim_063_worker_first_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000096';
          PERFORM public.claim_calendar_booking_reconciliation(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token
          );
          RETURN 'claimed';
        EXCEPTION WHEN SQLSTATE '55000' THEN
          IF SQLERRM = 'calendar booking claim is not stale' THEN
            RETURN 'not_stale';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.mark_063_reconciler_first_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000097';
          PERFORM public.mark_calendar_booking_submission_started(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            '2000-01-01 00:00:00+00'
          );
          RETURN 'started';
        EXCEPTION WHEN SQLSTATE '42501' THEN
          IF SQLERRM = 'calendar booking submission claim mismatch' THEN
            RETURN 'claim_mismatch';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.oauth_063_reservation_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.complete_google_calendar_oauth_connection(
            '65000000-0000-4000-a063-000000000096',
            '10000000-0000-4000-a063-000000000091',
            '00000000-0000-4000-a063-000000000091',
            NULL,
            'calendar-provider-concurrency-a063.example.test',
            'reservation-first-oauth-access-a063',
            'reservation-first-oauth-refresh-a063',
            '2099-08-01 00:00:00+00',
            'reservation-first-switch@example.test',
            'secondary'
          );
          RETURN 'completed';
        EXCEPTION WHEN SQLSTATE '55P03' THEN
          IF SQLERRM = 'calendar_provider_oauth_namespace_busy' THEN
            RETURN 'namespace_busy';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.reserve_063_oauth_waiter()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id =>
              '40000000-0000-4000-a063-000000000099',
            p_starts_at => '2063-09-10 09:00:00+00',
            p_ends_at => '2063-09-10 09:30:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000099',
            p_google_calendar_id => 'secondary',
            p_event_summary => 'OAuth-first AI reservation',
            p_request_fingerprint => repeat('9', 64)
          );
          RETURN 'allowed';
        END;
        $function$;

        CREATE FUNCTION pg_temp.confirm_063_operation_loser()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000100';
          PERFORM public.confirm_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            replace(v_booking.id::text, '-', ''),
            '2063-09-10 22:15:00+00',
            '2063-09-10 22:45:00+00',
            v_booking.operation_claim_token
          );
          RETURN 'confirmed';
        EXCEPTION WHEN SQLSTATE '23P01' THEN
          IF SQLERRM = 'calendar_booking_slot_unavailable' THEN
            RETURN 'slot_unavailable';
          END IF;
          RAISE;
        END;
        $function$;

        CREATE FUNCTION pg_temp.confirm_063_finalize_waiter()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000100';
          PERFORM public.confirm_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            replace(v_booking.id::text, '-', ''),
            '2063-09-10 22:15:00+00',
            '2063-09-10 22:45:00+00',
            v_booking.operation_claim_token
          );
          RETURN 'confirmed';
        EXCEPTION WHEN SQLSTATE '23P01' THEN
          IF SQLERRM = 'calendar_booking_slot_unavailable' THEN
            RETURN 'slot_unavailable';
          END IF;
          RAISE;
        END;
        $function$;
      $helpers_sql$
    );

    -- Keep the business mutex outside the caught finalization subtransaction.
    -- This proves that a conflicting provider-applied interval remains
    -- authoritative while a concurrent AI confirmation waits and refreshes.
    PERFORM extensions.dblink_exec(
      'calendar_063_worker_a',
      $finalize_helper_sql$
        CREATE FUNCTION pg_temp.finalize_063_confirm_conflict()
        RETURNS text
        LANGUAGE plpgsql
        SET search_path = public, pg_temp
        AS $function$
        BEGIN
          PERFORM 1
          FROM public.businesses AS business
          WHERE business.id =
                '10000000-0000-4000-a063-000000000091'
          FOR UPDATE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'calendar provider test business missing';
          END IF;

          BEGIN
            PERFORM public.finalize_calendar_provider_operation(
              '10000000-0000-4000-a063-000000000091',
              '63000000-0000-4000-a063-000000000100'
            );
            RETURN 'finalized';
          EXCEPTION WHEN SQLSTATE '23P01' THEN
            IF SQLERRM = 'calendar_provider_finalize_conflict' THEN
              RETURN 'finalize_conflict';
            END IF;
            RAISE;
          END;
        END;
        $function$;
      $finalize_helper_sql$
    );

    -- Provider operation wins before an OAuth callback that tries to switch
    -- Google identity. The callback waits, then rejects the namespace change.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $operation_oauth_winner$
        SELECT operation.id
        FROM public.acquire_calendar_provider_operation(
          p_operation_id => '63000000-0000-4000-a063-000000000088',
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_operation_kind => 'create',
          p_google_calendar_id => 'primary',
          p_starts_at => '2063-09-10 12:00:00+00',
          p_ends_at => '2063-09-10 12:30:00+00',
          p_linked_booking_id => NULL,
          p_deterministic_google_event_id => 'abcde0630000088',
          p_target_google_event_id => NULL,
          p_request_fingerprint => repeat('e', 64),
          p_claim_token => '63100000-0000-4000-a063-000000000088'
        ) AS operation
      $operation_oauth_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.oauth_063_operation_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('operation_oauth_send', v_send),
      ('operation_oauth_busy', v_busy),
      (
        'operation_oauth_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000088'
            AND operation.status = 'holding'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('operation_oauth_outcome', v_outcome),
      (
        'operation_oauth_namespace',
        (
          SELECT lower(btrim(token.google_email)) || '|' || token.calendar_id
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_operation_oauth$
        DO $release$
        BEGIN
          PERFORM public.fail_calendar_provider_operation(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000088',
            '63100000-0000-4000-a063-000000000088',
            'operation-first OAuth race complete'
          );
        END;
        $release$;
      $release_operation_oauth$
    );

    -- OAuth callback wins and commits a new account/calendar namespace before
    -- provider acquisition. The waiting operation refreshes and starts only
    -- in the newly committed namespace.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.completed
    INTO v_boolean
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $oauth_operation_winner$
        SELECT public.complete_google_calendar_oauth_connection(
          '65000000-0000-4000-a063-000000000092',
          '10000000-0000-4000-a063-000000000091',
          '00000000-0000-4000-a063-000000000091',
          NULL,
          'calendar-provider-concurrency-a063.example.test',
          'callback-first-access-a063',
          'callback-first-refresh-a063',
          '2099-01-01 00:00:00+00',
          'switched-google-account@example.test',
          'secondary'
        ) AS completed
      $oauth_operation_winner$
    ) AS result(completed boolean);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.acquire_063_callback_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('oauth_operation_send', v_send),
      ('oauth_operation_busy', v_busy),
      (
        'oauth_operation_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000089'
            AND operation.status = 'holding'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('oauth_operation_outcome', v_outcome),
      (
        'oauth_operation_namespace',
        (
          SELECT lower(btrim(token.google_email)) || '|' || token.calendar_id
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, boolean_value)
    VALUES ('oauth_operation_completed', v_boolean);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_oauth_operation$
        DO $release$
        BEGIN
          PERFORM public.fail_calendar_provider_operation(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000089',
            '63100000-0000-4000-a063-000000000089',
            'OAuth-first operation race complete'
          );
          UPDATE public.google_calendar_tokens
          SET access_token = 'fixture-access-a063-91',
              refresh_token = 'fixture-refresh-a063-91',
              google_email =
                'calendar-provider-concurrency-a063@example.test',
              calendar_id = 'primary',
              updated_at = '2063-01-01 00:00:00+00'
          WHERE business_id =
                '10000000-0000-4000-a063-000000000091';
        END;
        $release$;
      $release_oauth_operation$
    );

    -- OAuth replacement commits before a refresh persistence result returns.
    -- The waiting stale CAS must observe the rotated generation and no-op.
    SELECT token.credential_version
    INTO v_expected_version
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = '10000000-0000-4000-a063-000000000091';

    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.completed
    INTO v_boolean
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $oauth_refresh_late_winner$
        SELECT public.complete_google_calendar_oauth_connection(
          '65000000-0000-4000-a063-000000000093',
          '10000000-0000-4000-a063-000000000091',
          '00000000-0000-4000-a063-000000000091',
          NULL,
          'calendar-provider-concurrency-a063.example.test',
          'replacement-before-refresh-access-a063',
          'replacement-before-refresh-secret-a063',
          '2099-03-01 00:00:00+00',
          'replacement-before-refresh@example.test',
          'secondary'
        ) AS completed
      $oauth_refresh_late_winner$
    ) AS result(completed boolean);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      format(
        'SELECT public.persist_google_calendar_token_refresh_if_unchanged(%L::uuid, %L::uuid, %L, %L::timestamptz)',
        '10000000-0000-4000-a063-000000000091',
        v_expected_version,
        'stale-refresh-access-must-not-win-a063',
        '2099-04-01 00:00:00+00'
      )
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.persisted
    INTO v_boolean_two
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(persisted boolean);
    BEGIN
      PERFORM result.persisted
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(persisted boolean);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('oauth_refresh_late_send', v_send),
      ('oauth_refresh_late_busy', v_busy);
    INSERT INTO calendar_063_concurrency_state (key, boolean_value) VALUES
      ('oauth_refresh_late_completed', v_boolean),
      ('oauth_refresh_late_persisted', v_boolean_two),
      (
        'oauth_refresh_late_version_rotated',
        (
          SELECT token.credential_version IS DISTINCT FROM v_expected_version
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES (
      'oauth_refresh_late_state',
      (
        SELECT token.access_token || '|' || token.refresh_token || '|' ||
               token.google_email || '|' || token.calendar_id
        FROM public.google_calendar_tokens AS token
        WHERE token.business_id =
              '10000000-0000-4000-a063-000000000091'
      )
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $restore_after_oauth_refresh_late$
        UPDATE public.google_calendar_tokens
        SET access_token = 'fixture-access-a063-91',
            refresh_token = 'fixture-refresh-a063-91',
            token_expiry = '2099-01-01 00:00:00+00',
            google_email =
              'calendar-provider-concurrency-a063@example.test',
            calendar_id = 'primary',
            credential_version = gen_random_uuid(),
            updated_at = '2063-01-01 00:00:00+00'
        WHERE business_id =
              '10000000-0000-4000-a063-000000000091';
      $restore_after_oauth_refresh_late$
    );

    -- OAuth replacement also wins against a late definitive-invalid result:
    -- conditional disconnect waits and cannot delete the new generation.
    SELECT token.credential_version
    INTO v_expected_version
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = '10000000-0000-4000-a063-000000000091';

    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.completed
    INTO v_boolean
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $oauth_disconnect_late_winner$
        SELECT public.complete_google_calendar_oauth_connection(
          '65000000-0000-4000-a063-000000000094',
          '10000000-0000-4000-a063-000000000091',
          '00000000-0000-4000-a063-000000000091',
          NULL,
          'calendar-provider-concurrency-a063.example.test',
          'replacement-before-disconnect-access-a063',
          'replacement-before-disconnect-secret-a063',
          '2099-05-01 00:00:00+00',
          'replacement-before-disconnect@example.test',
          'secondary'
        ) AS completed
      $oauth_disconnect_late_winner$
    ) AS result(completed boolean);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      format(
        'SELECT public.disconnect_google_calendar_token_if_unchanged(%L::uuid, %L::uuid)',
        '10000000-0000-4000-a063-000000000091',
        v_expected_version
      )
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.disconnected
    INTO v_boolean_two
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(disconnected boolean);
    BEGIN
      PERFORM result.disconnected
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(disconnected boolean);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('oauth_disconnect_late_send', v_send),
      ('oauth_disconnect_late_busy', v_busy);
    INSERT INTO calendar_063_concurrency_state (key, boolean_value) VALUES
      ('oauth_disconnect_late_completed', v_boolean),
      ('oauth_disconnect_late_disconnected', v_boolean_two),
      (
        'oauth_disconnect_late_version_rotated',
        (
          SELECT token.credential_version IS DISTINCT FROM v_expected_version
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES (
      'oauth_disconnect_late_state',
      (
        SELECT token.access_token || '|' || token.refresh_token || '|' ||
               token.google_email || '|' || token.calendar_id
        FROM public.google_calendar_tokens AS token
        WHERE token.business_id =
              '10000000-0000-4000-a063-000000000091'
      )
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $restore_after_oauth_disconnect_late$
        UPDATE public.google_calendar_tokens
        SET access_token = 'fixture-access-a063-91',
            refresh_token = 'fixture-refresh-a063-91',
            token_expiry = '2099-01-01 00:00:00+00',
            google_email =
              'calendar-provider-concurrency-a063@example.test',
            calendar_id = 'primary',
            credential_version = gen_random_uuid(),
            updated_at = '2063-01-01 00:00:00+00'
        WHERE business_id =
              '10000000-0000-4000-a063-000000000091';
      $restore_after_oauth_disconnect_late$
    );

    -- Refresh persistence wins the mutex first. OAuth replacement waits,
    -- then rotates the refreshed generation and remains final authority.
    SELECT token.credential_version
    INTO v_expected_version
    FROM public.google_calendar_tokens AS token
    WHERE token.business_id = '10000000-0000-4000-a063-000000000091';

    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.persisted
    INTO v_boolean
    FROM extensions.dblink(
      'calendar_063_worker_a',
      format(
        'SELECT public.persist_google_calendar_token_refresh_if_unchanged(%L::uuid, %L::uuid, %L, %L::timestamptz)',
        '10000000-0000-4000-a063-000000000091',
        v_expected_version,
        'refresh-first-access-a063',
        '2099-06-01 00:00:00+00'
      )
    ) AS result(persisted boolean);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      $refresh_oauth_waiter$
        SELECT public.complete_google_calendar_oauth_connection(
          '65000000-0000-4000-a063-000000000095',
          '10000000-0000-4000-a063-000000000091',
          '00000000-0000-4000-a063-000000000091',
          NULL,
          'calendar-provider-concurrency-a063.example.test',
          'replacement-after-refresh-access-a063',
          'replacement-after-refresh-secret-a063',
          '2099-07-01 00:00:00+00',
          'replacement-after-refresh@example.test',
          'secondary'
        )
      $refresh_oauth_waiter$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.completed
    INTO v_boolean_two
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(completed boolean);
    BEGIN
      PERFORM result.completed
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(completed boolean);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('refresh_oauth_send', v_send),
      ('refresh_oauth_busy', v_busy);
    INSERT INTO calendar_063_concurrency_state (key, boolean_value) VALUES
      ('refresh_oauth_persisted', v_boolean),
      ('refresh_oauth_completed', v_boolean_two),
      (
        'refresh_oauth_version_rotated',
        (
          SELECT token.credential_version IS DISTINCT FROM v_expected_version
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES (
      'refresh_oauth_state',
      (
        SELECT token.access_token || '|' || token.refresh_token || '|' ||
               token.google_email || '|' || token.calendar_id
        FROM public.google_calendar_tokens AS token
        WHERE token.business_id =
              '10000000-0000-4000-a063-000000000091'
      )
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $restore_after_refresh_oauth$
        UPDATE public.google_calendar_tokens
        SET access_token = 'fixture-access-a063-91',
            refresh_token = 'fixture-refresh-a063-91',
            token_expiry = '2099-01-01 00:00:00+00',
            google_email =
              'calendar-provider-concurrency-a063@example.test',
            calendar_id = 'primary',
            credential_version = gen_random_uuid(),
            updated_at = '2063-01-01 00:00:00+00'
        WHERE business_id =
              '10000000-0000-4000-a063-000000000091';
      $restore_after_refresh_oauth$
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $seed_submission_fence_bookings_sql$
        DO $seed_submission_fence_bookings$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          v_booking := public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id => '40000000-0000-4000-a063-000000000096',
            p_starts_at => '2063-09-10 10:00:00+00',
            p_ends_at => '2063-09-10 10:30:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000096',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Worker-first submission fence',
            p_request_fingerprint => repeat('6', 64)
          );
          UPDATE public.calendar_bookings
          SET operation_claimed_at = '2000-01-01 00:00:00+00'
          WHERE id = v_booking.id;

          v_booking := public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id => '40000000-0000-4000-a063-000000000097',
            p_starts_at => '2063-09-10 11:00:00+00',
            p_ends_at => '2063-09-10 11:30:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000097',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Reconciler-first submission fence',
            p_request_fingerprint => repeat('7', 64)
          );
          UPDATE public.calendar_bookings
          SET operation_claimed_at = '2000-01-01 00:00:00+00'
          WHERE id = v_booking.id;
        END;
        $seed_submission_fence_bookings$;
      $seed_submission_fence_bookings_sql$
    );

    -- The original AI worker reaches the exact side-effect fence first. Its
    -- renewed claimed-at timestamp makes the waiting reconciler ineligible.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $worker_submission_winner$
        SELECT (
          public.mark_calendar_booking_submission_started(
            booking.business_id,
            booking.id,
            booking.operation_claim_token,
            '2000-01-01 00:00:00+00'
          )
        ).id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
              '40000000-0000-4000-a063-000000000096'
      $worker_submission_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.claim_063_worker_first_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('worker_submission_send', v_send),
      ('worker_submission_busy', v_busy),
      (
        'worker_submission_reconciliation_count',
        (
          SELECT booking.reconciliation_attempt_count
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000096'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('worker_submission_outcome', v_outcome);
    INSERT INTO calendar_063_concurrency_state (key, boolean_value)
    VALUES (
      'worker_submission_claim_renewed',
      (
        SELECT booking.operation_claimed_at >
                 clock_timestamp() - interval '5 seconds'
           AND booking.operation_claim_token =
                 '50000000-0000-4000-a063-000000000096'::uuid
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
              '40000000-0000-4000-a063-000000000096'
      )
    );

    -- Maintenance reconciliation takes the mutex first for the second stale
    -- booking. The waiting original worker loses its exact claimed-at CAS.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $reconciler_submission_winner$
        SELECT (
          public.claim_calendar_booking_reconciliation(
            booking.business_id,
            booking.id,
            booking.operation_claim_token
          )
        ).id
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
              '40000000-0000-4000-a063-000000000097'
      $reconciler_submission_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.mark_063_reconciler_first_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('reconciler_submission_send', v_send),
      ('reconciler_submission_busy', v_busy),
      (
        'reconciler_submission_reconciliation_count',
        (
          SELECT booking.reconciliation_attempt_count
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000097'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('reconciler_submission_outcome', v_outcome);
    INSERT INTO calendar_063_concurrency_state (key, boolean_value)
    VALUES (
      'reconciler_submission_claim_rotated',
      (
        SELECT booking.operation_claimed_at >
                 '2000-01-01 00:00:00+00'::timestamptz
           AND booking.operation_claim_token =
                 '50000000-0000-4000-a063-000000000097'::uuid
        FROM public.calendar_bookings AS booking
        WHERE booking.source_message_id =
              '40000000-0000-4000-a063-000000000097'
      )
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_submission_fence_bookings_sql$
        DO $release_submission_fence_bookings$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          FOR v_booking IN
            SELECT booking.*
            FROM public.calendar_bookings AS booking
            WHERE booking.source_message_id IN (
              '40000000-0000-4000-a063-000000000096',
              '40000000-0000-4000-a063-000000000097'
            )
          LOOP
            PERFORM public.fail_calendar_booking(
              v_booking.business_id,
              v_booking.id,
              v_booking.operation_claim_token,
              'submission-fence race complete'
            );
          END LOOP;
        END;
        $release_submission_fence_bookings$;
      $release_submission_fence_bookings_sql$
    );

    -- AI reservation commits first. The OAuth callback waits, then cannot
    -- replace the account/calendar namespace beneath pending provider work.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $reservation_oauth_winner$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_contact_id => '20000000-0000-4000-a063-000000000091',
          p_conversation_id => '30000000-0000-4000-a063-000000000091',
          p_source_message_id => '40000000-0000-4000-a063-000000000098',
          p_starts_at => '2063-09-10 08:00:00+00',
          p_ends_at => '2063-09-10 08:30:00+00',
          p_claim_token => '50000000-0000-4000-a063-000000000098',
          p_google_calendar_id => 'primary',
          p_event_summary => 'Reservation-first OAuth race',
          p_request_fingerprint => repeat('8', 64)
        ) AS booking
      $reservation_oauth_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.oauth_063_reservation_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('reservation_oauth_send', v_send),
      ('reservation_oauth_busy', v_busy),
      (
        'reservation_oauth_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000098'
            AND booking.status = 'pending'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('reservation_oauth_outcome', v_outcome),
      (
        'reservation_oauth_namespace',
        (
          SELECT token.google_email || '|' || token.calendar_id
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_reservation_oauth_sql$
        DO $release_reservation_oauth$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000098';
          PERFORM public.fail_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            'reservation-first OAuth race complete'
          );
        END;
        $release_reservation_oauth$;
      $release_reservation_oauth_sql$
    );

    -- OAuth callback commits a new namespace first. The waiting reservation
    -- refreshes after the business mutex and writes only in that namespace.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.completed
    INTO v_boolean
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $oauth_reservation_winner$
        SELECT public.complete_google_calendar_oauth_connection(
          '65000000-0000-4000-a063-000000000097',
          '10000000-0000-4000-a063-000000000091',
          '00000000-0000-4000-a063-000000000091',
          NULL,
          'calendar-provider-concurrency-a063.example.test',
          'oauth-before-reservation-access-a063',
          'oauth-before-reservation-refresh-a063',
          '2099-09-01 00:00:00+00',
          'oauth-before-reservation@example.test',
          'secondary'
        ) AS completed
      $oauth_reservation_winner$
    ) AS result(completed boolean);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.reserve_063_oauth_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('oauth_reservation_send', v_send),
      ('oauth_reservation_busy', v_busy),
      (
        'oauth_reservation_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000099'
            AND booking.status = 'pending'
            AND booking.google_calendar_id = 'secondary'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('oauth_reservation_outcome', v_outcome),
      (
        'oauth_reservation_namespace',
        (
          SELECT token.google_email || '|' || token.calendar_id
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, boolean_value)
    VALUES ('oauth_reservation_completed', v_boolean);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_oauth_reservation_sql$
        DO $release_oauth_reservation$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000099';
          PERFORM public.fail_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            'OAuth-first reservation race complete'
          );
          UPDATE public.google_calendar_tokens
          SET access_token = 'fixture-access-a063-91',
              refresh_token = 'fixture-refresh-a063-91',
              token_expiry = '2099-01-01 00:00:00+00',
              google_email =
                'calendar-provider-concurrency-a063@example.test',
              calendar_id = 'primary',
              updated_at = '2063-01-01 00:00:00+00'
          WHERE business_id =
                '10000000-0000-4000-a063-000000000091';
        END;
        $release_oauth_reservation$;
      $release_oauth_reservation_sql$
    );

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $seed_confirm_operation_race_sql$
        DO $seed_confirm_operation_race$
        BEGIN
          PERFORM public.reserve_calendar_booking(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_contact_id => '20000000-0000-4000-a063-000000000091',
            p_conversation_id => '30000000-0000-4000-a063-000000000091',
            p_source_message_id => '40000000-0000-4000-a063-000000000100',
            p_starts_at => '2063-09-10 22:00:00+00',
            p_ends_at => '2063-09-10 22:30:00+00',
            p_claim_token => '50000000-0000-4000-a063-000000000100',
            p_google_calendar_id => 'primary',
            p_event_summary => 'Provider-shifted confirmation race',
            p_request_fingerprint => repeat('a', 64)
          );
        END;
        $seed_confirm_operation_race$;
      $seed_confirm_operation_race_sql$
    );

    -- A dashboard operation reaches provider-applied first with Google-returned
    -- times shifted into the pending booking. Confirmation waits, refreshes,
    -- and rejects the committed target/slot authority.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'calendar_063_worker_a',
      $provider_applied_confirm_winner_sql$
        DO $provider_applied_confirm_winner$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000100',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'create',
            p_google_calendar_id => 'primary',
            p_starts_at => '2063-09-10 23:00:00+00',
            p_ends_at => '2063-09-10 23:30:00+00',
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => 'abcde0630000100',
            p_target_google_event_id => NULL,
            p_request_fingerprint => repeat('b', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000100'
          );
          PERFORM public.mark_calendar_provider_submission_started(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000100',
            '63100000-0000-4000-a063-000000000100'
          );
          PERFORM public.mark_calendar_provider_operation_applied(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_id => '63000000-0000-4000-a063-000000000100',
            p_claim_token => '63100000-0000-4000-a063-000000000100',
            p_provider_event_id => 'abcde0630000100',
            p_provider_starts_at => '2063-09-10 22:15:00+00',
            p_provider_ends_at => '2063-09-10 22:45:00+00',
            p_provider_evidence => jsonb_build_object(
              'operation_marker_verified', true,
              'provider_status', 'confirmed',
              'provider_etag_sha256', repeat('a', 64)
            )
          );
        END;
        $provider_applied_confirm_winner$;
      $provider_applied_confirm_winner_sql$
    );

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.confirm_063_operation_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('provider_confirm_send', v_send),
      ('provider_confirm_busy', v_busy),
      (
        'provider_confirm_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000100'
            AND operation.status = 'provider_applied'
        )
      ),
      (
        'provider_confirm_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000100'
            AND booking.status = 'pending'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('provider_confirm_outcome', v_outcome);

    -- A finalization attempt takes the same business mutex but must remain
    -- fail-closed because the provider-returned interval overlaps the pending
    -- booking. The waiting confirmation refreshes and rejects that same
    -- shifted-slot authority after the mutex is released.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.outcome
    INTO v_text
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $finalize_confirm_winner$
        SELECT pg_temp.finalize_063_confirm_conflict()
      $finalize_confirm_winner$
    ) AS result(outcome text);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.confirm_063_finalize_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('finalize_confirm_send', v_send),
      ('finalize_confirm_busy', v_busy),
      (
        'finalize_confirm_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000100'
            AND operation.status = 'provider_applied'
        )
      ),
      (
        'finalize_confirm_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000100'
            AND booking.status = 'pending'
            AND booking.google_event_id IS NULL
            AND booking.starts_at = '2063-09-10 22:00:00+00'
            AND booking.ends_at = '2063-09-10 22:30:00+00'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES
      ('finalize_confirm_finalize_outcome', v_text),
      ('finalize_confirm_outcome', v_outcome);

    -- The fail-closed assertions above are now captured in local state. Remove
    -- only this scenario's unresolved provider operation and pending booking
    -- before later races reuse the shared business; production disconnect must
    -- continue to reject either row while it is live.
    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_confirm_race_sql$
        DO $release_confirm_race$
        DECLARE
          v_operations_deleted integer;
          v_bookings_deleted integer;
        BEGIN
          DELETE FROM public.calendar_provider_operations
          WHERE id = '63000000-0000-4000-a063-000000000100'
            AND business_id =
                  '10000000-0000-4000-a063-000000000091';
          GET DIAGNOSTICS v_operations_deleted = ROW_COUNT;

          DELETE FROM public.calendar_bookings
          WHERE business_id =
                  '10000000-0000-4000-a063-000000000091'
            AND source_message_id =
                  '40000000-0000-4000-a063-000000000100';
          GET DIAGNOSTICS v_bookings_deleted = ROW_COUNT;

          IF v_operations_deleted <> 1 OR v_bookings_deleted <> 1 THEN
            RAISE EXCEPTION
              'calendar provider confirmation race cleanup mismatch';
          END IF;
        END;
        $release_confirm_race$;
      $release_confirm_race_sql$
    );

    -- Dashboard acquisition commits first. The waiting AI reservation must
    -- refresh after the business lock and observe the durable slot hold.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $dashboard_slot_winner$
        SELECT operation.id
        FROM public.acquire_calendar_provider_operation(
          p_operation_id => '63000000-0000-4000-a063-000000000091',
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_operation_kind => 'create',
          p_google_calendar_id => 'primary',
          p_starts_at => '2063-09-10 14:00:00+00',
          p_ends_at => '2063-09-10 14:30:00+00',
          p_linked_booking_id => NULL,
          p_deterministic_google_event_id => 'abcde0630000091',
          p_target_google_event_id => NULL,
          p_request_fingerprint => repeat('a', 64),
          p_claim_token => '63100000-0000-4000-a063-000000000091'
        ) AS operation
      $dashboard_slot_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.reserve_063_dashboard_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('dashboard_slot_send', v_send),
      ('dashboard_slot_busy', v_busy),
      (
        'dashboard_slot_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000091'
            AND operation.status = 'holding'
        )
      ),
      (
        'dashboard_slot_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000091'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('dashboard_slot_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_dashboard_slot$
        DO $release$
        BEGIN
          PERFORM public.fail_calendar_provider_operation(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000091',
            '63100000-0000-4000-a063-000000000091',
            'dashboard slot race complete'
          );
        END;
        $release$;
      $release_dashboard_slot$
    );

    -- AI reservation commits first. The waiting dashboard create must refresh
    -- after the same business lock and lose to the pending local interval.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $ai_slot_winner$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_contact_id => '20000000-0000-4000-a063-000000000091',
          p_conversation_id => '30000000-0000-4000-a063-000000000091',
          p_source_message_id => '40000000-0000-4000-a063-000000000092',
          p_starts_at => '2063-09-10 15:10:00+00',
          p_ends_at => '2063-09-10 15:20:00+00',
          p_claim_token => '50000000-0000-4000-a063-000000000092',
          p_google_calendar_id => 'primary',
          p_event_summary => 'AI slot winner',
          p_request_fingerprint => repeat('b', 64)
        ) AS booking
      $ai_slot_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.acquire_063_ai_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('ai_slot_send', v_send),
      ('ai_slot_busy', v_busy),
      (
        'ai_slot_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000092'
            AND booking.status = 'pending'
        )
      ),
      (
        'ai_slot_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000092'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('ai_slot_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_ai_slot$
        DO $release$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000092';
          PERFORM public.fail_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            'AI slot race complete'
          );
        END;
        $release$;
      $release_ai_slot$
    );

    -- A deterministic CREATE target and DELETE share one target mutex. The
    -- delete waits on the business row, then observes the committed create.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $create_target_winner$
        SELECT operation.id
        FROM public.acquire_calendar_provider_operation(
          p_operation_id => '63000000-0000-4000-a063-000000000093',
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_operation_kind => 'create',
          p_google_calendar_id => 'primary',
          p_starts_at => '2063-09-10 16:00:00+00',
          p_ends_at => '2063-09-10 16:30:00+00',
          p_linked_booking_id => NULL,
          p_deterministic_google_event_id => 'abcde0630000093',
          p_target_google_event_id => NULL,
          p_request_fingerprint => repeat('c', 64),
          p_claim_token => '63100000-0000-4000-a063-000000000093'
        ) AS operation
      $create_target_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.acquire_063_target_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('target_send', v_send),
      ('target_busy', v_busy),
      (
        'target_live_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.business_id =
                '10000000-0000-4000-a063-000000000091'
            AND operation.google_calendar_id = 'primary'
            AND operation.provider_target_event_id = 'abcde0630000093'
            AND operation.status IN ('holding', 'provider_applied')
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('target_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_target$
        DO $release$
        BEGIN
          PERFORM public.fail_calendar_provider_operation(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000093',
            '63100000-0000-4000-a063-000000000093',
            'target race complete'
          );
        END;
        $release$;
      $release_target$
    );

    -- Seed durable applied evidence, then let finalization win the business
    -- mutex. The waiting reservation refreshes and proceeds only after the
    -- operation is finalized and no longer unresolved authority.
    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $seed_applied_operation$
        DO $seed$
        BEGIN
          PERFORM public.acquire_calendar_provider_operation(
            p_operation_id => '63000000-0000-4000-a063-000000000095',
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_kind => 'create',
            p_google_calendar_id => 'primary',
            p_starts_at => '2063-09-10 17:00:00+00',
            p_ends_at => '2063-09-10 17:30:00+00',
            p_linked_booking_id => NULL,
            p_deterministic_google_event_id => 'abcde0630000095',
            p_target_google_event_id => NULL,
            p_request_fingerprint => repeat('e', 64),
            p_claim_token => '63100000-0000-4000-a063-000000000095'
          );
          PERFORM public.mark_calendar_provider_submission_started(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000095',
            '63100000-0000-4000-a063-000000000095'
          );
          PERFORM public.mark_calendar_provider_operation_applied(
            p_business_id => '10000000-0000-4000-a063-000000000091',
            p_operation_id => '63000000-0000-4000-a063-000000000095',
            p_claim_token => '63100000-0000-4000-a063-000000000095',
            p_provider_event_id => 'abcde0630000095',
            p_provider_starts_at => '2063-09-10 17:00:00+00',
            p_provider_ends_at => '2063-09-10 17:30:00+00',
            p_provider_evidence => jsonb_build_object(
              'operation_marker_verified', true,
              'provider_status', 'confirmed',
              'provider_etag_sha256', repeat('f', 64)
            )
          );
        END;
        $seed$;
      $seed_applied_operation$
    );

    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $finalize_winner$
        SELECT operation.id
        FROM public.finalize_calendar_provider_operation(
          '10000000-0000-4000-a063-000000000091',
          '63000000-0000-4000-a063-000000000095'
        ) AS operation
      $finalize_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.reserve_063_finalize_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('finalize_send', v_send),
      ('finalize_busy', v_busy),
      (
        'finalize_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000095'
            AND operation.status = 'finalized'
        )
      ),
      (
        'finalize_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000093'
            AND booking.status = 'pending'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('finalize_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_finalize_booking$
        DO $release$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000093';
          PERFORM public.fail_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            'finalize race complete'
          );
        END;
        $release$;
      $release_finalize_booking$
    );

    -- Dashboard operation wins before disconnect. Disconnect waits, then sees
    -- the committed holding row and preserves the credential.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $dashboard_disconnect_winner$
        SELECT operation.id
        FROM public.acquire_calendar_provider_operation(
          p_operation_id => '63000000-0000-4000-a063-000000000096',
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_operation_kind => 'create',
          p_google_calendar_id => 'primary',
          p_starts_at => '2063-09-10 18:00:00+00',
          p_ends_at => '2063-09-10 18:30:00+00',
          p_linked_booking_id => NULL,
          p_deterministic_google_event_id => 'abcde0630000096',
          p_target_google_event_id => NULL,
          p_request_fingerprint => repeat('f', 64),
          p_claim_token => '63100000-0000-4000-a063-000000000096'
        ) AS operation
      $dashboard_disconnect_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.disconnect_063_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('dashboard_disconnect_send', v_send),
      ('dashboard_disconnect_busy', v_busy),
      (
        'dashboard_disconnect_token_count',
        (
          SELECT count(*)::integer
          FROM public.google_calendar_tokens AS token
          WHERE token.id = '62000000-0000-4000-a063-000000000091'
        )
      ),
      (
        'dashboard_disconnect_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000096'
            AND operation.status = 'holding'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('dashboard_disconnect_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_dashboard_disconnect$
        DO $release$
        BEGIN
          PERFORM public.fail_calendar_provider_operation(
            '10000000-0000-4000-a063-000000000091',
            '63000000-0000-4000-a063-000000000096',
            '63100000-0000-4000-a063-000000000096',
            'dashboard disconnect race complete'
          );
        END;
        $release$;
      $release_dashboard_disconnect$
    );

    -- Disconnect wins before dashboard acquisition. The waiting acquire must
    -- refresh its post-lock token snapshot and reject new provider work.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.access_token
    INTO v_text
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $disconnect_dashboard_winner$
        SELECT public.disconnect_google_calendar_token(
          '10000000-0000-4000-a063-000000000091'
        ) AS access_token
      $disconnect_dashboard_winner$
    ) AS result(access_token text);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.acquire_063_disconnect_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('disconnect_dashboard_send', v_send),
      ('disconnect_dashboard_busy', v_busy),
      (
        'disconnect_dashboard_token_count',
        (
          SELECT count(*)::integer
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      ),
      (
        'disconnect_dashboard_operation_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_provider_operations AS operation
          WHERE operation.id = '63000000-0000-4000-a063-000000000097'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('disconnect_dashboard_token', v_text),
      ('disconnect_dashboard_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $restore_after_dashboard_disconnect$
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
          '62000000-0000-4000-a063-000000000091',
          '10000000-0000-4000-a063-000000000091',
          'fixture-access-a063-91',
          'fixture-refresh-a063-91',
          '2099-01-01 00:00:00+00',
          'primary',
          'calendar-provider-concurrency-a063@example.test',
          '2063-01-01 00:00:00+00',
          '2063-01-01 00:00:00+00'
        );
      $restore_after_dashboard_disconnect$
    );

    -- AI reservation wins before disconnect. Disconnect waits, sees the
    -- committed pending booking, and must preserve both booking and token.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    PERFORM result.id
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $ai_disconnect_winner$
        SELECT booking.id
        FROM public.reserve_calendar_booking(
          p_business_id => '10000000-0000-4000-a063-000000000091',
          p_contact_id => '20000000-0000-4000-a063-000000000091',
          p_conversation_id => '30000000-0000-4000-a063-000000000091',
          p_source_message_id => '40000000-0000-4000-a063-000000000094',
          p_starts_at => '2063-09-10 20:00:00+00',
          p_ends_at => '2063-09-10 20:30:00+00',
          p_claim_token => '50000000-0000-4000-a063-000000000094',
          p_google_calendar_id => 'primary',
          p_event_summary => 'AI disconnect winner',
          p_request_fingerprint => repeat('c', 64)
        ) AS booking
      $ai_disconnect_winner$
    ) AS result(id uuid);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.disconnect_063_waiter()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('ai_disconnect_send', v_send),
      ('ai_disconnect_busy', v_busy),
      (
        'ai_disconnect_token_count',
        (
          SELECT count(*)::integer
          FROM public.google_calendar_tokens AS token
          WHERE token.id = '62000000-0000-4000-a063-000000000091'
        )
      ),
      (
        'ai_disconnect_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000094'
            AND booking.status = 'pending'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value)
    VALUES ('ai_disconnect_outcome', v_outcome);

    PERFORM extensions.dblink_exec(
      'calendar_063_setup',
      $release_ai_disconnect$
        DO $release$
        DECLARE
          v_booking public.calendar_bookings;
        BEGIN
          SELECT booking.*
          INTO v_booking
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000094';
          PERFORM public.fail_calendar_booking(
            v_booking.business_id,
            v_booking.id,
            v_booking.operation_claim_token,
            'AI disconnect race complete'
          );
        END;
        $release$;
      $release_ai_disconnect$
    );

    -- Disconnect wins before AI reservation. The waiting reservation must use
    -- a fresh credential snapshot after the shared business mutex releases.
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'BEGIN');
    SELECT result.access_token
    INTO v_text
    FROM extensions.dblink(
      'calendar_063_worker_a',
      $disconnect_ai_winner$
        SELECT public.disconnect_google_calendar_token(
          '10000000-0000-4000-a063-000000000091'
        ) AS access_token
      $disconnect_ai_winner$
    ) AS result(access_token text);

    v_send := extensions.dblink_send_query(
      'calendar_063_worker_b',
      'SELECT pg_temp.reserve_063_disconnect_loser()'
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('calendar_063_worker_b');
    PERFORM extensions.dblink_exec('calendar_063_worker_a', 'COMMIT');

    SELECT result.outcome
    INTO v_outcome
    FROM extensions.dblink_get_result('calendar_063_worker_b', false)
      AS result(outcome text);
    BEGIN
      PERFORM result.outcome
      FROM extensions.dblink_get_result('calendar_063_worker_b', false)
        AS result(outcome text);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('calendar_063_worker_b', 'COMMIT');

    INSERT INTO calendar_063_concurrency_state (key, integer_value) VALUES
      ('disconnect_ai_send', v_send),
      ('disconnect_ai_busy', v_busy),
      (
        'disconnect_ai_token_count',
        (
          SELECT count(*)::integer
          FROM public.google_calendar_tokens AS token
          WHERE token.business_id =
                '10000000-0000-4000-a063-000000000091'
        )
      ),
      (
        'disconnect_ai_booking_count',
        (
          SELECT count(*)::integer
          FROM public.calendar_bookings AS booking
          WHERE booking.source_message_id =
                '40000000-0000-4000-a063-000000000095'
        )
      );
    INSERT INTO calendar_063_concurrency_state (key, text_value) VALUES
      ('disconnect_ai_token', v_text),
      ('disconnect_ai_outcome', v_outcome);
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      PERFORM pg_temp.cleanup_063_calendar_provider_concurrency();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING
        'test_063_calendar_provider_concurrency_finally_failed [%] %',
        SQLSTATE,
        SQLERRM;
    END;
    RAISE;
  END;

  v_cleanup_ok := pg_temp.cleanup_063_calendar_provider_concurrency();
  INSERT INTO calendar_063_concurrency_state (key, boolean_value)
  VALUES ('cleanup_ok', v_cleanup_ok);
END;
$orchestrate_calendar_provider_races$;

-- 1
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_slot_send'),
  1,
  'the dashboard-first slot race is dispatched'
);

-- 2
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_slot_busy'),
  1,
  'AI reservation waits while dashboard acquisition owns the business mutex'
);

-- 3
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_slot_outcome'),
  'slot_unavailable',
  'AI reservation loses after refreshing the committed dashboard hold'
);

-- 4
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_slot_operation_count'),
  1,
  'dashboard-first race persists exactly one holding operation'
);

-- 5
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_slot_booking_count'),
  0,
  'dashboard-first race leaves no losing AI booking row'
);

-- 6
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_slot_send'),
  1,
  'the AI-first slot race is dispatched'
);

-- 7
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_slot_busy'),
  1,
  'dashboard acquisition waits while AI reservation owns the business mutex'
);

-- 8
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_slot_outcome'),
  'slot_unavailable',
  'dashboard create loses after refreshing the committed AI interval'
);

-- 9
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_slot_booking_count'),
  1,
  'AI-first race persists exactly one pending booking winner'
);

-- 10
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_slot_operation_count'),
  0,
  'AI-first race leaves no losing dashboard operation row'
);

-- 11
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'target_send'),
  1,
  'the unified provider-target race is dispatched'
);

-- 12
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'target_busy'),
  1,
  'delete waits while deterministic create owns the business mutex'
);

-- 13
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'target_outcome'),
  'busy',
  'delete loses to the committed deterministic create target'
);

-- 14
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'target_live_count'),
  1,
  'create/delete race leaves exactly one live authority for the provider target'
);

-- 15
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_send'),
  1,
  'the provider-finalize versus reservation race is dispatched'
);

-- 16
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_busy'),
  1,
  'reservation waits while applied evidence finalizes under the business mutex'
);

-- 17
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_outcome'),
  'allowed',
  'reservation proceeds only after observing the committed finalized state'
);

-- 18
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_operation_count'),
  1,
  'finalization race persists the provider evidence exactly once'
);

-- 19
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_booking_count'),
  1,
  'post-finalization waiter creates exactly one AI reservation'
);

-- 20
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_disconnect_send'),
  1,
  'the dashboard-first disconnect race is dispatched'
);

-- 21
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_disconnect_busy'),
  1,
  'disconnect waits while dashboard acquisition owns the business mutex'
);

-- 22
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_disconnect_outcome'),
  'busy',
  'disconnect loses after observing committed dashboard authority'
);

-- 23
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_disconnect_token_count'),
  1,
  'dashboard-first disconnect race preserves the token row'
);

-- 24
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'dashboard_disconnect_operation_count'),
  1,
  'dashboard-first disconnect race preserves the holding operation'
);

-- 25
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_token'),
  'fixture-access-a063-91',
  'disconnect-first dashboard race removes the exact access token'
);

-- 26
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_send'),
  1,
  'the disconnect-first dashboard race is dispatched'
);

-- 27
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_busy'),
  1,
  'dashboard acquisition waits while disconnect owns the business mutex'
);

-- 28
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_outcome'),
  'business_unavailable',
  'dashboard acquisition rejects new work after refreshing credential state'
);

-- 29
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_token_count'),
  0,
  'disconnect-first dashboard race leaves no credential row'
);

-- 30
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_dashboard_operation_count'),
  0,
  'disconnect-first dashboard race leaves no provider intent'
);

-- 31
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_disconnect_send'),
  1,
  'the AI-first disconnect race is dispatched'
);

-- 32
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_disconnect_busy'),
  1,
  'disconnect waits while AI reservation owns the business mutex'
);

-- 33
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_disconnect_outcome'),
  'busy',
  'disconnect loses after observing the committed pending AI booking'
);

-- 34
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_disconnect_token_count'),
  1,
  'AI-first disconnect race preserves the token row'
);

-- 35
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'ai_disconnect_booking_count'),
  1,
  'AI-first disconnect race preserves the pending booking authority'
);

-- 36
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_ai_token'),
  'fixture-access-a063-91',
  'disconnect-first AI race removes the exact access token'
);

-- 37
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_ai_send'),
  1,
  'the disconnect-first AI race is dispatched'
);

-- 38
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_ai_busy'),
  1,
  'AI reservation waits while disconnect owns the business mutex'
);

-- 39
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_ai_outcome'),
  'business_inactive',
  'AI reservation rejects new work after refreshing credential state'
);

-- 40
SELECT ok(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'disconnect_ai_token_count') = 0
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'disconnect_ai_booking_count') = 0,
  'disconnect-first AI race leaves neither credentials nor a booking row'
);

-- 41
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'operation_oauth_send'),
  1,
  'the provider-operation-first OAuth race is dispatched'
);

-- 42
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'operation_oauth_busy'),
  1,
  'OAuth callback waits while provider acquisition owns the business mutex'
);

-- 43
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'operation_oauth_outcome'),
  'namespace_busy',
  'a waiting OAuth callback cannot switch namespace beneath committed work'
);

-- 44
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'operation_oauth_namespace'),
  'calendar-provider-concurrency-a063@example.test|primary',
  'operation-first rejection preserves the exact Google account and calendar'
);

-- 45
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'operation_oauth_operation_count'),
  1,
  'operation-first OAuth race preserves one holding provider operation'
);

-- 46
SELECT is(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_operation_completed'),
  true,
  'callback-first race commits the credential namespace replacement'
);

-- 47
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_operation_send'),
  1,
  'the OAuth-callback-first provider race is dispatched'
);

-- 48
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_operation_busy'),
  1,
  'provider acquisition waits while OAuth callback owns the business mutex'
);

-- 49
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_operation_outcome'),
  'allowed',
  'provider acquisition begins only after the callback namespace commits'
);

-- 50
SELECT ok(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_operation_namespace') =
      'switched-google-account@example.test|secondary'
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'oauth_operation_operation_count') = 1,
  'callback-first race binds the new operation to the committed namespace'
);

-- 50a
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_refresh_late_send'),
  1,
  'the OAuth-replacement-first stale-refresh race is dispatched'
);

-- 50b
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_refresh_late_busy'),
  1,
  'late refresh persistence waits while OAuth replacement owns the business mutex'
);

-- 50c
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_refresh_late_completed')
  AND NOT (SELECT boolean_value FROM calendar_063_concurrency_state
           WHERE key = 'oauth_refresh_late_persisted'),
  'OAuth replacement commits and the stale refresh CAS returns false'
);

-- 50d
SELECT ok(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_refresh_late_state') =
      'replacement-before-refresh-access-a063|replacement-before-refresh-secret-a063|replacement-before-refresh@example.test|secondary'
  AND (SELECT boolean_value FROM calendar_063_concurrency_state
       WHERE key = 'oauth_refresh_late_version_rotated'),
  'a late refresh cannot overwrite the replacement token or namespace generation'
);

-- 50e
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_disconnect_late_send'),
  1,
  'the OAuth-replacement-first stale-invalid-grant race is dispatched'
);

-- 50f
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_disconnect_late_busy'),
  1,
  'late conditional disconnect waits while OAuth replacement owns the mutex'
);

-- 50g
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_disconnect_late_completed')
  AND NOT (SELECT boolean_value FROM calendar_063_concurrency_state
           WHERE key = 'oauth_disconnect_late_disconnected'),
  'OAuth replacement commits and stale invalid-grant deletion returns false'
);

-- 50h
SELECT ok(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_disconnect_late_state') =
      'replacement-before-disconnect-access-a063|replacement-before-disconnect-secret-a063|replacement-before-disconnect@example.test|secondary'
  AND (SELECT boolean_value FROM calendar_063_concurrency_state
       WHERE key = 'oauth_disconnect_late_version_rotated'),
  'a late invalid-grant result cannot delete the replacement credential generation'
);

-- 50i
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'refresh_oauth_persisted')
  AND (SELECT boolean_value FROM calendar_063_concurrency_state
       WHERE key = 'refresh_oauth_completed'),
  'refresh-first ordering persists once before OAuth replacement serializes'
);

-- 50j
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'refresh_oauth_send'),
  1,
  'the refresh-first OAuth replacement race is dispatched'
);

-- 50k
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'refresh_oauth_busy'),
  1,
  'OAuth replacement waits while refresh persistence owns the business mutex'
);

-- 50l
SELECT ok(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'refresh_oauth_state') =
      'replacement-after-refresh-access-a063|replacement-after-refresh-secret-a063|replacement-after-refresh@example.test|secondary'
  AND (SELECT boolean_value FROM calendar_063_concurrency_state
       WHERE key = 'refresh_oauth_version_rotated'),
  'serialized OAuth replacement becomes final authority after refresh commits'
);

-- 50m
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'worker_submission_send'),
  1,
  'the AI-worker-first submission-fence race is dispatched'
);

-- 50n
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'worker_submission_busy'),
  1,
  'maintenance reconciliation waits while the AI worker renews its claim'
);

-- 50o
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'worker_submission_outcome'),
  'not_stale',
  'waiting reconciliation loses after observing the worker-renewed claim'
);

-- 50p
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'worker_submission_claim_renewed')
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'worker_submission_reconciliation_count') = 0,
  'worker-first ordering renews authority without a reconciliation attempt'
);

-- 50q
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'reconciler_submission_send'),
  1,
  'the AI-reconciler-first submission-fence race is dispatched'
);

-- 50r
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'reconciler_submission_busy'),
  1,
  'the original AI worker waits while reconciliation rotates claimed-at'
);

-- 50s
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'reconciler_submission_outcome'),
  'claim_mismatch',
  'waiting AI worker loses its exact claimed-at CAS after reconciliation'
);

-- 50t
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'reconciler_submission_claim_rotated')
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'reconciler_submission_reconciliation_count') = 1,
  'reconciler-first ordering rotates authority exactly once before provider submission'
);

-- 50u
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'reservation_oauth_send'),
  1,
  'the AI-reservation-first OAuth namespace race is dispatched'
);

-- 50v
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'reservation_oauth_busy'),
  1,
  'OAuth replacement waits while AI reservation owns the business mutex'
);

-- 50w
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'reservation_oauth_outcome'),
  'namespace_busy',
  'waiting OAuth replacement cannot switch namespace beneath the pending booking'
);

-- 50x
SELECT ok(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'reservation_oauth_booking_count') = 1
  AND (SELECT text_value FROM calendar_063_concurrency_state
       WHERE key = 'reservation_oauth_namespace') =
      'calendar-provider-concurrency-a063@example.test|primary',
  'reservation-first ordering preserves one booking in the original namespace'
);

-- 50y
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_reservation_send'),
  1,
  'the OAuth-first AI reservation race is dispatched'
);

-- 50z
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_reservation_busy'),
  1,
  'AI reservation waits while OAuth replacement owns the business mutex'
);

-- 50aa
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_reservation_outcome'),
  'allowed',
  'waiting AI reservation proceeds after refreshing the committed token namespace'
);

-- 50ab
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'oauth_reservation_completed')
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'oauth_reservation_booking_count') = 1
  AND (SELECT text_value FROM calendar_063_concurrency_state
       WHERE key = 'oauth_reservation_namespace') =
      'oauth-before-reservation@example.test|secondary',
  'OAuth-first ordering commits exactly one reservation in the replacement namespace'
);

-- 50ac
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'provider_confirm_send'),
  1,
  'the provider-applied-first shifted-confirmation race is dispatched'
);

-- 50ad
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'provider_confirm_busy'),
  1,
  'AI confirmation waits while provider evidence owns the business mutex'
);

-- 50ae
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'provider_confirm_outcome'),
  'slot_unavailable',
  'waiting confirmation rejects committed shifted provider target and slot authority'
);

-- 50af
SELECT ok(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'provider_confirm_operation_count') = 1
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'provider_confirm_booking_count') = 1,
  'provider-first ordering preserves one applied operation and pending booking'
);

-- 50ag
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_confirm_send'),
  1,
  'the conflicting-finalization-first shifted-confirmation race is dispatched'
);

-- 50ah
SELECT is(
  (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_confirm_busy'),
  1,
  'AI confirmation waits while the finalization attempt retains the business mutex'
);

-- 50ai
SELECT is(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_confirm_outcome'),
  'slot_unavailable',
  'waiting confirmation remains blocked by the provider-applied shifted interval'
);

-- 50aj
SELECT ok(
  (SELECT text_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_confirm_finalize_outcome') = 'finalize_conflict'
  AND (SELECT integer_value FROM calendar_063_concurrency_state
   WHERE key = 'finalize_confirm_operation_count') = 1
  AND (SELECT integer_value FROM calendar_063_concurrency_state
       WHERE key = 'finalize_confirm_booking_count') = 1,
  'conflicting finalization preserves one applied operation and pending booking for reconciliation'
);

-- 51
SELECT ok(
  (SELECT boolean_value FROM calendar_063_concurrency_state
   WHERE key = 'cleanup_ok')
  AND NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '00000000-0000-4000-a063-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a063-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE id = '62000000-0000-4000-a063-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.calendar_provider_operations
    WHERE business_id = '10000000-0000-4000-a063-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.calendar_bookings
    WHERE business_id = '10000000-0000-4000-a063-000000000091'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE business_id = '10000000-0000-4000-a063-000000000091'
  )
  AND NOT (
    'calendar_063_setup' = ANY(COALESCE(
      extensions.dblink_get_connections(), ARRAY[]::text[]
    ))
  )
  AND NOT (
    'calendar_063_worker_a' = ANY(COALESCE(
      extensions.dblink_get_connections(), ARRAY[]::text[]
    ))
  )
  AND NOT (
    'calendar_063_worker_b' = ANY(COALESCE(
      extensions.dblink_get_connections(), ARRAY[]::text[]
    ))
  ),
  'all remote sessions and committed provider-race fixtures are cleaned exactly'
);

SELECT * FROM finish();

ROLLBACK;
