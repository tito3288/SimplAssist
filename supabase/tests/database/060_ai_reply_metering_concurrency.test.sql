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
      'test_060_ai_reply_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(9);

CREATE TEMP TABLE meter_060_concurrency_state (
  key text PRIMARY KEY,
  text_value text,
  integer_value integer,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_060_ai_reply_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection text;
  v_ok boolean := true;
BEGIN
  FOREACH v_connection IN ARRAY ARRAY[
    'meter_060_worker_a',
    'meter_060_worker_b'
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

  IF 'meter_060_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(), ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'meter_060_setup',
        $metric_cleanup_sql$
          DO $metric_cleanup$
          BEGIN
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'DISABLE TRIGGER reject_business_metric_events_mutation';
            DELETE FROM public.business_metric_events
            WHERE business_id =
              '10000000-0000-4000-a060-000000000091';
            EXECUTE
              'ALTER TABLE public.business_metric_events ' ||
              'ENABLE TRIGGER reject_business_metric_events_mutation';
          END;
          $metric_cleanup$;
        $metric_cleanup_sql$
      );
      PERFORM extensions.dblink_exec(
        'meter_060_setup',
        $cleanup$
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a060-000000000091'
            AND owner_id IS NULL
            AND name = 'AI Reply Concurrency 060'
        $cleanup$
      );
      PERFORM extensions.dblink_disconnect('meter_060_setup');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('meter_060_setup');
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  END IF;

  RETURN v_ok;
END;
$$;

DO $orchestrate_199_200_race$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_outcome_a text;
  v_outcome_b text;
  v_busy_b integer;
  v_reservation_count integer;
  v_completed_count integer;
  v_provider_id_a text;
  v_provider_id_b text;
  v_provider_busy_b integer;
  v_provider_count integer;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect('meter_060_setup', v_connection_string);
    PERFORM extensions.dblink_connect('meter_060_worker_a', v_connection_string);
    PERFORM extensions.dblink_connect('meter_060_worker_b', v_connection_string);

    -- A prior interrupted disposable-local run may have committed only its
    -- fixture session. Remove that exact guarded fixture before recreating it.
    PERFORM extensions.dblink_exec(
      'meter_060_setup',
      $preflight_metric_cleanup_sql$
        DO $preflight_metric_cleanup$
        BEGIN
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'DISABLE TRIGGER reject_business_metric_events_mutation';
          DELETE FROM public.business_metric_events
          WHERE business_id =
            '10000000-0000-4000-a060-000000000091';
          EXECUTE
            'ALTER TABLE public.business_metric_events ' ||
            'ENABLE TRIGGER reject_business_metric_events_mutation';
        END;
        $preflight_metric_cleanup$;
      $preflight_metric_cleanup_sql$
    );
    PERFORM extensions.dblink_exec(
      'meter_060_setup',
      $preflight_cleanup$
        DELETE FROM public.businesses
        WHERE id = '10000000-0000-4000-a060-000000000091'
          AND owner_id IS NULL
          AND name = 'AI Reply Concurrency 060'
      $preflight_cleanup$
    );

    PERFORM extensions.dblink_exec(
      'meter_060_setup',
      $fixture$
        INSERT INTO public.businesses (
          id, name, email, business_type, slug
        ) VALUES (
          '10000000-0000-4000-a060-000000000091',
          'AI Reply Concurrency 060',
          'ai-reply-concurrency-a060@example.test',
          'general',
          'ai-reply-concurrency-a060'
        );

        INSERT INTO public.subscriptions (
          id, business_id, stripe_customer_id, stripe_subscription_id,
          plan, status, current_period_start, current_period_end
        ) VALUES (
          '11000000-0000-4000-a060-000000000091',
          '10000000-0000-4000-a060-000000000091',
          'cus_concurrency_a060',
          'sub_concurrency_a060',
          'chat_only',
          'active',
          date_trunc('month', statement_timestamp()),
          date_trunc('month', statement_timestamp()) + interval '1 month'
        );

        INSERT INTO public.contacts (
          id, business_id, source_channel, session_id
        ) VALUES (
          '21000000-0000-4000-a060-000000000091',
          '10000000-0000-4000-a060-000000000091',
          'web_chat',
          'concurrency-session-a060'
        );

        INSERT INTO public.conversations (
          id, business_id, contact_id, channel
        ) VALUES (
          '22000000-0000-4000-a060-000000000091',
          '10000000-0000-4000-a060-000000000091',
          '21000000-0000-4000-a060-000000000091',
          'web_chat'
        );

        INSERT INTO public.messages (
          id, conversation_id, business_id, role, content, channel
        ) VALUES
          ('23000000-0000-4000-a060-000000000091',
           '22000000-0000-4000-a060-000000000091',
           '10000000-0000-4000-a060-000000000091',
           'customer', 'Race inbound A', 'web_chat'),
          ('23000000-0000-4000-a060-000000000092',
           '22000000-0000-4000-a060-000000000091',
           '10000000-0000-4000-a060-000000000091',
           'customer', 'Race inbound B', 'web_chat');

        INSERT INTO public.ai_reply_usage_periods (
          id, business_id, period_start, period_end, billing_source,
          plan, included_ai_replies, completed_replies
        ) VALUES (
          '61000000-0000-4000-a060-000000000091',
          '10000000-0000-4000-a060-000000000091',
          date_trunc('month', statement_timestamp()),
          date_trunc('month', statement_timestamp()) + interval '1 month',
          'subscription',
          'chat_only',
          200,
          199
        );
      $fixture$
    );

    PERFORM extensions.dblink_exec('meter_060_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'meter_060_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec('meter_060_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'meter_060_worker_b', 'SET LOCAL ROLE service_role'
    );

    PERFORM extensions.dblink_send_query(
      'meter_060_worker_a',
      $worker_a$
        SELECT public.reserve_ai_reply(
          '10000000-0000-4000-a060-000000000091',
          'web_chat',
          'concurrency-client-a',
          repeat('a', 64),
          '23000000-0000-4000-a060-000000000091'
        )->>'outcome'
      $worker_a$
    );

    WHILE extensions.dblink_is_busy('meter_060_worker_a') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_outcome_a
    FROM extensions.dblink_get_result('meter_060_worker_a')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('meter_060_worker_a', false)
      AS drained_result(outcome text);

    PERFORM extensions.dblink_send_query(
      'meter_060_worker_b',
      $worker_b$
        SELECT public.reserve_ai_reply(
          '10000000-0000-4000-a060-000000000091',
          'web_chat',
          'concurrency-client-b',
          repeat('b', 64),
          '23000000-0000-4000-a060-000000000092'
        )->>'outcome'
      $worker_b$
    );

    PERFORM pg_sleep(0.1);
    v_busy_b := extensions.dblink_is_busy('meter_060_worker_b');

    PERFORM extensions.dblink_exec('meter_060_worker_a', 'COMMIT');

    WHILE extensions.dblink_is_busy('meter_060_worker_b') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT outcome INTO v_outcome_b
    FROM extensions.dblink_get_result('meter_060_worker_b')
      AS result(outcome text);
    PERFORM outcome
    FROM extensions.dblink_get_result('meter_060_worker_b', false)
      AS drained_result(outcome text);
    PERFORM extensions.dblink_exec('meter_060_worker_b', 'COMMIT');

    SELECT count(*)::integer
    INTO v_reservation_count
    FROM extensions.dblink(
      'meter_060_setup',
      $count_reservations$
        SELECT count(*)::integer
        FROM public.ai_reply_reservations
        WHERE business_id = '10000000-0000-4000-a060-000000000091'
          AND status = 'reserved'
          AND expires_at > statement_timestamp()
      $count_reservations$
    ) AS result(count integer);

    SELECT completed_replies
    INTO v_completed_count
    FROM extensions.dblink(
      'meter_060_setup',
      $read_completed$
        SELECT completed_replies
        FROM public.ai_reply_usage_periods
        WHERE business_id = '10000000-0000-4000-a060-000000000091'
      $read_completed$
    ) AS result(completed_replies integer);

    -- Identical provider-call retries must serialize on their business key and
    -- return one durable accounting row rather than surfacing a raw unique
    -- violation to the losing worker.
    PERFORM extensions.dblink_exec('meter_060_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'meter_060_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec('meter_060_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'meter_060_worker_b', 'SET LOCAL ROLE service_role'
    );

    PERFORM extensions.dblink_send_query(
      'meter_060_worker_a',
      $provider_a$
        SELECT public.record_anthropic_provider_call(
          '10000000-0000-4000-a060-000000000091',
          NULL, NULL,
          'provider-concurrency-a060',
          'message_initial',
          'sms',
          false,
          'claude-haiku-4-5-20251001',
          'msg_provider_concurrency_a060',
          12, 3, 0, 0, 50, 'end_turn', 0, 0, true, NULL
        )::text
      $provider_a$
    );

    WHILE extensions.dblink_is_busy('meter_060_worker_a') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT provider_id INTO v_provider_id_a
    FROM extensions.dblink_get_result('meter_060_worker_a')
      AS result(provider_id text);
    PERFORM provider_id
    FROM extensions.dblink_get_result('meter_060_worker_a', false)
      AS drained_result(provider_id text);

    PERFORM extensions.dblink_send_query(
      'meter_060_worker_b',
      $provider_b$
        SELECT public.record_anthropic_provider_call(
          '10000000-0000-4000-a060-000000000091',
          NULL, NULL,
          'provider-concurrency-a060',
          'message_initial',
          'sms',
          false,
          'claude-haiku-4-5-20251001',
          'msg_provider_concurrency_a060',
          12, 3, 0, 0, 50, 'end_turn', 0, 0, true, NULL
        )::text
      $provider_b$
    );

    PERFORM pg_sleep(0.1);
    v_provider_busy_b := extensions.dblink_is_busy('meter_060_worker_b');
    PERFORM extensions.dblink_exec('meter_060_worker_a', 'COMMIT');

    WHILE extensions.dblink_is_busy('meter_060_worker_b') = 1 LOOP
      PERFORM pg_sleep(0.01);
    END LOOP;
    SELECT provider_id INTO v_provider_id_b
    FROM extensions.dblink_get_result('meter_060_worker_b')
      AS result(provider_id text);
    PERFORM provider_id
    FROM extensions.dblink_get_result('meter_060_worker_b', false)
      AS drained_result(provider_id text);
    PERFORM extensions.dblink_exec('meter_060_worker_b', 'COMMIT');

    SELECT count(*)::integer
    INTO v_provider_count
    FROM extensions.dblink(
      'meter_060_setup',
      $count_provider_calls$
        SELECT count(*)::integer
        FROM public.anthropic_provider_calls
        WHERE business_id = '10000000-0000-4000-a060-000000000091'
          AND call_idempotency_key = 'provider-concurrency-a060'
      $count_provider_calls$
    ) AS result(count integer);

    INSERT INTO meter_060_concurrency_state (
      key, text_value, integer_value, boolean_value
    ) VALUES
      ('worker_a', v_outcome_a, NULL, NULL),
      ('worker_b', v_outcome_b, NULL, NULL),
      ('worker_b_busy', NULL, v_busy_b, NULL),
      ('reservation_count', NULL, v_reservation_count, NULL),
      ('completed_count', NULL, v_completed_count, NULL),
      ('provider_a', v_provider_id_a, NULL, NULL),
      ('provider_b', v_provider_id_b, NULL, NULL),
      ('provider_b_busy', NULL, v_provider_busy_b, NULL),
      ('provider_count', NULL, v_provider_count, NULL);

    v_cleanup_ok := pg_temp.cleanup_060_ai_reply_concurrency();
    INSERT INTO meter_060_concurrency_state (
      key, text_value, integer_value, boolean_value
    ) VALUES ('cleanup', NULL, NULL, v_cleanup_ok);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_temp.cleanup_060_ai_reply_concurrency();
    RAISE;
  END;
END;
$orchestrate_199_200_race$;

SELECT is(
  (SELECT text_value FROM meter_060_concurrency_state WHERE key = 'worker_a'),
  'reserved',
  'first contender reserves the 200th slot'
);
SELECT is(
  (SELECT integer_value FROM meter_060_concurrency_state
   WHERE key = 'worker_b_busy'),
  1,
  'second contender waits on the same business authority lock'
);
SELECT is(
  (SELECT text_value FROM meter_060_concurrency_state WHERE key = 'worker_b'),
  'limit_reached',
  'second contender sees the committed active reservation and is denied'
);
SELECT is(
  (SELECT integer_value FROM meter_060_concurrency_state
   WHERE key = 'reservation_count'),
  1,
  '199/200 race creates exactly one active reservation'
);
SELECT is(
  (SELECT integer_value FROM meter_060_concurrency_state
   WHERE key = 'completed_count'),
  199,
  'reservation race does not prematurely increment completed replies'
);
SELECT is(
  (SELECT integer_value FROM meter_060_concurrency_state
   WHERE key = 'provider_b_busy'),
  1,
  'identical provider-call retry waits on its idempotency authority lock'
);
SELECT is(
  (SELECT text_value FROM meter_060_concurrency_state WHERE key = 'provider_b'),
  (SELECT text_value FROM meter_060_concurrency_state WHERE key = 'provider_a'),
  'identical concurrent provider-call retries return the same accounting row'
);
SELECT is(
  (SELECT integer_value FROM meter_060_concurrency_state
   WHERE key = 'provider_count'),
  1,
  'provider-call concurrency creates exactly one content-free accounting row'
);
SELECT is(
  (SELECT boolean_value FROM meter_060_concurrency_state WHERE key = 'cleanup'),
  true,
  'committed concurrency fixture is cleaned up'
);

SELECT * FROM finish();
ROLLBACK;
