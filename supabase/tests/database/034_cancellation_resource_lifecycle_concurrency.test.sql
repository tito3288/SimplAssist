BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This file commits fixture work through dblink. Refuse to run unless the
-- server has the local Supabase container shape and either the known local
-- JWT marker or an explicit disposable-database attestation supplied by the
-- test runner (PGOPTIONS='-c simplassist.disposable_test_database=on').
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
      'test_034_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(12);

CREATE TEMP TABLE cancellation_034_concurrency_state (
  name text PRIMARY KEY,
  payload jsonb NOT NULL
) ON COMMIT DROP;

-- Centralized finally routine. It cancels/drains asynchronous work, rolls
-- back every worker transaction, removes committed fixtures, restores the
-- exact pre-test operational config, and disconnects even on teardown error.
CREATE FUNCTION pg_temp.cleanup_034_concurrency(
  p_record_restore_result boolean
) RETURNS void
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_has_snapshot boolean := false;
  v_restored boolean := false;
  v_worker_cleanup_error text;
  v_cleanup_error text;
  v_restore_error text;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_034_cancel_first',
    'test_034_claim_after_cancel',
    'test_034_claim_first',
    'test_034_cancel_after_claim'
  ] LOOP
    IF v_connection_name = ANY(COALESCE(
      extensions.dblink_get_connections(),
      ARRAY[]::text[]
    )) THEN
      BEGIN
        IF extensions.dblink_is_busy(v_connection_name) = 1 THEN
          PERFORM extensions.dblink_cancel_query(v_connection_name);
        END IF;

        -- A completed asynchronous query reports not-busy but still owns its
        -- result until dblink_get_result drains it. Drain both known async
        -- connections unconditionally before attempting ROLLBACK.
        IF v_connection_name IN (
          'test_034_claim_after_cancel',
          'test_034_cancel_after_claim'
        ) THEN
          BEGIN
            PERFORM result
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS canceled_result(result text);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;

          BEGIN
            PERFORM result
            FROM extensions.dblink_get_result(
              v_connection_name,
              false
            ) AS drained_async_result(result text);
          EXCEPTION
            WHEN OTHERS THEN
              NULL;
          END;
        END IF;

        PERFORM extensions.dblink_exec(v_connection_name, 'ROLLBACK');
      EXCEPTION
        WHEN OTHERS THEN
          v_worker_cleanup_error := COALESCE(
            v_worker_cleanup_error,
            v_connection_name || ':' || SQLSTATE || ':' || SQLERRM
          );
      END;

      -- Closing the remote session is the final rollback guarantee. Do this
      -- before fixture cleanup so a damaged worker connection cannot retain a
      -- business-row lock and block the setup session's cleanup transaction.
      BEGIN
        PERFORM extensions.dblink_disconnect(v_connection_name);
      EXCEPTION
        WHEN OTHERS THEN
          v_worker_cleanup_error := COALESCE(
            v_worker_cleanup_error,
            v_connection_name || ':disconnect:' || SQLSTATE || ':' || SQLERRM
          );
      END;
    END IF;
  END LOOP;

  IF 'test_034_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      SELECT result
      INTO v_has_snapshot
      FROM extensions.dblink(
        'test_034_setup',
        $snapshot_exists_sql$
          SELECT to_regclass(
            'pg_temp.cancellation_034_original_release_config'
          ) IS NOT NULL
        $snapshot_exists_sql$
      ) AS snapshot_exists(result boolean);
    EXCEPTION
      WHEN OTHERS THEN
        v_has_snapshot := false;
    END;

    -- The remote setup is one transaction. Without its snapshot, none of its
    -- mutations committed, so cleanup must not touch pre-existing state.
    IF v_has_snapshot THEN
      BEGIN
        PERFORM extensions.dblink_exec(
          'test_034_setup',
          $cleanup_sql$
            DO $fixture_cleanup$
            BEGIN
              UPDATE public.telnyx_resource_release_config
              SET mode = 'disabled',
                  single_business_id = NULL,
                  expected_shared_messaging_profile_id = NULL,
                  expected_shared_voice_application_id = NULL,
                  protection_manifest_fingerprint = NULL,
                  protection_manifest_verified_at = NULL,
                  protection_manifest_verified_by = NULL,
                  dry_run_completed_at = NULL,
                  dry_run_completed_by = NULL,
                  single_business_test_completed_at = NULL,
                  single_business_test_completed_by = NULL,
                  updated_by = 'test_034_concurrency_teardown'
              WHERE id = 1;

              DELETE FROM public.telnyx_resource_release_events
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.telnyx_resource_release_actions
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.telnyx_resource_release_reasons
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              UPDATE public.businesses
              SET active_telnyx_release_run_id = NULL
              WHERE id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.telnyx_resource_release_runs
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.telnyx_managed_resources
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.phone_numbers
              WHERE business_id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              );

              DELETE FROM auth.users
              WHERE id IN (
                '00000000-0000-4000-a034-000000000091',
                '00000000-0000-4000-a034-000000000092'
              );

              DELETE FROM public.businesses
              WHERE id IN (
                '10000000-0000-4000-a034-000000000091',
                '10000000-0000-4000-a034-000000000092'
              )
                AND owner_id IS NULL
                AND name IN ('Telnyx Cancel First', 'Telnyx Claim First');

              DELETE FROM public.telnyx_release_protections
              WHERE reviewed_by = 'test_034_concurrency'
                AND protection_key IN (
                  'bryan_develops_retain_all',
                  'simplassist_shared_messaging_profile',
                  'simplassist_shared_voice_application'
                );

              DELETE FROM public.businesses
              WHERE id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
                AND owner_id IS NULL
                AND name = 'Bryan Protection Concurrency Fixture';
            END;
            $fixture_cleanup$;
          $cleanup_sql$
        );
      EXCEPTION
        WHEN OTHERS THEN
          v_cleanup_error := SQLSTATE || ':' || SQLERRM;
      END;

      -- authorization_epoch and updated_at are intentionally monotonic and
      -- cannot be rewound by the config guard. Every operational value is
      -- restored from the byte-for-byte row snapshot.
      BEGIN
        PERFORM extensions.dblink_exec(
          'test_034_setup',
          $restore_config_sql$
            UPDATE public.telnyx_resource_release_config AS config
            SET mode = original.mode,
                single_business_id = original.single_business_id,
                expected_shared_messaging_profile_id =
                  original.expected_shared_messaging_profile_id,
                expected_shared_voice_application_id =
                  original.expected_shared_voice_application_id,
                protection_manifest_fingerprint =
                  original.protection_manifest_fingerprint,
                protection_manifest_verified_at =
                  original.protection_manifest_verified_at,
                protection_manifest_verified_by =
                  original.protection_manifest_verified_by,
                dry_run_completed_at = original.dry_run_completed_at,
                dry_run_completed_by = original.dry_run_completed_by,
                single_business_test_completed_at =
                  original.single_business_test_completed_at,
                single_business_test_completed_by =
                  original.single_business_test_completed_by,
                updated_by = original.updated_by
            FROM cancellation_034_original_release_config AS original
            WHERE config.id = original.id
          $restore_config_sql$
        );

        SELECT result
        INTO v_restored
        FROM extensions.dblink(
          'test_034_setup',
          $verify_config_restore$
            SELECT
              (
                to_jsonb(config)
                  - 'authorization_epoch'
                  - 'updated_at'
              ) = (
                to_jsonb(original)
                  - 'authorization_epoch'
                  - 'updated_at'
              )
              AND config.authorization_epoch >=
                    original.authorization_epoch
            FROM public.telnyx_resource_release_config AS config
            CROSS JOIN cancellation_034_original_release_config AS original
            WHERE config.id = 1
              AND original.id = 1
          $verify_config_restore$
        ) AS restored_config(result boolean);
      EXCEPTION
        WHEN OTHERS THEN
          v_restore_error := SQLSTATE || ':' || SQLERRM;
      END;
    END IF;
  END IF;

  IF p_record_restore_result THEN
    INSERT INTO cancellation_034_concurrency_state (name, payload)
    VALUES (
      'config_restored',
      jsonb_build_object('result', v_has_snapshot AND v_restored)
    )
    ON CONFLICT (name) DO UPDATE
    SET payload = EXCLUDED.payload;
  END IF;

  FOREACH v_connection_name IN ARRAY COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  ) LOOP
    IF v_connection_name LIKE 'test_034_%' THEN
      BEGIN
        PERFORM extensions.dblink_disconnect(v_connection_name);
      EXCEPTION
        WHEN OTHERS THEN
          NULL;
      END;
    END IF;
  END LOOP;

  IF v_worker_cleanup_error IS NOT NULL
     OR v_cleanup_error IS NOT NULL
     OR v_restore_error IS NOT NULL THEN
    RAISE EXCEPTION
      'test_034_concurrency_teardown_failed workers=% cleanup=% restore=%',
      COALESCE(v_worker_cleanup_error, 'ok'),
      COALESCE(v_cleanup_error, 'ok'),
      COALESCE(v_restore_error, 'ok')
      USING ERRCODE = '55000';
  END IF;
END;
$$;

-- All committed setup and both lock interleavings live inside this block.
-- The EXCEPTION branch is the finally path: after any unexpected error it
-- invokes the same idempotent cleanup/restore routine, then rethrows.
DO $orchestrate_concurrency$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_boolean boolean;
  v_integer integer;
  v_bigint bigint;
  v_payload jsonb;
  v_cancel_first_release_at timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('test_034_cancellation_concurrency', 0)
  );

  PERFORM extensions.dblink_connect('test_034_setup', v_connection_string);
  PERFORM extensions.dblink_connect(
    'test_034_cancel_first',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_034_claim_after_cancel',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_034_claim_first',
    v_connection_string
  );
  PERFORM extensions.dblink_connect(
    'test_034_cancel_after_claim',
    v_connection_string
  );

  PERFORM extensions.dblink_exec(
    'test_034_setup',
    $remote_setup$
      DO $fixture$
      DECLARE
        v_cancel_first_release_at timestamptz;
        v_claim_first_release_at timestamptz;
      BEGIN
        CREATE TEMP TABLE cancellation_034_original_release_config
        ON COMMIT PRESERVE ROWS
        AS
        SELECT *
        FROM public.telnyx_resource_release_config
        WITH NO DATA;

        INSERT INTO cancellation_034_original_release_config
        SELECT *
        FROM public.telnyx_resource_release_config
        WHERE id = 1;

        UPDATE public.telnyx_resource_release_config
        SET mode = 'disabled',
            single_business_id = NULL,
            protection_manifest_fingerprint = NULL,
            protection_manifest_verified_at = NULL,
            protection_manifest_verified_by = NULL,
            dry_run_completed_at = NULL,
            dry_run_completed_by = NULL,
            single_business_test_completed_at = NULL,
            single_business_test_completed_by = NULL,
            updated_by = 'test_034_concurrency_setup'
        WHERE id = 1;

        DELETE FROM public.telnyx_resource_release_events
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.telnyx_resource_release_actions
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.telnyx_resource_release_reasons
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        UPDATE public.businesses
        SET active_telnyx_release_run_id = NULL
        WHERE id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.telnyx_resource_release_runs
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.telnyx_managed_resources
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.phone_numbers
        WHERE business_id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        );
        DELETE FROM auth.users
        WHERE id IN (
          '00000000-0000-4000-a034-000000000091',
          '00000000-0000-4000-a034-000000000092'
        );
        DELETE FROM public.businesses
        WHERE id IN (
          '10000000-0000-4000-a034-000000000091',
          '10000000-0000-4000-a034-000000000092'
        )
          AND owner_id IS NULL
          AND name IN ('Telnyx Cancel First', 'Telnyx Claim First');
        DELETE FROM public.telnyx_release_protections
        WHERE reviewed_by = 'test_034_concurrency'
          AND protection_key IN (
            'bryan_develops_retain_all',
            'simplassist_shared_messaging_profile',
            'simplassist_shared_voice_application'
          );
        DELETE FROM public.businesses
        WHERE id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
          AND owner_id IS NULL
          AND name = 'Bryan Protection Concurrency Fixture';

        INSERT INTO public.businesses (
          id,
          owner_id,
          name,
          slug,
          business_type
        ) VALUES (
          'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
          NULL,
          'Bryan Protection Concurrency Fixture',
          'bryan-protection-concurrency-fixture',
          'general'
        )
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO public.telnyx_release_protections (
          protection_key,
          scope,
          business_id,
          reason_code,
          reviewed_by
        ) VALUES (
          'bryan_develops_retain_all',
          'business_all',
          'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
          'known_live_production_resource_relationship',
          'test_034_concurrency'
        )
        ON CONFLICT (protection_key) DO NOTHING;

        INSERT INTO public.telnyx_release_protections (
          protection_key,
          scope,
          resource_type,
          provider_id,
          reason_code,
          reviewed_by
        ) VALUES
          (
            'simplassist_shared_messaging_profile',
            'resource',
            'messaging_profile',
            '03400000-0000-4000-a000-0000000000cc',
            'known_shared_production_messaging_profile',
            'test_034_concurrency'
          ),
          (
            'simplassist_shared_voice_application',
            'resource',
            'voice_application',
            '340000000099',
            'known_shared_production_voice_application',
            'test_034_concurrency'
          )
        ON CONFLICT (protection_key) DO NOTHING;

        INSERT INTO auth.users (id, email)
        VALUES
          (
            '00000000-0000-4000-a034-000000000091',
            'telnyx-cancel-first@example.test'
          ),
          (
            '00000000-0000-4000-a034-000000000092',
            'telnyx-claim-first@example.test'
          );

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a034-000000000091',
            name = 'Telnyx Cancel First',
            slug = 'telnyx-cancel-first',
            telnyx_resource_state = 'active'
        WHERE owner_id = '00000000-0000-4000-a034-000000000091';

        UPDATE public.businesses
        SET id = '10000000-0000-4000-a034-000000000092',
            name = 'Telnyx Claim First',
            slug = 'telnyx-claim-first',
            telnyx_resource_state = 'active'
        WHERE owner_id = '00000000-0000-4000-a034-000000000092';

        INSERT INTO public.phone_numbers (
          id,
          business_id,
          phone_number,
          telnyx_phone_number_id,
          is_active
        ) VALUES
          (
            '20000000-0000-4000-a034-000000000091',
            '10000000-0000-4000-a034-000000000091',
            '+13175550091',
            '1293384261075734091',
            true
          ),
          (
            '20000000-0000-4000-a034-000000000092',
            '10000000-0000-4000-a034-000000000092',
            '+13175550092',
            '1293384261075734092',
            true
          );

        INSERT INTO public.telnyx_managed_resources (
          id,
          business_id,
          phone_number_id,
          resource_type,
          provider_id,
          canonical_e164,
          provider_origin,
          ownership_state,
          verified_by,
          verified_at
        ) VALUES
          (
            '30000000-0000-4000-a034-000000000091',
            '10000000-0000-4000-a034-000000000091',
            '20000000-0000-4000-a034-000000000091',
            'phone_number',
            '1293384261075734091',
            '+13175550091',
            'created_by_simplassist',
            'managed_releaseable',
            'test_034_concurrency',
            now()
          ),
          (
            '30000000-0000-4000-a034-000000000092',
            '10000000-0000-4000-a034-000000000092',
            '20000000-0000-4000-a034-000000000092',
            'phone_number',
            '1293384261075734092',
            '+13175550092',
            'created_by_simplassist',
            'managed_releaseable',
            'test_034_concurrency',
            now()
          );

        -- Assign the deadlines only after the heavier fixture work so the
        -- cancel-first transaction has a reliable pre-deadline window even
        -- on a slower disposable database.
        v_cancel_first_release_at :=
          clock_timestamp() + interval '5 seconds';
        v_claim_first_release_at :=
          clock_timestamp() - interval '1 second';

        PERFORM public.ensure_telnyx_release_reason(
          '10000000-0000-4000-a034-000000000091',
          'subscription_ended',
          v_cancel_first_release_at - interval '30 days',
          v_cancel_first_release_at,
          'sub_034_cancel_first',
          'evt_034_cancel_first',
          'test_034_concurrency'
        );
        PERFORM public.ensure_telnyx_release_reason(
          '10000000-0000-4000-a034-000000000092',
          'subscription_ended',
          v_claim_first_release_at - interval '30 days',
          v_claim_first_release_at,
          'sub_034_claim_first',
          'evt_034_claim_first',
          'test_034_concurrency'
        );

        UPDATE public.telnyx_resource_release_config
        SET mode = 'single_business',
            single_business_id =
              '10000000-0000-4000-a034-000000000091',
            expected_shared_messaging_profile_id =
              '03400000-0000-4000-a000-0000000000cc',
            expected_shared_voice_application_id = '340000000099',
            protection_manifest_fingerprint =
              public.telnyx_release_manifest_fingerprint(
                '03400000-0000-4000-a000-0000000000cc',
                '340000000099'
              ),
            protection_manifest_verified_at = now(),
            protection_manifest_verified_by = 'test_034_concurrency',
            dry_run_completed_at = now(),
            dry_run_completed_by = 'test_034_concurrency',
            updated_by = 'test_034_concurrency'
        WHERE id = 1;
      END;
      $fixture$;
    $remote_setup$
  );

  SELECT result
  INTO v_cancel_first_release_at
  FROM extensions.dblink(
    'test_034_setup',
    $cancel_first_release_at_sql$
      SELECT run.effective_release_at
      FROM public.telnyx_resource_release_runs AS run
      WHERE run.business_id =
              '10000000-0000-4000-a034-000000000091'
      ORDER BY run.generation DESC
      LIMIT 1
    $cancel_first_release_at_sql$
  ) AS cancel_first_release_at(result timestamptz);

  -- Commit order A: cancellation starts before the deadline and owns the
  -- business row lock. The claimant starts only after the wall clock crosses
  -- that deadline, so it sees due committed work and must recheck after the
  -- cancellation commits.
  PERFORM extensions.dblink_exec('test_034_cancel_first', 'BEGIN');

  SELECT result
  INTO v_boolean
  FROM extensions.dblink(
    'test_034_cancel_first',
    $remote_cancel_first$
      SELECT public.cancel_telnyx_release_reason(
        '10000000-0000-4000-a034-000000000091',
        'subscription_ended',
        'test_034_cancel_first'
      )
    $remote_cancel_first$
  ) AS cancel_first_result(result boolean);

  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('cancel_first_result', jsonb_build_object('result', v_boolean));

  PERFORM pg_sleep(
    GREATEST(
      EXTRACT(EPOCH FROM (
        v_cancel_first_release_at - clock_timestamp()
      ))::double precision + 0.1,
      0.0
    )
  );

  PERFORM extensions.dblink_exec('test_034_claim_after_cancel', 'BEGIN');

  v_integer := extensions.dblink_send_query(
    'test_034_claim_after_cancel',
    $remote_claim_after_cancel$
      SELECT public.claim_telnyx_release_action(
        'test-034-claim-after-cancel',
        120
      )
    $remote_claim_after_cancel$
  );
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('cancel_first_send', jsonb_build_object('result', v_integer));

  PERFORM pg_sleep(0.1);
  v_integer := extensions.dblink_is_busy('test_034_claim_after_cancel');
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('cancel_first_busy', jsonb_build_object('result', v_integer));

  SELECT count(*)::bigint
  INTO v_bigint
  FROM public.telnyx_resource_release_actions
  WHERE business_id = '10000000-0000-4000-a034-000000000091'
    AND state = 'leased';
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('cancel_first_leases', jsonb_build_object('result', v_bigint));

  PERFORM extensions.dblink_exec('test_034_cancel_first', 'COMMIT');
  SELECT result
  INTO v_payload
  FROM extensions.dblink_get_result('test_034_claim_after_cancel')
    AS claim_after_cancel_result(result jsonb);
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES (
    'claim_after_cancel_result',
    jsonb_build_object('result', v_payload)
  );
  PERFORM result
  FROM extensions.dblink_get_result(
    'test_034_claim_after_cancel',
    false
  ) AS drained_claim_after_cancel(result jsonb);
  PERFORM extensions.dblink_exec('test_034_claim_after_cancel', 'ROLLBACK');

  SELECT result
  INTO v_payload
  FROM extensions.dblink(
    'test_034_setup',
    $cancel_first_final_sql$
      SELECT jsonb_build_object(
        'reason_status', reason.status,
        'run_status', run.status,
        'point_of_no_return_at', run.point_of_no_return_at
      )
      FROM public.telnyx_resource_release_reasons AS reason
      JOIN public.telnyx_resource_release_runs AS run
        ON run.id = reason.run_id
      WHERE reason.business_id =
              '10000000-0000-4000-a034-000000000091'
        AND reason.reason_type = 'subscription_ended'
    $cancel_first_final_sql$
  ) AS cancel_first_final(result jsonb);
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('cancel_first_final', v_payload);

  -- Commit order B: claim owns the business row lock first.
  PERFORM extensions.dblink_exec(
    'test_034_setup',
    $remote_select_claim_first$
      UPDATE public.telnyx_resource_release_config
      SET mode = 'single_business',
          single_business_id =
            '10000000-0000-4000-a034-000000000092',
          updated_by = 'test_034_concurrency_claim_first'
      WHERE id = 1
    $remote_select_claim_first$
  );
  PERFORM extensions.dblink_exec('test_034_claim_first', 'BEGIN');
  PERFORM extensions.dblink_exec('test_034_cancel_after_claim', 'BEGIN');

  SELECT result
  INTO v_payload
  FROM extensions.dblink(
    'test_034_claim_first',
    $remote_claim_first$
      SELECT public.claim_telnyx_release_action(
        'test-034-claim-first',
        120
      )
    $remote_claim_first$
  ) AS claim_first_result(result jsonb);
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('claim_first_result', v_payload);

  v_integer := extensions.dblink_send_query(
    'test_034_cancel_after_claim',
    $remote_cancel_after_claim$
      SELECT public.cancel_telnyx_release_reason(
        '10000000-0000-4000-a034-000000000092',
        'subscription_ended',
        'test_034_cancel_after_claim'
      )
    $remote_cancel_after_claim$
  );
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('claim_first_send', jsonb_build_object('result', v_integer));

  PERFORM pg_sleep(0.1);
  v_integer := extensions.dblink_is_busy('test_034_cancel_after_claim');
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('claim_first_busy', jsonb_build_object('result', v_integer));

  PERFORM extensions.dblink_exec('test_034_claim_first', 'COMMIT');
  SELECT result
  INTO v_boolean
  FROM extensions.dblink_get_result('test_034_cancel_after_claim')
    AS cancel_after_claim_result(result boolean);
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES (
    'cancel_after_claim_result',
    jsonb_build_object('result', v_boolean)
  );
  PERFORM result
  FROM extensions.dblink_get_result(
    'test_034_cancel_after_claim',
    false
  ) AS drained_cancel_after_claim(result boolean);
  PERFORM extensions.dblink_exec('test_034_cancel_after_claim', 'ROLLBACK');

  SELECT result
  INTO v_payload
  FROM extensions.dblink(
    'test_034_setup',
    $claim_first_final_sql$
      SELECT jsonb_build_object(
        'action_state', action.state,
        'has_lease_token', action.lease_token IS NOT NULL,
        'run_status', run.status,
        'has_point_of_no_return', run.point_of_no_return_at IS NOT NULL,
        'reason_status', reason.status
      )
      FROM public.telnyx_resource_release_actions AS action
      JOIN public.telnyx_resource_release_runs AS run
        ON run.id = action.run_id
      JOIN public.telnyx_resource_release_reasons AS reason
        ON reason.run_id = run.id
       AND reason.reason_type = 'subscription_ended'
      WHERE action.business_id =
              '10000000-0000-4000-a034-000000000092'
        AND action.resource_type = 'phone_number'
    $claim_first_final_sql$
  ) AS claim_first_final(result jsonb);
  INSERT INTO cancellation_034_concurrency_state (name, payload)
  VALUES ('claim_first_final', v_payload);

  PERFORM pg_temp.cleanup_034_concurrency(true);
EXCEPTION
  WHEN OTHERS THEN
    BEGIN
      PERFORM pg_temp.cleanup_034_concurrency(false);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING
          'test_034_concurrency_finally_failed [%] %',
          SQLSTATE,
          SQLERRM;
    END;
    RAISE;
END;
$orchestrate_concurrency$;

-- Assertions run only against observations captured before the finally
-- cleanup. No assertion can strand a remote transaction or committed fixture.
SELECT is(
  (payload ->> 'result')::boolean,
  true,
  'cancel-first transaction cancels the active release reason'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_first_result';

SELECT is(
  (payload ->> 'result')::integer,
  1,
  'a worker starts claiming while cancellation is uncommitted'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_first_send';

SELECT is(
  (payload ->> 'result')::integer,
  1,
  'claim waits behind the cancel-first business lock'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_first_busy';

SELECT is(
  (payload ->> 'result')::bigint,
  0::bigint,
  'the waiting claim creates no partially visible lease'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_first_leases';

SELECT is(
  payload -> 'result',
  'null'::jsonb,
  'claim rechecks after the lock and returns no canceled work'
)
FROM cancellation_034_concurrency_state
WHERE name = 'claim_after_cancel_result';

SELECT ok(
  payload ->> 'reason_status' = 'canceled'
    AND payload ->> 'run_status' = 'canceled'
    AND payload -> 'point_of_no_return_at' = 'null'::jsonb,
  'cancel-first order remains canceled with no point of no return'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_first_final';

SELECT ok(
  payload ->> 'state' = 'leased'
    AND (payload ->> 'business_id')::uuid =
          '10000000-0000-4000-a034-000000000092',
  'claim-first transaction leases the selected due action'
)
FROM cancellation_034_concurrency_state
WHERE name = 'claim_first_result';

SELECT is(
  (payload ->> 'result')::integer,
  1,
  'cancellation starts while the claim is uncommitted'
)
FROM cancellation_034_concurrency_state
WHERE name = 'claim_first_send';

SELECT is(
  (payload ->> 'result')::integer,
  1,
  'cancellation waits behind the claim-first business lock'
)
FROM cancellation_034_concurrency_state
WHERE name = 'claim_first_busy';

SELECT is(
  (payload ->> 'result')::boolean,
  false,
  'cancellation rechecks after claim and cannot cross the point of no return'
)
FROM cancellation_034_concurrency_state
WHERE name = 'cancel_after_claim_result';

SELECT ok(
  payload ->> 'action_state' = 'leased'
    AND (payload ->> 'has_lease_token')::boolean
    AND payload ->> 'run_status' = 'releasing'
    AND (payload ->> 'has_point_of_no_return')::boolean
    AND payload ->> 'reason_status' = 'active',
  'claim-first order preserves the lease, active reason, and no-return marker'
)
FROM cancellation_034_concurrency_state
WHERE name = 'claim_first_final';

SELECT is(
  (payload ->> 'result')::boolean,
  true,
  'finally teardown restores the complete pre-test release config snapshot'
)
FROM cancellation_034_concurrency_state
WHERE name = 'config_restored';

SELECT * FROM finish();

ROLLBACK;
