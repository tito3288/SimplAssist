BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(37);

SELECT has_table(
  'public',
  'widget_engagement_events',
  'content-free widget engagement telemetry exists'
);

SELECT ok(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attnum) = ARRAY[
      'id',
      'business_id',
      'session_key_hash',
      'event_type',
      'source',
      'device_bucket',
      'prompt_version',
      'occurred_at'
    ]::name[]
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.widget_engagement_events'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  'the ledger has only content-free, bucketed dimensions and a keyed session hash'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.widget_engagement_events'::regclass)
  AND has_table_privilege(
    'service_role', 'public.widget_engagement_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.widget_engagement_events', 'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role', 'public.widget_engagement_events', 'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated', 'public.widget_engagement_events', 'SELECT'
  )
  AND NOT has_table_privilege(
    'anon', 'public.widget_engagement_events', 'SELECT'
  ),
  'telemetry enforces RLS and RPC-owned mutation'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'public.widget_engagement_events'::regclass
      AND constraint_row.conname =
        'widget_engagement_events_session_event_unique'
      AND constraint_row.contype = 'u'
  ),
  'one event type and prompt version is stored per business session'
);

SELECT ok(
  to_regclass('public.idx_widget_engagement_events_business_occurred')
    IS NOT NULL
  AND to_regclass('public.idx_widget_engagement_events_retention') IS NOT NULL,
  'business reporting and retention both have supporting indexes'
);

SELECT has_function(
  'public',
  'record_widget_engagement_event',
  ARRAY['uuid', 'text', 'text', 'text', 'text', 'integer'],
  'telemetry recording RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.record_widget_engagement_event(uuid,text,text,text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_widget_engagement_event(uuid,text,text,text,text,integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.record_widget_engagement_event(uuid,text,text,text,text,integer)',
    'EXECUTE'
  )
  AND (
    SELECT procedure.prosecdef
    FROM pg_proc AS procedure
    WHERE procedure.oid =
      'public.record_widget_engagement_event(uuid,text,text,text,text,integer)'
        ::regprocedure
  )
  AND pg_get_functiondef(
    'public.record_widget_engagement_event(uuid,text,text,text,text,integer)'
      ::regprocedure
  ) NOT LIKE ALL (ARRAY[
    '%public.contacts%',
    '%public.conversations%',
    '%public.messages%',
    '%anthropic%',
    '%billing_usage%',
    '%ai_reply_usage_periods%',
    '%ai_reply_reservations%',
    '%subscriptions%',
    '%stripe%',
    '%telnyx%',
    '%calendar_provider_operations%'
  ]),
  'recording is service-only and cannot create product, billing, or provider state'
);

SELECT has_function(
  'public',
  'acquire_widget_telemetry_ingress_capacity',
  ARRAY['text'],
  'isolated telemetry ingress RPC exists'
);

SELECT has_function(
  'public',
  'acquire_widget_telemetry_capacity',
  ARRAY['uuid', 'text', 'text', 'text', 'text'],
  'origin-bound shared telemetry capacity RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.acquire_widget_telemetry_ingress_capacity(text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.acquire_widget_telemetry_capacity(uuid,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.acquire_widget_telemetry_ingress_capacity(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.acquire_widget_telemetry_capacity(uuid,text,text,text,text)',
    'EXECUTE'
  ),
  'only service role can execute telemetry traffic mutations'
);

SELECT has_function(
  'public',
  'purge_widget_engagement_events',
  ARRAY[]::text[],
  'scheduled-retention purge RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.purge_widget_engagement_events()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.purge_widget_engagement_events()',
    'EXECUTE'
  )
  AND pg_get_functiondef(
    'public.purge_widget_engagement_events()'::regprocedure
  ) LIKE '%interval ''90 days''%',
  'retention is privileged and has an explicit 90-day eligibility cutoff'
);

SELECT is(
  (SELECT count(*)::integer FROM cron.job),
  3,
  'telemetry adds exactly one independently scheduled job at schema tip'
);

SELECT is(
  (
    SELECT job.schedule
    FROM cron.job AS job
    WHERE job.jobname = 'cleanup_widget_engagement_events'
  ),
  '20 3 * * *',
  'eligible telemetry is purged daily after webhook cleanup'
);

SELECT ok(
  (
    SELECT job.command =
      'SELECT public.purge_widget_engagement_events()'
    FROM cron.job AS job
    WHERE job.jobname = 'cleanup_widget_engagement_events'
  )
  AND (
    SELECT job.command NOT LIKE '%widget_engagement%'
    FROM cron.job AS job
    WHERE job.jobname = 'cleanup_processed_webhook_events'
  )
  AND (
    SELECT job.command NOT LIKE '%processed_webhook%'
    FROM cron.job AS job
    WHERE job.jobname = 'cleanup_widget_engagement_events'
  ),
  'telemetry and webhook retention cannot share a cron transaction or failure'
);

INSERT INTO public.businesses (
  id,
  name,
  business_type,
  slug,
  website_url
) VALUES (
  '66000000-0000-4000-8000-000000000001',
  'Widget Telemetry 066',
  'general',
  'widget-telemetry-066',
  'https://allowed.example'
);

INSERT INTO public.widget_configs (
  business_id,
  is_active,
  allowed_hostnames
) VALUES (
  '66000000-0000-4000-8000-000000000001',
  true,
  ARRAY['allowed.example']
);

SELECT is(
  public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'invitation_shown',
    'proactive_timer',
    'mobile',
    1
  ),
  true,
  'the first valid telemetry event is inserted'
);

SELECT is(
  public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'invitation_shown',
    'proactive_timer',
    'mobile',
    1
  ),
  false,
  'an exact retry is a successful duplicate no-op'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_engagement_events
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
      AND session_key_hash = repeat('a', 64)
      AND event_type = 'invitation_shown'
      AND prompt_version = 1
  ),
  1,
  'session event deduplication leaves one durable row'
);

SELECT is(
  public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('a', 64),
    'invitation_shown',
    'proactive_scroll',
    'desktop',
    2
  ),
  true,
  'a new prompt version remains independently measurable'
);

SELECT ok(
  public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('0', 64),
    'widget_loaded',
    'widget_load',
    'mobile',
    1
  )
  AND public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('b', 64),
    'invitation_dismissed',
    'proactive_scroll',
    'desktop',
    1
  )
  AND public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('c', 64),
    'widget_engaged',
    'manual',
    'mobile',
    1
  )
  AND public.record_widget_engagement_event(
    '66000000-0000-4000-8000-000000000001',
    repeat('d', 64),
    'first_message_submitted',
    'proactive_timer',
    'desktop',
    1
  ),
  'the remaining constrained funnel events and sources are accepted'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'invitation_shown',
      'manual',
      'desktop',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'an invitation cannot claim a manual source'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'widget_loaded',
      'manual',
      'desktop',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'a widget load can only use the dedicated widget_load source'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'widget_engaged',
      'widget_load',
      'desktop',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'the widget_load source cannot be reused for engagement events'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      'raw-session-id',
      'widget_engaged',
      'manual',
      'desktop',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'the database refuses raw session identity'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'widget_rendered',
      'manual',
      'desktop',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'unknown event types are rejected'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'widget_engaged',
      'manual',
      'tablet',
      1
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'device identity remains a constrained coarse bucket'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_engagement_event(
      '66000000-0000-4000-8000-000000000001',
      repeat('e', 64),
      'widget_engaged',
      'manual',
      'desktop',
      0
    )
  $$,
  '22023',
  'invalid_widget_engagement_event',
  'prompt versions must be positive and bounded'
);

SELECT is(
  (
    SELECT count(*)::integer FROM public.contacts
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
  )
  + (
    SELECT count(*)::integer FROM public.conversations
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
  )
  + (
    SELECT count(*)::integer FROM public.messages
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
  )
  + (
    SELECT count(*)::integer FROM public.anthropic_provider_calls
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
  ),
  0,
  'telemetry creates no contact, conversation, message, or Anthropic state'
);

SELECT is(
  public.acquire_widget_telemetry_ingress_capacity(repeat('A', 43)),
  jsonb_build_object('status', 'allowed'),
  'valid telemetry reaches isolated business-independent ingress capacity'
);

DELETE FROM public.widget_ingress_rate_buckets
WHERE endpoint = 'telemetry';
INSERT INTO public.widget_ingress_rate_buckets (
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  'telemetry',
  'network',
  encode(
    extensions.digest(
      'widget-ingress:network:v1:' || repeat('B', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('minute', statement_timestamp()),
  240
);

SELECT is(
  (
    public.acquire_widget_telemetry_ingress_capacity(
      repeat('B', 43)
    )->>'status'
  ),
  'rate_limited',
  'telemetry ingress denies the first request over its opaque network limit'
);

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '66000000-0000-4000-8000-000000000001';

SELECT is(
  public.acquire_widget_telemetry_capacity(
    '66000000-0000-4000-8000-000000000001',
    'allowed.example',
    'session_telemetry_066',
    repeat('N', 43),
    repeat('R', 43)
  ),
  jsonb_build_object('status', 'allowed', 'lease_token', NULL),
  'valid telemetry passes exact-origin shared capacity without a lease'
);

SELECT is(
  public.acquire_widget_telemetry_capacity(
    '66000000-0000-4000-8000-000000000001',
    'denied.example',
    'session_telemetry_066',
    repeat('N', 43),
    repeat('S', 43)
  ),
  jsonb_build_object('status', 'origin_not_allowed'),
  'shared telemetry capacity rejects an unlisted origin'
);

UPDATE public.widget_configs
SET is_active = false
WHERE business_id = '66000000-0000-4000-8000-000000000001';

SELECT is(
  public.acquire_widget_telemetry_capacity(
    '66000000-0000-4000-8000-000000000001',
    'allowed.example',
    'session_telemetry_066',
    repeat('N', 43),
    repeat('T', 43)
  ),
  jsonb_build_object('status', 'widget_inactive'),
  'shared telemetry capacity rejects an inactive widget'
);

UPDATE public.widget_configs
SET is_active = true
WHERE business_id = '66000000-0000-4000-8000-000000000001';
DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '66000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '66000000-0000-4000-8000-000000000001',
  'telemetry',
  'business_day',
  encode(
    extensions.digest(
      '66000000-0000-4000-8000-000000000001',
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  25000
);

SELECT is(
  (
    public.acquire_widget_telemetry_capacity(
      '66000000-0000-4000-8000-000000000001',
      'allowed.example',
      'another_session_066',
      repeat('Q', 43),
      repeat('U', 43)
    )->>'status'
  ),
  'rate_limited',
  'daily business capacity bounds durable telemetry growth'
);

INSERT INTO public.widget_engagement_events (
  business_id,
  session_key_hash,
  event_type,
  source,
  device_bucket,
  prompt_version,
  occurred_at
) VALUES
  (
    '66000000-0000-4000-8000-000000000001',
    repeat('f', 64),
    'widget_engaged',
    'manual',
    'desktop',
    1,
    statement_timestamp() - interval '91 days'
  ),
  (
    '66000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    'widget_engaged',
    'manual',
    'desktop',
    1,
    statement_timestamp() - interval '89 days'
  );

SELECT is(
  public.purge_widget_engagement_events(),
  1::bigint,
  'the purge removes rows that are older than 90 days when it runs'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.widget_engagement_events
    WHERE session_key_hash = repeat('f', 64)
  )
  AND EXISTS (
    SELECT 1 FROM public.widget_engagement_events
    WHERE session_key_hash = repeat('1', 64)
  ),
  'the purge preserves telemetry not yet eligible at the 90-day cutoff'
);

DELETE FROM public.businesses
WHERE id = '66000000-0000-4000-8000-000000000001';

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_engagement_events
    WHERE business_id = '66000000-0000-4000-8000-000000000001'
  ),
  0,
  'business deletion cascades its content-free telemetry rows'
);

SELECT * FROM finish();
ROLLBACK;
