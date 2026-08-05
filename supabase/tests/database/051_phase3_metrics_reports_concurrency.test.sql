BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

-- This test commits fixtures and winning transitions through dblink. Refuse
-- to run unless the server has the disposable local Supabase shape, or the
-- runner explicitly attests that the target database is disposable with
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
      'test_051_concurrency_requires_disposable_local_database'
      USING ERRCODE = '55000';
  END IF;
END;
$require_disposable_local_database$;

SELECT plan(23);

CREATE TEMP TABLE metrics_reports_051_concurrency_state (
  name text PRIMARY KEY,
  integer_value integer,
  bigint_value bigint,
  boolean_value boolean
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.cleanup_051_metrics_reports_concurrency()
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_connection_name text;
  v_cleanup_ok boolean := true;
BEGIN
  FOREACH v_connection_name IN ARRAY ARRAY[
    'test_051_metrics_b',
    'test_051_metrics_a'
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
          PERFORM result_count
          FROM extensions.dblink_get_result(v_connection_name, false)
            AS pending_result(result_count bigint);
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

        BEGIN
          PERFORM result_count
          FROM extensions.dblink_get_result(v_connection_name, false)
            AS drained_result(result_count bigint);
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;

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

  IF 'test_051_metrics_setup' = ANY(COALESCE(
    extensions.dblink_get_connections(),
    ARRAY[]::text[]
  )) THEN
    BEGIN
      PERFORM extensions.dblink_exec(
        'test_051_metrics_setup',
        $cleanup_sql$
          DO $cleanup$
          BEGIN
            DELETE FROM public.metrics_report_deliveries
            WHERE report_id IN (
              SELECT report.id
              FROM public.metrics_reports AS report
              JOIN public.metrics_report_configs AS config
                ON config.id = report.config_id
              WHERE config.partner_id =
                '51000000-0000-4000-a051-000000000101'
            );

            DELETE FROM public.metrics_reports
            WHERE config_id IN (
              SELECT config.id
              FROM public.metrics_report_configs AS config
              WHERE config.partner_id =
                '51000000-0000-4000-a051-000000000101'
            );

            DELETE FROM public.metrics_report_recipients
            WHERE config_id IN (
              SELECT config.id
              FROM public.metrics_report_configs AS config
              WHERE config.partner_id =
                '51000000-0000-4000-a051-000000000101'
            );

            DELETE FROM public.metrics_report_selected_businesses
            WHERE config_id IN (
              SELECT config.id
              FROM public.metrics_report_configs AS config
              WHERE config.partner_id =
                '51000000-0000-4000-a051-000000000101'
            );

            DELETE FROM public.metrics_report_configs
            WHERE partner_id =
              '51000000-0000-4000-a051-000000000101';

            DELETE FROM public.business_metric_events
            WHERE business_id =
              '51000000-0000-4000-a051-000000000102';

            DELETE FROM public.businesses
            WHERE id = '51000000-0000-4000-a051-000000000102';

            DELETE FROM public.partners
            WHERE id = '51000000-0000-4000-a051-000000000101';
          END;
          $cleanup$;
        $cleanup_sql$
      );
      PERFORM extensions.dblink_disconnect('test_051_metrics_setup');
    EXCEPTION
      WHEN OTHERS THEN
        v_cleanup_ok := false;
        BEGIN
          PERFORM extensions.dblink_disconnect('test_051_metrics_setup');
        EXCEPTION
          WHEN OTHERS THEN
            NULL;
        END;
    END;
  END IF;

  RETURN v_cleanup_ok;
END;
$$;

DO $orchestrate_metrics_report_races$
DECLARE
  v_connection_string text :=
    'host=supabase_db_SimplAssist port=' || current_setting('port') ||
    ' dbname=' || current_database() || ' user=' || current_user ||
    ' password=postgres';
  v_config_id uuid;
  v_report_id uuid;
  v_delivery_id uuid;
  v_result_count bigint;
  v_send_result integer;
  v_busy_result integer;
  v_visible_count bigint;
  v_final_count bigint;
  v_final_shape boolean;
  v_cleanup_ok boolean := false;
BEGIN
  BEGIN
    PERFORM extensions.dblink_connect(
      'test_051_metrics_setup',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_051_metrics_a',
      v_connection_string
    );
    PERFORM extensions.dblink_connect(
      'test_051_metrics_b',
      v_connection_string
    );

    PERFORM extensions.dblink_exec(
      'test_051_metrics_setup',
      $fixture_sql$
        DO $fixture$
        BEGIN
          DELETE FROM public.metrics_report_deliveries
          WHERE report_id IN (
            SELECT report.id
            FROM public.metrics_reports AS report
            JOIN public.metrics_report_configs AS config
              ON config.id = report.config_id
            WHERE config.partner_id =
              '51000000-0000-4000-a051-000000000101'
          );

          DELETE FROM public.metrics_reports
          WHERE config_id IN (
            SELECT config.id
            FROM public.metrics_report_configs AS config
            WHERE config.partner_id =
              '51000000-0000-4000-a051-000000000101'
          );

          DELETE FROM public.metrics_report_recipients
          WHERE config_id IN (
            SELECT config.id
            FROM public.metrics_report_configs AS config
            WHERE config.partner_id =
              '51000000-0000-4000-a051-000000000101'
          );

          DELETE FROM public.metrics_report_selected_businesses
          WHERE config_id IN (
            SELECT config.id
            FROM public.metrics_report_configs AS config
            WHERE config.partner_id =
              '51000000-0000-4000-a051-000000000101'
          );

          DELETE FROM public.metrics_report_configs
          WHERE partner_id =
            '51000000-0000-4000-a051-000000000101';

          DELETE FROM public.business_metric_events
          WHERE business_id =
            '51000000-0000-4000-a051-000000000102';

          DELETE FROM public.businesses
          WHERE id = '51000000-0000-4000-a051-000000000102';

          DELETE FROM public.partners
          WHERE id = '51000000-0000-4000-a051-000000000101';

          INSERT INTO public.partners (id, name, slug)
          VALUES (
            '51000000-0000-4000-a051-000000000101',
            'Metrics Reports Concurrency 051',
            'metrics-reports-concurrency-051'
          );

          INSERT INTO public.businesses (
            id,
            name,
            business_type,
            slug,
            partner_id,
            billing_mode,
            partner_plan
          ) VALUES (
            '51000000-0000-4000-a051-000000000102',
            'Zero Event Concurrency Business 051',
            'general',
            'zero-event-concurrency-business-051',
            '51000000-0000-4000-a051-000000000101',
            'invoiced',
            'sms_and_chat'
          );
        END;
        $fixture$;
      $fixture_sql$
    );

    -- First-time saves for one partner scope must serialize on the partial
    -- uniqueness boundary and leave one complete replacement payload.
    PERFORM extensions.dblink_exec('test_051_metrics_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'BEGIN');
    PERFORM extensions.dblink_exec(
      'test_051_metrics_a',
      'SET ROLE service_role'
    );
    PERFORM extensions.dblink_exec(
      'test_051_metrics_b',
      'SET ROLE service_role'
    );

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink(
      'test_051_metrics_a',
      $first_config_sql$
        SELECT count(*)::bigint
        FROM public.save_metrics_report_config_v1(
          'partner',
          '51000000-0000-4000-a051-000000000101',
          'selected',
          '2020-01-01',
          true,
          '[{"email":"first-config-051@example.test","enabled":true}]',
          ARRAY[
            '51000000-0000-4000-a051-000000000102'::uuid
          ]
        )
      $first_config_sql$
    ) AS first_config(result_count bigint);

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('config_first_count', v_result_count);

    v_send_result := extensions.dblink_send_query(
      'test_051_metrics_b',
      $second_config_sql$
        SELECT count(*)::bigint
        FROM public.save_metrics_report_config_v1(
          'partner',
          '51000000-0000-4000-a051-000000000101',
          'selected',
          '2020-02-01',
          true,
          '[{"email":"second-config-051@example.test","enabled":true}]',
          ARRAY[
            '51000000-0000-4000-a051-000000000102'::uuid
          ]
        )
      $second_config_sql$
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_051_metrics_b');

    SELECT count(*)::bigint
    INTO v_visible_count
    FROM public.metrics_report_configs AS config
    WHERE config.partner_id =
      '51000000-0000-4000-a051-000000000101';

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      integer_value
    ) VALUES
      ('config_send', v_send_result),
      ('config_busy', v_busy_result);
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('config_visible_before_commit', v_visible_count);

    PERFORM extensions.dblink_exec('test_051_metrics_a', 'COMMIT');

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink_get_result('test_051_metrics_b')
      AS second_config(result_count bigint);
    PERFORM result_count
    FROM extensions.dblink_get_result('test_051_metrics_b', false)
      AS drained_second_config(result_count bigint);
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'COMMIT');

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('config_second_count', v_result_count);

    SELECT count(*)::bigint
    INTO v_final_count
    FROM public.metrics_report_configs AS config
    WHERE config.partner_id =
      '51000000-0000-4000-a051-000000000101';

    SELECT config.id
    INTO v_config_id
    FROM public.metrics_report_configs AS config
    WHERE config.partner_id =
      '51000000-0000-4000-a051-000000000101';

    SELECT
      config.selection_mode = 'selected'
      AND config.reporting_starts_on = '2020-02-01'::date
      AND config.enabled
      AND (
        SELECT count(*) = 1
           AND bool_and(recipient.email =
             'second-config-051@example.test')
           AND bool_and(recipient.enabled)
        FROM public.metrics_report_recipients AS recipient
        WHERE recipient.config_id = config.id
      )
      AND (
        SELECT count(*) = 1
           AND bool_and(selected.business_id =
             '51000000-0000-4000-a051-000000000102'::uuid)
        FROM public.metrics_report_selected_businesses AS selected
        WHERE selected.config_id = config.id
      )
    INTO v_final_shape
    FROM public.metrics_report_configs AS config
    WHERE config.id = v_config_id;

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('config_final_count', v_final_count);
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      boolean_value
    ) VALUES ('config_final_shape', v_final_shape);

    -- The builder locks the config. Its waiter must observe the committed
    -- report and return existing, never a second report or orphan delivery.
    PERFORM extensions.dblink_exec('test_051_metrics_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'BEGIN');

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink(
      'test_051_metrics_a',
      format(
        $first_build_sql$
          SELECT count(*) FILTER (WHERE outcome = 'created')
          FROM public.build_metrics_report_snapshot_v1(
            %L::uuid,
            '2020-03-01'
          )
        $first_build_sql$,
        v_config_id
      )
    ) AS first_build(result_count bigint);

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('build_first_created', v_result_count);

    v_send_result := extensions.dblink_send_query(
      'test_051_metrics_b',
      format(
        $second_build_sql$
          SELECT count(*) FILTER (WHERE outcome = 'existing')
          FROM public.build_metrics_report_snapshot_v1(
            %L::uuid,
            '2020-03-01'
          )
        $second_build_sql$,
        v_config_id
      )
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_051_metrics_b');

    SELECT count(*)::bigint
    INTO v_visible_count
    FROM public.metrics_reports AS report
    WHERE report.config_id = v_config_id
      AND report.period_start = '2020-03-01';

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      integer_value
    ) VALUES
      ('build_send', v_send_result),
      ('build_busy', v_busy_result);
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('build_visible_before_commit', v_visible_count);

    PERFORM extensions.dblink_exec('test_051_metrics_a', 'COMMIT');

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink_get_result('test_051_metrics_b')
      AS second_build(result_count bigint);
    PERFORM result_count
    FROM extensions.dblink_get_result('test_051_metrics_b', false)
      AS drained_second_build(result_count bigint);
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'COMMIT');

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('build_second_existing', v_result_count);

    SELECT count(*)::bigint
    INTO v_final_count
    FROM public.metrics_reports AS report
    WHERE report.config_id = v_config_id
      AND report.period_start = '2020-03-01';

    SELECT report.id
    INTO v_report_id
    FROM public.metrics_reports AS report
    WHERE report.config_id = v_config_id
      AND report.period_start = '2020-03-01';
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('build_report_count', v_final_count);

    SELECT count(*)::bigint
    INTO v_final_count
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.report_id = v_report_id;

    SELECT delivery.id
    INTO v_delivery_id
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.report_id = v_report_id;
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('build_delivery_count', v_final_count);

    SELECT
      jsonb_array_length(report.snapshot_payload->'businesses') = 1
      AND report.snapshot_payload #>> '{businesses,0,business_id}' =
        '51000000-0000-4000-a051-000000000102'
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_each_text(
          report.snapshot_payload #> '{businesses,0,counts}'
        ) AS count_entry
        WHERE count_entry.value <> '0'
      )
    INTO v_final_shape
    FROM public.metrics_reports AS report
    WHERE report.id = v_report_id;
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      boolean_value
    ) VALUES ('build_zero_row', v_final_shape);

    -- A claim updates the pending delivery under its row lock. The concurrent
    -- waiter must recheck the pending predicate and return no claimed row.
    PERFORM extensions.dblink_exec('test_051_metrics_a', 'BEGIN');
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'BEGIN');

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink(
      'test_051_metrics_a',
      format(
        $first_claim_sql$
          SELECT count(*)::bigint
          FROM public.claim_metrics_report_delivery_v1(
            %L::uuid,
            '51000000-0000-4000-a051-000000000111',
            '2100-01-02 00:00:00+00'
          )
        $first_claim_sql$,
        v_delivery_id
      )
    ) AS first_claim(result_count bigint);

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('claim_first_count', v_result_count);

    v_send_result := extensions.dblink_send_query(
      'test_051_metrics_b',
      format(
        $second_claim_sql$
          SELECT count(*)::bigint
          FROM public.claim_metrics_report_delivery_v1(
            %L::uuid,
            '51000000-0000-4000-a051-000000000112',
            '2100-01-02 00:00:00+00'
          )
        $second_claim_sql$,
        v_delivery_id
      )
    );
    PERFORM pg_sleep(0.1);
    v_busy_result := extensions.dblink_is_busy('test_051_metrics_b');

    SELECT count(*)::bigint
    INTO v_visible_count
    FROM public.metrics_report_deliveries AS delivery
    WHERE delivery.id = v_delivery_id
      AND delivery.status = 'pending'
      AND delivery.attempt_count = 0;

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      integer_value
    ) VALUES
      ('claim_send', v_send_result),
      ('claim_busy', v_busy_result);
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('claim_visible_pending', v_visible_count);

    PERFORM extensions.dblink_exec('test_051_metrics_a', 'COMMIT');

    SELECT result_count
    INTO v_result_count
    FROM extensions.dblink_get_result('test_051_metrics_b')
      AS second_claim(result_count bigint);
    PERFORM result_count
    FROM extensions.dblink_get_result('test_051_metrics_b', false)
      AS drained_second_claim(result_count bigint);
    PERFORM extensions.dblink_exec('test_051_metrics_b', 'COMMIT');

    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      bigint_value
    ) VALUES ('claim_second_count', v_result_count);

    SELECT
      delivery.status = 'claimed'
      AND delivery.claim_token =
        '51000000-0000-4000-a051-000000000111'::uuid
      AND delivery.attempt_count = 1
      AND delivery.claimed_at = '2100-01-02 00:00:00+00'::timestamptz
      AND delivery.lease_expires_at =
        '2100-01-02 00:15:00+00'::timestamptz
      AND report.status = 'in_progress'
    INTO v_final_shape
    FROM public.metrics_report_deliveries AS delivery
    JOIN public.metrics_reports AS report
      ON report.id = delivery.report_id
    WHERE delivery.id = v_delivery_id;
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      boolean_value
    ) VALUES ('claim_final_shape', v_final_shape);

    v_cleanup_ok := pg_temp.cleanup_051_metrics_reports_concurrency();
    INSERT INTO metrics_reports_051_concurrency_state (
      name,
      boolean_value
    ) VALUES ('cleanup_ok', v_cleanup_ok);
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        PERFORM pg_temp.cleanup_051_metrics_reports_concurrency();
      EXCEPTION
        WHEN OTHERS THEN
          RAISE WARNING
            'test_051_concurrency_finally_failed [%] %',
            SQLSTATE,
            SQLERRM;
      END;
      RAISE;
  END;
END;
$orchestrate_metrics_report_races$;

SELECT is(
  bigint_value,
  1::bigint,
  'the first same-scope config save succeeds'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_first_count';

SELECT is(
  integer_value,
  1,
  'the second same-scope config save starts concurrently'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_send';

SELECT is(
  integer_value,
  1,
  'the second same-scope config save waits on the unique scope boundary'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_busy';

SELECT is(
  bigint_value,
  0::bigint,
  'the first uncommitted config is not partially visible'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_visible_before_commit';

SELECT is(
  bigint_value,
  1::bigint,
  'the waiting config replacement succeeds after the first commit'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_second_count';

SELECT is(
  bigint_value,
  1::bigint,
  'concurrent saves leave exactly one config for the partner'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_final_count';

SELECT ok(
  boolean_value,
  'the waiting save atomically replaces recipients and selections'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'config_final_shape';

SELECT is(
  bigint_value,
  1::bigint,
  'the first snapshot builder creates the report'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_first_created';

SELECT is(
  integer_value,
  1,
  'the second snapshot builder starts concurrently'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_send';

SELECT is(
  integer_value,
  1,
  'the second builder waits while the first owns the config lock'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_busy';

SELECT is(
  bigint_value,
  0::bigint,
  'the first uncommitted report is not partially visible'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_visible_before_commit';

SELECT is(
  bigint_value,
  1::bigint,
  'the waiting builder returns the existing report after commit'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_second_existing';

SELECT is(
  bigint_value,
  1::bigint,
  'the double-build race persists exactly one frozen report'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_report_count';

SELECT is(
  bigint_value,
  1::bigint,
  'the frozen report has exactly one frozen recipient delivery'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_delivery_count';

SELECT ok(
  boolean_value,
  'the selected zero-event business survives the race as an honest zero row'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'build_zero_row';

SELECT is(
  bigint_value,
  1::bigint,
  'the first delivery worker acquires the pending claim'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_first_count';

SELECT is(
  integer_value,
  1,
  'the second delivery worker starts a concurrent claim'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_send';

SELECT is(
  integer_value,
  1,
  'the second claim waits on the first uncommitted delivery update'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_busy';

SELECT is(
  bigint_value,
  1::bigint,
  'the committed pending version remains visible before the claim commits'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_visible_pending';

SELECT is(
  bigint_value,
  0::bigint,
  'the simultaneous losing worker receives no claimed delivery'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_second_count';

SELECT ok(
  boolean_value,
  'only the winning token and one optimistic attempt remain after the race'
)
FROM metrics_reports_051_concurrency_state
WHERE name = 'claim_final_shape';

SELECT is(
  (
    SELECT bigint_value
    FROM metrics_reports_051_concurrency_state
    WHERE name = 'claim_first_count'
  ) + (
    SELECT bigint_value
    FROM metrics_reports_051_concurrency_state
    WHERE name = 'claim_second_count'
  ),
  1::bigint,
  'simultaneous delivery claims produce exactly one winner'
);

SELECT ok(
  (
    SELECT boolean_value
    FROM metrics_reports_051_concurrency_state
    WHERE name = 'cleanup_ok'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.metrics_report_configs AS config
    WHERE config.partner_id =
      '51000000-0000-4000-a051-000000000101'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id =
      '51000000-0000-4000-a051-000000000102'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.partners AS partner
    WHERE partner.id =
      '51000000-0000-4000-a051-000000000101'
  ),
  'all remote sessions and committed concurrency fixtures are cleaned'
);

SELECT * FROM finish();

ROLLBACK;
