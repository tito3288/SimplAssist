BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(117);

-- ---------------------------------------------------------------------------
-- Private ledger, exact shape, and service-only mutation surface
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'chat_only_checkout_attempts',
  'Chat Only Checkout has a durable single-flight ledger'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid =
          'public.chat_only_checkout_attempts'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'business_id', 'uuid',
    'plan', 'text',
    'checkout_mode', 'text',
    'stripe_price_id', 'text',
    'request_fingerprint', 'text',
    'state', 'text',
    'claim_token', 'uuid',
    'claimed_at', 'timestamp with time zone',
    'claim_expires_at', 'timestamp with time zone',
    'attempt_count', 'integer',
    'stripe_checkout_session_id', 'text',
    'stripe_customer_id', 'text',
    'stripe_subscription_id', 'text',
    'checkout_url', 'text',
    'checkout_session_expires_at', 'timestamp with time zone',
    'completed_at', 'timestamp with time zone',
    'expired_at', 'timestamp with time zone',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'the private ledger exposes only the exact twenty lifecycle columns'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
          'public.chat_only_checkout_attempts'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  12,
  'all twelve identity, provider-shape, time, and lifecycle checks are validated'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
          'public.chat_only_checkout_attempts'::regclass
      AND constraint_row.contype = 'f'
      AND pg_get_constraintdef(constraint_row.oid) LIKE
            '%FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE%'
  ),
  'attempts are tenant-owned and cascade only after the business fence permits deletion'
);

SELECT ok(
  pg_get_indexdef(
    'public.chat_only_checkout_attempts_one_live_per_business'::regclass
  ) LIKE ALL (ARRAY[
    '%UNIQUE INDEX%',
    '%(business_id)%',
    '%state = ANY (ARRAY[''creating''::text, ''open''::text])%'
  ])
  AND pg_get_indexdef(
    'public.chat_only_checkout_attempts_subscription_unique'::regclass
  ) LIKE ALL (ARRAY[
    '%UNIQUE INDEX%',
    '%(stripe_subscription_id)%',
    '%WHERE (stripe_subscription_id IS NOT NULL)%'
  ])
  AND pg_get_indexdef(
    'public.chat_only_checkout_attempts_state_expiry_idx'::regclass
  ) LIKE '%state, checkout_session_expires_at, business_id%',
  'active-business and Subscription identities are unique with a lifecycle review index'
);

SELECT ok(
  (
    SELECT class.relrowsecurity
    FROM pg_class AS class
    WHERE class.oid = 'public.chat_only_checkout_attempts'::regclass
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid =
          'public.chat_only_checkout_attempts'::regclass
  ),
  'attempts enable RLS without any customer-visible policy'
);

SELECT ok(
  has_table_privilege(
    'service_role',
    'public.chat_only_checkout_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.chat_only_checkout_attempts',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.chat_only_checkout_attempts',
    'UPDATE'
  )
  AND NOT has_table_privilege(
    'service_role',
    'public.chat_only_checkout_attempts',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.chat_only_checkout_attempts',
    'SELECT'
  )
  AND NOT has_table_privilege(
    'anon',
    'public.chat_only_checkout_attempts',
    'SELECT'
  ),
  'the service can inspect attempts but all table mutation stays behind RPCs'
);

SELECT has_function(
  'public',
  'acquire_chat_only_checkout_attempt',
  ARRAY['uuid', 'text', 'text', 'uuid'],
  'single-flight acquisition RPC exists'
);

SELECT has_function(
  'public',
  'sync_chat_only_subscription_from_attempt',
  ARRAY[
    'uuid', 'uuid', 'text', 'timestamp with time zone', 'text', 'text',
    'text', 'timestamp with time zone', 'timestamp with time zone', 'text',
    'text', 'boolean', 'timestamp with time zone'
  ],
  'attempt-bound Chat subscription synchronization RPC exists'
);

SELECT has_function(
  'public',
  'record_chat_only_checkout_session',
  ARRAY['uuid', 'uuid', 'text', 'text', 'text', 'timestamp with time zone'],
  'exact open-Session recording RPC exists'
);

SELECT has_function(
  'public',
  'release_chat_only_checkout_attempt_claim',
  ARRAY['uuid', 'uuid'],
  'transient worker-claim release RPC exists'
);

SELECT has_function(
  'public',
  'complete_chat_only_checkout_attempt',
  ARRAY[
    'uuid', 'uuid', 'text', 'text', 'text', 'text',
    'timestamp with time zone'
  ],
  'subscription-bound completion RPC exists'
);

SELECT has_function(
  'public',
  'expire_chat_only_checkout_attempt',
  ARRAY['uuid', 'uuid', 'text', 'text', 'timestamp with time zone'],
  'Stripe-evidence expiry RPC exists'
);

SELECT ok(
  (
    SELECT bool_and(
      procedure.prosecdef
      AND procedure.provolatile = 'v'
      AND procedure.proconfig =
            ARRAY['search_path=public, pg_temp']::text[]
    )
    FROM pg_proc AS procedure
    WHERE procedure.oid = ANY (ARRAY[
      'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)'
        ::regprocedure,
      'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)'
        ::regprocedure,
      'public.record_chat_only_checkout_session(uuid,uuid,text,text,text,timestamptz)'
        ::regprocedure,
      'public.release_chat_only_checkout_attempt_claim(uuid,uuid)'
        ::regprocedure,
      'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)'
        ::regprocedure,
      'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)'
        ::regprocedure
    ])
  )
  AND has_function_privilege(
    'service_role',
    'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_chat_only_checkout_session(uuid,uuid,text,text,text,timestamptz)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.release_chat_only_checkout_attempt_claim(uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY[
      'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)'
        ::regprocedure,
      'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)'
        ::regprocedure,
      'public.record_chat_only_checkout_session(uuid,uuid,text,text,text,timestamptz)'
        ::regprocedure,
      'public.release_chat_only_checkout_attempt_claim(uuid,uuid)'
        ::regprocedure,
      'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)'
        ::regprocedure,
      'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)'
        ::regprocedure
    ]) AS lifecycle(procedure_oid)
    WHERE has_function_privilege(
            'authenticated', lifecycle.procedure_oid::oid, 'EXECUTE'
          )
       OR has_function_privilege(
            'anon', lifecycle.procedure_oid::oid, 'EXECUTE'
          )
  ),
  'all lifecycle writes are fixed-path volatile definers executable only by the service'
);

SELECT ok(
  pg_get_functiondef(
    'public.acquire_chat_only_checkout_attempt(uuid,text,text,uuid)'
      ::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%business_plan_family_locks%',
    '%claim_business_plan_family%',
    '%onboarding_selected_plan IS DISTINCT FROM ''chat_only''%',
    '%public.subscriptions%',
    '%created_at <= v_now - interval ''23 hours''%',
    '%''status'', ''recovery_required''%',
    '%chat_only_checkout_attempt_conflict%'
  ])
  AND pg_get_functiondef(
    'public.sync_chat_only_subscription_from_attempt(uuid,uuid,text,timestamptz,text,text,text,timestamptz,timestamptz,text,text,boolean,timestamptz)'
      ::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%v_attempt.stripe_price_id <> p_stripe_price_id%',
    '%v_attempt.request_fingerprint <> p_request_fingerprint%',
    '%v_attempt.checkout_session_expires_at <>%',
    '%sync_stripe_subscription_if_business_active%',
    '%stripe_subscription_id = COALESCE%',
    '%WHEN p_stripe_checkout_session_id IS NOT NULL THEN ''completed''%',
    '%completed_at = CASE%'
  ])
  AND pg_get_functiondef(
    'public.complete_chat_only_checkout_attempt(uuid,uuid,text,text,text,text,timestamptz)'
      ::regprocedure
  ) LIKE ALL (ARRAY[
    '%FOR UPDATE%',
    '%subscription.stripe_checkout_session_id%',
    '%subscription.stripe_customer_id%',
    '%subscription.stripe_subscription_id%'
  ])
  AND pg_get_functiondef(
    'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)'
      ::regprocedure
  ) NOT LIKE '%v_attempt.checkout_session_expires_at < v_now%'
  AND pg_get_functiondef(
    'public.expire_chat_only_checkout_attempt(uuid,uuid,text,text,timestamptz)'
      ::regprocedure
  ) NOT LIKE '%v_attempt.checkout_session_expires_at <= v_now%',
  'acquisition and terminal transitions lock authority and require exact persisted evidence'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_chat_checkout_attempt_authority',
  'business authority changes are fenced during an active Checkout attempt'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_delete_chat_checkout_attempt_authority',
  'hard business deletion is fenced during an active Checkout attempt'
);

SELECT ok(
  pg_get_triggerdef(
    (
      SELECT trigger.oid
      FROM pg_trigger AS trigger
      WHERE trigger.tgrelid = 'public.businesses'::regclass
        AND trigger.tgname =
              'guard_business_chat_checkout_attempt_authority'
    )
  ) LIKE ALL (ARRAY[
    '%BEFORE UPDATE OF owner_id, deleted_at, billing_mode, partner_id, partner_plan%',
    '%billing_pilot, billing_comped, billing_exempt%'
  ])
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_business_chat_checkout_attempt_authority()',
    'EXECUTE'
  ),
  'the uncallable trigger fences every direct-billing authority field'
);

-- ---------------------------------------------------------------------------
-- Exact direct-acquisition authority fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a064-000000000001',
  'chat-checkout-ledger-a064@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a064-000000000001',
    name = 'Chat Checkout Eligible 064',
    slug = 'chat-checkout-eligible-a064',
    onboarding_selected_plan = 'chat_only'
WHERE owner_id = '00000000-0000-4000-a064-000000000001';

INSERT INTO public.partners (
  id, name, slug
) VALUES (
  '90000000-0000-4000-a064-000000000001',
  'Chat Checkout Partner 064',
  'chat-checkout-partner-a064'
);

INSERT INTO public.businesses (
  id, owner_id, name, business_type, slug, onboarding_selected_plan,
  deleted_at, operations_suspended_at, billing_mode, partner_id,
  partner_plan, billing_pilot, billing_comped, billing_exempt
) VALUES
  (
    '10000000-0000-4000-a064-000000000002',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout No Lock 064', 'general',
    'chat-checkout-no-lock-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000003',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout SMS Lock 064', 'general',
    'chat-checkout-sms-lock-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000004',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Stale Intent 064', 'general',
    'chat-checkout-stale-intent-a064', 'sms_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000005',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Deleted 064', 'general',
    'chat-checkout-deleted-a064', 'chat_only',
    now(), NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000006',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Suspended 064', 'general',
    'chat-checkout-suspended-a064', 'chat_only',
    NULL, now(), 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000007',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Partner 064', 'general',
    'chat-checkout-partner-business-a064', 'chat_only',
    NULL, NULL, 'invoiced',
    '90000000-0000-4000-a064-000000000001', 'chat_only',
    false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000008',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Pilot 064', 'general',
    'chat-checkout-pilot-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, true, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000009',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Comped 064', 'general',
    'chat-checkout-comped-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, true, false
  ),
  (
    '10000000-0000-4000-a064-000000000010',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Exempt 064', 'general',
    'chat-checkout-exempt-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, true
  ),
  (
    '10000000-0000-4000-a064-000000000011',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Canceled 064', 'general',
    'chat-checkout-canceled-a064', NULL,
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000012',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Active 064', 'general',
    'chat-checkout-active-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000013',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout SMS Subscription 064', 'general',
    'chat-checkout-sms-subscription-a064', NULL,
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000014',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Clock Only 064', 'general',
    'chat-checkout-clock-only-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000015',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Service Role 064', 'general',
    'chat-checkout-service-role-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000016',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Completion 064', 'general',
    'chat-checkout-completion-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000017',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Recovery Required 064', 'general',
    'chat-checkout-recovery-required-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  ),
  (
    '10000000-0000-4000-a064-000000000018',
    '00000000-0000-4000-a064-000000000001',
    'Chat Checkout Generic Event 064', 'general',
    'chat-checkout-generic-event-a064', 'chat_only',
    NULL, NULL, 'stripe', NULL, NULL, false, false, false
  );

INSERT INTO public.business_plan_family_locks (
  business_id, family, claimed_by
) VALUES
  ('10000000-0000-4000-a064-000000000001', 'chat_only', 'direct_checkout'),
  ('10000000-0000-4000-a064-000000000003', 'sms', 'direct_checkout'),
  ('10000000-0000-4000-a064-000000000004', 'chat_only', 'direct_checkout'),
  ('10000000-0000-4000-a064-000000000011', 'chat_only', 'stripe_sync'),
  ('10000000-0000-4000-a064-000000000012', 'chat_only', 'stripe_sync'),
  ('10000000-0000-4000-a064-000000000013', 'chat_only', 'direct_checkout'),
  ('10000000-0000-4000-a064-000000000014', 'chat_only', 'direct_checkout'),
  ('10000000-0000-4000-a064-000000000017', 'chat_only', 'direct_checkout');

INSERT INTO public.subscriptions (
  id, business_id, stripe_customer_id, stripe_subscription_id,
  stripe_checkout_session_id, stripe_price_id, plan, status
) VALUES
  (
    '30000000-0000-4000-a064-000000000011',
    '10000000-0000-4000-a064-000000000011',
    'cus_CanceledA064', 'sub_CanceledA064', NULL,
    'price_chat_a064', 'chat_only', 'canceled'
  ),
  (
    '30000000-0000-4000-a064-000000000012',
    '10000000-0000-4000-a064-000000000012',
    'cus_ActiveA064', 'sub_ActiveA064', 'cs_active_a064',
    'price_chat_a064', 'chat_only', 'active'
  ),
  (
    '30000000-0000-4000-a064-000000000013',
    '10000000-0000-4000-a064-000000000013',
    'cus_SmsA064', 'sub_SmsA064', NULL,
    'price_sms_a064', 'sms_only', 'canceled'
  );

CREATE TEMP TABLE checkout_064_state (
  name text PRIMARY KEY,
  payload jsonb
) ON COMMIT DROP;

CREATE FUNCTION pg_temp.capture_chat_subscription_attempt_mismatch(
  p_business_id uuid,
  p_attempt_id uuid,
  p_request_fingerprint text,
  p_checkout_session_expires_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_stripe_price_id text,
  p_stripe_checkout_session_id text,
  p_cancel_at_period_end boolean,
  p_updated_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.sync_chat_only_subscription_from_attempt(
    p_business_id,
    p_attempt_id,
    p_request_fingerprint,
    p_checkout_session_expires_at,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_status,
    p_current_period_start,
    p_current_period_end,
    p_stripe_price_id,
    p_stripe_checkout_session_id,
    p_cancel_at_period_end,
    p_updated_at
  );
  RETURN 'no_error';
EXCEPTION
  WHEN SQLSTATE '55000' THEN
    RETURN SQLERRM;
END;
$$;

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    'ffffffff-ffff-4fff-afff-ffffffffffff',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000001'
  )->>'status',
  'unavailable',
  'a nonexistent business is unavailable'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000002',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000002'
  )->>'status',
  'create',
  'pristine acquisition atomically claims its family and durable attempt'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.business_plan_family_locks
    WHERE business_id = '10000000-0000-4000-a064-000000000002'
      AND family = 'chat_only'
      AND claimed_by = 'direct_checkout'
  )
  AND EXISTS (
    SELECT 1
    FROM public.chat_only_checkout_attempts
    WHERE business_id = '10000000-0000-4000-a064-000000000002'
      AND state = 'creating'
  ),
  'the family claim and attempt persist in the same acquisition transaction'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000003',
      'price_chat_a064', repeat('0', 64),
      '40000000-0000-4000-a064-000000000003'
    )
  $$,
  '55000',
  'plan_family_transition_not_supported',
  'an opposing SMS family lock rejects Chat Checkout acquisition'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000004',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000004'
  )->>'status',
  'unavailable',
  'new acquisition requires exact current Chat Only intent'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000005',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000005'
  )->>'status',
  'unavailable',
  'a deleted business cannot acquire a Checkout attempt'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000006',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000006'
  )->>'status',
  'unavailable',
  'an operationally suspended business cannot acquire a Checkout attempt'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000007',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000007'
  )->>'status',
  'unavailable',
  'partner-owned billing cannot acquire direct Checkout'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000008',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000008'
  )->>'status',
  'unavailable',
  'a pilot override cannot acquire paid direct Checkout'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000009',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000009'
  )->>'status',
  'unavailable',
  'a comped override cannot acquire paid direct Checkout'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000010',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000010'
  )->>'status',
  'unavailable',
  'an exempt override cannot acquire paid direct Checkout'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.business_plan_family_locks AS family_lock
    FULL JOIN public.chat_only_checkout_attempts AS attempt
      ON attempt.business_id = family_lock.business_id
    WHERE COALESCE(family_lock.business_id, attempt.business_id) IN (
      '10000000-0000-4000-a064-000000000005',
      '10000000-0000-4000-a064-000000000006',
      '10000000-0000-4000-a064-000000000007',
      '10000000-0000-4000-a064-000000000008',
      '10000000-0000-4000-a064-000000000009',
      '10000000-0000-4000-a064-000000000010'
    )
  ),
  0,
  'failed authority checks leave neither a family claim nor an attempt'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000012',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000012'
  )->>'status',
  'unavailable',
  'an active subscription cannot open a second Checkout authority'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000011',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000011'
  )->>'status',
  'unavailable',
  'a locally canceled Chat subscription stays paused for explicit recovery'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000013',
    'price_chat_a064', repeat('0', 64),
    '40000000-0000-4000-a064-000000000013'
  )->>'status',
  'unavailable',
  'any canceled subscription row blocks canary reacquisition regardless of family'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000001',
      'x', repeat('0', 64),
      '40000000-0000-4000-a064-000000000001'
    )
  $$,
  '22023',
  'invalid_chat_only_checkout_attempt_request',
  'acquisition rejects malformed Price identity before reading authority'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000001',
      'price_chat_a064', 'NOT-A-SHA256',
      '40000000-0000-4000-a064-000000000001'
    )
  $$,
  '22023',
  'invalid_chat_only_checkout_attempt_request',
  'acquisition requires an exact lowercase SHA-256 fingerprint'
);

-- ---------------------------------------------------------------------------
-- Lease recovery, single-flight uniqueness, and exact expiry evidence
-- ---------------------------------------------------------------------------

INSERT INTO checkout_064_state (name, payload)
VALUES (
  'new_attempt',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000101'
  )
);

SELECT is(
  payload->>'status',
  'create',
  'eligible direct Chat acquisition creates a durable attempt identity'
)
FROM checkout_064_state WHERE name = 'new_attempt';

SELECT ok(
  (payload->>'attempt_id')::uuid IS NOT NULL
  AND payload->>'stripe_customer_id' IS NULL
  AND (payload->>'checkout_session_expires_at')::timestamptz
        BETWEEN clock_timestamp() + interval '59 minutes'
            AND clock_timestamp() + interval '60 minutes',
  'new acquisition snapshots no Customer and fixes a sixty-minute Session expiry'
)
FROM checkout_064_state WHERE name = 'new_attempt';

SELECT ok(
  (
    SELECT attempt.plan = 'chat_only'
       AND attempt.checkout_mode = 'onboarding'
       AND attempt.state = 'creating'
       AND attempt.request_fingerprint = repeat('a', 64)
       AND attempt.attempt_count = 1
       AND attempt.stripe_checkout_session_id IS NULL
       AND attempt.checkout_url IS NULL
    FROM public.chat_only_checkout_attempts AS attempt
    WHERE attempt.id =
          (SELECT (payload->>'attempt_id')::uuid
           FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  'the first worker persists an exact creating-state provider snapshot'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000101'
  )->>'attempt_id',
  (SELECT payload->>'attempt_id'
   FROM checkout_064_state WHERE name = 'new_attempt'),
  'the owning claim token idempotently recovers the same attempt'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000102'
  )->>'status',
  'in_progress',
  'a second worker observes the live claim instead of creating a second attempt'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000001',
      'price_chat_a064', repeat('b', 64),
      '40000000-0000-4000-a064-000000000102'
    )
  $$,
  '55000',
  'chat_only_checkout_attempt_conflict',
  'an active attempt rejects a different request fingerprint'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000001',
      'price_other_a064', repeat('a', 64),
      '40000000-0000-4000-a064-000000000102'
    )
  $$,
  '55000',
  'chat_only_checkout_attempt_conflict',
  'an active attempt rejects Price drift under the same fingerprint'
);

SELECT throws_ok(
  $$
    INSERT INTO public.chat_only_checkout_attempts (
      business_id, stripe_price_id, request_fingerprint, claim_token,
      claimed_at, claim_expires_at, checkout_session_expires_at
    ) VALUES (
      '10000000-0000-4000-a064-000000000001',
      'price_chat_a064', repeat('f', 64),
      '40000000-0000-4000-a064-000000000199',
      clock_timestamp(), clock_timestamp() + interval '5 minutes',
      clock_timestamp() + interval '60 minutes'
    )
  $$,
  '23505',
  NULL,
  'the partial unique index rejects a second creating/open attempt'
);

UPDATE public.chat_only_checkout_attempts
SET claimed_at = clock_timestamp() - interval '10 minutes',
    claim_expires_at = clock_timestamp() - interval '5 minutes'
WHERE id = (
  SELECT (payload->>'attempt_id')::uuid
  FROM checkout_064_state WHERE name = 'new_attempt'
);

INSERT INTO checkout_064_state (name, payload)
VALUES (
  'reclaimed_attempt',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000103'
  )
);

SELECT ok(
  payload->>'status' = 'create'
  AND payload->>'attempt_id' = (
    SELECT original.payload->>'attempt_id'
    FROM checkout_064_state AS original
    WHERE original.name = 'new_attempt'
  )
  AND (
    SELECT attempt_count = 2
    FROM public.chat_only_checkout_attempts
    WHERE id = (payload->>'attempt_id')::uuid
  ),
  'an elapsed lease rotates ownership of the same idempotency identity'
)
FROM checkout_064_state WHERE name = 'reclaimed_attempt';

SELECT is(
  public.release_chat_only_checkout_attempt_claim(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000102'
  ),
  false,
  'a stale worker cannot release the recovered claim'
);

SELECT is(
  public.release_chat_only_checkout_attempt_claim(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000103'
  ),
  true,
  'the owning worker can release only its transient claim lease'
);

INSERT INTO checkout_064_state (name, payload)
VALUES (
  'released_reclaim',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000104'
  )
);

SELECT ok(
  payload->>'status' = 'create'
  AND payload->>'attempt_id' = (
    SELECT original.payload->>'attempt_id'
    FROM checkout_064_state AS original
    WHERE original.name = 'new_attempt'
  )
  AND (
    SELECT attempt_count = 3
    FROM public.chat_only_checkout_attempts
    WHERE id = (payload->>'attempt_id')::uuid
  ),
  'claim release permits immediate same-attempt recovery without terminalizing it'
)
FROM checkout_064_state WHERE name = 'released_reclaim';

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000104'
  )->>'attempt_id',
  (SELECT payload->>'attempt_id'
   FROM checkout_064_state WHERE name = 'new_attempt'),
  'retrying with the current token is idempotent after recovery'
);

SELECT is(
  (
    SELECT attempt_count
    FROM public.chat_only_checkout_attempts
    WHERE id = (
      SELECT (payload->>'attempt_id')::uuid
      FROM checkout_064_state WHERE name = 'new_attempt'
    )
  ),
  3,
  'idempotent current-token retry does not increment the attempt counter'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000103',
    'cs_new_a064', 'cus_NewA064',
    'https://checkout.stripe.test/new-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  false,
  'a stale claim token cannot record provider Session evidence'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000104',
    'cs_new_a064', 'cus_NewA064',
    'https://checkout.stripe.test/new-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
      + interval '1 second'
  ),
  false,
  'Session recording rejects provider expiry drift'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000104',
    'cs_new_a064', 'cus_NewA064',
    'https://checkout.stripe.test/new-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  true,
  'the owning worker records the exact Session, Customer, URL, and expiry'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000104',
    'cs_new_a064', 'cus_NewA064',
    'https://checkout.stripe.test/new-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  true,
  're-recording identical open-Session evidence is idempotent'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000104',
    'cs_new_a064', 'cus_NewA064',
    'https://checkout.stripe.test/changed-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  false,
  'an idempotent open record cannot replace its bearer URL'
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000105'
  )->>'status',
  'open',
  'later retries recover exact open Session identity without a new claim'
);

SELECT is(
  public.release_chat_only_checkout_attempt_claim(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    '40000000-0000-4000-a064-000000000104'
  ),
  false,
  'claim release cannot mutate an open attempt'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    'cs_wrong_a064', repeat('a', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  false,
  'expiry rejects a mismatched Stripe Session identity'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    'cs_new_a064', repeat('b', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  false,
  'expiry rejects a mismatched request fingerprint'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    'cs_new_a064', repeat('a', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  true,
  'exact Stripe expiry evidence terminalizes the open attempt'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'new_attempt'),
    'cs_new_a064', repeat('a', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'new_attempt')
  ),
  true,
  'replaying identical Stripe expiry evidence is idempotent'
);

SELECT ok(
  (
    SELECT state = 'expired'
       AND expired_at IS NOT NULL
       AND completed_at IS NULL
    FROM public.chat_only_checkout_attempts
    WHERE id = (
      SELECT (payload->>'attempt_id')::uuid
      FROM checkout_064_state WHERE name = 'new_attempt'
    )
  ),
  'expiry preserves one exact terminal provider record'
);

INSERT INTO public.chat_only_checkout_attempts (
  id, business_id, stripe_price_id, request_fingerprint, state,
  claim_token, claimed_at, claim_expires_at, attempt_count,
  checkout_session_expires_at, created_at, updated_at
) VALUES (
  '50000000-0000-4000-a064-000000000017',
  '10000000-0000-4000-a064-000000000017',
  'price_chat_a064', repeat('7', 64), 'creating',
  '40000000-0000-4000-a064-000000000117',
  clock_timestamp() - interval '24 hours',
  clock_timestamp() - interval '23 hours 55 minutes', 4,
  clock_timestamp() - interval '23 hours',
  clock_timestamp() - interval '24 hours', clock_timestamp()
);

INSERT INTO checkout_064_state (name, payload)
VALUES (
  'recovery_required',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000017',
    'price_chat_a064', repeat('7', 64),
    '40000000-0000-4000-a064-000000000217'
  )
);

SELECT ok(
  payload->>'status' = 'recovery_required'
  AND payload->>'attempt_id' =
        '50000000-0000-4000-a064-000000000017',
  'an unknown creating attempt stops automatic replay before Stripe idempotency retention lapses'
)
FROM checkout_064_state WHERE name = 'recovery_required';

SELECT ok(
  (
    SELECT state = 'creating'
       AND attempt_count = 4
       AND claim_token = '40000000-0000-4000-a064-000000000117'
       AND stripe_checkout_session_id IS NULL
       AND completed_at IS NULL
       AND expired_at IS NULL
    FROM public.chat_only_checkout_attempts
    WHERE id = '50000000-0000-4000-a064-000000000017'
  ),
  'recovery-required preserves the same unknown identity without lease rotation or terminal guesswork'
);

-- ---------------------------------------------------------------------------
-- Clock-only evidence and authority-change/deletion fence
-- ---------------------------------------------------------------------------

INSERT INTO public.chat_only_checkout_attempts (
  id, business_id, stripe_price_id, request_fingerprint, state,
  claim_token, claimed_at, claim_expires_at, attempt_count,
  stripe_checkout_session_id, stripe_customer_id, checkout_url,
  checkout_session_expires_at, created_at, updated_at
) VALUES (
  '50000000-0000-4000-a064-000000000014',
  '10000000-0000-4000-a064-000000000014',
  'price_chat_a064', repeat('e', 64), 'open',
  '40000000-0000-4000-a064-000000000114',
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '90 minutes', 1,
  'cs_clock_a064', 'cus_ClockA064',
  'https://checkout.stripe.test/clock-a064',
  clock_timestamp() - interval '60 minutes',
  clock_timestamp() - interval '3 hours', clock_timestamp()
);

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000014',
    'price_chat_a064', repeat('e', 64),
    '40000000-0000-4000-a064-000000000214'
  )->>'status',
  'open',
  'elapsed wall clock alone never terminalizes an open provider Session'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET deleted_at = statement_timestamp(),
        deletion_scheduled_for =
          statement_timestamp() + interval '60 days'
    WHERE id = '10000000-0000-4000-a064-000000000014'
  $$,
  '55000',
  'chat_only_checkout_attempt_authority_locked',
  'account deletion is fenced while a Checkout outcome is still payable or unknown'
);

SELECT throws_ok(
  $$
    DELETE FROM public.businesses
    WHERE id = '10000000-0000-4000-a064-000000000014'
  $$,
  '55000',
  'chat_only_checkout_attempt_authority_locked',
  'hard business deletion cannot cascade away an active provider attempt'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET operations_suspended_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-a064-000000000014'
  $$,
  'urgent service suspension remains available during an active payment attempt'
);

SELECT is(
  (
    SELECT state
    FROM public.chat_only_checkout_attempts
    WHERE id = '50000000-0000-4000-a064-000000000014'
  ),
  'open',
  'service suspension preserves the exact open provider evidence for recovery'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET billing_exempt = true
    WHERE id = '10000000-0000-4000-a064-000000000014'
  $$,
  '55000',
  'chat_only_checkout_attempt_authority_locked',
  'direct billing authority cannot change underneath an active attempt'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000014',
    '50000000-0000-4000-a064-000000000014',
    'cs_clock_a064', repeat('e', 64),
    (SELECT checkout_session_expires_at
     FROM public.chat_only_checkout_attempts
     WHERE id = '50000000-0000-4000-a064-000000000014')
  ),
  true,
  'exact provider evidence, not the old timestamp, closes the attempt'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET deleted_at = statement_timestamp(),
        deletion_scheduled_for =
          statement_timestamp() + interval '60 days'
    WHERE id = '10000000-0000-4000-a064-000000000014'
  $$,
  'terminal evidence releases the account-deletion fence'
);

-- ---------------------------------------------------------------------------
-- New-business Customer binding and exact subscription-event completion
-- ---------------------------------------------------------------------------

INSERT INTO checkout_064_state (name, payload)
VALUES (
  'canceled_attempt',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    'price_chat_a064', repeat('c', 64),
    '40000000-0000-4000-a064-000000000111'
  )
);

SELECT ok(
  payload->>'status' = 'create'
  AND payload->>'stripe_customer_id' IS NULL
  AND (
    SELECT stripe_customer_id IS NULL
    FROM public.chat_only_checkout_attempts
    WHERE id = (payload->>'attempt_id')::uuid
  ),
  'new-business acquisition begins without inventing a Stripe Customer'
)
FROM checkout_064_state WHERE name = 'canceled_attempt';

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    '40000000-0000-4000-a064-000000000111',
    'cs_canceled_a064', 'cus_CanceledA064',
    'https://checkout.stripe.test/canceled-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
      + interval '1 second'
  ),
  false,
  'Session recording cannot drift from the precommitted provider expiry'
);

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    '40000000-0000-4000-a064-000000000111',
    'cs_canceled_a064', 'cus_CanceledA064',
    'https://checkout.stripe.test/canceled-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  true,
  'Session recording binds the first provider-created Customer to the attempt'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET operations_suspended_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-a064-000000000016'
  $$,
  'urgent suspension remains writable after exact Session creation'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completion waits for the exact local subscription Checkout binding'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('d', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:00+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'Chat subscription sync rejects mismatched attempt metadata fingerprint'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
      + interval '1 second',
    'cus_CanceledA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:00+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'Chat subscription sync rejects mismatched attempt metadata expiry'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_wrong_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:00+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'Chat subscription sync rejects mismatched Price metadata'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_wrong_a064', false,
    '2064-01-01 00:00:00+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'Chat subscription sync rejects mismatched Checkout Session metadata'
);

SELECT is(
  public.sync_chat_only_subscription_from_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:00+00'
  ),
  true,
  'exact attempt metadata authorizes guarded Chat subscription synchronization'
);

SELECT ok(
  (
    SELECT subscription.plan = 'chat_only'
       AND subscription.status = 'active'
       AND subscription.stripe_customer_id = 'cus_CanceledA064'
       AND subscription.stripe_subscription_id = 'sub_CanceledA064'
       AND subscription.stripe_checkout_session_id = 'cs_canceled_a064'
       AND attempt.stripe_customer_id = 'cus_CanceledA064'
       AND attempt.stripe_subscription_id = 'sub_CanceledA064'
       AND attempt.stripe_checkout_session_id = 'cs_canceled_a064'
       AND attempt.state = 'completed'
       AND attempt.completed_at IS NOT NULL
       AND attempt.completed_at = attempt.updated_at
       AND attempt.claim_expires_at = attempt.completed_at
       AND attempt.expired_at IS NULL
       AND business.operations_suspended_at IS NOT NULL
    FROM public.chat_only_checkout_attempts AS attempt
    JOIN public.subscriptions AS subscription
      ON subscription.business_id = attempt.business_id
    JOIN public.businesses AS business
      ON business.id = attempt.business_id
    WHERE attempt.id = (
      SELECT (payload->>'attempt_id')::uuid
      FROM checkout_064_state WHERE name = 'canceled_attempt'
    )
  ),
  'Session-bearing sync atomically binds exact IDs and completes the suspended attempt'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_WrongA064', 'sub_CanceledA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:01+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'a later event cannot replace the bound Customer'
);

SELECT is(
  pg_temp.capture_chat_subscription_attempt_mismatch(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_WrongA064', 'active',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', 'cs_canceled_a064', false,
    '2064-01-01 00:00:01+00'
  ),
  'chat_only_subscription_attempt_mismatch',
  'a later event cannot replace the bound Subscription'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'expiry cannot discard an attempt after subscription evidence is bound'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_wrong_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completion rejects a mismatched Session'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_WrongA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completion rejects a mismatched Customer'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_WrongA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completion rejects a mismatched Subscription'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('d', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completion rejects a mismatched request fingerprint'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
      + interval '1 second'
  ),
  false,
  'completion rejects provider expiry drift'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  true,
  'exact synchronized subscription evidence completes the attempt'
);

SELECT is(
  public.complete_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', 'cus_CanceledA064', 'sub_CanceledA064',
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  true,
  'replaying identical completion evidence is idempotent'
);

SELECT is(
  public.sync_chat_only_subscription_from_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'past_due',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', NULL, false,
    '2064-01-02 00:00:00+00'
  ),
  true,
  'a generic subscription event without Session ID still requires exact attempt metadata'
);

SELECT ok(
  (
    SELECT status = 'past_due'
       AND stripe_checkout_session_id = 'cs_canceled_a064'
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a064-000000000016'
  ),
  'generic attempt-bound events preserve Checkout linkage while updating status'
);

SELECT ok(
  (
    SELECT state = 'completed'
       AND stripe_checkout_session_id = 'cs_canceled_a064'
       AND stripe_customer_id = 'cus_CanceledA064'
       AND stripe_subscription_id = 'sub_CanceledA064'
       AND completed_at IS NOT NULL
       AND expired_at IS NULL
    FROM public.chat_only_checkout_attempts
    WHERE id = (
      SELECT (payload->>'attempt_id')::uuid
      FROM checkout_064_state WHERE name = 'canceled_attempt'
    )
  ),
  'completion preserves one exact immutable terminal provider binding'
);

SELECT is(
  public.expire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cs_canceled_a064', repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt')
  ),
  false,
  'completed evidence cannot be reversed into expiry'
);

DELETE FROM public.subscriptions
WHERE business_id = '10000000-0000-4000-a064-000000000016';

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000016',
    'price_chat_a064', repeat('c', 64),
    '40000000-0000-4000-a064-000000000211'
  )->>'status',
  'unavailable',
  'completed or subscription-bound attempt history blocks reacquisition after local-row drift'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.chat_only_checkout_attempts
    WHERE business_id = '10000000-0000-4000-a064-000000000016'
  ),
  1,
  'history-based reacquisition denial creates no replacement attempt'
);

UPDATE public.businesses
SET deleted_at = statement_timestamp(),
    deletion_scheduled_for =
      statement_timestamp() + interval '60 days'
WHERE id = '10000000-0000-4000-a064-000000000016';

SELECT is(
  public.sync_chat_only_subscription_from_attempt(
    '10000000-0000-4000-a064-000000000016',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    repeat('c', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'canceled_attempt'),
    'cus_CanceledA064', 'sub_CanceledA064', 'past_due',
    '2064-01-01 00:00:00+00', '2064-02-01 00:00:00+00',
    'price_chat_a064', NULL, false,
    '2064-01-03 00:00:00+00'
  ),
  false,
  'a valid terminal event for an inactive business is safely ignored'
);

-- A customer.subscription.* delivery can arrive without a Checkout Session
-- ID. It may bind exact Customer/Subscription evidence, but it cannot prove
-- Checkout completion or close the crash window by itself.
INSERT INTO checkout_064_state (name, payload)
VALUES (
  'generic_event_attempt',
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000018',
    'price_chat_a064', repeat('8', 64),
    '40000000-0000-4000-a064-000000000118'
  )
);

SELECT is(
  payload->>'status',
  'create',
  'the generic-event fixture acquires one new attempt'
)
FROM checkout_064_state WHERE name = 'generic_event_attempt';

SELECT is(
  public.record_chat_only_checkout_session(
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'generic_event_attempt'),
    '40000000-0000-4000-a064-000000000118',
    'cs_generic_a064', 'cus_GenericA064',
    'https://checkout.stripe.test/generic-a064',
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'generic_event_attempt')
  ),
  true,
  'the fixture records exact open Checkout Session evidence'
);

SELECT is(
  public.sync_chat_only_subscription_from_attempt(
    '10000000-0000-4000-a064-000000000018',
    (SELECT (payload->>'attempt_id')::uuid
     FROM checkout_064_state WHERE name = 'generic_event_attempt'),
    repeat('8', 64),
    (SELECT (payload->>'checkout_session_expires_at')::timestamptz
     FROM checkout_064_state WHERE name = 'generic_event_attempt'),
    'cus_GenericA064', 'sub_GenericA064', 'active',
    '2064-03-01 00:00:00+00', '2064-04-01 00:00:00+00',
    'price_chat_a064', NULL, false,
    '2064-03-01 00:00:00+00'
  ),
  true,
  'a generic event can bind exact subscription evidence without Session metadata'
);

SELECT ok(
  (
    SELECT attempt.state = 'open'
       AND attempt.completed_at IS NULL
       AND attempt.expired_at IS NULL
       AND attempt.stripe_checkout_session_id = 'cs_generic_a064'
       AND attempt.stripe_customer_id = 'cus_GenericA064'
       AND attempt.stripe_subscription_id = 'sub_GenericA064'
       AND subscription.stripe_checkout_session_id IS NULL
    FROM public.chat_only_checkout_attempts AS attempt
    JOIN public.subscriptions AS subscription
      ON subscription.business_id = attempt.business_id
    WHERE attempt.id = (
      SELECT (payload->>'attempt_id')::uuid
      FROM checkout_064_state WHERE name = 'generic_event_attempt'
    )
  ),
  'null-Session generic sync remains nonterminal while preserving exact bound IDs'
);

-- A terminal attempt releases the partial unique slot for an intentional
-- provider-evidenced retry while retaining immutable history.
SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000001',
    'price_chat_a064', repeat('a', 64),
    '40000000-0000-4000-a064-000000000199'
  )->>'status',
  'create',
  'an expired attempt permits a new single-flight generation'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.chat_only_checkout_attempts
    WHERE business_id = '10000000-0000-4000-a064-000000000001'
  ),
  2,
  'terminal history is retained beside exactly one new active generation'
);

SELECT throws_ok(
  $$
    UPDATE public.chat_only_checkout_attempts
    SET stripe_subscription_id = 'sub_CanceledA064'
    WHERE business_id = '10000000-0000-4000-a064-000000000001'
      AND state = 'creating'
  $$,
  '23505',
  NULL,
  'one Stripe Subscription cannot be bound to two Checkout attempts'
);

-- ---------------------------------------------------------------------------
-- Role enforcement and malformed provider payloads
-- ---------------------------------------------------------------------------

SELECT is(
  public.sync_chat_only_subscription_from_attempt(
    'ffffffff-ffff-4fff-afff-ffffffffffff',
    'eeeeeeee-eeee-4eee-aeee-eeeeeeeeeeee', repeat('e', 64),
    clock_timestamp() + interval '60 minutes',
    'cus_AbsentA064', 'sub_AbsentA064', 'active',
    NULL, NULL, 'price_chat_a064', NULL, false, clock_timestamp()
  ),
  false,
  'a validly shaped event for an absent business is safely ignored'
);

SELECT throws_ok(
  $$
    SELECT public.record_chat_only_checkout_session(
      NULL, NULL, 'bad', NULL, 'http://not-stripe.test', NULL
    )
  $$,
  '22023',
  'invalid_chat_only_checkout_session_record',
  'Session recording rejects malformed provider evidence'
);

SELECT throws_ok(
  $$
    SELECT public.sync_chat_only_subscription_from_attempt(
      NULL, NULL, 'bad', NULL, 'bad', 'bad', 'unknown',
      NULL, NULL, 'x', 'bad', NULL, NULL
    )
  $$,
  '22023',
  'invalid_chat_only_subscription_attempt_sync',
  'attempt-bound subscription sync rejects malformed provider metadata'
);

SELECT throws_ok(
  $$
    SELECT public.release_chat_only_checkout_attempt_claim(NULL, NULL)
  $$,
  '22023',
  'invalid_chat_only_checkout_claim_release',
  'claim release rejects missing CAS identity'
);

SELECT throws_ok(
  $$
    SELECT public.complete_chat_only_checkout_attempt(
      NULL, NULL, 'bad', 'bad', 'bad', 'bad', NULL
    )
  $$,
  '22023',
  'invalid_chat_only_checkout_completion',
  'completion rejects malformed provider evidence'
);

SELECT throws_ok(
  $$
    SELECT public.expire_chat_only_checkout_attempt(
      NULL, NULL, 'bad', 'bad', NULL
    )
  $$,
  '22023',
  'invalid_chat_only_checkout_expiry',
  'expiry rejects malformed provider evidence'
);

SET LOCAL ROLE service_role;

SELECT is(
  public.acquire_chat_only_checkout_attempt(
    '10000000-0000-4000-a064-000000000015',
    'price_chat_a064', repeat('5', 64),
    '40000000-0000-4000-a064-000000000115'
  )->>'status',
  'create',
  'the service role can acquire through the hardened definer RPC'
);

SELECT throws_ok(
  $$
    INSERT INTO public.chat_only_checkout_attempts (
      business_id, stripe_price_id, request_fingerprint, claim_token,
      claim_expires_at, checkout_session_expires_at
    ) VALUES (
      '10000000-0000-4000-a064-000000000015',
      'price_chat_a064', repeat('6', 64),
      '40000000-0000-4000-a064-000000000116',
      clock_timestamp() + interval '5 minutes',
      clock_timestamp() + interval '60 minutes'
    )
  $$,
  '42501',
  NULL,
  'the service role cannot bypass lifecycle RPCs with direct table mutation'
);

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    SELECT * FROM public.chat_only_checkout_attempts LIMIT 1
  $$,
  '42501',
  NULL,
  'authenticated customers cannot read bearer-like Checkout evidence'
);

SELECT throws_ok(
  $$
    SELECT public.acquire_chat_only_checkout_attempt(
      '10000000-0000-4000-a064-000000000015',
      'price_chat_a064', repeat('5', 64),
      '40000000-0000-4000-a064-000000000115'
    )
  $$,
  '42501',
  NULL,
  'authenticated customers cannot execute acquisition'
);

SELECT throws_ok(
  $$
    SELECT public.sync_chat_only_subscription_from_attempt(
      '10000000-0000-4000-a064-000000000016',
      '50000000-0000-4000-a064-000000000016', repeat('c', 64),
      clock_timestamp(), 'cus_DeniedA064', 'sub_DeniedA064', 'active',
      NULL, NULL, 'price_chat_a064', NULL, false, clock_timestamp()
    )
  $$,
  '42501',
  NULL,
  'authenticated customers cannot execute Chat subscription synchronization'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
