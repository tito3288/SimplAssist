BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(80);

-- ---------------------------------------------------------------------------
-- Service-only schema and RPC surface
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public', 'ai_reply_usage_periods',
  'AI reply usage periods exist'
);
SELECT has_table(
  'public', 'ai_reply_reservations',
  'AI reply reservations exist'
);
SELECT has_table(
  'public', 'ai_reply_reservation_attempts',
  'AI reply reservation attempt history exists'
);
SELECT has_table(
  'public', 'anthropic_provider_calls',
  'content-free Anthropic provider-call accounting exists'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class
   WHERE oid = 'public.ai_reply_usage_periods'::regclass)
  AND (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'public.ai_reply_reservations'::regclass)
  AND (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'public.ai_reply_reservation_attempts'::regclass)
  AND (SELECT relrowsecurity FROM pg_class
       WHERE oid = 'public.anthropic_provider_calls'::regclass),
  'all new ledgers have RLS enabled'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.ai_reply_usage_periods', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ai_reply_reservations', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ai_reply_reservation_attempts', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.anthropic_provider_calls', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ai_reply_usage_periods', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ai_reply_reservations', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.ai_reply_reservation_attempts', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.anthropic_provider_calls', 'SELECT'),
  'anonymous and authenticated roles cannot read internal AI cost or allowance rows'
);

SELECT ok(
  has_table_privilege('service_role', 'public.ai_reply_usage_periods', 'SELECT')
  AND has_table_privilege('service_role', 'public.ai_reply_reservations', 'SELECT')
  AND has_table_privilege('service_role', 'public.ai_reply_reservation_attempts', 'SELECT')
  AND has_table_privilege('service_role', 'public.anthropic_provider_calls', 'SELECT')
  AND NOT has_table_privilege('service_role', 'public.ai_reply_usage_periods', 'INSERT')
  AND NOT has_table_privilege('service_role', 'public.ai_reply_reservations', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.ai_reply_reservation_attempts', 'UPDATE')
  AND NOT has_table_privilege('service_role', 'public.anthropic_provider_calls', 'DELETE'),
  'service role reads ledgers but mutates them only through guarded RPCs'
);

SELECT has_function(
  'public', 'reserve_ai_reply',
  ARRAY['uuid', 'text', 'text', 'text', 'uuid'],
  'reserve RPC exists'
);
SELECT has_function(
  'public', 'finalize_ai_reply', ARRAY['uuid', 'uuid', 'uuid'],
  'finalize RPC exists'
);
SELECT has_function(
  'public', 'release_ai_reply', ARRAY['uuid', 'uuid', 'text'],
  'release RPC exists'
);
SELECT has_function(
  'public', 'reap_expired_ai_reply_reservations', ARRAY['integer'],
  'reservation reaper exists'
);
SELECT has_function(
  'public', 'get_current_ai_reply_usage', ARRAY['uuid'],
  'side-effect-free current AI reply usage RPC exists'
);
SELECT has_function(
  'public', 'get_completed_ai_reply',
  ARRAY['uuid', 'text', 'text', 'text'],
  'exact completed AI reply recovery RPC exists'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.reserve_ai_reply(uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reserve_ai_reply(uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reserve_ai_reply(uuid,text,text,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'public.finalize_ai_reply(uuid,uuid,uuid)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.finalize_ai_reply(uuid,uuid,uuid)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role', 'public.release_ai_reply(uuid,uuid,text)', 'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated', 'public.release_ai_reply(uuid,uuid,text)', 'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.reap_expired_ai_reply_reservations(integer)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.reap_expired_ai_reply_reservations(integer)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_current_ai_reply_usage(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.get_current_ai_reply_usage(uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_current_ai_reply_usage(uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.get_completed_ai_reply(uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.get_completed_ai_reply(uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.get_completed_ai_reply(uuid,text,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_anthropic_provider_call(uuid,uuid,uuid,text,text,text,boolean,text,text,bigint,bigint,bigint,bigint,integer,text,integer,integer,boolean,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_anthropic_provider_call(uuid,uuid,uuid,text,text,text,boolean,text,text,bigint,bigint,bigint,bigint,integer,text,integer,integer,boolean,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.reconcile_linked_ai_reply_reservations(uuid)',
    'EXECUTE'
  ),
  'public metering mutations are service-only and the reconciler stays internal'
);

SELECT ok(
  (
    SELECT bool_and(procedure.prosecdef)
      AND bool_and(
        procedure.proconfig = ARRAY['search_path=public, pg_temp']::text[]
      )
    FROM pg_proc AS procedure
    WHERE procedure.oid IN (
      'public.reserve_ai_reply(uuid,text,text,text,uuid)'::regprocedure,
      'public.finalize_ai_reply(uuid,uuid,uuid)'::regprocedure,
      'public.release_ai_reply(uuid,uuid,text)'::regprocedure,
      'public.reap_expired_ai_reply_reservations(integer)'::regprocedure,
      'public.get_current_ai_reply_usage(uuid)'::regprocedure,
      'public.get_completed_ai_reply(uuid,text,text,text)'::regprocedure,
      'public.guard_message_ai_reply_reservation_proof()'::regprocedure,
      'public.record_anthropic_provider_call(uuid,uuid,uuid,text,text,text,boolean,text,text,bigint,bigint,bigint,bigint,integer,text,integer,integer,boolean,text)'::regprocedure
    )
  ),
  'metering RPCs use fixed-path definer authority'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.columns AS column_row
    WHERE column_row.table_schema = 'public'
      AND column_row.table_name = 'anthropic_provider_calls'
      AND column_row.column_name IN (
        'content', 'message', 'prompt', 'response', 'tool_input',
        'tool_result', 'metadata', 'request_body', 'response_body'
      )
  ),
  'provider-call accounting has no prompt, response, tool-content, or metadata columns'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_reply_reservations'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%business_id, channel, client_message_id%'
  )
  AND EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.ai_reply_reservations'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%business_id, source_message_id%'
  ),
  'logical request and durable inbound uniqueness are database-enforced'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
            'public.idx_ai_reply_reservations_global_expiry'::regclass
      AND index_row.indisvalid
      AND index_row.indpred IS NOT NULL
  ),
  'global reservation reaping has a valid partial expiry index'
);

SELECT is(
  (
    SELECT job.schedule
    FROM cron.job AS job
    WHERE job.jobname = 'reap_expired_ai_reply_reservations'
  ),
  '* * * * *',
  'expired and crash-window reply reservations have a scheduled reaper'
);

-- ---------------------------------------------------------------------------
-- Billing fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id, name, slug, status, created_at, updated_at
) VALUES (
  '90000000-0000-4000-a060-000000000001',
  'Metering Partner 060',
  'metering-partner-060',
  'active',
  now(),
  now()
);

INSERT INTO public.businesses (
  id, name, email, business_type, slug, billing_mode, partner_plan,
  partner_id, billing_exempt, operations_suspended_at, ai_replies_paused_at
) VALUES
  ('10000000-0000-4000-a060-000000000001', 'Direct Chat 060',
   'direct-chat-a060@example.test', 'general', 'direct-chat-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000002', 'Partner Chat 060',
   'partner-chat-a060@example.test', 'general', 'partner-chat-a060',
   'comped', 'chat_only', '90000000-0000-4000-a060-000000000001',
   false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000003', 'Override Full 060',
   'override-full-a060@example.test', 'general', 'override-full-a060',
   'stripe', NULL, NULL, true, NULL, NULL),
  ('10000000-0000-4000-a060-000000000004', 'Direct Growth 060',
   'direct-growth-a060@example.test', 'general', 'direct-growth-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000005', 'Direct Full 060',
   'direct-full-a060@example.test', 'general', 'direct-full-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000006', 'Direct Starter 060',
   'direct-starter-a060@example.test', 'general', 'direct-starter-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000007', 'Canceled Chat 060',
   'canceled-chat-a060@example.test', 'general', 'canceled-chat-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000008', 'Paused Chat 060',
   'paused-chat-a060@example.test', 'general', 'paused-chat-a060',
   'stripe', NULL, NULL, false, NULL, now()),
  ('10000000-0000-4000-a060-000000000009', 'Suspended Chat 060',
   'suspended-chat-a060@example.test', 'general', 'suspended-chat-a060',
   'stripe', NULL, NULL, false, now(), NULL),
  ('10000000-0000-4000-a060-000000000010', 'Period Boundary Chat 060',
   'period-boundary-chat-a060@example.test', 'general',
   'period-boundary-chat-a060',
   'stripe', NULL, NULL, false, NULL, NULL),
  ('10000000-0000-4000-a060-000000000011', 'Past Due Chat 060',
   'past-due-chat-a060@example.test', 'general', 'past-due-chat-a060',
   'stripe', NULL, NULL, false, NULL, NULL);

SELECT throws_ok(
  $$
    INSERT INTO public.ai_reply_usage_periods (
      business_id, period_start, period_end, billing_source, plan,
      included_ai_replies
    ) VALUES (
      '10000000-0000-4000-a060-000000000001',
      '2040-01-01 00:00:00+00', '2040-02-01 00:00:00+00',
      'subscription', 'chat_only', NULL
    )
  $$,
  '23514',
  NULL,
  'Chat Only usage periods cannot bypass the exact 200 allowance with NULL'
);

INSERT INTO public.subscriptions (
  id, business_id, stripe_customer_id, stripe_subscription_id,
  plan, status, current_period_start, current_period_end
) VALUES
  ('11000000-0000-4000-a060-000000000001',
   '10000000-0000-4000-a060-000000000001', 'cus_chat_a060',
   'sub_chat_a060', 'chat_only', 'active',
   statement_timestamp() - interval '8 days',
   statement_timestamp() + interval '22 days'),
  ('11000000-0000-4000-a060-000000000004',
   '10000000-0000-4000-a060-000000000004', 'cus_growth_a060',
   'sub_growth_a060', 'sms_and_chat', 'past_due',
   statement_timestamp() - interval '13 days',
   statement_timestamp() + interval '17 days'),
  ('11000000-0000-4000-a060-000000000005',
   '10000000-0000-4000-a060-000000000005', 'cus_full_a060',
   'sub_full_a060', 'full', 'trialing',
   statement_timestamp() - interval '15 days',
   statement_timestamp() + interval '15 days'),
  ('11000000-0000-4000-a060-000000000006',
   '10000000-0000-4000-a060-000000000006', 'cus_starter_a060',
   'sub_starter_a060', 'sms_only', 'active',
   statement_timestamp() - interval '17 days',
   statement_timestamp() + interval '13 days'),
  ('11000000-0000-4000-a060-000000000007',
   '10000000-0000-4000-a060-000000000007', 'cus_canceled_a060',
   'sub_canceled_a060', 'chat_only', 'canceled',
   statement_timestamp() - interval '17 days',
   statement_timestamp() + interval '13 days'),
  ('11000000-0000-4000-a060-000000000008',
   '10000000-0000-4000-a060-000000000008', 'cus_paused_a060',
   'sub_paused_a060', 'chat_only', 'active',
   statement_timestamp() - interval '17 days',
   statement_timestamp() + interval '13 days'),
  ('11000000-0000-4000-a060-000000000009',
   '10000000-0000-4000-a060-000000000009', 'cus_suspended_a060',
   'sub_suspended_a060', 'chat_only', 'active',
   statement_timestamp() - interval '17 days',
   statement_timestamp() + interval '13 days'),
  ('11000000-0000-4000-a060-000000000010',
   '10000000-0000-4000-a060-000000000010', 'cus_boundary_a060',
   'sub_boundary_a060', 'chat_only', 'active',
   statement_timestamp() - interval '10 days',
   statement_timestamp() + interval '20 days'),
  ('11000000-0000-4000-a060-000000000011',
   '10000000-0000-4000-a060-000000000011', 'cus_past_due_chat_a060',
   'sub_past_due_chat_a060', 'chat_only', 'past_due',
   statement_timestamp() - interval '60 days',
   statement_timestamp() - interval '30 days');

INSERT INTO public.contacts (
  id, business_id, source_channel, session_id
)
SELECT
  ('21000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  ('10000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  'web_chat',
  'session-a060-' || number
FROM generate_series(1, 11) AS number;

INSERT INTO public.conversations (
  id, business_id, contact_id, channel
)
SELECT
  ('22000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  ('10000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  ('21000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  'web_chat'
FROM generate_series(1, 11) AS number;

INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
)
SELECT
  ('23000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  ('22000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  ('10000000-0000-4000-a060-' || lpad(number::text, 12, '0'))::uuid,
  'customer',
  'Inbound ' || number,
  'web_chat'
FROM generate_series(1, 11) AS number;

INSERT INTO public.ai_reply_usage_periods (
  business_id, period_start, period_end, billing_source, plan,
  included_ai_replies, completed_replies
)
SELECT
  subscription.business_id,
  subscription.current_period_start,
  subscription.current_period_end,
  'subscription',
  'chat_only',
  200,
  199
FROM public.subscriptions AS subscription
WHERE subscription.business_id =
  '10000000-0000-4000-a060-000000000011';

SET LOCAL ROLE service_role;

CREATE TEMP TABLE meter_060_state (
  key text PRIMARY KEY,
  value text NOT NULL
) ON COMMIT DROP;

SELECT is(
  (public.get_completed_ai_reply(
    '10000000-0000-4000-a060-000000000001',
    'web_chat', 'client-not-created', repeat('0', 64)
  ))->>'outcome',
  'not_found',
  'completed lookup is side-effect-free when no logical request exists'
);

WITH snapshot AS (
  SELECT public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000001'
  ) AS value
)
SELECT ok(
  (SELECT value @> jsonb_build_object(
     'outcome', 'no_period',
     'usage_period_id', NULL,
     'billing_source', 'subscription',
     'plan', 'chat_only',
     'allowance', 200,
     'completed_replies', 0,
     'active_reservations', 0,
     'remaining_replies', 200,
     'allowance_renewal', 'scheduled',
     'reset_at', (SELECT subscription.current_period_end
                  FROM public.subscriptions AS subscription
                  WHERE subscription.business_id =
                    '10000000-0000-4000-a060-000000000001')
   ) FROM snapshot)
  AND (
    SELECT (snapshot.value->>'period_start')::timestamptz =
             subscription.current_period_start
       AND (snapshot.value->>'period_end')::timestamptz =
             subscription.current_period_end
       AND (snapshot.value->>'reset_at')::timestamptz =
             subscription.current_period_end
    FROM snapshot
    JOIN public.subscriptions AS subscription
      ON subscription.business_id =
           '10000000-0000-4000-a060-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.ai_reply_usage_periods
    WHERE business_id = '10000000-0000-4000-a060-000000000001'
  ),
  'usage read returns an entitled zero state without creating a period'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001',
    'web_chat',
    'client-direct-1',
    repeat('a', 64),
    '23000000-0000-4000-a060-000000000001'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'direct_reservation', value::text FROM decision;

SELECT is(
  (SELECT (value::jsonb)->>'outcome' FROM meter_060_state
   WHERE key = 'direct_reservation'),
  'reserved',
  'active direct Chat Only reserves one reply'
);

SELECT is(
  (SELECT ((value::jsonb)->>'allowance')::integer FROM meter_060_state
   WHERE key = 'direct_reservation'),
  200,
  'Chat Only allowance is exactly 200'
);

SELECT ok(
  (
    SELECT period.period_start = subscription.current_period_start
       AND period.period_end = subscription.current_period_end
       AND period.billing_source = 'subscription'
    FROM public.ai_reply_usage_periods AS period
    JOIN public.subscriptions AS subscription
      ON subscription.business_id = period.business_id
    WHERE period.id = (
      SELECT ((value::jsonb)->>'usage_period_id')::uuid
      FROM meter_060_state WHERE key = 'direct_reservation'
    )
  ),
  'direct Stripe metering uses the synchronized subscription period exactly'
);

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000001'
  ) @> jsonb_build_object(
    'outcome', 'current',
    'billing_source', 'subscription',
    'plan', 'chat_only',
    'allowance', 200,
    'completed_replies', 0,
    'active_reservations', 1,
    'remaining_replies', 199
  ),
  'usage read includes active reservations in remaining Chat Only allowance'
);

SELECT throws_ok(
  $$
    INSERT INTO public.messages (
      id, conversation_id, business_id, role, content, channel,
      ai_reply_reservation_id, ai_reply_reservation_attempt_token
    )
    SELECT
      '24000000-0000-4000-a060-000000000099',
      '22000000-0000-4000-a060-000000000001',
      NULL,
      'assistant', 'Malformed proof', 'web_chat',
      ((value::jsonb)->>'reservation_id')::uuid,
      ((value::jsonb)->>'attempt_token')::uuid
    FROM meter_060_state WHERE key = 'direct_reservation'
  $$,
  '55000',
  'invalid_or_expired_ai_reply_reservation_proof',
  'nullable legacy message columns cannot bypass assistant proof identity'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-direct-1', repeat('a', 64),
    '23000000-0000-4000-a060-000000000001'
  ))->>'outcome',
  'in_progress',
  'same request retry returns the existing in-progress reference'
);

SELECT ok(
  public.get_completed_ai_reply(
    '10000000-0000-4000-a060-000000000001',
    'web_chat', 'client-direct-1', repeat('a', 64)
  ) @> jsonb_build_object(
    'outcome', 'not_completed',
    'source_message_id', '23000000-0000-4000-a060-000000000001',
    'status', 'reserved'
  ),
  'completed lookup never exposes an in-progress worker token'
);

SELECT throws_ok(
  $$
    SELECT public.reserve_ai_reply(
      '10000000-0000-4000-a060-000000000001', 'web_chat',
      'client-direct-1', repeat('b', 64),
      '23000000-0000-4000-a060-000000000001'
    )
  $$,
  '23505',
  'ai_reply_idempotency_conflict',
  'same client id with another fingerprint fails explicitly'
);

-- Persist with both opaque proofs, then finalize. The exact reply becomes the
-- durable idempotent replay target.
INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel,
  ai_reply_reservation_id, ai_reply_reservation_attempt_token
)
SELECT
  '24000000-0000-4000-a060-000000000001',
  '22000000-0000-4000-a060-000000000001',
  '10000000-0000-4000-a060-000000000001',
  'assistant',
  'Durable answer one',
  'web_chat',
  ((value::jsonb)->>'reservation_id')::uuid,
  ((value::jsonb)->>'attempt_token')::uuid
FROM meter_060_state
WHERE key = 'direct_reservation';

SELECT is(
  (public.finalize_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'),
    '24000000-0000-4000-a060-000000000001'
  ))->>'outcome',
  'completed',
  'finalization succeeds only after durable assistant persistence'
);

SELECT is(
  (SELECT completed_replies FROM public.ai_reply_usage_periods
   WHERE id = (
     SELECT ((value::jsonb)->>'usage_period_id')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'
   )),
  1,
  'one durable assistant consumes exactly one unit'
);

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000001'
  ) @> jsonb_build_object(
    'outcome', 'current',
    'completed_replies', 1,
    'active_reservations', 0,
    'remaining_replies', 199
  ),
  'usage read reports finalized durable replies and released capacity exactly'
);

SELECT is(
  (public.finalize_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'),
    '24000000-0000-4000-a060-000000000001'
  ))->>'assistant_message_id',
  '24000000-0000-4000-a060-000000000001',
  'finalization retry returns the exact prior assistant proof'
);

SELECT is(
  (SELECT completed_replies FROM public.ai_reply_usage_periods
   WHERE id = (
     SELECT ((value::jsonb)->>'usage_period_id')::uuid
     FROM meter_060_state WHERE key = 'direct_reservation'
   )),
  1,
  'idempotent finalization never increments twice'
);

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-direct-1', repeat('a', 64),
    '23000000-0000-4000-a060-000000000001'
  )) @> jsonb_build_object(
    'outcome', 'completed',
    'assistant_message_id', '24000000-0000-4000-a060-000000000001',
    'conversation_id', '22000000-0000-4000-a060-000000000001'
  ),
  'completed request retry returns enough proof to fetch the exact response'
);

SELECT ok(
  public.get_completed_ai_reply(
    '10000000-0000-4000-a060-000000000001',
    'web_chat', 'client-direct-1', repeat('a', 64)
  ) @> jsonb_build_object(
    'outcome', 'completed',
    'source_message_id', '23000000-0000-4000-a060-000000000001',
    'assistant_message_id', '24000000-0000-4000-a060-000000000001',
    'conversation_id', '22000000-0000-4000-a060-000000000001'
  ),
  'pre-gate lookup returns exact durable assistant proof after finalization'
);

SELECT throws_ok(
  $$
    SELECT public.get_completed_ai_reply(
      '10000000-0000-4000-a060-000000000001',
      'web_chat', 'client-direct-1', repeat('b', 64)
    )
  $$,
  '23505',
  'ai_reply_idempotency_conflict',
  'completed lookup rejects a reused client id with another fingerprint'
);

-- Release and retry reuse one logical row with a fresh opaque attempt.
INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
) VALUES (
  '23000000-0000-4000-a060-000000000101',
  '22000000-0000-4000-a060-000000000001',
  '10000000-0000-4000-a060-000000000001',
  'customer', 'Second inbound', 'web_chat'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-direct-2', repeat('c', 64),
    '23000000-0000-4000-a060-000000000101'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'released_first', value::text FROM decision;

SELECT is(
  (public.release_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    'anthropic_error'
  ))->>'outcome',
  'released',
  'failed model attempt releases its allowance slot'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-direct-2', repeat('c', 64),
    '23000000-0000-4000-a060-000000000101'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'released_retry', value::text FROM decision;

SELECT ok(
  (
    SELECT
      (retry.value::jsonb)->>'reservation_id'
        = (first_try.value::jsonb)->>'reservation_id'
      AND ((retry.value::jsonb)->>'attempt_count')::integer = 2
      AND (retry.value::jsonb)->>'attempt_token'
        <> (first_try.value::jsonb)->>'attempt_token'
    FROM meter_060_state AS retry
    CROSS JOIN meter_060_state AS first_try
    WHERE retry.key = 'released_retry'
      AND first_try.key = 'released_first'
  ),
  'released retry reuses the logical row with a new opaque attempt token'
);

SELECT is(
  (public.finalize_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    '24000000-0000-4000-a060-000000000001'
  ))->>'outcome',
  'stale_attempt',
  'old worker token cannot finalize after retry'
);

-- Crash recovery: assistant persistence is linked before finalization. A retry
-- reconciles it and does not spend another reservation.
INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
) VALUES (
  '23000000-0000-4000-a060-000000000102',
  '22000000-0000-4000-a060-000000000001',
  '10000000-0000-4000-a060-000000000001',
  'customer', 'Crash inbound', 'web_chat'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-crash', repeat('d', 64),
    '23000000-0000-4000-a060-000000000102'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'crash_reservation', value::text FROM decision;

INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel,
  ai_reply_reservation_id, ai_reply_reservation_attempt_token
)
SELECT
  '24000000-0000-4000-a060-000000000011',
  '22000000-0000-4000-a060-000000000001',
  '10000000-0000-4000-a060-000000000001',
  'assistant', 'Persisted before crash', 'web_chat',
  ((value::jsonb)->>'reservation_id')::uuid,
  ((value::jsonb)->>'attempt_token')::uuid
FROM meter_060_state WHERE key = 'crash_reservation';

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000001'
  ) @> jsonb_build_object(
    'outcome', 'current',
    'completed_replies', 2,
    'active_reservations', 1,
    'remaining_replies', 197
  )
  AND (
    SELECT completed_replies = 1
    FROM public.ai_reply_usage_periods
    WHERE business_id = '10000000-0000-4000-a060-000000000001'
  ),
  'usage read counts linked crash-window proof without mutating the ledger'
);

SELECT is(
  public.reap_expired_ai_reply_reservations(50),
  1,
  'scheduled reaper reconciles linked crash-window assistant proof without later traffic'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-crash', repeat('d', 64),
    '23000000-0000-4000-a060-000000000102'
  ))->>'assistant_message_id',
  '24000000-0000-4000-a060-000000000011',
  'retry discovers and completes an assistant persisted before a crash'
);

SELECT is(
  (SELECT completed_replies FROM public.ai_reply_usage_periods
   WHERE business_id = '10000000-0000-4000-a060-000000000001'),
  2,
  'crash reconciliation increments exactly once'
);

-- Provider-call telemetry is separate from reply-unit completion.
WITH provider_call AS (
  SELECT public.record_anthropic_provider_call(
    '10000000-0000-4000-a060-000000000001',
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    'call-a060-live-1', 'live_web_chat_reply', 'web_chat', false,
    'claude-haiku-4-5-20251001', 'msg_a060_live_1',
    120, 40, 10, 20, 350, 'end_turn', 1, 1, true, NULL
  ) AS id
)
INSERT INTO meter_060_state (key, value)
SELECT 'provider_call', id::text FROM provider_call;

SELECT ok(
  (SELECT value::uuid IS NOT NULL FROM meter_060_state
   WHERE key = 'provider_call')
  AND (SELECT completed_replies = 2
       FROM public.ai_reply_usage_periods
       WHERE business_id = '10000000-0000-4000-a060-000000000001'),
  'provider calls record tokens/cache/latency/tools without consuming a reply'
);

SELECT is(
  public.record_anthropic_provider_call(
    '10000000-0000-4000-a060-000000000001',
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'released_first'),
    'call-a060-live-1', 'live_web_chat_reply', 'web_chat', false,
    'claude-haiku-4-5-20251001', 'msg_a060_live_1',
    120, 40, 10, 20, 350, 'end_turn', 1, 1, true, NULL
  ),
  (SELECT value::uuid FROM meter_060_state WHERE key = 'provider_call'),
  'identical provider-call retry is idempotent'
);

SELECT throws_ok(
  $$
    SELECT public.record_anthropic_provider_call(
      '10000000-0000-4000-a060-000000000001',
      (SELECT ((value::jsonb)->>'reservation_id')::uuid
       FROM meter_060_state WHERE key = 'released_first'),
      (SELECT ((value::jsonb)->>'attempt_token')::uuid
       FROM meter_060_state WHERE key = 'released_first'),
      'call-a060-live-1', 'live_web_chat_reply', 'web_chat', false,
      'claude-haiku-4-5-20251001', 'msg_a060_live_1',
      121, 40, 10, 20, 350, 'end_turn', 1, 1, true, NULL
    )
  $$,
  '23505',
  'anthropic_provider_call_idempotency_conflict',
  'provider-call key cannot be reused with different accounting facts'
);

SELECT ok(
  public.record_anthropic_provider_call(
    '10000000-0000-4000-a060-000000000001',
    NULL, NULL,
    'call-a060-preview-1', 'preview_web_chat_reply', 'web_chat', true,
    'claude-haiku-4-5-20251001', 'msg_a060_preview_1',
    25, 8, 0, 0, 100, 'end_turn', 0, 0, true, NULL
  ) IS NOT NULL
  AND (SELECT completed_replies = 2
       FROM public.ai_reply_usage_periods
       WHERE business_id = '10000000-0000-4000-a060-000000000001'),
  'preview provider call is accounted but never billable'
);

-- Existing plan regression and period sources.
SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000004', 'web_chat',
    'client-growth', repeat('e', 64),
    '23000000-0000-4000-a060-000000000004'
  )) @> jsonb_build_object(
    'outcome', 'reserved', 'plan', 'sms_and_chat',
    'allowance', NULL::integer
  ),
  'Growth remains eligible and uncapped during past-due recovery'
);

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000005', 'web_chat',
    'client-full', repeat('f', 64),
    '23000000-0000-4000-a060-000000000005'
  )) @> jsonb_build_object(
    'outcome', 'reserved', 'plan', 'full',
    'allowance', NULL::integer
  ),
  'Full remains eligible and uncapped while trialing'
);

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000005'
  ) @> jsonb_build_object(
    'outcome', 'current',
    'plan', 'full',
    'allowance', NULL,
    'completed_replies', 0,
    'active_reservations', 1,
    'remaining_replies', NULL
  ),
  'usage read preserves uncapped existing-plan behavior'
);

DO $$
DECLARE
  v_reservation public.ai_reply_reservations%ROWTYPE;
BEGIN
  SELECT reservation.* INTO STRICT v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.business_id =
    '10000000-0000-4000-a060-000000000004';
  PERFORM public.release_ai_reply(
    v_reservation.id, v_reservation.attempt_token, 'period_policy_test'
  );
END;
$$;

RESET ROLE;
UPDATE public.subscriptions
SET current_period_start = statement_timestamp() - interval '60 days',
    current_period_end = statement_timestamp() - interval '30 days'
WHERE business_id = '10000000-0000-4000-a060-000000000004';
SET LOCAL ROLE service_role;

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000004', 'web_chat',
    'client-growth', repeat('e', 64),
    '23000000-0000-4000-a060-000000000004'
  )) @> jsonb_build_object(
    'outcome', 'reserved',
    'plan', 'sms_and_chat',
    'allowance', NULL,
    'period_end', (SELECT subscription.current_period_end
                   FROM public.subscriptions AS subscription
                   WHERE subscription.business_id =
                     '10000000-0000-4000-a060-000000000004')
  ),
  'uncapped Growth service survives a structurally valid stale Stripe period'
);

DO $$
DECLARE
  v_reservation public.ai_reply_reservations%ROWTYPE;
BEGIN
  SELECT reservation.* INTO STRICT v_reservation
  FROM public.ai_reply_reservations AS reservation
  WHERE reservation.business_id =
    '10000000-0000-4000-a060-000000000004';
  PERFORM public.release_ai_reply(
    v_reservation.id, v_reservation.attempt_token, 'period_fallback_test'
  );
END;
$$;

RESET ROLE;
UPDATE public.subscriptions
SET current_period_start = NULL,
    current_period_end = NULL
WHERE business_id = '10000000-0000-4000-a060-000000000004';
SET LOCAL ROLE service_role;

SELECT ok(
  (
    SELECT
      decision.value @> jsonb_build_object(
        'outcome', 'reserved', 'plan', 'sms_and_chat', 'allowance', NULL
      )
      AND (decision.value->>'period_start')::timestamptz =
            date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')
              AT TIME ZONE 'UTC'
    FROM (
      SELECT public.reserve_ai_reply(
        '10000000-0000-4000-a060-000000000004', 'web_chat',
        'client-growth', repeat('e', 64),
        '23000000-0000-4000-a060-000000000004'
      ) AS value
    ) AS decision
  ),
  'uncapped Growth uses a UTC telemetry period when Stripe dates are null'
);

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000011'
  ) @> jsonb_build_object(
    'outcome', 'current',
    'plan', 'chat_only',
    'allowance', 200,
    'completed_replies', 199,
    'active_reservations', 0,
    'remaining_replies', 1,
    'reset_at', NULL,
    'allowance_renewal', 'frozen_past_due'
  ),
  'past-due Chat Only reads its last allowance without promising a reset'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000011', 'web_chat',
    'client-past-due', repeat('7', 64),
    '23000000-0000-4000-a060-000000000011'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'past_due_reservation', value::text FROM decision;

SELECT ok(
  (SELECT value::jsonb FROM meter_060_state
   WHERE key = 'past_due_reservation') @> jsonb_build_object(
    'outcome', 'reserved',
    'remaining_replies', 0,
    'reset_at', NULL,
    'allowance_renewal', 'frozen_past_due'
  ),
  'past-due Chat Only can spend only the remaining frozen-period allowance'
);

DO $$
BEGIN
  PERFORM public.release_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'past_due_reservation'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'past_due_reservation'),
    'frozen_allowance_test'
  );
END;
$$;

RESET ROLE;
UPDATE public.ai_reply_usage_periods
SET completed_replies = 200
WHERE business_id = '10000000-0000-4000-a060-000000000011';
SET LOCAL ROLE service_role;

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000011', 'web_chat',
    'client-past-due', repeat('7', 64),
    '23000000-0000-4000-a060-000000000011'
  )) @> jsonb_build_object(
    'outcome', 'limit_reached',
    'remaining_replies', 0,
    'reset_at', NULL,
    'allowance_renewal', 'frozen_past_due'
  )
  AND (SELECT count(*) = 1
       FROM public.ai_reply_usage_periods
       WHERE business_id = '10000000-0000-4000-a060-000000000011'),
  'past-due exhaustion cannot mint a virtual renewal period'
);

RESET ROLE;
UPDATE public.subscriptions
SET current_period_start = NULL,
    current_period_end = NULL
WHERE business_id = '10000000-0000-4000-a060-000000000011';
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.get_current_ai_reply_usage(
      '10000000-0000-4000-a060-000000000011'
    )
  $$,
  '55000',
  'invalid_ai_reply_subscription_period',
  'past-due Chat Only fails closed when its frozen Stripe period is null'
);

RESET ROLE;
UPDATE public.subscriptions
SET current_period_start = statement_timestamp(),
    current_period_end = statement_timestamp() - interval '1 day'
WHERE business_id = '10000000-0000-4000-a060-000000000011';
SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.reserve_ai_reply(
      '10000000-0000-4000-a060-000000000011', 'web_chat',
      'client-past-due', repeat('7', 64),
      '23000000-0000-4000-a060-000000000011'
    )
  $$,
  '55000',
  'invalid_ai_reply_subscription_period',
  'past-due Chat Only fails closed when its frozen Stripe period is inverted'
);

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000003', 'web_chat',
    'client-override', repeat('1', 64),
    '23000000-0000-4000-a060-000000000003'
  )) @> jsonb_build_object(
    'outcome', 'reserved', 'plan', 'full',
    'allowance', NULL::integer
  ),
  'legacy billing override retains uncapped Full behavior'
);

SELECT ok(
  (
    SELECT period.period_start =
             date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')
               AT TIME ZONE 'UTC'
       AND period.period_end = period.period_start + interval '1 month'
       AND period.billing_source = 'billing_override'
    FROM public.ai_reply_usage_periods AS period
    WHERE period.business_id = '10000000-0000-4000-a060-000000000003'
  ),
  'override period uses a UTC calendar month'
);

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000002', 'web_chat',
    'client-partner', repeat('2', 64),
    '23000000-0000-4000-a060-000000000002'
  )) @> jsonb_build_object(
    'outcome', 'reserved', 'plan', 'chat_only', 'allowance', 200
  ),
  'partner-managed Chat Only uses the same 200-reply product allowance'
);

SELECT ok(
  (
    SELECT period.period_start =
             date_trunc('month', statement_timestamp() AT TIME ZONE 'UTC')
               AT TIME ZONE 'UTC'
       AND period.period_end = period.period_start + interval '1 month'
       AND period.billing_source = 'partner_billing'
    FROM public.ai_reply_usage_periods AS period
    WHERE period.business_id = '10000000-0000-4000-a060-000000000002'
  ),
  'partner period uses a UTC calendar month'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000006', 'web_chat',
    'client-starter', repeat('3', 64),
    '23000000-0000-4000-a060-000000000006'
  ))->>'reason',
  'plan',
  'Starter remains ineligible for web-chat AI replies'
);

SELECT ok(
  public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000006'
  ) @> jsonb_build_object(
    'outcome', 'not_entitled',
    'reason', 'plan',
    'plan', 'sms_only'
  ),
  'usage read returns a typed result for an existing plan without web chat'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000007', 'web_chat',
    'client-canceled', repeat('4', 64),
    '23000000-0000-4000-a060-000000000007'
  ))->>'reason',
  'inactive_subscription',
  'canceled Chat subscription cannot reserve'
);

RESET ROLE;
UPDATE public.subscriptions
SET status = NULL
WHERE business_id = '10000000-0000-4000-a060-000000000007';
SET LOCAL ROLE service_role;

SELECT ok(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000007', 'web_chat',
    'client-null-status', repeat('4', 64),
    '23000000-0000-4000-a060-000000000007'
  ))->>'reason' = 'inactive_subscription'
  AND public.get_current_ai_reply_usage(
    '10000000-0000-4000-a060-000000000007'
  ) @> jsonb_build_object(
    'outcome', 'not_entitled',
    'reason', 'inactive_subscription'
  ),
  'nullable legacy subscription status fails closed in reserve and usage read'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000008', 'web_chat',
    'client-paused', repeat('5', 64),
    '23000000-0000-4000-a060-000000000008'
  ))->>'reason',
  'ai_replies_paused',
  'AI pause fails closed before reservation'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000009', 'web_chat',
    'client-suspended', repeat('6', 64),
    '23000000-0000-4000-a060-000000000009'
  ))->>'reason',
  'account_suspended',
  'account suspension fails closed before reservation'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000010', 'web_chat',
    'client-period-boundary', repeat('9', 64),
    '23000000-0000-4000-a060-000000000010'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'period_boundary_first', value::text FROM decision;

SELECT is(
  (public.release_ai_reply(
    (SELECT ((value::jsonb)->>'reservation_id')::uuid
     FROM meter_060_state WHERE key = 'period_boundary_first'),
    (SELECT ((value::jsonb)->>'attempt_token')::uuid
     FROM meter_060_state WHERE key = 'period_boundary_first'),
    'period_boundary_retry'
  ))->>'outcome',
  'released',
  'period-boundary fixture releases its first attempt'
);

RESET ROLE;

UPDATE public.subscriptions
SET current_period_start = statement_timestamp() - interval '5 days',
    current_period_end = statement_timestamp() + interval '25 days'
WHERE business_id = '10000000-0000-4000-a060-000000000010';

SET LOCAL ROLE service_role;

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000010', 'web_chat',
    'client-period-boundary', repeat('9', 64),
    '23000000-0000-4000-a060-000000000010'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'period_boundary_retry', value::text FROM decision;

SELECT ok(
  (
    SELECT
      (retry.value::jsonb)->>'reservation_id'
        = (first_try.value::jsonb)->>'reservation_id'
      AND (retry.value::jsonb)->>'usage_period_id'
        <> (first_try.value::jsonb)->>'usage_period_id'
      AND ((retry.value::jsonb)->>'period_start')::timestamptz = (
        SELECT subscription.current_period_start
        FROM public.subscriptions AS subscription
        WHERE subscription.business_id =
          '10000000-0000-4000-a060-000000000010'
      )
      AND ((retry.value::jsonb)->>'attempt_count')::integer = 2
    FROM meter_060_state AS retry
    CROSS JOIN meter_060_state AS first_try
    WHERE retry.key = 'period_boundary_retry'
      AND first_try.key = 'period_boundary_first'
  ),
  'released logical request retries into the updated Stripe billing period'
);

RESET ROLE;

UPDATE public.subscriptions
SET current_period_start = statement_timestamp() - interval '60 days',
    current_period_end = statement_timestamp() - interval '30 days'
WHERE business_id = '10000000-0000-4000-a060-000000000010';

SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT public.get_current_ai_reply_usage(
      '10000000-0000-4000-a060-000000000010'
    )
  $$,
  '55000',
  'invalid_ai_reply_subscription_period',
  'stale synchronized subscription periods fail closed'
);

RESET ROLE;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.ai_reply_usage_periods
    WHERE business_id IN (
      '10000000-0000-4000-a060-000000000006',
      '10000000-0000-4000-a060-000000000007',
      '10000000-0000-4000-a060-000000000008',
      '10000000-0000-4000-a060-000000000009'
    )
  ),
  'denied, canceled, paused, and suspended attempts create no usage period'
);

-- Expiry/reaper and 199/200 sequential boundary. Concurrency is a separate
-- disposable-database dblink test.
UPDATE public.ai_reply_reservations
SET reserved_at = statement_timestamp() - interval '20 minutes',
    expires_at = statement_timestamp() - interval '10 minutes'
WHERE id = (
  SELECT ((value::jsonb)->>'reservation_id')::uuid
  FROM meter_060_state WHERE key = 'released_retry'
);

SET LOCAL ROLE service_role;

SELECT is(
  public.reap_expired_ai_reply_reservations(50),
  1,
  'reaper expires an abandoned active reservation'
);

WITH decision AS (
  SELECT public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-direct-2', repeat('c', 64),
    '23000000-0000-4000-a060-000000000101'
  ) AS value
)
INSERT INTO meter_060_state (key, value)
SELECT 'expired_retry', value::text FROM decision;

SELECT ok(
  (
    SELECT
      (expired.value::jsonb)->>'reservation_id'
        = (first_try.value::jsonb)->>'reservation_id'
      AND ((expired.value::jsonb)->>'attempt_count')::integer = 3
      AND (expired.value::jsonb)->>'attempt_token'
        <> (retry.value::jsonb)->>'attempt_token'
    FROM meter_060_state AS expired
    CROSS JOIN meter_060_state AS first_try
    CROSS JOIN meter_060_state AS retry
    WHERE expired.key = 'expired_retry'
      AND first_try.key = 'released_first'
      AND retry.key = 'released_retry'
  ),
  'expired retry also reuses the logical row with a fresh token'
);

RESET ROLE;

UPDATE public.ai_reply_usage_periods
SET completed_replies = 199
WHERE business_id = '10000000-0000-4000-a060-000000000001';

INSERT INTO public.messages (
  id, conversation_id, business_id, role, content, channel
) VALUES
  ('23000000-0000-4000-a060-000000000012',
   '22000000-0000-4000-a060-000000000001',
   '10000000-0000-4000-a060-000000000001',
   'customer', 'Boundary inbound one', 'web_chat'),
  ('23000000-0000-4000-a060-000000000013',
   '22000000-0000-4000-a060-000000000001',
   '10000000-0000-4000-a060-000000000001',
   'customer', 'Boundary inbound two', 'web_chat');

-- Clear the retry slot so the boundary begins with exactly 199 completed and
-- no active reservations.
UPDATE public.ai_reply_reservations
SET status = 'released',
    released_at = statement_timestamp(),
    release_reason = 'test_boundary_setup',
    updated_at = statement_timestamp()
WHERE id = (
  SELECT ((value::jsonb)->>'reservation_id')::uuid
  FROM meter_060_state WHERE key = 'expired_retry'
);

UPDATE public.ai_reply_reservation_attempts
SET status = 'released',
    ended_at = statement_timestamp()
WHERE reservation_id = (
  SELECT ((value::jsonb)->>'reservation_id')::uuid
  FROM meter_060_state WHERE key = 'expired_retry'
)
  AND status = 'reserved';

SET LOCAL ROLE service_role;

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-boundary-200', repeat('7', 64),
    '23000000-0000-4000-a060-000000000012'
  ))->>'outcome',
  'reserved',
  'the 200th reply slot can be reserved'
);

SELECT is(
  (public.reserve_ai_reply(
    '10000000-0000-4000-a060-000000000001', 'web_chat',
    'client-boundary-201', repeat('8', 64),
    '23000000-0000-4000-a060-000000000013'
  ))->>'outcome',
  'limit_reached',
  'the 201st completed-or-active slot is denied'
);

RESET ROLE;

-- Customer message writes remain available, but reservation proof is a
-- protected service-owned column.
INSERT INTO auth.users (
  id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, aud, role
) VALUES (
  '00000000-0000-4000-a060-000000000001',
  'meter-owner-a060@example.test', '', now(), now(), now(),
  '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'
);

UPDATE public.businesses
SET owner_id = '00000000-0000-4000-a060-000000000001'
WHERE id = '10000000-0000-4000-a060-000000000001';

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a060-000000000001',
  true
);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT throws_ok(
  $$
    UPDATE public.messages
    SET ai_reply_reservation_id = (
          SELECT ai_reply_reservation_id
          FROM public.messages
          WHERE id = '24000000-0000-4000-a060-000000000001'
        ),
        ai_reply_reservation_attempt_token = gen_random_uuid()
    WHERE id = '23000000-0000-4000-a060-000000000001'
  $$,
  '42501',
  'customer writes cannot set AI reply reservation proof',
  'authenticated owner cannot forge billable assistant proof'
);

SELECT throws_ok(
  $$
    UPDATE public.messages
    SET content = 'Rewritten metered reply'
    WHERE id = '24000000-0000-4000-a060-000000000001'
  $$,
  '42501',
  'customer writes cannot change metered message proof',
  'authenticated owner cannot rewrite an exact completed replay target'
);

DELETE FROM public.contacts
WHERE id = '21000000-0000-4000-a060-000000000001';

RESET ROLE;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.messages
    WHERE business_id = '10000000-0000-4000-a060-000000000001'
  )
  AND EXISTS (
    SELECT 1 FROM public.ai_reply_reservations
    WHERE business_id = '10000000-0000-4000-a060-000000000001'
      AND status = 'completed'
  ),
  'existing owner contact deletion still removes transcript content while retaining usage proof'
);

SELECT * FROM finish();
ROLLBACK;
