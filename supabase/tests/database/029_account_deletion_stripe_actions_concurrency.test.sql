BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(14);

CREATE TEMP TABLE account_deletion_029_concurrency_state (
  name text PRIMARY KEY,
  payload jsonb
);

-- dblink sessions commit independently from this pgTAP transaction. Fixed
-- fixture ids and an up-front cleanup make interrupted local re-runs safe.
DO $local_setup$
DECLARE
  -- Local Supabase dev-stack default password; this test file runs against
  -- the disposable local stack only, never production.
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
BEGIN
  PERFORM extensions.dblink_connect('test_029_setup', v_connection_string);
  PERFORM extensions.dblink_connect('test_029_a_webhook', v_connection_string);
  PERFORM extensions.dblink_connect('test_029_a_cleanup', v_connection_string);
  PERFORM extensions.dblink_connect('test_029_b_cleanup', v_connection_string);
  PERFORM extensions.dblink_connect('test_029_b_webhook', v_connection_string);

  PERFORM extensions.dblink_exec(
    'test_029_setup',
    $remote_setup$
      DO $fixture$
      BEGIN
        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a000-000000000011',
          '10000000-0000-4000-a000-000000000012'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a000-000000000011',
          '00000000-0000-4000-a000-000000000012'
        );

        INSERT INTO auth.users (id, email)
        VALUES
          ('00000000-0000-4000-a000-000000000011', 'concurrency-a@example.test'),
          ('00000000-0000-4000-a000-000000000012', 'concurrency-b@example.test');

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a000-000000000011',
            name = 'Concurrency Test A',
            slug = 'account-deletion-concurrency-a'
        WHERE owner_id = '00000000-0000-4000-a000-000000000011';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a000-000000000012',
            name = 'Concurrency Test B',
            slug = 'account-deletion-concurrency-b'
        WHERE owner_id = '00000000-0000-4000-a000-000000000012';

        INSERT INTO public.subscriptions (
          business_id,
          stripe_customer_id,
          stripe_subscription_id,
          plan,
          status,
          stripe_price_id
        ) VALUES
          (
            '10000000-0000-4000-a000-000000000011',
            'cus_concurrency_a',
            'sub_concurrency_a',
            'sms_only',
            'active',
            'price_concurrency_a'
          ),
          (
            '10000000-0000-4000-a000-000000000012',
            'cus_concurrency_b',
            'sub_concurrency_b',
            'sms_only',
            'active',
            'price_concurrency_b'
          );
      END;
      $fixture$;
    $remote_setup$
  );
END;
$local_setup$;

-- ---------------------------------------------------------------------------
-- Commit order A: webhook first, deletion/cleanup second
-- ---------------------------------------------------------------------------
-- The webhook holds a SHARE lock on the active business. Scheduling deletion
-- on another connection must wait. After the webhook commits, deletion sees
-- its subscription state, snapshots the Stripe id, and cleanup removes the
-- local row without allowing a later zombie write.

DO $start_a$
BEGIN
  PERFORM extensions.dblink_exec('test_029_a_webhook', 'BEGIN');
  PERFORM extensions.dblink_exec('test_029_a_cleanup', 'BEGIN');
END;
$start_a$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'a_webhook', jsonb_build_object('result', result)
FROM extensions.dblink(
  'test_029_a_webhook',
  $remote_sync_a$
    SELECT public.sync_stripe_subscription_if_business_active(
      '10000000-0000-4000-a000-000000000011',
      'cus_concurrency_a',
      'sub_concurrency_a',
      'sms_only',
      'active',
      now(),
      now() + interval '30 days',
      'price_concurrency_a',
      NULL,
      NULL,
      NULL,
      false,
      now()
    )
  $remote_sync_a$
) AS remote_result(result boolean);

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_webhook'
  ),
  true,
  'webhook-first transaction synchronizes while the business is active'
);

SELECT is(
  extensions.dblink_send_query(
    'test_029_a_cleanup',
    $remote_schedule_a$
      SELECT public.schedule_account_deletion(
        '10000000-0000-4000-a000-000000000011',
        '00000000-0000-4000-a000-000000000011',
        timestamptz '2099-01-01 00:00:00+00',
        timestamptz '2099-03-02 00:00:00+00'
      )
    $remote_schedule_a$
  ),
  1,
  'webhook-first race starts deletion on a second connection'
);

DO $wait_a$ BEGIN PERFORM pg_sleep(0.1); END $wait_a$;

SELECT is(
  extensions.dblink_is_busy('test_029_a_cleanup'),
  1,
  'deletion waits while the webhook transaction holds the business lock'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000011'
  ),
  'the waiting deletion is not partially visible'
);

DO $commit_webhook_a$
BEGIN
  PERFORM extensions.dblink_exec('test_029_a_webhook', 'COMMIT');
END;
$commit_webhook_a$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'a_schedule', result
FROM extensions.dblink_get_result('test_029_a_cleanup')
  AS remote_result(result jsonb);

DO $drain_a_schedule$
BEGIN
  PERFORM result
  FROM extensions.dblink_get_result('test_029_a_cleanup')
    AS remote_result(result jsonb);
END;
$drain_a_schedule$;

DO $expire_a$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_029_a_cleanup',
    $remote_expire_a$
      UPDATE public.businesses
      SET deletion_scheduled_for = now() - interval '1 second'
      WHERE id = '10000000-0000-4000-a000-000000000011'
    $remote_expire_a$
  );
END;
$expire_a$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'a_cleanup', to_jsonb(result)
FROM extensions.dblink(
  'test_029_a_cleanup',
  $remote_cleanup_a$
    SELECT public.cleanup_expired_business(
      '10000000-0000-4000-a000-000000000011'
    )
  $remote_cleanup_a$
) AS remote_result(result uuid);

DO $commit_cleanup_a$
BEGIN
  PERFORM extensions.dblink_exec('test_029_a_cleanup', 'COMMIT');
END;
$commit_cleanup_a$;

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000011'
  ),
  0::bigint,
  'webhook-first commit order ends with no local subscription row'
);

SELECT ok(
  (
    SELECT desired_action = 'cancel'
       AND stripe_subscription_id = 'sub_concurrency_a'
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000011'
  ),
  'webhook-first order retains the durable cancellation linkage'
);

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'a_post_cleanup_sync', jsonb_build_object('result', result)
FROM extensions.dblink(
  'test_029_a_webhook',
  $remote_post_cleanup_a$
    SELECT public.sync_stripe_subscription_if_business_active(
      '10000000-0000-4000-a000-000000000011',
      'cus_concurrency_a',
      'sub_concurrency_a',
      'sms_only',
      'active',
      now(),
      now() + interval '30 days',
      'price_concurrency_a',
      NULL,
      NULL,
      NULL,
      false,
      now()
    )
  $remote_post_cleanup_a$
) AS remote_result(result boolean);

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'a_post_cleanup_sync'
  ),
  false,
  'post-cleanup webhook is skipped after webhook-first serialization'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000011'
  ),
  0::bigint,
  'post-cleanup webhook cannot create a zombie row in webhook-first order'
);

-- ---------------------------------------------------------------------------
-- Commit order B: deletion/cleanup first, webhook second
-- ---------------------------------------------------------------------------
-- Cleanup holds the business UPDATE lock with its subscription deletion still
-- uncommitted. The webhook starts from the pre-cleanup snapshot, waits, then
-- must recheck deleted_at and return false after cleanup commits.

DO $start_b$
BEGIN
  PERFORM extensions.dblink_exec('test_029_b_cleanup', 'BEGIN');
END;
$start_b$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'b_schedule', result
FROM extensions.dblink(
  'test_029_b_cleanup',
  $remote_schedule_b$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000012',
      '00000000-0000-4000-a000-000000000012',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $remote_schedule_b$
) AS remote_result(result jsonb);

DO $expire_b$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_029_b_cleanup',
    $remote_expire_b$
      UPDATE public.businesses
      SET deletion_scheduled_for = now() - interval '1 second'
      WHERE id = '10000000-0000-4000-a000-000000000012'
    $remote_expire_b$
  );
END;
$expire_b$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'b_cleanup', to_jsonb(result)
FROM extensions.dblink(
  'test_029_b_cleanup',
  $remote_cleanup_b$
    SELECT public.cleanup_expired_business(
      '10000000-0000-4000-a000-000000000012'
    )
  $remote_cleanup_b$
) AS remote_result(result uuid);

SELECT is(
  extensions.dblink_send_query(
    'test_029_b_webhook',
    $remote_sync_b$
      SELECT public.sync_stripe_subscription_if_business_active(
        '10000000-0000-4000-a000-000000000012',
        'cus_concurrency_b',
        'sub_concurrency_b',
        'sms_only',
        'active',
        now(),
        now() + interval '30 days',
        'price_concurrency_b',
        NULL,
        NULL,
        NULL,
        false,
        now()
      )
    $remote_sync_b$
  ),
  1,
  'cleanup-first race starts a webhook on a second connection'
);

DO $wait_b$ BEGIN PERFORM pg_sleep(0.1); END $wait_b$;

SELECT is(
  extensions.dblink_is_busy('test_029_b_webhook'),
  1,
  'webhook waits while cleanup holds the business lock'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000012'
  ),
  1::bigint,
  'uncommitted cleanup is not partially visible'
);

DO $commit_cleanup_b$
BEGIN
  PERFORM extensions.dblink_exec('test_029_b_cleanup', 'COMMIT');
END;
$commit_cleanup_b$;

INSERT INTO account_deletion_029_concurrency_state (name, payload)
SELECT 'b_webhook', jsonb_build_object('result', result)
FROM extensions.dblink_get_result('test_029_b_webhook')
  AS remote_result(result boolean);

DO $drain_b_webhook$
BEGIN
  PERFORM result
  FROM extensions.dblink_get_result('test_029_b_webhook')
    AS remote_result(result boolean);
END;
$drain_b_webhook$;

SELECT is(
  (
    SELECT (payload ->> 'result')::boolean
    FROM account_deletion_029_concurrency_state
    WHERE name = 'b_webhook'
  ),
  false,
  'cleanup-first webhook rechecks state and reports a deleted-business skip'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000012'
  ),
  0::bigint,
  'cleanup-first commit order cannot create a zombie subscription row'
);

SELECT ok(
  (
    SELECT desired_action = 'cancel'
       AND stripe_subscription_id = 'sub_concurrency_b'
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000012'
  ),
  'cleanup-first order retains the durable cancellation linkage'
);

-- The independent fixtures were committed outside pgTAP's transaction, so
-- remove them explicitly before disconnecting. Business deletion cascades the
-- durable action rows; auth rows are then safe to remove.
DO $local_cleanup$
BEGIN
  PERFORM extensions.dblink_exec(
    'test_029_setup',
    $remote_fixture_cleanup$
      DO $fixture_cleanup$
      BEGIN
        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a000-000000000011',
          '10000000-0000-4000-a000-000000000012'
        );

        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a000-000000000011',
          '00000000-0000-4000-a000-000000000012'
        );
      END;
      $fixture_cleanup$;
    $remote_fixture_cleanup$
  );

  PERFORM extensions.dblink_disconnect('test_029_a_webhook');
  PERFORM extensions.dblink_disconnect('test_029_a_cleanup');
  PERFORM extensions.dblink_disconnect('test_029_b_cleanup');
  PERFORM extensions.dblink_disconnect('test_029_b_webhook');
  PERFORM extensions.dblink_disconnect('test_029_setup');
END;
$local_cleanup$;

SELECT * FROM finish();

ROLLBACK;
