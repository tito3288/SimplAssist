BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits a fixture through dblink so two independent transactions
-- can contend for the same first family claim. Refuse any non-disposable
-- database even when someone invokes the file outside the repository wrapper.
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
      'test_059_billing_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(13);

CREATE TEMP TABLE billing_059_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  boolean_value boolean,
  text_value text
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_059_billing_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_059_family_chat',
    'test_059_family_sms',
    'test_059_intent_selection',
    'test_059_intent_checkout'
  ] LOOP
    IF v_connection_name = ANY(COALESCE(
      extensions.dblink_get_connections(),
      ARRAY[]::text[]
    )) THEN
      BEGIN
        IF extensions.dblink_is_busy(v_connection_name) = 1 THEN
          PERFORM extensions.dblink_cancel_query(v_connection_name);
        END IF;

        IF v_connection_name IN (
          'test_059_family_sms',
          'test_059_intent_checkout'
        ) THEN
          BEGIN
            PERFORM claimed
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS pending_result(claimed boolean);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;
          BEGIN
            PERFORM claimed
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS drained_result(claimed boolean);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;
        END IF;

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

  IF 'test_059_family_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_059_family_setup',
        $cleanup_fixture$
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a059-000000000091'
            AND owner_id IS NULL
            AND name = 'Family Claim Concurrency 059'
        $cleanup_fixture$
      );
      PERFORM extensions.dblink_disconnect('test_059_family_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect('test_059_family_setup');
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  IF 'test_059_intent_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_059_intent_setup',
        $cleanup_intent_fixture$
          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a059-000000000092'
            AND email = 'intent-claim-concurrency-a059@example.test'
        $cleanup_intent_fixture$
      );
      PERFORM extensions.dblink_disconnect('test_059_intent_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect('test_059_intent_setup');
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_opposing_first_claims$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_chat_claimed boolean;
  v_send_result integer;
  v_busy_result integer;
  v_sms_error_state text;
  v_sms_error_message text;
  v_lock_family text;
  v_lock_claimed_by text;
  v_lock_count integer;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_059_family_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_059_family_chat',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_059_family_sms',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_059_family_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.businesses
          WHERE id = '10000000-0000-4000-a059-000000000091';

          INSERT INTO public.businesses (
            id, owner_id, name, email, slug, business_type
          ) VALUES (
            '10000000-0000-4000-a059-000000000091',
            NULL,
            'Family Claim Concurrency 059',
            'family-claim-concurrency-a059@example.test',
            'family-claim-concurrency-a059',
            'general'
          );
        END;
        $fixture$;
      $fixture_sql$
    );

    PERFORM extensions.dblink_exec('test_059_family_chat', 'BEGIN');
    PERFORM extensions.dblink_exec('test_059_family_sms', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_059_family_chat',
      'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'test_059_family_sms',
      'SET LOCAL ROLE service_role'
    );

    SELECT claimed
    INTO v_chat_claimed
    FROM extensions.dblink(
      'test_059_family_chat',
      $chat_claim$
        SELECT public.claim_business_plan_family(
          '10000000-0000-4000-a059-000000000091',
          'chat_only',
          'direct_checkout'
        )
      $chat_claim$
    ) AS chat_result(claimed boolean);

    v_send_result := extensions.dblink_send_query(
      'test_059_family_sms',
      $sms_claim$
        SELECT public.claim_business_plan_family(
          '10000000-0000-4000-a059-000000000091',
          'sms',
          'direct_checkout'
        )
      $sms_claim$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_059_family_sms');

    PERFORM extensions.dblink_exec('test_059_family_chat', 'COMMIT');

    BEGIN
      PERFORM claimed
      FROM extensions.dblink_get_result('test_059_family_sms')
        AS sms_result(claimed boolean);
    EXCEPTION
      WHEN OTHERS THEN
        v_sms_error_state := SQLSTATE;
        v_sms_error_message := SQLERRM;
    END;
    BEGIN
      PERFORM claimed
      FROM extensions.dblink_get_result('test_059_family_sms', false)
        AS drained_sms_result(claimed boolean);
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    BEGIN
      PERFORM extensions.dblink_exec('test_059_family_sms', 'ROLLBACK');
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;

    SELECT family, claimed_by, lock_count
    INTO v_lock_family, v_lock_claimed_by, v_lock_count
    FROM extensions.dblink(
      'test_059_family_setup',
      $read_lock$
        SELECT min(family), min(claimed_by), count(*)::integer
        FROM public.business_plan_family_locks
        WHERE business_id = '10000000-0000-4000-a059-000000000091'
      $read_lock$
    ) AS lock_result(
      family text,
      claimed_by text,
      lock_count integer
    );

    INSERT INTO billing_059_concurrency_state (
      name, integer_value, boolean_value, text_value
    ) VALUES
      ('send', v_send_result, NULL, NULL),
      ('busy', v_busy_result, NULL, NULL),
      ('winner', NULL, v_chat_claimed, NULL),
      ('loser_state', NULL, NULL, v_sms_error_state),
      ('loser_message', NULL, NULL, v_sms_error_message),
      ('lock', v_lock_count, NULL, v_lock_family || ':' || v_lock_claimed_by);

    v_cleanup_ok := pg_temp.cleanup_059_billing_concurrency();
    INSERT INTO billing_059_concurrency_state (
      name, boolean_value
    ) VALUES ('cleanup', v_cleanup_ok);
  EXCEPTION
    WHEN OTHERS THEN
      v_cleanup_ok := pg_temp.cleanup_059_billing_concurrency();
      RAISE;
  END;
END;
$orchestrate_opposing_first_claims$;

SELECT is(integer_value, 1, 'the opposing family claim starts asynchronously')
FROM billing_059_concurrency_state WHERE name = 'send';

SELECT is(integer_value, 1, 'the opposing claim waits on the business row lock')
FROM billing_059_concurrency_state WHERE name = 'busy';

SELECT is(boolean_value, true, 'the first Chat family claim succeeds')
FROM billing_059_concurrency_state WHERE name = 'winner';

SELECT is(text_value, '55000', 'the waiting opposing family claim fails closed')
FROM billing_059_concurrency_state WHERE name = 'loser_state';

SELECT matches(
  text_value,
  'plan_family_transition_not_supported',
  'the waiting claim surfaces the stable transition conflict'
)
FROM billing_059_concurrency_state WHERE name = 'loser_message';

SELECT ok(
  integer_value = 1
  AND text_value = 'chat_only:direct_checkout',
  'exactly one durable Chat family lock survives the race'
)
FROM billing_059_concurrency_state WHERE name = 'lock';

SELECT is(boolean_value, true, 'finally cleanup removes the committed fixture')
FROM billing_059_concurrency_state WHERE name = 'cleanup';

DO $orchestrate_intent_change_before_checkout_claim$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_selection_saved boolean;
  v_checkout_claimed boolean;
  v_send_result integer;
  v_busy_result integer;
  v_selected_plan text;
  v_lock_count integer;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_059_intent_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_059_intent_selection',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_059_intent_checkout',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_059_intent_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM auth.users
          WHERE id = '00000000-0000-4000-a059-000000000092';

          INSERT INTO auth.users (id, email)
          VALUES (
            '00000000-0000-4000-a059-000000000092',
            'intent-claim-concurrency-a059@example.test'
          );

          UPDATE public.businesses
          SET id = '10000000-0000-4000-a059-000000000092',
              name = 'Intent Claim Concurrency 059',
              email = 'intent-claim-concurrency-a059@example.test',
              slug = 'intent-claim-concurrency-a059',
              onboarding_selected_plan = 'chat_only'
          WHERE owner_id = '00000000-0000-4000-a059-000000000092';
        END;
        $fixture$;
      $fixture_sql$
    );

    PERFORM extensions.dblink_exec('test_059_intent_selection', 'BEGIN');
    PERFORM extensions.dblink_exec('test_059_intent_checkout', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_059_intent_selection',
      'SET LOCAL ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'test_059_intent_checkout',
      'SET LOCAL ROLE service_role'
    );

    SELECT saved
    INTO v_selection_saved
    FROM extensions.dblink(
      'test_059_intent_selection',
      $selection_change$
        SELECT public.save_direct_onboarding_plan_intent(
          '10000000-0000-4000-a059-000000000092',
          '00000000-0000-4000-a059-000000000092',
          'chat_only',
          'sms_only'
        )
      $selection_change$
    ) AS selection_result(saved boolean);

    v_send_result := extensions.dblink_send_query(
      'test_059_intent_checkout',
      $checkout_claim$
        SELECT public.claim_direct_checkout_plan(
          '10000000-0000-4000-a059-000000000092',
          'chat_only',
          true
        )
      $checkout_claim$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_059_intent_checkout');

    PERFORM extensions.dblink_exec('test_059_intent_selection', 'COMMIT');

    SELECT claimed
    INTO v_checkout_claimed
    FROM extensions.dblink_get_result('test_059_intent_checkout')
      AS checkout_result(claimed boolean);
    BEGIN
      PERFORM claimed
      FROM extensions.dblink_get_result('test_059_intent_checkout', false)
        AS drained_checkout_result(claimed boolean);
    EXCEPTION
      WHEN OTHERS THEN
        NULL;
    END;
    PERFORM extensions.dblink_exec('test_059_intent_checkout', 'COMMIT');

    SELECT selected_plan, lock_count
    INTO v_selected_plan, v_lock_count
    FROM extensions.dblink(
      'test_059_intent_setup',
      $read_intent_state$
        SELECT
          min(business.onboarding_selected_plan),
          count(family_lock.business_id)::integer
        FROM public.businesses AS business
        LEFT JOIN public.business_plan_family_locks AS family_lock
          ON family_lock.business_id = business.id
        WHERE business.id = '10000000-0000-4000-a059-000000000092'
      $read_intent_state$
    ) AS intent_state(selected_plan text, lock_count integer);

    INSERT INTO billing_059_concurrency_state (
      name, integer_value, boolean_value, text_value
    ) VALUES
      ('intent_selection', NULL, v_selection_saved, NULL),
      ('intent_send', v_send_result, NULL, NULL),
      ('intent_busy', v_busy_result, NULL, NULL),
      ('intent_checkout', NULL, v_checkout_claimed, NULL),
      (
        'intent_state',
        v_lock_count,
        NULL,
        v_selected_plan
      );

    v_cleanup_ok := pg_temp.cleanup_059_billing_concurrency();
    INSERT INTO billing_059_concurrency_state (
      name, boolean_value
    ) VALUES ('intent_cleanup', v_cleanup_ok);
  EXCEPTION
    WHEN OTHERS THEN
      v_cleanup_ok := pg_temp.cleanup_059_billing_concurrency();
      RAISE;
  END;
END;
$orchestrate_intent_change_before_checkout_claim$;

SELECT is(
  boolean_value,
  true,
  'the advisory selection change succeeds while it owns the business lock'
)
FROM billing_059_concurrency_state WHERE name = 'intent_selection';

SELECT is(
  integer_value,
  1,
  'the exact Checkout claim starts asynchronously'
)
FROM billing_059_concurrency_state WHERE name = 'intent_send';

SELECT is(
  integer_value,
  1,
  'the exact Checkout claim waits for the advisory intent writer'
)
FROM billing_059_concurrency_state WHERE name = 'intent_busy';

SELECT is(
  boolean_value,
  false,
  'the waiting Checkout claim rejects the now-stale exact Chat plan'
)
FROM billing_059_concurrency_state WHERE name = 'intent_checkout';

SELECT ok(
  integer_value = 0 AND text_value = 'sms_only',
  'the winning SMS intent remains advisory and no stale Chat lock is created'
)
FROM billing_059_concurrency_state WHERE name = 'intent_state';

SELECT is(
  boolean_value,
  true,
  'finally cleanup removes the intent/Checkout race fixture'
)
FROM billing_059_concurrency_state WHERE name = 'intent_cleanup';

SELECT * FROM finish();

ROLLBACK;
