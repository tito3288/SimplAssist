BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(71);

SELECT has_column(
  'public',
  'widget_configs',
  'allowed_hostnames',
  'widget configs carry an exact hostname allowlist'
);

SELECT ok(
  (
    SELECT attribute.attnotnull
      AND pg_get_expr(default_row.adbin, default_row.adrelid) =
        'ARRAY[]::text[]'
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_row
      ON default_row.adrelid = attribute.attrelid
     AND default_row.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.widget_configs'::regclass
      AND attribute.attname = 'allowed_hostnames'
      AND NOT attribute.attisdropped
  ),
  'hostname allowlists are non-null and fail closed to empty by default'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.widget_configs'::regclass
      AND constraint_row.conname =
        'widget_configs_allowed_hostnames_valid'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  'the canonical hostname allowlist constraint is validated'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.widget_configs'::regclass
      AND constraint_row.conname =
        'widget_configs_active_requires_allowed_hostname'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  'an active widget must always have at least one allowed hostname'
);

SELECT has_table(
  'public',
  'widget_request_rate_buckets',
  'shared widget rate buckets exist'
);

SELECT has_table(
  'public',
  'widget_request_capacity_leases',
  'shared widget concurrency leases exist'
);

SELECT has_table(
  'public',
  'widget_ingress_rate_buckets',
  'business-independent widget ingress buckets exist'
);

SELECT has_table(
  'public',
  'widget_offline_lead_submissions',
  'durable content-free offline lead proofs exist'
);

SELECT ok(
  (
    SELECT table_row.relrowsecurity
    FROM pg_class AS table_row
    WHERE table_row.oid =
      'public.widget_offline_lead_submissions'::regclass
  )
  AND has_table_privilege(
    'service_role',
    'public.widget_offline_lead_submissions',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.widget_offline_lead_submissions',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.widget_offline_lead_submissions',
    'SELECT'
  ),
  'offline lead proofs enforce RLS and RPC-owned mutation'
);

SELECT has_function(
  'public',
  'record_widget_offline_lead',
  ARRAY['uuid', 'text', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'offline widget lead recording RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.record_widget_offline_lead(uuid,text,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_widget_offline_lead(uuid,text,uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND pg_get_functiondef(
    'public.record_widget_offline_lead(uuid,text,uuid,text,text,text,text,text)'
      ::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%business.operations_suspended_at%',
    '%v_subscription.status NOT IN%',
    '%v_plan NOT IN%',
    '%source_message.provider_event_id = p_source_provider_event_id%',
    '%contact.session_id = p_session_id%',
    '%widget_offline_lead_idempotency_conflict%'
  ])
  AND position(
    'v_business.partner_id' IN pg_get_functiondef(
      'public.record_widget_offline_lead(uuid,text,uuid,text,text,text,text,text)'
        ::regprocedure
    )
  ) = 0,
  'offline lead RPC is service-only and binds the signed session to its durable source'
);

SELECT ok(
  (
    SELECT bool_and(table_row.relrowsecurity)
    FROM pg_class AS table_row
    WHERE table_row.oid IN (
      'public.widget_request_rate_buckets'::regclass,
      'public.widget_request_capacity_leases'::regclass
    )
  ),
  'both widget traffic tables enforce RLS'
);

SELECT ok(
  has_table_privilege(
    'service_role',
    'public.widget_request_rate_buckets',
    'SELECT'
  )
  AND has_table_privilege(
    'service_role',
    'public.widget_request_capacity_leases',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.widget_request_rate_buckets',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.widget_request_rate_buckets',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'public.widget_request_capacity_leases',
    'SELECT'
  ),
  'traffic state is service-readable but RPC-owned for mutation'
);

SELECT ok(
  (
    SELECT table_row.relrowsecurity
    FROM pg_class AS table_row
    WHERE table_row.oid = 'public.widget_ingress_rate_buckets'::regclass
  )
  AND has_table_privilege(
    'service_role',
    'public.widget_ingress_rate_buckets',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.widget_ingress_rate_buckets',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.widget_ingress_rate_buckets',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'public.widget_ingress_rate_buckets',
    'SELECT'
  ),
  'ingress buckets enforce RLS and RPC-owned mutation'
);

SELECT has_function(
  'public',
  'acquire_widget_ingress_capacity',
  ARRAY['text', 'text'],
  'business-independent widget ingress RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.acquire_widget_ingress_capacity(text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.acquire_widget_ingress_capacity(text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.acquire_widget_ingress_capacity(text,text)',
    'EXECUTE'
  )
  AND pg_get_functiondef(
    'public.acquire_widget_ingress_capacity(text,text)'::regprocedure
  ) LIKE ALL (ARRAY[
    '%WHEN ''config'' THEN 120%',
    '%WHEN ''chat'' THEN 60%',
    '%WHEN ''end'' THEN 30%',
    '%WHEN ''lead'' THEN 20%',
    '%WHEN ''config'' THEN 10000%',
    '%WHEN ''chat'' THEN 3000%',
    '%WHEN ''end'' THEN 3000%',
    '%WHEN ''lead'' THEN 1000%',
    '%interval ''10 minutes''%'
  ])
  AND position(
    'public.businesses' IN pg_get_functiondef(
      'public.acquire_widget_ingress_capacity(text,text)'::regprocedure
    )
  ) = 0,
  'ingress RPC is service-only, business-independent, bounded, and retained briefly'
);

SELECT has_function(
  'public',
  'acquire_widget_request_capacity',
  ARRAY['uuid', 'text', 'text', 'text', 'text', 'text'],
  'shared widget capacity acquisition RPC exists'
);

SELECT has_function(
  'public',
  'release_widget_request_capacity',
  ARRAY['uuid'],
  'shared widget capacity release RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.acquire_widget_request_capacity(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.release_widget_request_capacity(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.acquire_widget_request_capacity(uuid,text,text,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.release_widget_request_capacity(uuid)',
    'EXECUTE'
  ),
  'only service role can execute shared widget capacity mutations'
);

SELECT ok(
  pg_get_functiondef(
    'public.acquire_widget_request_capacity(uuid,text,text,text,text,text)'
      ::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%widget.allowed_hostnames%',
    '%v_subscription.status IN%',
    '%v_business.partner_plan%',
    '%v_effective_plan = ''chat_only''%',
    '%v_active_session >= 1%',
    '%v_active_business >= 8%',
    '%v_effective_plan = ''chat_only'' THEN 120%',
    '%ELSE 2500%'
  ]),
  'capacity RPC pins origin, atomic counters, concurrency, and daily ceiling'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_widget_ingress_capacity(
      'preview_chat',
      repeat('A', 43)
    )
  $$,
  '22023',
  'invalid_widget_ingress_request',
  'ingress rejects endpoint variants before touching shared state'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_widget_ingress_capacity('chat', 'raw-ip-address')
  $$,
  '22023',
  'invalid_widget_ingress_request',
  'ingress accepts only bounded opaque network HMACs'
);

SELECT is(
  public.acquire_widget_ingress_capacity('config', repeat('A', 43)),
  jsonb_build_object('status', 'allowed'),
  'a valid config request passes the business-independent ingress tier'
);

DELETE FROM public.widget_ingress_rate_buckets;
INSERT INTO public.widget_ingress_rate_buckets (
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  'config',
  'network',
  encode(
    extensions.digest(
      'widget-ingress:network:v1:' || repeat('B', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('minute', statement_timestamp()),
  120
);

SELECT is(
  (
    public.acquire_widget_ingress_capacity(
      'config',
      repeat('B', 43)
    )->>'status'
  ),
  'rate_limited',
  'the first request over the config network ingress limit is denied'
);

DELETE FROM public.widget_ingress_rate_buckets;
INSERT INTO public.widget_ingress_rate_buckets (
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  'lead',
  'global',
  encode(
    extensions.digest('widget-ingress:global:v1', 'sha256'),
    'hex'
  ),
  date_trunc('minute', statement_timestamp()),
  1000
);

SELECT is(
  (
    public.acquire_widget_ingress_capacity(
      'lead',
      repeat('C', 43)
    )->>'status'
  ),
  'rate_limited',
  'rotating networks cannot cross the global lead ingress limit'
);

INSERT INTO public.widget_ingress_rate_buckets (
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  'end',
  'network',
  repeat('d', 64),
  date_trunc('minute', statement_timestamp()) - interval '11 minutes',
  1
);

CREATE TEMP TABLE widget_061_ingress_acquisition
ON COMMIT DROP
AS
SELECT public.acquire_widget_ingress_capacity(
    'end',
    repeat('D', 43)
  ) AS payload;

SELECT ok(
  (
    SELECT payload->>'status' = 'allowed'
    FROM widget_061_ingress_acquisition
  )
  AND NOT EXISTS (
      SELECT 1
      FROM public.widget_ingress_rate_buckets AS bucket
      WHERE bucket.endpoint = 'end'
        AND bucket.scope_key_hash = repeat('d', 64)
    ),
  'ingress acquisition removes counters beyond the ten-minute retention window'
);

SELECT ok(
  public.is_valid_widget_hostname('example.com')
  AND public.is_valid_widget_hostname('www.alpha-dog.example')
  AND public.is_valid_widget_hostname('localhost')
  AND public.is_valid_widget_hostname('203.0.113.10'),
  'canonical DNS, localhost, and IPv4-shaped hostnames are accepted'
);

SELECT ok(
  NOT public.is_valid_widget_hostname('Example.com')
  AND NOT public.is_valid_widget_hostname('example.com.')
  AND NOT public.is_valid_widget_hostname('https://example.com')
  AND NOT public.is_valid_widget_hostname('*.example.com')
  AND NOT public.is_valid_widget_hostname('example.com:443')
  AND NOT public.is_valid_widget_hostname('bad_label.example'),
  'noncanonical, wildcard, URL, port, and malformed hostnames are rejected'
);

SELECT ok(
  public.is_valid_widget_hostname_allowlist(
    ARRAY['example.com', 'www.example.com']
  )
  AND public.is_valid_widget_hostname_allowlist(ARRAY[]::text[]),
  'valid unique and empty hostname allowlists satisfy storage shape'
);

SELECT ok(
  NOT public.is_valid_widget_hostname_allowlist(
    ARRAY['example.com', 'example.com']
  )
  AND NOT public.is_valid_widget_hostname_allowlist(
    ARRAY['Example.com']
  )
  AND NOT public.is_valid_widget_hostname_allowlist(
    array_fill('example.com'::text, ARRAY[11])
  ),
  'duplicate, noncanonical, and oversized allowlists are rejected'
);

SELECT is(
  public.widget_hostname_from_website_url(
    'https://WWW.Example.com:443/install?source=owner'
  ),
  'www.example.com',
  'website URL backfill derives one canonical hostname'
);

SELECT is(
  public.widget_hostname_from_website_url('alpha-dog.example/widget'),
  'alpha-dog.example',
  'website URL backfill supports an existing scheme-less value'
);

SELECT ok(
  public.widget_hostname_from_website_url('ftp://example.com') IS NULL
  AND public.widget_hostname_from_website_url('user@example.com') IS NULL
  AND public.widget_hostname_from_website_url('[::1]') IS NULL
  AND public.widget_hostname_from_website_url('example.com:0') IS NULL,
  'unsafe or ambiguous website URLs never seed an allowlist'
);

INSERT INTO public.businesses (
  id,
  name,
  business_type,
  slug,
  website_url
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'Widget Traffic 061',
  'general',
  'widget-traffic-061',
  'https://allowed.example'
);

INSERT INTO public.widget_configs (
  business_id,
  is_active,
  allowed_hostnames
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  true,
  ARRAY['allowed.example']
);

INSERT INTO public.subscriptions (
  id,
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  current_period_start,
  current_period_end
) VALUES (
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'cus_widget_061',
  'sub_widget_061',
  'chat_only',
  'active',
  statement_timestamp() - interval '10 days',
  statement_timestamp() + interval '20 days'
);

INSERT INTO public.contacts (
  id,
  business_id,
  session_id,
  source_channel
) VALUES (
  '61000000-0000-4000-8000-000000000010',
  '61000000-0000-4000-8000-000000000001',
  'session_lead_001',
  'web_chat'
);

INSERT INTO public.conversations (
  id,
  business_id,
  contact_id,
  channel
) VALUES (
  '61000000-0000-4000-8000-000000000011',
  '61000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000010',
  'web_chat'
);

INSERT INTO public.messages (
  id,
  conversation_id,
  business_id,
  role,
  content,
  channel,
  provider_event_id
) VALUES
  (
    '61000000-0000-4000-8000-000000000012',
    '61000000-0000-4000-8000-000000000011',
    '61000000-0000-4000-8000-000000000001',
    'customer',
    'Please contact me tomorrow.',
    'web_chat',
    'widget:' || repeat('a', 64)
  ),
  (
    '61000000-0000-4000-8000-000000000013',
    '61000000-0000-4000-8000-000000000011',
    '61000000-0000-4000-8000-000000000001',
    'customer',
    'A second offline question.',
    'web_chat',
    'widget:' || repeat('c', 64)
  );

CREATE TEMP TABLE widget_061_lead_state (
  submission_id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO widget_061_lead_state(submission_id)
SELECT public.record_widget_offline_lead(
  '61000000-0000-4000-8000-000000000001',
  'session_lead_001',
  '61000000-0000-4000-8000-000000000014',
  'widget:' || repeat('a', 64),
  encode(
    extensions.digest('Please contact me tomorrow.', 'sha256'),
    'hex'
  ),
  repeat('b', 64),
  'Pat',
  'pat@example.com'
);

SELECT ok(
  (SELECT submission_id IS NOT NULL FROM widget_061_lead_state),
  'offline lead submission returns durable opaque proof'
);

SELECT ok(
  (
    SELECT name = 'Pat' AND email = 'pat@example.com'
    FROM public.contacts
    WHERE id = '61000000-0000-4000-8000-000000000010'
  ),
  'offline lead atomically fills missing contact identity'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.widget_offline_lead_submissions
    WHERE business_id = '61000000-0000-4000-8000-000000000001'
      AND contact_id = '61000000-0000-4000-8000-000000000010'
      AND conversation_id = '61000000-0000-4000-8000-000000000011'
      AND source_message_id = '61000000-0000-4000-8000-000000000012'
      AND client_lead_id = '61000000-0000-4000-8000-000000000014'
      AND submission_fingerprint = repeat('b', 64)
  ),
  'offline proof links to the existing customer message without storing content'
);

SELECT is(
  public.record_widget_offline_lead(
    '61000000-0000-4000-8000-000000000001',
    'session_lead_001',
    '61000000-0000-4000-8000-000000000014',
    'widget:' || repeat('a', 64),
    encode(
      extensions.digest('Please contact me tomorrow.', 'sha256'),
      'hex'
    ),
    repeat('b', 64),
    'Pat',
    'pat@example.com'
  ),
  (SELECT submission_id FROM widget_061_lead_state),
  'an exact lead retry returns the original proof'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.widget_offline_lead_submissions
    WHERE business_id = '61000000-0000-4000-8000-000000000001'
  ),
  1,
  'an exact lead retry creates no duplicate row or message'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000014',
      'widget:' || repeat('a', 64),
      repeat('d', 64),
      repeat('e', 64),
      'Other',
      'other@example.com'
    )
  $$,
  '23505',
  'widget_offline_lead_idempotency_conflict',
  'a reused client lead id with changed input fails closed'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000015',
      'widget:' || repeat('c', 64),
      repeat('f', 64),
      repeat('1', 64),
      'Pat',
      'pat@example.com'
    )
  $$,
  '55000',
  'widget_offline_lead_source_unavailable',
  'a lead cannot relink a source message with the wrong content proof'
);

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000016',
      'widget:' || repeat('c', 64),
      encode(
        extensions.digest('A second offline question.', 'sha256'),
        'hex'
      ),
      repeat('2', 64),
      'Pat',
      'other@example.com'
    )
  $$,
  '23505',
  'widget_offline_lead_contact_conflict',
  'an offline form cannot silently replace a session contact email'
);

UPDATE public.businesses
SET ai_replies_paused_at = statement_timestamp()
WHERE id = '61000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000017',
      'widget:' || repeat('c', 64),
      encode(
        extensions.digest('A second offline question.', 'sha256'),
        'hex'
      ),
      repeat('3', 64),
      'Pat',
      'pat@example.com'
    )
  $$,
  '55000',
  'widget_offline_lead_business_unavailable',
  'an AI service pause closes the durable offline lead race'
);

UPDATE public.businesses
SET ai_replies_paused_at = NULL,
    operations_suspended_at = statement_timestamp()
WHERE id = '61000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000018',
      'widget:' || repeat('c', 64),
      encode(
        extensions.digest('A second offline question.', 'sha256'),
        'hex'
      ),
      repeat('4', 64),
      'Pat',
      'pat@example.com'
    )
  $$,
  '55000',
  'widget_offline_lead_business_unavailable',
  'an account suspension closes the durable offline lead race'
);

UPDATE public.businesses
SET operations_suspended_at = NULL
WHERE id = '61000000-0000-4000-8000-000000000001';
UPDATE public.subscriptions
SET plan = 'sms_only'
WHERE business_id = '61000000-0000-4000-8000-000000000001';

SELECT throws_ok(
  $$
    SELECT public.record_widget_offline_lead(
      '61000000-0000-4000-8000-000000000001',
      'session_lead_001',
      '61000000-0000-4000-8000-000000000019',
      'widget:' || repeat('c', 64),
      encode(
        extensions.digest('A second offline question.', 'sha256'),
        'hex'
      ),
      repeat('5', 64),
      'Pat',
      'pat@example.com'
    )
  $$,
  '55000',
  'widget_offline_lead_business_unavailable',
  'a billing transition without web chat closes the durable offline lead race'
);

UPDATE public.subscriptions
SET plan = 'chat_only'
WHERE business_id = '61000000-0000-4000-8000-000000000001';

DELETE FROM public.subscriptions
WHERE business_id = '61000000-0000-4000-8000-000000000001';
UPDATE public.businesses
SET billing_mode = 'comped',
    partner_plan = 'chat_only'
WHERE id = '61000000-0000-4000-8000-000000000001';

SELECT ok(
  public.record_widget_offline_lead(
    '61000000-0000-4000-8000-000000000001',
    'session_lead_001',
    '61000000-0000-4000-8000-000000000020',
    'widget:' || repeat('c', 64),
    encode(
      extensions.digest('A second offline question.', 'sha256'),
      'hex'
    ),
    repeat('6', 64),
    'Pat',
    'pat@example.com'
  ) IS NOT NULL,
  'offline lead authority matches partner billing even without a partner attribution row'
);

SELECT is(
  public.acquire_widget_request_capacity(
    '61000000-0000-4000-8000-000000000001',
    'allowed.example',
    'session_config_001',
    'config',
    repeat('A', 43),
    repeat('B', 43)
  ),
  jsonb_build_object('status', 'allowed', 'lease_token', NULL),
  'config traffic is authorized without a concurrency lease'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'evil.example',
      'session_config_001',
      'config',
      repeat('A', 43),
      repeat('C', 43)
    )->>'status'
  ),
  'origin_not_allowed',
  'shared capacity returns a typed denial for an unconfigured origin'
);

INSERT INTO public.businesses (
  id,
  name,
  business_type,
  slug
) VALUES (
  '61000000-0000-4000-8000-000000000098',
  'Missing Preview Widget 061',
  'general',
  'missing-preview-widget-061'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000098',
      'app.simplassist.example',
      'session_preview_missing',
      'preview_chat',
      repeat('V', 43),
      repeat('W', 43)
    )->>'status'
  ),
  'origin_not_allowed',
  'a missing preview configuration returns the typed existing denial'
);

UPDATE public.widget_configs
SET is_active = false
WHERE business_id = '61000000-0000-4000-8000-000000000001';

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'app.simplassist.example',
      'session_preview_001',
      'preview_chat',
      repeat('N', 43),
      repeat('O', 43)
    )->>'status'
  ),
  'allowed',
  'an authenticated preview endpoint is rate limited without public activation or allowlist coupling'
);

SELECT is(
  public.acquire_widget_request_capacity(
    '61000000-0000-4000-8000-000000000001',
    'app.simplassist.example',
    'session_preview_001',
    'preview_end',
    repeat('P', 43),
    repeat('Q', 43)
  ),
  jsonb_build_object('status', 'allowed', 'lease_token', NULL),
  'authenticated preview end is shared-rate-limited without a lease'
);

UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';

SELECT is(
  public.acquire_widget_request_capacity(
    '61000000-0000-4000-8000-000000000001',
    'allowed.example',
    'session_config_001',
    'config',
    repeat('A', 43),
    repeat('D', 43)
  ),
  jsonb_build_object('status', 'allowed', 'lease_token', NULL),
  'an inactive public config remains shared-rate-limited before returning unavailable'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_inactive_chat_001',
      'chat',
      repeat('A', 43),
      repeat('Z', 43)
    )->>'status'
  ),
  'widget_inactive',
  'an exact-origin inactive widget returns the typed live-chat denial'
);

UPDATE public.widget_configs
SET is_active = true
WHERE business_id = '61000000-0000-4000-8000-000000000001';

CREATE TEMP TABLE widget_061_state (
  name text PRIMARY KEY,
  value text NOT NULL
) ON COMMIT DROP;

WITH decision AS (
  SELECT public.acquire_widget_request_capacity(
    '61000000-0000-4000-8000-000000000001',
    'allowed.example',
    'session_chat_001',
    'chat',
    repeat('E', 43),
    repeat('F', 43)
  ) AS payload
)
INSERT INTO widget_061_state(name, value)
SELECT 'first_lease', payload->>'lease_token'
FROM decision;

SELECT ok(
  (SELECT value::uuid IS NOT NULL FROM widget_061_state
    WHERE name = 'first_lease'),
  'chat acquisition returns a shared UUID lease'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_chat_001',
      'chat',
      repeat('E', 43),
      repeat('F', 43)
    )->>'status'
  ),
  'concurrency_limited',
  'an active duplicate request cannot execute twice'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_chat_001',
      'chat',
      repeat('G', 43),
      repeat('H', 43)
    )->>'status'
  ),
  'concurrency_limited',
  'one session cannot hold two live chat executions'
);

SELECT ok(
  public.release_widget_request_capacity(
    (SELECT value::uuid FROM widget_061_state WHERE name = 'first_lease')
  ),
  'the shared chat lease releases idempotently by token'
);

SELECT ok(
  public.release_widget_request_capacity(
    (SELECT value::uuid FROM widget_061_state WHERE name = 'first_lease')
  ),
  'releasing the same known lease again remains successful'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_chat_001',
      'chat',
      repeat('E', 43),
      repeat('F', 43)
    )->>'status'
  ),
  'allowed',
  'a released request may retry under a fresh lease'
);

UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

DO $rate_boundary$
DECLARE
  v_index integer;
  v_result jsonb;
BEGIN
  FOR v_index IN 1..60 LOOP
    v_result := public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_config_limit',
      'config',
      repeat('I', 43),
      repeat('J', 43)
    );
    IF v_result->>'status' <> 'allowed' THEN
      RAISE EXCEPTION 'unexpected_config_rate_denial';
    END IF;
  END LOOP;
END;
$rate_boundary$;

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_config_limit',
      'config',
      repeat('I', 43),
      repeat('J', 43)
    )->>'status'
  ),
  'rate_limited',
  'the first request beyond the shared session boundary is denied'
);

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'business_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001',
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  120
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_daily_limit',
      'chat',
      repeat('K', 43),
      repeat('L', 43)
    )->>'status'
  ),
  'rate_limited',
  'the Chat Only 120-request daily business ceiling fails closed'
);

SELECT ok(
  (
    SELECT request_count = 121
    FROM public.widget_request_rate_buckets
    WHERE business_id = '61000000-0000-4000-8000-000000000001'
      AND endpoint = 'chat'
      AND scope = 'business_day'
  ),
  'denied Chat Only daily attempts remain counted'
);

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES
  (
    '61000000-0000-4000-8000-000000000001',
    'chat',
    'network_day',
    encode(
      extensions.digest(
        '61000000-0000-4000-8000-000000000001:network:' || repeat('R', 43),
        'sha256'
      ),
      'hex'
    ),
    date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC',
    60
  ),
  (
    '61000000-0000-4000-8000-000000000001',
    'chat',
    'session_day',
    encode(
      extensions.digest(
        '61000000-0000-4000-8000-000000000001:session:session_daily_guard',
        'sha256'
      ),
      'hex'
    ),
    date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
      AT TIME ZONE 'UTC',
    30
  );

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_network_guard',
      'chat',
      repeat('R', 43),
      repeat('S', 43)
    )->>'status'
  ),
  'rate_limited',
  'one network cannot consume more than 60 live replies in a UTC day'
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_daily_guard',
      'chat',
      repeat('T', 43),
      repeat('U', 43)
    )->>'status'
  ),
  'rate_limited',
  'one session cannot consume more than 30 live replies in a UTC day'
);

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';
UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.subscriptions (
  id,
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  current_period_start,
  current_period_end
) VALUES (
  '61000000-0000-4000-8000-000000000002',
  '61000000-0000-4000-8000-000000000001',
  'cus_widget_061_growth',
  'sub_widget_061_growth',
  'sms_and_chat',
  'active',
  statement_timestamp() - interval '10 days',
  statement_timestamp() + interval '20 days'
);

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'network_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001:network:' || repeat('a', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  60
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_growth_subscription',
      'chat',
      repeat('a', 43),
      repeat('b', 43)
    )->>'status'
  ),
  'allowed',
  'an active Growth subscription takes precedence and does not inherit Chat Only daily caps'
);

UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';
DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';
UPDATE public.subscriptions
SET plan = 'chat_only'
WHERE business_id = '61000000-0000-4000-8000-000000000001';
UPDATE public.businesses
SET partner_plan = 'sms_and_chat'
WHERE id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'network_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001:network:' || repeat('c', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  60
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_chat_subscription',
      'chat',
      repeat('c', 43),
      repeat('d', 43)
    )->>'status'
  ),
  'rate_limited',
  'an active Chat Only subscription takes precedence over a Growth partner plan'
);

DELETE FROM public.subscriptions
WHERE business_id = '61000000-0000-4000-8000-000000000001';
DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'network_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001:network:' || repeat('e', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  60
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_growth_partner',
      'chat',
      repeat('e', 43),
      repeat('f', 43)
    )->>'status'
  ),
  'allowed',
  'a partner-managed Growth plan does not inherit Chat Only daily caps'
);

UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';
DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';
UPDATE public.businesses
SET billing_mode = 'stripe',
    partner_plan = NULL,
    billing_exempt = true
WHERE id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'network_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001:network:' || repeat('g', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  60
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_full_override',
      'chat',
      repeat('g', 43),
      repeat('h', 43)
    )->>'status'
  ),
  'allowed',
  'a valid direct Full billing override does not inherit Chat Only daily caps'
);

UPDATE public.widget_request_capacity_leases
SET released_at = statement_timestamp()
WHERE business_id = '61000000-0000-4000-8000-000000000001';
DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'chat',
  'business_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001',
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  2500
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'allowed.example',
      'session_full_emergency',
      'chat',
      repeat('i', 43),
      repeat('j', 43)
    )->>'status'
  ),
  'rate_limited',
  'Full traffic retains the high daily business emergency ceiling'
);

DELETE FROM public.widget_request_rate_buckets
WHERE business_id = '61000000-0000-4000-8000-000000000001';

INSERT INTO public.widget_request_rate_buckets (
  business_id,
  endpoint,
  scope,
  scope_key_hash,
  window_start,
  request_count
) VALUES (
  '61000000-0000-4000-8000-000000000001',
  'preview_chat',
  'network_day',
  encode(
    extensions.digest(
      '61000000-0000-4000-8000-000000000001:network:' || repeat('k', 43),
      'sha256'
    ),
    'hex'
  ),
  date_trunc('day', statement_timestamp() AT TIME ZONE 'UTC')
    AT TIME ZONE 'UTC',
  30
);

SELECT is(
  (
    public.acquire_widget_request_capacity(
      '61000000-0000-4000-8000-000000000001',
      'app.simplassist.example',
      'session_preview_daily',
      'preview_chat',
      repeat('k', 43),
      repeat('l', 43)
    )->>'status'
  ),
  'rate_limited',
  'authenticated preview chat retains its separate daily network limit'
);

SELECT is(
  public.release_widget_request_capacity(
    '61000000-0000-4000-8000-00000000ffff'
  ),
  false,
  'an unknown lease token does not report success'
);

INSERT INTO public.businesses (
  id,
  name,
  business_type,
  slug
) VALUES (
  '61000000-0000-4000-8000-000000000099',
  'Invalid Widget Host 061',
  'general',
  'invalid-widget-host-061'
);

SELECT throws_ok(
  $$
    INSERT INTO public.widget_configs (
      business_id,
      allowed_hostnames
    ) VALUES (
      '61000000-0000-4000-8000-000000000099',
      ARRAY['*.example.com']
    )
  $$,
  '23514',
  NULL,
  'the storage constraint rejects wildcard hostname configuration'
);

SELECT * FROM finish();

ROLLBACK;
