BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(18);

-- Historical-looking source fixtures are inserted only after migration 050 is
-- already present. Live metric triggers are disabled for the fixture insert so
-- the test can prove that explicit invocation, rather than an automatic hook,
-- is what populates the backfill rows.

INSERT INTO public.partners (
  id, name, slug, custom_domain, domain_status, status
) VALUES
  (
    '21000000-0000-4000-a050-000000000001',
    'Backfill Partner A',
    'backfill-partner-a-050',
    'backfill-a-050.example.com',
    'connected',
    'active'
  ),
  (
    '21000000-0000-4000-a050-000000000002',
    'Backfill Partner B',
    'backfill-partner-b-050',
    'backfill-b-050.example.com',
    'connected',
    'active'
  );

INSERT INTO public.businesses (
  id, name, business_type, slug, partner_id, billing_mode, partner_plan
) VALUES (
  '11000000-0000-4000-a050-000000000001',
  'Backfill Business 050',
  'general',
  'backfill-business-050',
  '21000000-0000-4000-a050-000000000001',
  'invoiced',
  'sms_and_chat'
);

SET LOCAL session_replication_role = replica;

INSERT INTO public.billing_usage_periods (
  id, business_id, period_start, period_end, plan, included_sms_parts
) VALUES (
  '81000000-0000-4000-a050-000000000001',
  '11000000-0000-4000-a050-000000000001',
  '2020-04-01 00:00:00+00',
  '2020-05-01 00:00:00+00',
  'sms_and_chat',
  1500
);

INSERT INTO public.billing_usage_events (
  id,
  business_id,
  usage_period_id,
  idempotency_key,
  direction,
  channel,
  source,
  sms_parts,
  mms_events,
  provider_message_id,
  metadata,
  created_at
) VALUES
  (
    '82000000-0000-4000-a050-000000000001',
    '11000000-0000-4000-a050-000000000001',
    '81000000-0000-4000-a050-000000000001',
    'backfill:usage-outbound-a050',
    'outbound',
    'sms',
    'missed_call_sms',
    2,
    0,
    '050 secret outbound provider id',
    '{"content":"050 secret outbound usage metadata","phone":"+13175550101"}'::jsonb,
    '2020-04-02 01:02:03+00'
  ),
  (
    '82000000-0000-4000-a050-000000000002',
    '11000000-0000-4000-a050-000000000001',
    '81000000-0000-4000-a050-000000000001',
    'backfill:usage-inbound-a050',
    'inbound',
    'mms',
    'telnyx_webhook',
    3,
    1,
    '050 secret inbound provider id',
    '{"content":"050 secret inbound usage metadata","phone":"+13175550102"}'::jsonb,
    '2020-04-03 01:02:03+00'
  );

-- Simulate a post-050 usage row whose exception-isolated live mirror failed.
-- Its persisted safe snapshot must remain event-time attribution if the
-- manual routine later repairs it after reassignment.
INSERT INTO public.billing_usage_events (
  id,
  business_id,
  usage_period_id,
  idempotency_key,
  direction,
  channel,
  source,
  sms_parts,
  mms_events,
  provider_message_id,
  metadata,
  created_at,
  metric_partner_id_at_event,
  metric_partner_snapshot_captured
) VALUES (
  '82000000-0000-4000-a050-000000000003',
  '11000000-0000-4000-a050-000000000001',
  '81000000-0000-4000-a050-000000000001',
  'backfill:usage-captured-a050',
  'outbound',
  'sms',
  'ai_reply',
  1,
  0,
  '050 secret captured provider id',
  '{"content":"050 secret captured metadata","phone":"+13175550104"}'::jsonb,
  '2020-04-03 02:02:03+00',
  '21000000-0000-4000-a050-000000000001',
  true
);

INSERT INTO public.contacts (
  id,
  business_id,
  name,
  phone_number,
  email,
  source_channel,
  notes,
  created_at
) VALUES (
  '31000000-0000-4000-a050-000000000001',
  '11000000-0000-4000-a050-000000000001',
  '050 Secret Contact',
  '+13175550103',
  'secret-contact-a050@example.test',
  'sms',
  '050 secret contact notes',
  '2020-04-04 01:02:03+00'
);

INSERT INTO public.lead_events (
  id,
  business_id,
  contact_id,
  event_type,
  reason,
  created_at
) VALUES (
  '61000000-0000-4000-a050-000000000001',
  '11000000-0000-4000-a050-000000000001',
  '31000000-0000-4000-a050-000000000001',
  'became_hot',
  '050 secret lead reason',
  '2020-04-05 01:02:03+00'
);

INSERT INTO public.calendar_bookings (
  id,
  business_id,
  contact_id,
  conversation_id,
  source_message_id,
  google_calendar_id,
  google_event_id,
  event_summary,
  request_fingerprint,
  status,
  starts_at,
  ends_at,
  operation_claim_token,
  operation_claimed_at,
  confirmed_at,
  cancelled_at,
  created_at
) VALUES
  (
    '71000000-0000-4000-a050-000000000001',
    '11000000-0000-4000-a050-000000000001',
    '31000000-0000-4000-a050-000000000001',
    '41000000-0000-4000-a050-000000000001',
    '51000000-0000-4000-a050-000000000001',
    '050-secret-calendar-confirmed@example.test',
    '050-secret-confirmed-provider-event',
    '050 secret confirmed booking summary',
    repeat('b', 64),
    'confirmed',
    '2020-04-07 12:00:00+00',
    '2020-04-07 13:00:00+00',
    NULL,
    NULL,
    '2020-04-06 01:02:03+00',
    NULL,
    '2020-04-01 01:00:00+00'
  ),
  (
    '71000000-0000-4000-a050-000000000002',
    '11000000-0000-4000-a050-000000000001',
    '31000000-0000-4000-a050-000000000001',
    '41000000-0000-4000-a050-000000000002',
    '51000000-0000-4000-a050-000000000002',
    '050-secret-calendar-cancelled@example.test',
    '050-secret-cancelled-provider-event',
    '050 secret cancelled booking summary',
    repeat('c', 64),
    'cancelled',
    '2020-04-09 12:00:00+00',
    '2020-04-09 13:00:00+00',
    NULL,
    NULL,
    '2020-04-08 01:02:03+00',
    '2020-04-08 02:02:03+00',
    '2020-04-01 02:00:00+00'
  ),
  (
    '71000000-0000-4000-a050-000000000003',
    '11000000-0000-4000-a050-000000000001',
    '31000000-0000-4000-a050-000000000001',
    '41000000-0000-4000-a050-000000000003',
    '51000000-0000-4000-a050-000000000003',
    '050-secret-calendar-pending@example.test',
    NULL,
    '050 secret pending booking summary',
    repeat('d', 64),
    'pending',
    '2020-04-11 12:00:00+00',
    '2020-04-11 13:00:00+00',
    '91000000-0000-4000-a050-000000000001',
    '2020-04-10 01:02:03+00',
    NULL,
    NULL,
    '2020-04-01 03:00:00+00'
  );

SET LOCAL session_replication_role = origin;

-- Backfill attribution is intentionally the current assignment at rollout,
-- not an invented reconstruction of historical partner ownership.
UPDATE public.businesses
SET partner_id = '21000000-0000-4000-a050-000000000002'
WHERE id = '11000000-0000-4000-a050-000000000001';

-- 1
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
  ),
  0,
  'historical sources remain untouched until the manual routine is invoked'
);

-- 2
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS trigger_row
    JOIN pg_proc AS procedure_row
      ON procedure_row.oid = trigger_row.tgfoid
    WHERE NOT trigger_row.tgisinternal
      AND pg_get_functiondef(procedure_row.oid)
            LIKE '%backfill_business_metric_events_v1%'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM cron.job AS job
    WHERE job.command LIKE '%backfill_business_metric_events_v1%'
  ),
  'no trigger or cron job automatically invokes the manual backfill routine'
);

CREATE FUNCTION public.poison_backfill_metric_insert_050()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_key =
       'hot-lead:61000000-0000-4000-a050-000000000001' THEN
    RAISE EXCEPTION '050 backfill poison';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER poison_backfill_metric_insert_050
BEFORE INSERT ON public.business_metric_events
FOR EACH ROW
EXECUTE FUNCTION public.poison_backfill_metric_insert_050();

SET LOCAL ROLE service_role;

-- 3
SELECT throws_ok(
  $$ SELECT public.backfill_business_metric_events_v1() $$,
  'P0001',
  '050 backfill poison',
  'a late backfill failure aborts the manual routine atomically'
);

RESET ROLE;

-- 4
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
  ),
  0,
  'a failed manual backfill leaves no earlier partial rows'
);

DROP TRIGGER poison_backfill_metric_insert_050
  ON public.business_metric_events;
DROP FUNCTION public.poison_backfill_metric_insert_050();

SET LOCAL ROLE service_role;
CREATE TEMP TABLE backfill_050_first AS
SELECT public.backfill_business_metric_events_v1() AS inserted_count;
RESET ROLE;

-- 5
SELECT ok(
  (SELECT inserted_count >= 11 FROM backfill_050_first),
  'the first deliberate backfill reports at least the eleven fixture rows'
);

-- 6
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
  ),
  11,
  'the recoverable fixture produces exactly eleven immutable metric rows'
);

-- 7
SELECT results_eq(
  $$
    SELECT metric_key, count(*)::bigint
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
    GROUP BY metric_key
    ORDER BY metric_key
  $$,
  $$
    VALUES
      ('booking_confirmed'::text, 2::bigint),
      ('contact_created'::text, 1::bigint),
      ('hot_lead_classified'::text, 1::bigint),
      ('mms_event_inbound'::text, 1::bigint),
      ('sms_message_inbound'::text, 1::bigint),
      ('sms_message_outbound'::text, 2::bigint),
      ('sms_parts_inbound'::text, 1::bigint),
      ('sms_parts_outbound'::text, 2::bigint)
  $$,
  'backfill creates only the expected recoverable metric keys'
);

-- 8
SELECT results_eq(
  $$
    SELECT metric_key, quantity
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND metric_key IN (
        'sms_parts_inbound',
        'sms_parts_outbound',
        'mms_event_inbound'
      )
    ORDER BY metric_key, source_key
  $$,
  $$
    VALUES
      ('mms_event_inbound'::text, 1::bigint),
      ('sms_parts_inbound'::text, 3::bigint),
      ('sms_parts_outbound'::text, 2::bigint),
      ('sms_parts_outbound'::text, 1::bigint)
  $$,
  'usage mirrors preserve exact SMS-part and MMS quantities'
);

-- 9
SELECT ok(
  (
    SELECT count(*) = 9
       AND bool_and(
         partner_id_at_event =
           '21000000-0000-4000-a050-000000000002'
       )
       AND bool_and(attribution = 'current_assignment_backfill')
       AND bool_and(definition_version = 1)
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND source_key <>
        'billing-usage:82000000-0000-4000-a050-000000000003'
  )
  AND (
    SELECT count(*) = 2
       AND bool_and(
         partner_id_at_event =
           '21000000-0000-4000-a050-000000000001'
       )
       AND bool_and(attribution = 'event_time')
    FROM public.business_metric_events
    WHERE source_key =
      'billing-usage:82000000-0000-4000-a050-000000000003'
  ),
  'legacy rows use current assignment while captured live repairs preserve event-time attribution'
);

-- 10
SELECT ok(
  (
    SELECT occurred_at = '2020-04-02 01:02:03+00'::timestamptz
    FROM public.business_metric_events
    WHERE metric_key = 'sms_message_outbound'
      AND source_key =
        'billing-usage:82000000-0000-4000-a050-000000000001'
  )
  AND (
    SELECT occurred_at = '2020-04-04 01:02:03+00'::timestamptz
    FROM public.business_metric_events
    WHERE metric_key = 'contact_created'
      AND source_key =
        'contact-created:31000000-0000-4000-a050-000000000001'
  )
  AND (
    SELECT occurred_at = '2020-04-05 01:02:03+00'::timestamptz
    FROM public.business_metric_events
    WHERE metric_key = 'hot_lead_classified'
      AND source_key =
        'hot-lead:61000000-0000-4000-a050-000000000001'
  ),
  'usage, contact, and HOT rows retain their exact source timestamps'
);

-- 11
SELECT results_eq(
  $$
    SELECT source_key, occurred_at
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND metric_key = 'booking_confirmed'
    ORDER BY source_key
  $$,
  $$
    VALUES
      (
        'ai-booking:71000000-0000-4000-a050-000000000001'::text,
        '2020-04-06 01:02:03+00'::timestamptz
      ),
      (
        'ai-booking:71000000-0000-4000-a050-000000000002'::text,
        '2020-04-08 01:02:03+00'::timestamptz
      )
  $$,
  'confirmed and later-cancelled AI bookings retain confirmed_at while pending bookings are excluded'
);

-- 12
SELECT ok(
  (
    SELECT count(*) = 2 AND bool_and(origin = 'ai')
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND metric_key = 'booking_confirmed'
  ),
  'recoverable booking history is labeled only as AI origin'
);

-- 13
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND metric_key IN (
        'missed_call_caught',
        'ai_conversation_engaged',
        'web_chat_session_engaged'
      )
  ),
  'unrecoverable missed-call, AI-conversation, and widget-session history is never fabricated'
);

-- 14
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.business_metric_events AS event
    WHERE event.business_id = '11000000-0000-4000-a050-000000000001'
      AND to_jsonb(event)::text LIKE ANY (ARRAY[
        '%050 secret%',
        '%+1317555%',
        '%example.test%'
      ])
  ),
  'backfill never copies content, provider ids, calendar ids, summaries, metadata, or PII'
);

-- 15
SELECT ok(
  (
    SELECT count(*) = 3
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND source_key LIKE 'billing-usage:%'
      AND metric_key LIKE 'sms_message_%'
  )
  AND (
    SELECT count(*) = 4
    FROM public.business_metric_events
    WHERE business_id = '11000000-0000-4000-a050-000000000001'
      AND source_key LIKE 'billing-usage:%'
      AND metric_key IN (
        'sms_parts_inbound',
        'sms_parts_outbound',
        'mms_event_inbound'
      )
  ),
  'usage UUIDs safely namespace independent SMS-message, parts, and MMS mirrors by metric key'
);

CREATE TEMP TABLE backfill_050_snapshot AS
SELECT jsonb_agg(to_jsonb(event) ORDER BY event.metric_key, event.source_key) AS rows
FROM public.business_metric_events AS event
WHERE event.business_id = '11000000-0000-4000-a050-000000000001';

SET LOCAL ROLE service_role;
CREATE TEMP TABLE backfill_050_second AS
SELECT public.backfill_business_metric_events_v1() AS inserted_count;
RESET ROLE;

-- 16
SELECT is(
  (SELECT inserted_count FROM backfill_050_second),
  0::bigint,
  'a second deliberate backfill inserts nothing'
);

-- 17
SELECT is(
  (
    SELECT jsonb_agg(to_jsonb(event) ORDER BY event.metric_key, event.source_key)
    FROM public.business_metric_events AS event
    WHERE event.business_id = '11000000-0000-4000-a050-000000000001'
  ),
  (SELECT rows FROM backfill_050_snapshot),
  're-execution cannot rewrite ids, quantities, timestamps, or attribution'
);

-- 18
SELECT ok(
  lower(pg_get_functiondef(
    'public.backfill_business_metric_events_v1()'::regprocedure
  )) NOT LIKE ALL (ARRAY[
    '%provider_message_id%',
    '%metadata%',
    '%google_calendar_id%',
    '%google_event_id%',
    '%event_summary%',
    '%phone_number%',
    '%email%',
    '%notes%',
    '%reason%'
  ]),
  'the backfill function definition contains only explicit safe source columns'
);

SELECT * FROM finish();

ROLLBACK;
