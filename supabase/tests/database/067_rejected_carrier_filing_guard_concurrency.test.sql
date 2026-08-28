BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(5);

-- The remote sessions commit independently from this pgTAP transaction.
-- Fixed fixture IDs plus up-front/final cleanup keep interrupted reruns safe.
DO $local_setup$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
BEGIN
  PERFORM extensions.dblink_connect('test_067_setup', v_connection_string);
  PERFORM extensions.dblink_connect('test_067_webhook', v_connection_string);
  PERFORM extensions.dblink_connect('test_067_owner', v_connection_string);

  PERFORM extensions.dblink_exec(
    'test_067_setup',
    $remote_setup$
      DO $fixture$
      BEGIN
        DELETE FROM public.businesses
        WHERE id = '10000000-0000-4000-a067-000000000003';

        DELETE FROM auth.users
        WHERE id = '00000000-0000-4000-a067-000000000003';

        INSERT INTO auth.users (id, email)
        VALUES (
          '00000000-0000-4000-a067-000000000003',
          'rejected-language-race-a067@example.test'
        );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a067-000000000003',
            name = 'Rejected Language Race 067',
            slug = 'rejected-language-race-a067'
        WHERE owner_id = '00000000-0000-4000-a067-000000000003';

        INSERT INTO public.ai_settings (business_id, language)
        VALUES (
          '10000000-0000-4000-a067-000000000003',
          'en'
        );
      END;
      $fixture$;
    $remote_setup$
  );

  PERFORM extensions.dblink_exec('test_067_webhook', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_067_webhook',
    $remote_rejection$
      UPDATE public.businesses
      SET campaign_status = 'rejected',
          onboarding_registration_status = 'failed'
      WHERE id = '10000000-0000-4000-a067-000000000003'
    $remote_rejection$
  );

  PERFORM extensions.dblink_exec('test_067_owner', 'BEGIN');
  PERFORM extensions.dblink_exec(
    'test_067_owner',
    $remote_claims$
      SET LOCAL "request.jwt.claim.sub" =
        '00000000-0000-4000-a067-000000000003'
    $remote_claims$
  );
  PERFORM extensions.dblink_exec(
    'test_067_owner',
    'SET LOCAL ROLE authenticated'
  );
END;
$local_setup$;

SELECT is(
  extensions.dblink_send_query(
    'test_067_owner',
    $remote_owner_write$
      UPDATE public.ai_settings
      SET language = 'es'
      WHERE business_id = '10000000-0000-4000-a067-000000000003'
      RETURNING language
    $remote_owner_write$
  ),
  1,
  'an owner language update starts while the rejection webhook is uncommitted'
);

DO $wait_for_parent_lock$
BEGIN
  PERFORM pg_sleep(0.1);
END;
$wait_for_parent_lock$;

SELECT is(
  extensions.dblink_is_busy('test_067_owner'),
  1,
  'the owner write waits for the carrier-status row lock'
);

SELECT ok(
  (SELECT language = 'en'
   FROM public.ai_settings
   WHERE business_id = '10000000-0000-4000-a067-000000000003')
  AND
  (SELECT campaign_status IS NULL
   FROM public.businesses
   WHERE id = '10000000-0000-4000-a067-000000000003'),
  'neither transaction exposes partial state while the webhook is pending'
);

DO $commit_webhook$
BEGIN
  PERFORM extensions.dblink_exec('test_067_webhook', 'COMMIT');
END;
$commit_webhook$;

SELECT throws_ok(
  $$
    SELECT *
    FROM extensions.dblink_get_result('test_067_owner')
      AS owner_result(language text)
  $$,
  '42501',
  'customer writes cannot change campaign language after rejection',
  'the waiting owner write observes the committed rejection and fails closed'
);

SELECT ok(
  (SELECT language = 'en'
   FROM public.ai_settings
   WHERE business_id = '10000000-0000-4000-a067-000000000003')
  AND
  (SELECT campaign_status = 'rejected'
   FROM public.businesses
   WHERE id = '10000000-0000-4000-a067-000000000003'),
  'the carrier rejection wins without campaign-language drift'
);

DO $remote_cleanup$
BEGIN
  -- Drain libpq's end-of-results marker after throws_ok consumed the expected
  -- authorization result, then release the aborted owner transaction.
  PERFORM language
  FROM extensions.dblink_get_result('test_067_owner', false)
    AS drained_owner_result(language text);

  PERFORM extensions.dblink_exec('test_067_owner', 'ROLLBACK');

  PERFORM extensions.dblink_exec(
    'test_067_setup',
    $cleanup_sql$
      DELETE FROM auth.users
      WHERE id = '00000000-0000-4000-a067-000000000003'
    $cleanup_sql$
  );

  PERFORM extensions.dblink_disconnect('test_067_webhook');
  PERFORM extensions.dblink_disconnect('test_067_owner');
  PERFORM extensions.dblink_disconnect('test_067_setup');
END;
$remote_cleanup$;

SELECT * FROM finish();

ROLLBACK;
