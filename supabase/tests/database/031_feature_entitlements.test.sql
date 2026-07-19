BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(74);

-- ---------------------------------------------------------------------------
-- Catalog shape and authorization boundary
-- ---------------------------------------------------------------------------

SELECT has_column(
  'public',
  'messages',
  'provider_event_id',
  'messages carry a provider event id for retry deduplication'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname = 'messages_provider_event_id_unique'
      AND index_row.indisunique
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
        = '(provider_event_id IS NOT NULL)'
  ),
  'provider event ids have a unique partial index'
);

SELECT has_trigger(
  'public',
  'messages',
  'guard_message_provider_event_id',
  'messages protect provider event ids with a trigger'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.messages', 'SELECT')
  AND has_table_privilege('authenticated', 'public.messages', 'INSERT')
  AND has_table_privilege('authenticated', 'public.messages', 'UPDATE')
  AND has_table_privilege('authenticated', 'public.messages', 'DELETE'),
  'owners retain ordinary message privileges behind RLS and the provider-id guard'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname = 'contacts_business_phone_unique'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ),
  'contacts have a partial unique business/phone index'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname = 'contacts_business_session_unique'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ),
  'contacts retain one web-chat identity per business/session'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname = 'conversations_one_open_thread_unique'
      AND index_row.indisunique
      AND index_row.indpred IS NOT NULL
  ),
  'conversations have one partial unique open-thread index'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'processed_webhook_events'
      AND column_name IN (
        'processing_status', 'claim_token', 'claimed_at', 'completed_at'
      )
  ),
  4,
  'processed webhook events carry the complete claim lifecycle state'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.processed_webhook_events'::regclass
      AND conname = 'processed_webhook_events_processing_status_check'
      AND contype = 'c'
  ),
  'processed webhook claim state is protected by a check constraint'
);

SELECT policies_are(
  'public',
  'subscriptions',
  ARRAY['subscriptions_select'],
  'customers retain only the subscription SELECT policy'
);

SELECT ok(
  has_table_privilege('authenticated', 'public.subscriptions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.subscriptions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.subscriptions', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.subscriptions', 'DELETE'),
  'authenticated can read but cannot mutate subscriptions'
);

SELECT ok(
  NOT has_table_privilege('anon', 'public.subscriptions', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.subscriptions', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.subscriptions', 'DELETE'),
  'anon cannot mutate subscriptions'
);

SELECT ok(
  has_table_privilege('service_role', 'public.subscriptions', 'SELECT')
  AND has_table_privilege('service_role', 'public.subscriptions', 'INSERT')
  AND has_table_privilege('service_role', 'public.subscriptions', 'UPDATE')
  AND has_table_privilege('service_role', 'public.subscriptions', 'DELETE'),
  'service_role retains Stripe synchronization privileges'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_billing_authorization_fields',
  'businesses protect billing authorization fields with a trigger'
);

SELECT ok(
  pg_get_functiondef(
    'public.guard_business_billing_authorization_fields()'::regprocedure
  ) LIKE ALL (ARRAY[
    '%billing_pilot%',
    '%billing_comped%',
    '%billing_exempt%',
    '%sms_overage_opt_in%',
    '%sms_overage_opted_in_at%',
    '%sms_overage_opted_in_by%',
    '%telnyx_submission_disabled%',
    '%billing_admin_notes%',
    '%billing_flags_updated_at%',
    '%billing_flags_updated_by%'
  ]),
  'the trigger covers every trusted billing and audit field'
);

SELECT has_function(
  'public',
  'record_billing_usage_event',
  ARRAY[
    'uuid', 'uuid', 'text', 'text', 'text', 'text', 'integer', 'integer',
    'text', 'jsonb'
  ],
  'atomic billing usage RPC exists with its stable signature'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_billing_usage_event(uuid,uuid,text,text,text,text,integer,integer,text,jsonb)',
    'EXECUTE'
  ),
  'only service_role can execute the usage RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.increment_billing_usage_period(uuid,text,text,integer,integer)',
    'EXECUTE'
  ),
  'the superseded counter-only RPC is no longer client-callable'
);

SELECT has_function(
  'public',
  'claim_messaging_webhook_event',
  ARRAY['text'],
  'messaging event claim RPC exists'
);

SELECT has_function(
  'public',
  'complete_messaging_webhook_event',
  ARRAY['text', 'uuid'],
  'messaging event completion RPC exists'
);

SELECT has_function(
  'public',
  'release_messaging_webhook_claim',
  ARRAY['text', 'uuid'],
  'messaging event release RPC exists'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.claim_messaging_webhook_event(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.claim_messaging_webhook_event(text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_messaging_webhook_event(text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.release_messaging_webhook_claim(text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.claim_messaging_webhook_event(text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_messaging_webhook_event(text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.release_messaging_webhook_claim(text,uuid)',
    'EXECUTE'
  ),
  'only service_role can execute messaging claim lifecycle RPCs'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-4000-a000-000000000031', 'entitlements-a@example.test'),
  ('00000000-0000-4000-a000-000000000032', 'entitlements-b@example.test');

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000031',
    name = 'Entitlement Test A',
    slug = 'entitlement-test-a'
WHERE owner_id = '00000000-0000-4000-a000-000000000031';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000032',
    name = 'Entitlement Test B',
    slug = 'entitlement-test-b'
WHERE owner_id = '00000000-0000-4000-a000-000000000032';

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status
) VALUES (
  '10000000-0000-4000-a000-000000000031',
  'cus_entitlement_031',
  'sub_entitlement_031',
  'sms_only',
  'active'
);

-- ---------------------------------------------------------------------------
-- Customer and service-role writes
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a000-000000000031',
  true
);
SET LOCAL ROLE authenticated;

SELECT is(
  (
    SELECT plan
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000031'
  ),
  'sms_only',
  'an owner can read their subscription'
);

SELECT throws_ok(
  $$
    UPDATE public.subscriptions
    SET plan = 'full'
    WHERE business_id = '10000000-0000-4000-a000-000000000031'
  $$,
  '42501',
  NULL,
  'customer cannot promote their subscription plan'
);

SELECT throws_ok(
  $$
    INSERT INTO public.subscriptions (
      business_id, stripe_customer_id, stripe_subscription_id, plan, status
    ) VALUES (
      '10000000-0000-4000-a000-000000000032',
      'cus_forged',
      'sub_forged',
      'full',
      'active'
    )
  $$,
  '42501',
  NULL,
  'customer cannot forge a subscription'
);

SELECT throws_ok(
  $$
    DELETE FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000031'
  $$,
  '42501',
  NULL,
  'customer cannot delete their subscription'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Entitlement Customer Rename'
    WHERE id = '10000000-0000-4000-a000-000000000031'
  $$,
  'normal owner profile writes remain available'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET billing_pilot = true,
        billing_comped = true,
        billing_exempt = true,
        sms_overage_opt_in = true,
        sms_overage_opted_in_at = now(),
        sms_overage_opted_in_by = 'forged customer',
        telnyx_submission_disabled = true,
        billing_admin_notes = 'forged notes',
        billing_flags_updated_at = now(),
        billing_flags_updated_by = 'forged customer'
    WHERE id = '10000000-0000-4000-a000-000000000031'
  $$,
  '42501',
  'customer writes cannot change protected business billing fields',
  'customers cannot mutate any trusted business billing fields'
);

SELECT throws_ok(
  $$
    INSERT INTO public.businesses (
      owner_id, name, business_type, slug, billing_exempt
    ) VALUES (
      '00000000-0000-4000-a000-000000000031',
      'Forged Override Business',
      'general',
      'forged-override-business',
      true
    )
  $$,
  '42501',
  'customer writes cannot set protected business billing fields',
  'customers cannot seed billing overrides during insert'
);

RESET ROLE;

SELECT is(
  (
    SELECT name
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000031'
  ),
  'Entitlement Customer Rename',
  'the allowed customer profile update persisted'
);

SELECT ok(
  (
    SELECT NOT billing_pilot
       AND NOT billing_comped
       AND NOT billing_exempt
       AND NOT sms_overage_opt_in
       AND NOT telnyx_submission_disabled
       AND billing_admin_notes IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000031'
  ),
  'rejected customer billing changes persisted nothing'
);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    UPDATE public.subscriptions
    SET plan = 'sms_and_chat'
    WHERE business_id = '10000000-0000-4000-a000-000000000031'
  $$,
  'service_role can synchronize a plan change'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET billing_comped = true,
        billing_flags_updated_by = 'admin-031'
    WHERE id = '10000000-0000-4000-a000-000000000031'
  $$,
  'service_role can manage protected business billing fields'
);

RESET ROLE;

-- ---------------------------------------------------------------------------
-- Provider message and usage idempotency
-- ---------------------------------------------------------------------------

INSERT INTO public.conversations (
  id, business_id, channel, status, is_ai_handling
) VALUES (
  '30000000-0000-4000-a000-000000000031',
  '10000000-0000-4000-a000-000000000031',
  'sms',
  'active',
  true
);

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    INSERT INTO public.messages (
      conversation_id, business_id, provider_event_id, role, content, channel
    ) VALUES (
      '30000000-0000-4000-a000-000000000031',
      '10000000-0000-4000-a000-000000000031',
      'telnyx:forged-provider-key-031',
      'human_agent',
      'forged provider key',
      'sms'
    )
  $$,
  '42501',
  'customer writes cannot set provider event identifiers',
  'an owner cannot reserve a provider event id during insert'
);

SELECT lives_ok(
  $$
    INSERT INTO public.messages (
      id, conversation_id, business_id, role, content, channel
    ) VALUES (
      '50000000-0000-4000-a000-000000000031',
      '30000000-0000-4000-a000-000000000031',
      '10000000-0000-4000-a000-000000000031',
      'human_agent',
      'normal owner reply',
      'sms'
    )
  $$,
  'owners retain ordinary message writes'
);

SELECT throws_ok(
  $$
    UPDATE public.messages
    SET provider_event_id = 'telnyx:forged-update-031'
    WHERE id = '50000000-0000-4000-a000-000000000031'
  $$,
  '42501',
  'customer writes cannot set provider event identifiers',
  'an owner cannot add or rewrite a provider event id during update'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    INSERT INTO public.messages (
      conversation_id, business_id, provider_event_id, role, content, channel
    ) VALUES (
      '30000000-0000-4000-a000-000000000031',
      '10000000-0000-4000-a000-000000000031',
      'telnyx:event-031',
      'customer',
      'first delivery',
      'sms'
    )
  $$,
  'service_role can persist a verified provider event id'
);

RESET ROLE;

SELECT throws_ok(
  $$
    INSERT INTO public.messages (
      conversation_id, business_id, provider_event_id, role, content, channel
    ) VALUES (
      '30000000-0000-4000-a000-000000000031',
      '10000000-0000-4000-a000-000000000031',
      'telnyx:event-031',
      'customer',
      'duplicate delivery',
      'sms'
    )
  $$,
  '23505',
  NULL,
  'a provider retry cannot create a duplicate inbound message'
);

SELECT lives_ok(
  $$
    INSERT INTO public.messages (
      conversation_id, business_id, provider_event_id, role, content, channel
    ) VALUES
      (
        '30000000-0000-4000-a000-000000000031',
        '10000000-0000-4000-a000-000000000031',
        NULL,
        'human_agent',
        'manual one',
        'sms'
      ),
      (
        '30000000-0000-4000-a000-000000000031',
        '10000000-0000-4000-a000-000000000031',
        NULL,
        'human_agent',
        'manual two',
        'sms'
      )
  $$,
  'multiple non-provider messages may keep a NULL event id'
);

-- Find-or-create helpers depend on these constraints to recover cleanly from
-- concurrent inserts rather than creating duplicate contacts/threads.
INSERT INTO public.contacts (
  id, business_id, name, phone_number, session_id, source_channel
) VALUES (
  '20000000-0000-4000-a000-000000000031',
  '10000000-0000-4000-a000-000000000031',
  'Concurrency Contact',
  '+13175550031',
  'session-031',
  'sms'
);

SELECT throws_ok(
  $$
    INSERT INTO public.contacts (
      business_id, phone_number, session_id, source_channel
    ) VALUES (
      '10000000-0000-4000-a000-000000000031',
      '+13175550031',
      'different-session-031',
      'sms'
    )
  $$,
  '23505',
  NULL,
  'a business cannot create duplicate contacts for one phone number'
);

SELECT throws_ok(
  $$
    INSERT INTO public.contacts (
      business_id, phone_number, session_id, source_channel
    ) VALUES (
      '10000000-0000-4000-a000-000000000031',
      '+13175550999',
      'session-031',
      'web_chat'
    )
  $$,
  '23505',
  NULL,
  'a business cannot create duplicate contacts for one widget session'
);

SELECT lives_ok(
  $$
    INSERT INTO public.contacts (
      business_id, phone_number, session_id, source_channel
    ) VALUES (
      '10000000-0000-4000-a000-000000000032',
      '+13175550031',
      'session-031',
      'sms'
    )
  $$,
  'the same phone and session identifiers remain valid for another business'
);

INSERT INTO public.conversations (
  id, business_id, contact_id, channel, status, is_ai_handling
) VALUES (
  '30000000-0000-4000-a000-000000000032',
  '10000000-0000-4000-a000-000000000031',
  '20000000-0000-4000-a000-000000000031',
  'sms',
  'handed_off',
  false
);

SELECT throws_ok(
  $$
    INSERT INTO public.conversations (
      business_id, contact_id, channel, status, is_ai_handling
    ) VALUES (
      '10000000-0000-4000-a000-000000000031',
      '20000000-0000-4000-a000-000000000031',
      'sms',
      'active',
      true
    )
  $$,
  '23505',
  NULL,
  'a contact cannot gain a second non-closed conversation per channel'
);

SELECT lives_ok(
  $$
    INSERT INTO public.conversations (
      business_id, contact_id, channel, status, is_ai_handling
    ) VALUES (
      '10000000-0000-4000-a000-000000000031',
      '20000000-0000-4000-a000-000000000031',
      'sms',
      'closed',
      false
    )
  $$,
  'closed conversation history is not limited by the open-thread index'
);

-- ---------------------------------------------------------------------------
-- Messaging webhook claim lifecycle
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE claim_attempts (
  attempt text PRIMARY KEY,
  event_id text NOT NULL,
  outcome text NOT NULL,
  token uuid
) ON COMMIT DROP;

GRANT ALL ON TABLE claim_attempts TO service_role;

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_messaging_webhook_event('telnyx:forged-claim-031')
  $$,
  '42501',
  NULL,
  'authenticated callers cannot invoke the messaging claim RPC'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT * FROM public.claim_messaging_webhook_event('  ')
  $$,
  '22023',
  'event id is required',
  'blank event identifiers cannot be claimed'
);

INSERT INTO claim_attempts (attempt, event_id, outcome, token)
SELECT
  'complete-first',
  'telnyx:claim-complete-031',
  outcome,
  token
FROM public.claim_messaging_webhook_event('telnyx:claim-complete-031');

SELECT is(
  (SELECT outcome FROM claim_attempts WHERE attempt = 'complete-first'),
  'claimed',
  'the first delivery owns the event claim'
);

SELECT ok(
  (SELECT token IS NOT NULL FROM claim_attempts WHERE attempt = 'complete-first'),
  'a successful claim receives an ownership token'
);

SELECT is(
  (
    SELECT outcome
    FROM public.claim_messaging_webhook_event('telnyx:claim-complete-031')
  ),
  'in_progress',
  'a concurrent delivery is distinguished from a completed retry'
);

SELECT ok(
  (
    SELECT token IS NULL
    FROM public.claim_messaging_webhook_event('telnyx:claim-complete-031')
  ),
  'a concurrent delivery cannot receive the holder token'
);

SELECT is(
  public.complete_messaging_webhook_event(
    'telnyx:claim-complete-031',
    gen_random_uuid()
  ),
  false,
  'a non-owner cannot complete another request claim'
);

SELECT is(
  public.complete_messaging_webhook_event(
    'telnyx:claim-complete-031',
    (SELECT token FROM claim_attempts WHERE attempt = 'complete-first')
  ),
  true,
  'the token owner can complete its claim'
);

SELECT ok(
  (
    SELECT processing_status = 'completed'
       AND completed_at IS NOT NULL
    FROM public.processed_webhook_events
    WHERE event_id = 'telnyx:claim-complete-031'
  ),
  'completion persists an authoritative completed state and timestamp'
);

SELECT is(
  (
    SELECT outcome
    FROM public.claim_messaging_webhook_event('telnyx:claim-complete-031')
  ),
  'completed',
  'later retries observe completed rather than in-progress'
);

SELECT ok(
  (
    SELECT token IS NULL
    FROM public.claim_messaging_webhook_event('telnyx:claim-complete-031')
  ),
  'a completed retry never receives an ownership token'
);

SELECT is(
  public.release_messaging_webhook_claim(
    'telnyx:claim-complete-031',
    (SELECT token FROM claim_attempts WHERE attempt = 'complete-first')
  ),
  false,
  'a completed event cannot be released back to pending'
);

INSERT INTO claim_attempts (attempt, event_id, outcome, token)
SELECT
  'release-first',
  'telnyx:claim-release-031',
  outcome,
  token
FROM public.claim_messaging_webhook_event('telnyx:claim-release-031');

SELECT is(
  (SELECT outcome FROM claim_attempts WHERE attempt = 'release-first'),
  'claimed',
  'a retryable event begins with a normal owned claim'
);

SELECT is(
  (
    SELECT outcome
    FROM public.claim_messaging_webhook_event('telnyx:claim-release-031')
  ),
  'in_progress',
  'the release candidate remains protected while its owner works'
);

SELECT is(
  public.release_messaging_webhook_claim(
    'telnyx:claim-release-031',
    gen_random_uuid()
  ),
  false,
  'a non-owner cannot release another request claim'
);

SELECT is(
  public.release_messaging_webhook_claim(
    'telnyx:claim-release-031',
    (SELECT token FROM claim_attempts WHERE attempt = 'release-first')
  ),
  true,
  'the token owner can release a failed claim for provider retry'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.processed_webhook_events
    WHERE event_id = 'telnyx:claim-release-031'
  ),
  0,
  'release removes the unfinished claim row'
);

INSERT INTO claim_attempts (attempt, event_id, outcome, token)
SELECT
  'release-second',
  'telnyx:claim-release-031',
  outcome,
  token
FROM public.claim_messaging_webhook_event('telnyx:claim-release-031');

SELECT is(
  (SELECT outcome FROM claim_attempts WHERE attempt = 'release-second'),
  'claimed',
  'a provider retry can claim the event after release'
);

SELECT ok(
  (
    SELECT first_claim.token IS DISTINCT FROM second_claim.token
    FROM claim_attempts AS first_claim
    CROSS JOIN claim_attempts AS second_claim
    WHERE first_claim.attempt = 'release-first'
      AND second_claim.attempt = 'release-second'
  ),
  'a retried claim receives a fresh ownership token'
);

INSERT INTO claim_attempts (attempt, event_id, outcome, token)
SELECT
  'stale-first',
  'telnyx:claim-stale-031',
  outcome,
  token
FROM public.claim_messaging_webhook_event('telnyx:claim-stale-031');

UPDATE public.processed_webhook_events
SET claimed_at = now() - interval '3 minutes'
WHERE event_id = 'telnyx:claim-stale-031';

INSERT INTO claim_attempts (attempt, event_id, outcome, token)
SELECT
  'stale-second',
  'telnyx:claim-stale-031',
  outcome,
  token
FROM public.claim_messaging_webhook_event('telnyx:claim-stale-031');

SELECT is(
  (SELECT outcome FROM claim_attempts WHERE attempt = 'stale-second'),
  'claimed',
  'an abandoned claim can be reclaimed after the bounded lease expires'
);

SELECT ok(
  (
    SELECT first_claim.token IS DISTINCT FROM second_claim.token
    FROM claim_attempts AS first_claim
    CROSS JOIN claim_attempts AS second_claim
    WHERE first_claim.attempt = 'stale-first'
      AND second_claim.attempt = 'stale-second'
  ),
  'stale recovery invalidates the abandoned ownership token'
);

RESET ROLE;

INSERT INTO public.billing_usage_periods (
  id, business_id, period_start, period_end, plan, included_sms_parts
) VALUES
  (
    '40000000-0000-4000-a000-000000000031',
    '10000000-0000-4000-a000-000000000031',
    '2026-07-01 00:00:00+00',
    '2026-08-01 00:00:00+00',
    'sms_and_chat',
    1500
  ),
  (
    '40000000-0000-4000-a000-000000000032',
    '10000000-0000-4000-a000-000000000032',
    '2026-07-01 00:00:00+00',
    '2026-08-01 00:00:00+00',
    'sms_only',
    500
  );

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$
    SELECT public.record_billing_usage_event(
      '10000000-0000-4000-a000-000000000031',
      '40000000-0000-4000-a000-000000000031',
      'telnyx:forged-031',
      'inbound',
      'sms',
      'forged',
      1,
      0,
      NULL,
      '{}'::jsonb
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot call the service-role usage RPC'
);
RESET ROLE;

SET LOCAL ROLE service_role;

SELECT is(
  public.record_billing_usage_event(
    '10000000-0000-4000-a000-000000000031',
    '40000000-0000-4000-a000-000000000031',
    'telnyx:usage-031',
    'inbound',
    'mms',
    'telnyx_webhook',
    2,
    1,
    'message-031',
    '{"mediaCount": 1}'::jsonb
  ),
  true,
  'the first usage event inserts and increments atomically'
);

SELECT is(
  public.record_billing_usage_event(
    '10000000-0000-4000-a000-000000000031',
    '40000000-0000-4000-a000-000000000031',
    'telnyx:usage-031',
    'inbound',
    'mms',
    'telnyx_webhook',
    2,
    1,
    'message-031',
    '{"mediaCount": 1}'::jsonb
  ),
  false,
  'a duplicate usage event is a successful no-op'
);

RESET ROLE;

SELECT is(
  (
    SELECT inbound_sms_parts
    FROM public.billing_usage_periods
    WHERE id = '40000000-0000-4000-a000-000000000031'
  ),
  2,
  'a retry increments inbound SMS parts exactly once'
);

SELECT is(
  (
    SELECT inbound_mms_events
    FROM public.billing_usage_periods
    WHERE id = '40000000-0000-4000-a000-000000000031'
  ),
  1,
  'a retry increments inbound MMS events exactly once'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.billing_usage_events
    WHERE idempotency_key = 'telnyx:usage-031'
  ),
  1,
  'the immutable ledger contains one row for the provider event'
);

SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.record_billing_usage_event(
      '10000000-0000-4000-a000-000000000032',
      '40000000-0000-4000-a000-000000000031',
      'telnyx:mismatched-period-031',
      'inbound',
      'sms',
      'telnyx_webhook',
      1,
      0,
      NULL,
      '{}'::jsonb
    )
  $$,
  '23503',
  NULL,
  'a usage period cannot be charged to a different business'
);

SELECT throws_ok(
  $$
    SELECT public.record_billing_usage_event(
      '10000000-0000-4000-a000-000000000031',
      '40000000-0000-4000-a000-000000000031',
      '',
      'inbound',
      'sms',
      'telnyx_webhook',
      1,
      0,
      NULL,
      '{}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'invalid usage payloads fail before writing'
);

RESET ROLE;

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.billing_usage_events
    WHERE idempotency_key = 'telnyx:mismatched-period-031'
  ),
  0,
  'a failed counter update rolls back its ledger insert'
);

SELECT * FROM finish();

ROLLBACK;
