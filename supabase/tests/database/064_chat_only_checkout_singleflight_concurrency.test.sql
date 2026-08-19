BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

-- dblink workers commit outside this pgTAP transaction. Refuse every database
-- except the disposable local Supabase instance (or an explicitly attested
-- disposable runner) before creating or cleaning exact race fixtures.
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
      'test_064_chat_checkout_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(32);

CREATE TEMP TABLE checkout_064_concurrency_state (
  name text PRIMARY KEY,
  send_result integer,
  busy_result integer,
  boolean_value boolean,
  status_value text,
  second_status_value text,
  attempt_id text,
  second_attempt_id text,
  family_count integer,
  attempt_count integer,
  error_state text,
  error_message text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_064_chat_checkout_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection text;
  v_ok boolean := true;
BEGIN
  FOREACH v_connection IN ARRAY ARRAY[
    'chat_checkout_064_worker_a',
    'chat_checkout_064_worker_b'
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

  IF 'chat_checkout_064_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(), ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'chat_checkout_064_setup',
        $cleanup_sql$
          DELETE FROM public.chat_only_checkout_attempts
          WHERE business_id IN (
            '10000000-0000-4000-a064-000000000091',
            '10000000-0000-4000-a064-000000000092',
            '10000000-0000-4000-a064-000000000093',
            '10000000-0000-4000-a064-000000000094',
            '10000000-0000-4000-a064-000000000095',
            '10000000-0000-4000-a064-000000000096',
            '10000000-0000-4000-a064-000000000097',
            '10000000-0000-4000-a064-000000000098',
            '10000000-0000-4000-a064-000000000099'
          );

          DELETE FROM public.businesses
          WHERE id IN (
            '10000000-0000-4000-a064-000000000091',
            '10000000-0000-4000-a064-000000000092',
            '10000000-0000-4000-a064-000000000093',
            '10000000-0000-4000-a064-000000000094',
            '10000000-0000-4000-a064-000000000095',
            '10000000-0000-4000-a064-000000000096',
            '10000000-0000-4000-a064-000000000097',
            '10000000-0000-4000-a064-000000000098',
            '10000000-0000-4000-a064-000000000099'
          )
            AND name = 'Chat Checkout Race 064'
            AND slug IN (
              'chat-checkout-race-91-a064',
              'chat-checkout-race-92-a064',
              'chat-checkout-race-93-a064',
              'chat-checkout-race-94-a064',
              'chat-checkout-race-95-a064',
              'chat-checkout-race-96-a064',
              'chat-checkout-race-97-a064',
              'chat-checkout-race-98-a064',
              'chat-checkout-race-99-a064'
            );

          DELETE FROM auth.users
          WHERE (id, email) IN (
            (
              '00000000-0000-4000-a064-000000000091',
              'chat-checkout-race-91-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000092',
              'chat-checkout-race-92-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000093',
              'chat-checkout-race-93-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000094',
              'chat-checkout-race-94-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000095',
              'chat-checkout-race-95-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000096',
              'chat-checkout-race-96-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000097',
              'chat-checkout-race-97-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000098',
              'chat-checkout-race-98-a064@example.test'
            ),
            (
              '00000000-0000-4000-a064-000000000099',
              'chat-checkout-race-99-a064@example.test'
            )
          );

          DELETE FROM public.partners
          WHERE id = '90000000-0000-4000-a064-000000000094'
            AND name = 'Chat Checkout Race Partner 064'
            AND slug = 'chat-checkout-race-partner-a064';
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('chat_checkout_064_setup');
    EXCEPTION WHEN OTHERS THEN
      v_ok := false;
      BEGIN
        PERFORM extensions.dblink_disconnect('chat_checkout_064_setup');
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END IF;

  RETURN v_ok;
END;
$$;

DO $orchestrate_chat_checkout_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_payload jsonb;
  v_second_payload jsonb;
  v_boolean boolean;
  v_second_boolean boolean;
  v_send integer;
  v_busy integer;
  v_family_count integer;
  v_attempt_count integer;
  v_error_state text;
  v_error_message text;
  v_case_name text;
  v_business_id uuid;
  v_fingerprint_character text;
  v_update_sql text;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'chat_checkout_064_setup', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'chat_checkout_064_worker_a', v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'chat_checkout_064_worker_b', v_connection_string
    );

    -- Remove only exact fixtures left by an interrupted disposable run.
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_setup',
      $preflight_cleanup_sql$
        DELETE FROM public.chat_only_checkout_attempts
        WHERE business_id IN (
          '10000000-0000-4000-a064-000000000091',
          '10000000-0000-4000-a064-000000000092',
          '10000000-0000-4000-a064-000000000093',
          '10000000-0000-4000-a064-000000000094',
          '10000000-0000-4000-a064-000000000095',
          '10000000-0000-4000-a064-000000000096',
          '10000000-0000-4000-a064-000000000097',
          '10000000-0000-4000-a064-000000000098',
          '10000000-0000-4000-a064-000000000099'
        );

        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a064-000000000091',
          '10000000-0000-4000-a064-000000000092',
          '10000000-0000-4000-a064-000000000093',
          '10000000-0000-4000-a064-000000000094',
          '10000000-0000-4000-a064-000000000095',
          '10000000-0000-4000-a064-000000000096',
          '10000000-0000-4000-a064-000000000097',
          '10000000-0000-4000-a064-000000000098',
          '10000000-0000-4000-a064-000000000099'
        )
          AND name = 'Chat Checkout Race 064'
          AND slug IN (
            'chat-checkout-race-91-a064',
            'chat-checkout-race-92-a064',
            'chat-checkout-race-93-a064',
            'chat-checkout-race-94-a064',
            'chat-checkout-race-95-a064',
            'chat-checkout-race-96-a064',
            'chat-checkout-race-97-a064',
            'chat-checkout-race-98-a064',
            'chat-checkout-race-99-a064'
          );

        DELETE FROM auth.users
        WHERE (id, email) IN (
          ('00000000-0000-4000-a064-000000000091', 'chat-checkout-race-91-a064@example.test'),
          ('00000000-0000-4000-a064-000000000092', 'chat-checkout-race-92-a064@example.test'),
          ('00000000-0000-4000-a064-000000000093', 'chat-checkout-race-93-a064@example.test'),
          ('00000000-0000-4000-a064-000000000094', 'chat-checkout-race-94-a064@example.test'),
          ('00000000-0000-4000-a064-000000000095', 'chat-checkout-race-95-a064@example.test'),
          ('00000000-0000-4000-a064-000000000096', 'chat-checkout-race-96-a064@example.test'),
          ('00000000-0000-4000-a064-000000000097', 'chat-checkout-race-97-a064@example.test'),
          ('00000000-0000-4000-a064-000000000098', 'chat-checkout-race-98-a064@example.test'),
          ('00000000-0000-4000-a064-000000000099', 'chat-checkout-race-99-a064@example.test')
        );

        DELETE FROM public.partners
        WHERE id = '90000000-0000-4000-a064-000000000094'
          AND name = 'Chat Checkout Race Partner 064'
          AND slug = 'chat-checkout-race-partner-a064';
      $preflight_cleanup_sql$
    );

    PERFORM extensions.dblink_exec(
      'chat_checkout_064_setup',
      $fixture_sql$
        INSERT INTO public.partners (id, name, slug)
        VALUES (
          '90000000-0000-4000-a064-000000000094',
          'Chat Checkout Race Partner 064',
          'chat-checkout-race-partner-a064'
        );

        INSERT INTO auth.users (id, email) VALUES
          ('00000000-0000-4000-a064-000000000091', 'chat-checkout-race-91-a064@example.test'),
          ('00000000-0000-4000-a064-000000000092', 'chat-checkout-race-92-a064@example.test'),
          ('00000000-0000-4000-a064-000000000093', 'chat-checkout-race-93-a064@example.test'),
          ('00000000-0000-4000-a064-000000000094', 'chat-checkout-race-94-a064@example.test'),
          ('00000000-0000-4000-a064-000000000095', 'chat-checkout-race-95-a064@example.test'),
          ('00000000-0000-4000-a064-000000000096', 'chat-checkout-race-96-a064@example.test'),
          ('00000000-0000-4000-a064-000000000097', 'chat-checkout-race-97-a064@example.test'),
          ('00000000-0000-4000-a064-000000000098', 'chat-checkout-race-98-a064@example.test'),
          ('00000000-0000-4000-a064-000000000099', 'chat-checkout-race-99-a064@example.test');

        UPDATE public.businesses
        SET id = CASE owner_id
              WHEN '00000000-0000-4000-a064-000000000091'
                THEN '10000000-0000-4000-a064-000000000091'::uuid
              WHEN '00000000-0000-4000-a064-000000000092'
                THEN '10000000-0000-4000-a064-000000000092'::uuid
              WHEN '00000000-0000-4000-a064-000000000093'
                THEN '10000000-0000-4000-a064-000000000093'::uuid
              WHEN '00000000-0000-4000-a064-000000000094'
                THEN '10000000-0000-4000-a064-000000000094'::uuid
              WHEN '00000000-0000-4000-a064-000000000095'
                THEN '10000000-0000-4000-a064-000000000095'::uuid
              WHEN '00000000-0000-4000-a064-000000000096'
                THEN '10000000-0000-4000-a064-000000000096'::uuid
              WHEN '00000000-0000-4000-a064-000000000097'
                THEN '10000000-0000-4000-a064-000000000097'::uuid
              WHEN '00000000-0000-4000-a064-000000000098'
                THEN '10000000-0000-4000-a064-000000000098'::uuid
              ELSE '10000000-0000-4000-a064-000000000099'::uuid
            END,
            name = 'Chat Checkout Race 064',
            slug = 'chat-checkout-race-' || right(owner_id::text, 2) || '-a064',
            onboarding_selected_plan = 'chat_only'
        WHERE owner_id IN (
          '00000000-0000-4000-a064-000000000091',
          '00000000-0000-4000-a064-000000000092',
          '00000000-0000-4000-a064-000000000093',
          '00000000-0000-4000-a064-000000000094',
          '00000000-0000-4000-a064-000000000095',
          '00000000-0000-4000-a064-000000000096',
          '00000000-0000-4000-a064-000000000097',
          '00000000-0000-4000-a064-000000000098',
          '00000000-0000-4000-a064-000000000099'
        );

        -- Terminal-race fixtures start at exact open provider evidence. The
        -- main suite separately proves acquisition and Session recording.
        INSERT INTO public.business_plan_family_locks (
          business_id, family, claimed_by
        ) VALUES
          ('10000000-0000-4000-a064-000000000097', 'chat_only', 'direct_checkout'),
          ('10000000-0000-4000-a064-000000000098', 'chat_only', 'direct_checkout');

        INSERT INTO public.chat_only_checkout_attempts (
          id, business_id, stripe_price_id, request_fingerprint, state,
          claim_token, claimed_at, claim_expires_at,
          stripe_checkout_session_id, stripe_customer_id, checkout_url,
          checkout_session_expires_at, created_at, updated_at
        ) VALUES
          (
            '50000000-0000-4000-a064-000000000097',
            '10000000-0000-4000-a064-000000000097',
            'price_chat_a064', repeat('7', 64), 'open',
            '40000000-0000-4000-a064-000000000097',
            clock_timestamp(), clock_timestamp(),
            'cs_complete_race_a064', 'cus_CompleteRaceA064',
            'https://checkout.stripe.test/complete-race-a064',
            clock_timestamp() + interval '60 minutes',
            clock_timestamp(), clock_timestamp()
          ),
          (
            '50000000-0000-4000-a064-000000000098',
            '10000000-0000-4000-a064-000000000098',
            'price_chat_a064', repeat('8', 64), 'open',
            '40000000-0000-4000-a064-000000000098',
            clock_timestamp(), clock_timestamp(),
            'cs_expire_race_a064', 'cus_ExpireRaceA064',
            'https://checkout.stripe.test/expire-race-a064',
            clock_timestamp() + interval '60 minutes',
            clock_timestamp(), clock_timestamp()
          );
      $fixture_sql$
    );

    -- Two first callers contend on the business mutex. The winner commits one
    -- family claim + attempt; the waiter then observes in_progress.
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
    );

    SELECT payload INTO v_payload
    FROM extensions.dblink(
      'chat_checkout_064_worker_a',
      $first_acquire$
        SELECT public.acquire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000091',
          'price_chat_a064', repeat('1', 64),
          '40000000-0000-4000-a064-000000000091'
        )
      $first_acquire$
    ) AS acquired(payload jsonb);

    v_send := extensions.dblink_send_query(
      'chat_checkout_064_worker_b',
      $second_acquire$
        SELECT public.acquire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000091',
          'price_chat_a064', repeat('1', 64),
          '40000000-0000-4000-a064-000000000191'
        )
      $second_acquire$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

    SELECT payload INTO v_second_payload
    FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
      AS waited(payload jsonb);
    BEGIN
      PERFORM payload
      FROM extensions.dblink_get_result(
        'chat_checkout_064_worker_b', false
      ) AS drained(payload jsonb);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'COMMIT');

    SELECT family_count, attempt_count
    INTO v_family_count, v_attempt_count
    FROM extensions.dblink(
      'chat_checkout_064_setup',
      $read_first_acquire$
        SELECT
          (SELECT count(*)::integer
           FROM public.business_plan_family_locks
           WHERE business_id = '10000000-0000-4000-a064-000000000091'),
          (SELECT count(*)::integer
           FROM public.chat_only_checkout_attempts
           WHERE business_id = '10000000-0000-4000-a064-000000000091')
      $read_first_acquire$
    ) AS state(family_count integer, attempt_count integer);

    INSERT INTO checkout_064_concurrency_state (
      name, send_result, busy_result, status_value, second_status_value,
      attempt_id, second_attempt_id, family_count, attempt_count
    ) VALUES (
      'concurrent_acquire', v_send, v_busy,
      v_payload->>'status', v_second_payload->>'status',
      v_payload->>'attempt_id', v_second_payload->>'attempt_id',
      v_family_count, v_attempt_count
    );

    -- Authority wins first for suspension, override, partner attribution, and
    -- owner removal. Each waiting acquire fails before creating family/attempt.
    FOR v_case_name, v_business_id, v_fingerprint_character, v_update_sql IN
      SELECT * FROM (VALUES
        (
          'suspension_first',
          '10000000-0000-4000-a064-000000000092'::uuid,
          '2',
          $suspend$
            UPDATE public.businesses
            SET operations_suspended_at = clock_timestamp()
            WHERE id = '10000000-0000-4000-a064-000000000092'
          $suspend$
        ),
        (
          'override_first',
          '10000000-0000-4000-a064-000000000093'::uuid,
          '3',
          $override$
            UPDATE public.businesses
            SET billing_exempt = true
            WHERE id = '10000000-0000-4000-a064-000000000093'
          $override$
        ),
        (
          'partner_first',
          '10000000-0000-4000-a064-000000000094'::uuid,
          '4',
          $partner$
            UPDATE public.businesses
            SET partner_id = '90000000-0000-4000-a064-000000000094'
            WHERE id = '10000000-0000-4000-a064-000000000094'
          $partner$
        ),
        (
          'owner_first',
          '10000000-0000-4000-a064-000000000095'::uuid,
          '5',
          $owner$
            UPDATE public.businesses
            SET owner_id = NULL
            WHERE id = '10000000-0000-4000-a064-000000000095'
          $owner$
        )
      ) AS authority_cases(
        case_name, business_id, fingerprint_character, update_sql
      )
    LOOP
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
      PERFORM extensions.dblink_exec(
        'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
      );
      PERFORM extensions.dblink_exec(
        'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
      );
      PERFORM extensions.dblink_exec(
        'chat_checkout_064_worker_a', v_update_sql
      );

      v_send := extensions.dblink_send_query(
        'chat_checkout_064_worker_b',
        format(
          'SELECT public.acquire_chat_only_checkout_attempt(' ||
          '%L::uuid, %L, repeat(%L, 64), %L::uuid)',
          v_business_id,
          'price_chat_a064',
          v_fingerprint_character,
          '40000000-0000-4000-a064-000000000' ||
            right(v_business_id::text, 3)
        )
      );
      PERFORM pg_sleep(0.1);
      v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

      SELECT payload INTO v_second_payload
      FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
        AS waited(payload jsonb);
      BEGIN
        PERFORM payload
        FROM extensions.dblink_get_result(
          'chat_checkout_064_worker_b', false
        ) AS drained(payload jsonb);
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'COMMIT');

      SELECT family_count, attempt_count
      INTO v_family_count, v_attempt_count
      FROM extensions.dblink(
        'chat_checkout_064_setup',
        format(
          'SELECT ' ||
          '(SELECT count(*)::integer FROM public.business_plan_family_locks ' ||
          ' WHERE business_id = %L::uuid), ' ||
          '(SELECT count(*)::integer FROM public.chat_only_checkout_attempts ' ||
          ' WHERE business_id = %L::uuid)',
          v_business_id,
          v_business_id
        )
      ) AS authority_state(family_count integer, attempt_count integer);

      INSERT INTO checkout_064_concurrency_state (
        name, send_result, busy_result, status_value,
        family_count, attempt_count
      ) VALUES (
        v_case_name, v_send, v_busy, v_second_payload->>'status',
        v_family_count, v_attempt_count
      );
    END LOOP;

    -- Acquisition wins before a billing override. The writer waits, then the
    -- active-attempt trigger rejects authority widening without data loss.
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
    );

    SELECT payload INTO v_payload
    FROM extensions.dblink(
      'chat_checkout_064_worker_a',
      $acquire_before_override$
        SELECT public.acquire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000096',
          'price_chat_a064', repeat('6', 64),
          '40000000-0000-4000-a064-000000000096'
        )
      $acquire_before_override$
    ) AS acquired(payload jsonb);

    v_send := extensions.dblink_send_query(
      'chat_checkout_064_worker_b',
      $override_after_acquire$
        WITH changed AS (
          UPDATE public.businesses
          SET billing_exempt = true
          WHERE id = '10000000-0000-4000-a064-000000000096'
          RETURNING 1
        ) SELECT count(*)::integer FROM changed
      $override_after_acquire$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

    v_error_state := NULL;
    v_error_message := NULL;
    BEGIN
      PERFORM changed_count
      FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
        AS blocked(changed_count integer);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
      v_error_message := SQLERRM;
    END;
    BEGIN
      PERFORM changed_count
      FROM extensions.dblink_get_result(
        'chat_checkout_064_worker_b', false
      ) AS drained(changed_count integer);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    SELECT family_count, attempt_count
    INTO v_family_count, v_attempt_count
    FROM extensions.dblink(
      'chat_checkout_064_setup',
      $read_override_after_acquire$
        SELECT
          (SELECT count(*)::integer
           FROM public.business_plan_family_locks
           WHERE business_id = '10000000-0000-4000-a064-000000000096'),
          (SELECT count(*)::integer
           FROM public.chat_only_checkout_attempts
           WHERE business_id = '10000000-0000-4000-a064-000000000096')
      $read_override_after_acquire$
    ) AS state(family_count integer, attempt_count integer);

    INSERT INTO checkout_064_concurrency_state (
      name, send_result, busy_result, status_value, family_count,
      attempt_count, error_state, error_message
    ) VALUES (
      'acquire_before_override', v_send, v_busy, v_payload->>'status',
      v_family_count, v_attempt_count, v_error_state, v_error_message
    );

    -- Urgent suspension is the deliberate exception: it waits for the
    -- acquisition mutex, succeeds, and leaves the exact attempt/family intact.
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
    );

    SELECT payload INTO v_payload
    FROM extensions.dblink(
      'chat_checkout_064_worker_a',
      $acquire_before_suspension$
        SELECT public.acquire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000099',
          'price_chat_a064', repeat('9', 64),
          '40000000-0000-4000-a064-000000000099'
        )
      $acquire_before_suspension$
    ) AS acquired(payload jsonb);

    v_send := extensions.dblink_send_query(
      'chat_checkout_064_worker_b',
      $suspend_after_acquire$
        WITH changed AS (
          UPDATE public.businesses
          SET operations_suspended_at = clock_timestamp()
          WHERE id = '10000000-0000-4000-a064-000000000099'
          RETURNING 1
        ) SELECT count(*)::integer FROM changed
      $suspend_after_acquire$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

    SELECT changed_count INTO v_attempt_count
    FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
      AS suspended(changed_count integer);
    v_second_boolean := v_attempt_count = 1;
    BEGIN
      PERFORM changed_count
      FROM extensions.dblink_get_result(
        'chat_checkout_064_worker_b', false
      ) AS drained(changed_count integer);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'COMMIT');

    SELECT family_count, attempt_count
    INTO v_family_count, v_attempt_count
    FROM extensions.dblink(
      'chat_checkout_064_setup',
      $read_suspension_after_acquire$
        SELECT
          (SELECT count(*)::integer
           FROM public.business_plan_family_locks
           WHERE business_id = '10000000-0000-4000-a064-000000000099'),
          (SELECT count(*)::integer
           FROM public.chat_only_checkout_attempts
           WHERE business_id = '10000000-0000-4000-a064-000000000099')
      $read_suspension_after_acquire$
    ) AS state(family_count integer, attempt_count integer);

    INSERT INTO checkout_064_concurrency_state (
      name, send_result, busy_result, boolean_value, status_value,
      family_count, attempt_count
    ) VALUES (
      'acquire_before_suspension', v_send, v_busy, v_second_boolean,
      v_payload->>'status', v_family_count, v_attempt_count
    );

    -- A synchronized completion owns the business mutex first; exact expiry
    -- waits, then refuses to reverse the subscription-bound attempt.
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
    );

    SELECT completed INTO v_boolean
    FROM extensions.dblink(
      'chat_checkout_064_worker_a',
      $complete_first$
        WITH synced AS MATERIALIZED (
          SELECT public.sync_chat_only_subscription_from_attempt(
            '10000000-0000-4000-a064-000000000097',
            '50000000-0000-4000-a064-000000000097',
            repeat('7', 64),
            (SELECT checkout_session_expires_at
             FROM public.chat_only_checkout_attempts
             WHERE id = '50000000-0000-4000-a064-000000000097'),
            'cus_CompleteRaceA064', 'sub_CompleteRaceA064', 'active',
            '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
            'price_chat_a064', 'cs_complete_race_a064', false,
            '2064-01-01 00:00:00+00'
          ) AS ok
        )
        SELECT CASE WHEN ok THEN
          public.complete_chat_only_checkout_attempt(
            '10000000-0000-4000-a064-000000000097',
            '50000000-0000-4000-a064-000000000097',
            'cs_complete_race_a064', 'cus_CompleteRaceA064',
            'sub_CompleteRaceA064', repeat('7', 64),
            (SELECT checkout_session_expires_at
             FROM public.chat_only_checkout_attempts
             WHERE id = '50000000-0000-4000-a064-000000000097')
          ) ELSE false END
        FROM synced
      $complete_first$
    ) AS completed(completed boolean);

    v_send := extensions.dblink_send_query(
      'chat_checkout_064_worker_b',
      $expiry_after_completion$
        SELECT public.expire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000097',
          '50000000-0000-4000-a064-000000000097',
          'cs_complete_race_a064', repeat('7', 64),
          (SELECT checkout_session_expires_at
           FROM public.chat_only_checkout_attempts
           WHERE id = '50000000-0000-4000-a064-000000000097')
        )
      $expiry_after_completion$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

    SELECT expired INTO v_second_boolean
    FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
      AS expired(expired boolean);
    BEGIN
      PERFORM expired
      FROM extensions.dblink_get_result(
        'chat_checkout_064_worker_b', false
      ) AS drained(expired boolean);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'COMMIT');

    INSERT INTO checkout_064_concurrency_state (
      name, send_result, busy_result, boolean_value, status_value,
      second_status_value
    ) VALUES (
      'completion_before_expiry', v_send, v_busy, v_boolean,
      v_second_boolean::text,
      (SELECT state_value
       FROM extensions.dblink(
         'chat_checkout_064_setup',
         $read_completion_state$
           SELECT state
           FROM public.chat_only_checkout_attempts
           WHERE id = '50000000-0000-4000-a064-000000000097'
         $read_completion_state$
       ) AS state(state_value text))
    );

    -- Exact expiry owns the mutex first. The later subscription event waits,
    -- then raises the retryable mismatch and creates no subscription row.
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'BEGIN');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_a', 'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'chat_checkout_064_worker_b', 'SET LOCAL ROLE service_role'
    );

    SELECT expired INTO v_boolean
    FROM extensions.dblink(
      'chat_checkout_064_worker_a',
      $expire_first$
        SELECT public.expire_chat_only_checkout_attempt(
          '10000000-0000-4000-a064-000000000098',
          '50000000-0000-4000-a064-000000000098',
          'cs_expire_race_a064', repeat('8', 64),
          (SELECT checkout_session_expires_at
           FROM public.chat_only_checkout_attempts
           WHERE id = '50000000-0000-4000-a064-000000000098')
        )
      $expire_first$
    ) AS expired(expired boolean);

    v_send := extensions.dblink_send_query(
      'chat_checkout_064_worker_b',
      $sync_after_expiry$
        SELECT public.sync_chat_only_subscription_from_attempt(
          '10000000-0000-4000-a064-000000000098',
          '50000000-0000-4000-a064-000000000098',
          repeat('8', 64),
          (SELECT checkout_session_expires_at
           FROM public.chat_only_checkout_attempts
           WHERE id = '50000000-0000-4000-a064-000000000098'),
          'cus_ExpireRaceA064', 'sub_ExpireRaceA064', 'active',
          '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
          'price_chat_a064', 'cs_expire_race_a064', false,
          '2064-01-01 00:00:00+00'
        )
      $sync_after_expiry$
    );
    PERFORM pg_sleep(0.1);
    v_busy := extensions.dblink_is_busy('chat_checkout_064_worker_b');
    PERFORM extensions.dblink_exec('chat_checkout_064_worker_a', 'COMMIT');

    v_error_state := NULL;
    v_error_message := NULL;
    BEGIN
      PERFORM synced
      FROM extensions.dblink_get_result('chat_checkout_064_worker_b')
        AS synced(synced boolean);
    EXCEPTION WHEN OTHERS THEN
      v_error_state := SQLSTATE;
      v_error_message := SQLERRM;
    END;
    BEGIN
      PERFORM synced
      FROM extensions.dblink_get_result(
        'chat_checkout_064_worker_b', false
      ) AS drained(synced boolean);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM extensions.dblink_exec('chat_checkout_064_worker_b', 'ROLLBACK');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    SELECT state_value, attempt_count
    INTO v_case_name, v_attempt_count
    FROM extensions.dblink(
      'chat_checkout_064_setup',
      $read_expiry_state$
        SELECT
          attempt.state,
          (SELECT count(*)::integer
           FROM public.subscriptions
           WHERE business_id = '10000000-0000-4000-a064-000000000098')
        FROM public.chat_only_checkout_attempts AS attempt
        WHERE attempt.id = '50000000-0000-4000-a064-000000000098'
      $read_expiry_state$
    ) AS state(state_value text, attempt_count integer);

    INSERT INTO checkout_064_concurrency_state (
      name, send_result, busy_result, boolean_value, status_value,
      attempt_count, error_state, error_message
    ) VALUES (
      'expiry_before_subscription', v_send, v_busy, v_boolean,
      v_case_name, v_attempt_count, v_error_state, v_error_message
    );

    v_cleanup_ok := pg_temp.cleanup_064_chat_checkout_concurrency();
    INSERT INTO checkout_064_concurrency_state (name, boolean_value)
    VALUES ('cleanup', v_cleanup_ok);
  EXCEPTION WHEN OTHERS THEN
    v_cleanup_ok := pg_temp.cleanup_064_chat_checkout_concurrency();
    RAISE;
  END;
END;
$orchestrate_chat_checkout_races$;

SELECT is(send_result, 1, 'the second first-acquire call starts asynchronously')
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT is(busy_result, 1, 'the second first-acquire call waits on the business mutex')
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT is(status_value, 'create', 'the first concurrent caller creates the attempt')
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT is(second_status_value, 'in_progress', 'the waiting caller observes in-progress')
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT is(attempt_id, second_attempt_id, 'both callers converge on one attempt UUID')
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT ok(
  family_count = 1 AND attempt_count = 1,
  'concurrent acquisition commits exactly one family claim and one attempt'
)
FROM checkout_064_concurrency_state WHERE name = 'concurrent_acquire';

SELECT is(
  count(*) FILTER (WHERE send_result = 1)::integer,
  4,
  'all four authority-first acquire calls start asynchronously'
)
FROM checkout_064_concurrency_state
WHERE name IN ('suspension_first', 'override_first', 'partner_first', 'owner_first');

SELECT is(
  count(*) FILTER (WHERE busy_result = 1)::integer,
  4,
  'all four authority-first acquire calls wait on the business mutex'
)
FROM checkout_064_concurrency_state
WHERE name IN ('suspension_first', 'override_first', 'partner_first', 'owner_first');

SELECT is(
  count(*) FILTER (WHERE status_value = 'unavailable')::integer,
  4,
  'suspension, override, partner, and owner authority win fail closed'
)
FROM checkout_064_concurrency_state
WHERE name IN ('suspension_first', 'override_first', 'partner_first', 'owner_first');

SELECT is(
  sum(family_count + attempt_count)::integer,
  0,
  'authority-first losses create neither direct family claim nor attempt'
)
FROM checkout_064_concurrency_state
WHERE name IN ('suspension_first', 'override_first', 'partner_first', 'owner_first');

SELECT is(status_value, 'create', 'acquisition wins before the competing override')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT is(send_result, 1, 'the competing override starts asynchronously')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT is(busy_result, 1, 'the competing override waits on the acquisition mutex')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT is(error_state, '55000', 'the waiting override fails with an authority fence')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT matches(
  error_message,
  'chat_only_checkout_attempt_authority_locked',
  'the waiting override surfaces the stable active-attempt conflict'
)
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT ok(
  family_count = 1 AND attempt_count = 1,
  'failed authority widening preserves one family claim and attempt'
)
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_override';

SELECT is(status_value, 'create', 'acquisition wins before urgent suspension')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_suspension';

SELECT is(send_result, 1, 'urgent suspension starts asynchronously')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_suspension';

SELECT is(busy_result, 1, 'urgent suspension waits for the business mutex')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_suspension';

SELECT is(boolean_value, true, 'urgent suspension succeeds after acquisition commits')
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_suspension';

SELECT ok(
  family_count = 1 AND attempt_count = 1,
  'urgent suspension preserves exact family and attempt evidence'
)
FROM checkout_064_concurrency_state WHERE name = 'acquire_before_suspension';

SELECT is(boolean_value, true, 'subscription synchronization and completion win atomically')
FROM checkout_064_concurrency_state WHERE name = 'completion_before_expiry';

SELECT is(send_result, 1, 'the competing expiry starts asynchronously')
FROM checkout_064_concurrency_state WHERE name = 'completion_before_expiry';

SELECT is(busy_result, 1, 'the competing expiry waits on the completion mutex')
FROM checkout_064_concurrency_state WHERE name = 'completion_before_expiry';

SELECT ok(
  status_value = 'false' AND second_status_value = 'completed',
  'completion wins and the waiting expiry cannot reverse bound evidence'
)
FROM checkout_064_concurrency_state WHERE name = 'completion_before_expiry';

SELECT is(boolean_value, true, 'exact expiry wins its business mutex')
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT is(send_result, 1, 'the competing subscription event starts asynchronously')
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT is(busy_result, 1, 'the competing subscription event waits on expiry')
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT is(error_state, '55000', 'the waiting event becomes a retryable mismatch')
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT matches(
  error_message,
  'chat_only_subscription_attempt_mismatch',
  'the waiting event identifies exact expired-attempt mismatch'
)
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT ok(
  status_value = 'expired' AND attempt_count = 0,
  'expiry-first leaves terminal evidence and creates no subscription row'
)
FROM checkout_064_concurrency_state WHERE name = 'expiry_before_subscription';

SELECT is(boolean_value, true, 'finally cleanup removes every committed race fixture')
FROM checkout_064_concurrency_state WHERE name = 'cleanup';

SELECT * FROM finish();

ROLLBACK;
