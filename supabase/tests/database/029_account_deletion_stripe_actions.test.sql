BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(81);

-- ---------------------------------------------------------------------------
-- Catalog shape, constraints, RLS, and grants
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'account_deletion_stripe_actions',
  'account-deletion Stripe action table exists'
);

SELECT col_is_pk(
  'public',
  'account_deletion_stripe_actions',
  'business_id',
  'business_id is the one-row-per-business primary key'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'f'
      AND pg_get_constraintdef(constraint_row.oid) =
        'FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE'
  ),
  'business linkage cascades only when its tombstone is deleted'
);

SELECT col_not_null(
  'public',
  'account_deletion_stripe_actions',
  'stripe_subscription_id',
  'durable Stripe subscription linkage is required'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%desired_action%pause%resume%cancel%'
  ),
  'desired action is constrained to pause, resume, or cancel'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%status%pending%applied%blocked%'
  ),
  'action status is constrained to pending, applied, or blocked'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%generation > 0%'
  ),
  'generation must remain positive'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    JOIN pg_attribute AS attribute_row
      ON attribute_row.attrelid = constraint_row.conrelid
     AND attribute_row.attnum = ANY (constraint_row.conkey)
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'u'
      AND attribute_row.attname = 'idempotency_key'
  ),
  'idempotency keys are globally unique'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%lease_token IS NULL%lease_owner IS NULL%lease_expires_at IS NULL%'
  ),
  'lease fields are structurally all-null or all-present'
);

SELECT ok(
  (
    SELECT count(*)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_stripe_actions'::regclass
      AND constraint_row.contype = 'c'
      AND pg_get_constraintdef(constraint_row.oid) LIKE '%status%applied%applied_action%'
  ) >= 2,
  'applied status requires a proven compatible applied action'
);

SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.account_deletion_stripe_actions'::regclass
  ),
  'RLS is enabled'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.account_deletion_stripe_actions'::regclass
  ),
  0::bigint,
  'the service-only table has no customer RLS policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid = 'public.account_deletion_stripe_actions'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC has no table privileges'
);

SELECT table_privs_are(
  'public',
  'account_deletion_stripe_actions',
  'anon',
  ARRAY[]::name[],
  'anon has no table privileges'
);

SELECT table_privs_are(
  'public',
  'account_deletion_stripe_actions',
  'authenticated',
  ARRAY[]::name[],
  'authenticated has no table privileges'
);

SELECT table_privs_are(
  'public',
  'account_deletion_stripe_actions',
  'service_role',
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has the exact intended table privileges'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS acl_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'queue_account_deletion_stripe_action',
        'schedule_account_deletion',
        'prepare_account_reactivation',
        'complete_account_reactivation',
        'claim_account_deletion_stripe_action',
        'finish_account_deletion_stripe_action',
        'cleanup_expired_business',
        'complete_expired_business_cleanup',
        'sync_stripe_subscription_if_business_active',
        'mark_stripe_subscription_past_due_if_business_active'
      )
      AND acl_row.grantee = 0
  ),
  'PUBLIC cannot execute any account-deletion Stripe RPC'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'queue_account_deletion_stripe_action',
        'schedule_account_deletion',
        'prepare_account_reactivation',
        'complete_account_reactivation',
        'claim_account_deletion_stripe_action',
        'finish_account_deletion_stripe_action',
        'cleanup_expired_business',
        'complete_expired_business_cleanup',
        'sync_stripe_subscription_if_business_active',
        'mark_stripe_subscription_past_due_if_business_active'
      )
      AND (
        has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
        OR has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
      )
  ),
  'anon and authenticated cannot execute account-deletion Stripe RPCs'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'queue_account_deletion_stripe_action',
        'schedule_account_deletion',
        'prepare_account_reactivation',
        'complete_account_reactivation',
        'claim_account_deletion_stripe_action',
        'finish_account_deletion_stripe_action',
        'cleanup_expired_business',
        'complete_expired_business_cleanup',
        'sync_stripe_subscription_if_business_active',
        'mark_stripe_subscription_past_due_if_business_active'
      )
      AND NOT has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
  ),
  'service_role can execute every account-deletion Stripe RPC'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT count(*) FROM public.account_deletion_stripe_actions$$,
  '42501',
  'permission denied for table account_deletion_stripe_actions',
  'authenticated receives a runtime permission denial'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.account_deletion_stripe_actions$$,
  '42501',
  'permission denied for table account_deletion_stripe_actions',
  'anon receives a runtime permission denial'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT count(*) FROM public.account_deletion_stripe_actions$$,
  'service_role can read the RLS-protected table'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Local fixtures
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE account_deletion_029_test_state (
  name text PRIMARY KEY,
  payload jsonb
);

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-4000-a000-000000000001', 'account-delete-a@example.test'),
  ('00000000-0000-4000-a000-000000000002', 'account-delete-b@example.test'),
  ('00000000-0000-4000-a000-000000000003', 'account-delete-c@example.test');

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000001',
    name = 'Account Deletion Test A',
    slug = 'account-deletion-test-a'
WHERE owner_id = '00000000-0000-4000-a000-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000002',
    name = 'Account Deletion Test B',
    slug = 'account-deletion-test-b'
WHERE owner_id = '00000000-0000-4000-a000-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000003',
    name = 'Account Deletion Test C',
    slug = 'account-deletion-test-c'
WHERE owner_id = '00000000-0000-4000-a000-000000000003';

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  stripe_price_id,
  setup_fee_paid_at
)
VALUES
  (
    '10000000-0000-4000-a000-000000000001',
    'cus_account_delete_a',
    'sub_account_delete_a',
    'sms_only',
    'active',
    'price_account_delete_a',
    now()
  ),
  (
    '10000000-0000-4000-a000-000000000002',
    'cus_account_delete_b',
    'sub_account_delete_b',
    'sms_and_chat',
    'active',
    'price_account_delete_b',
    now()
  );

SELECT throws_ok(
  $$
    INSERT INTO public.account_deletion_stripe_actions (
      business_id, stripe_subscription_id, desired_action
    ) VALUES (
      '10000000-0000-4000-a000-000000000003', 'sub_invalid', 'invalid'
    )
  $$,
  '23514'
);

SELECT throws_ok(
  $$
    INSERT INTO public.account_deletion_stripe_actions (
      business_id, stripe_subscription_id, desired_action, generation
    ) VALUES (
      '10000000-0000-4000-a000-000000000003', 'sub_invalid', 'pause', 0
    )
  $$,
  '23514'
);

SELECT throws_ok(
  $$
    INSERT INTO public.account_deletion_stripe_actions (
      business_id,
      stripe_subscription_id,
      desired_action,
      lease_token
    ) VALUES (
      '10000000-0000-4000-a000-000000000003',
      'sub_invalid',
      'pause',
      'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
    )
  $$,
  '23514'
);

-- ---------------------------------------------------------------------------
-- Atomic scheduling and poisoned action insertion
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000003',
      '00000000-0000-4000-a000-000000000003',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-01 00:00:00+00'
    )
  $$,
  '22007',
  'invalid account deletion timestamps',
  'schedule rejects a grace period other than exactly 60 days'
);

SELECT ok(
  (SELECT deleted_at IS NULL FROM public.businesses
   WHERE id = '10000000-0000-4000-a000-000000000003'),
  'invalid scheduling leaves the live business unchanged'
);

CREATE FUNCTION public.test_029_poison_action_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '029 poison action insert' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER test_029_poison_action_insert
BEFORE INSERT ON public.account_deletion_stripe_actions
FOR EACH ROW
EXECUTE FUNCTION public.test_029_poison_action_insert();

SELECT throws_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000001',
      '00000000-0000-4000-a000-000000000001',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'P0001',
  '029 poison action insert',
  'a poisoned durable-action insert aborts scheduling'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL AND deletion_scheduled_for IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  ),
  'poisoned action insertion rolls back the business soft delete'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  0::bigint,
  'poisoned scheduling leaves no partial action row'
);

DROP TRIGGER test_029_poison_action_insert
  ON public.account_deletion_stripe_actions;
DROP FUNCTION public.test_029_poison_action_insert();

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000001',
      '00000000-0000-4000-a000-000000000001',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'scheduling succeeds after the poison is removed'
);

SELECT is(
  (
    SELECT deletion_scheduled_for - deleted_at
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  ),
  interval '60 days',
  'successful scheduling records the exact grace period atomically'
);

SELECT is(
  (
    SELECT desired_action || ':' || stripe_subscription_id
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  'pause:sub_account_delete_a',
  'scheduling snapshots the local Stripe subscription as pause'
);

SELECT ok(
  (
    SELECT status = 'pending'
       AND generation = 1
       AND attempt_count = 0
       AND idempotency_key IS NOT NULL
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  'new pause work has the expected initial durable state'
);

INSERT INTO account_deletion_029_test_state (name, payload)
SELECT 'schedule_a_initial', to_jsonb(action)
FROM public.account_deletion_stripe_actions AS action
WHERE action.business_id = '10000000-0000-4000-a000-000000000001';

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000001',
      '00000000-0000-4000-a000-000000000001',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'an identical schedule retry succeeds'
);

SELECT ok(
  (
    SELECT action.generation = (state.payload ->> 'generation')::bigint
       AND action.idempotency_key = state.payload ->> 'idempotency_key'
       AND action.attempt_count = (state.payload ->> 'attempt_count')::integer
    FROM public.account_deletion_stripe_actions AS action
    CROSS JOIN account_deletion_029_test_state AS state
    WHERE action.business_id = '10000000-0000-4000-a000-000000000001'
      AND state.name = 'schedule_a_initial'
  ),
  'identical scheduling retains generation, key, and attempt metadata'
);

SELECT throws_ok(
  $$SELECT public.cleanup_expired_business('10000000-0000-4000-a000-000000000003')$$,
  '42501'
);

SELECT throws_ok(
  $$SELECT public.cleanup_expired_business('10000000-0000-4000-a000-000000000001')$$,
  '42501'
);

-- ---------------------------------------------------------------------------
-- Poisoned cleanup rollback, retry, lease CAS, and final completion
-- ---------------------------------------------------------------------------

UPDATE public.businesses
SET deletion_scheduled_for = now() - interval '1 second'
WHERE id = '10000000-0000-4000-a000-000000000001';

CREATE FUNCTION public.test_029_poison_subscription_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '029 poison subscription delete' USING ERRCODE = 'P0001';
END;
$$;

CREATE TRIGGER test_029_poison_subscription_delete
BEFORE DELETE ON public.subscriptions
FOR EACH ROW
WHEN (OLD.business_id = '10000000-0000-4000-a000-000000000001')
EXECUTE FUNCTION public.test_029_poison_subscription_delete();

SELECT throws_ok(
  $$SELECT public.cleanup_expired_business('10000000-0000-4000-a000-000000000001')$$,
  'P0001',
  '029 poison subscription delete',
  'a poisoned local subscription delete aborts cleanup'
);

SELECT ok(
  (
    SELECT owner_id = '00000000-0000-4000-a000-000000000001'
       AND cleanup_auth_user_id IS NULL
       AND name = 'Account Deletion Test A'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  ),
  'poisoned cleanup rolls back auth linkage and tombstone scrub'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  1::bigint,
  'poisoned cleanup retains the local subscription row'
);

SELECT ok(
  (
    SELECT action.desired_action = 'pause'
       AND action.generation = (state.payload ->> 'generation')::bigint
       AND action.idempotency_key = state.payload ->> 'idempotency_key'
    FROM public.account_deletion_stripe_actions AS action
    CROSS JOIN account_deletion_029_test_state AS state
    WHERE action.business_id = '10000000-0000-4000-a000-000000000001'
      AND state.name = 'schedule_a_initial'
  ),
  'poisoned cleanup rolls the cancel generation back to the original pause'
);

DROP TRIGGER test_029_poison_subscription_delete ON public.subscriptions;
DROP FUNCTION public.test_029_poison_subscription_delete();

SELECT results_eq(
  $$SELECT public.cleanup_expired_business('10000000-0000-4000-a000-000000000001')$$,
  ARRAY['00000000-0000-4000-a000-000000000001'::uuid],
  'cleanup succeeds after the poison is removed and returns durable auth linkage'
);

SELECT ok(
  (
    SELECT owner_id IS NULL
       AND cleanup_auth_user_id = '00000000-0000-4000-a000-000000000001'
       AND name = '[deleted]'
       AND slug = 'deleted-10000000-0000-4000-a000-000000000001'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  ),
  'successful cleanup creates the scrubbed tombstone and preserves auth linkage'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  0::bigint,
  'successful cleanup deletes the local subscription only after queuing cancel'
);

SELECT ok(
  (
    SELECT desired_action = 'cancel'
       AND status = 'pending'
       AND generation = 2
       AND applied_action IS NULL
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  'cleanup advances pause to a pending cancel generation'
);

INSERT INTO account_deletion_029_test_state (name, payload)
SELECT 'cleanup_a_initial', to_jsonb(action)
FROM public.account_deletion_stripe_actions AS action
WHERE action.business_id = '10000000-0000-4000-a000-000000000001';

SELECT results_eq(
  $$SELECT public.cleanup_expired_business('10000000-0000-4000-a000-000000000001')$$,
  ARRAY['00000000-0000-4000-a000-000000000001'::uuid],
  'cleanup is idempotent on an already-scrubbed tombstone'
);

SELECT ok(
  (
    SELECT action.generation = (state.payload ->> 'generation')::bigint
       AND action.idempotency_key = state.payload ->> 'idempotency_key'
       AND action.status = state.payload ->> 'status'
    FROM public.account_deletion_stripe_actions AS action
    CROSS JOIN account_deletion_029_test_state AS state
    WHERE action.business_id = '10000000-0000-4000-a000-000000000001'
      AND state.name = 'cleanup_a_initial'
  ),
  'cleanup retry retains the cancel generation and idempotency key'
);

SELECT throws_ok(
  $$SELECT public.complete_expired_business_cleanup('10000000-0000-4000-a000-000000000001', 2)$$,
  '55000'
);

SELECT ok(
  (
    SELECT deletion_scheduled_for IS NOT NULL
       AND cleanup_auth_user_id = '00000000-0000-4000-a000-000000000001'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  ),
  'unapplied cancellation retains both cleanup linkages'
);

INSERT INTO account_deletion_029_test_state (name, payload)
SELECT 'cleanup_a_claim', public.claim_account_deletion_stripe_action(
  '10000000-0000-4000-a000-000000000001',
  2,
  'test-cleanup-worker',
  60
);

SELECT ok(
  (
    SELECT (payload ->> 'generation')::bigint = 2
       AND payload ->> 'lease_token' IS NOT NULL
       AND payload ->> 'lease_owner' = 'test-cleanup-worker'
       AND (payload ->> 'attempt_count')::integer = 1
    FROM account_deletion_029_test_state
    WHERE name = 'cleanup_a_claim'
  ),
  'claim returns the exact generation with a CAS lease and attempt metadata'
);

SELECT is(
  public.claim_account_deletion_stripe_action(
    '10000000-0000-4000-a000-000000000001',
    2,
    'competing-worker',
    60
  ),
  NULL::jsonb,
  'a live lease prevents a duplicate claim'
);

SELECT is(
  public.finish_account_deletion_stripe_action(
    '10000000-0000-4000-a000-000000000001',
    1,
    (
      SELECT (payload ->> 'lease_token')::uuid
      FROM account_deletion_029_test_state
      WHERE name = 'cleanup_a_claim'
    ),
    'applied',
    'cancel',
    NULL,
    NULL
  ),
  false,
  'a stale generation cannot finish a newer claim'
);

SELECT is(
  public.finish_account_deletion_stripe_action(
    '10000000-0000-4000-a000-000000000001',
    2,
    (
      SELECT (payload ->> 'lease_token')::uuid
      FROM account_deletion_029_test_state
      WHERE name = 'cleanup_a_claim'
    ),
    'applied',
    'cancel',
    NULL,
    NULL
  ),
  true,
  'the current lease holder can mark cancellation applied'
);

SELECT ok(
  (
    SELECT status = 'applied'
       AND desired_action = 'cancel'
       AND applied_action = 'cancel'
       AND applied_at IS NOT NULL
       AND lease_token IS NULL
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  'applied cancellation clears the lease and records proven Stripe state'
);

SELECT is(
  public.finish_account_deletion_stripe_action(
    '10000000-0000-4000-a000-000000000001',
    2,
    (
      SELECT (payload ->> 'lease_token')::uuid
      FROM account_deletion_029_test_state
      WHERE name = 'cleanup_a_claim'
    ),
    'applied',
    'cancel',
    NULL,
    NULL
  ),
  true,
  'an identical action completion retry is idempotent'
);

SELECT throws_ok(
  $$SELECT public.complete_expired_business_cleanup('10000000-0000-4000-a000-000000000001', 1)$$,
  '55000'
);

SELECT is(
  public.complete_expired_business_cleanup(
    '10000000-0000-4000-a000-000000000001',
    2
  ),
  true,
  'the applied cancel generation permits final cleanup completion'
);

SELECT ok(
  (
    SELECT deletion_scheduled_for IS NULL
       AND cleanup_auth_user_id IS NULL
       AND cleanup_attempted_at IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000001'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000001'
  ),
  'final completion clears the schedule, auth linkage, claim, and Stripe action'
);

SELECT is(
  public.complete_expired_business_cleanup(
    '10000000-0000-4000-a000-000000000001',
    2
  ),
  true,
  'final cleanup completion is idempotent'
);

-- ---------------------------------------------------------------------------
-- Reactivation generation guards and guarded payment/webhook updates
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'reactivation fixture schedules a pause'
);

SELECT lives_ok(
  $$
    SELECT public.prepare_account_reactivation(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002'
    )
  $$,
  'reactivation preparation succeeds within grace'
);

SELECT ok(
  (
    SELECT desired_action = 'resume'
       AND status = 'pending'
       AND generation = 2
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  ),
  'reactivation advances pause to a pending resume generation'
);

INSERT INTO account_deletion_029_test_state (name, payload)
SELECT 'reactivation_b_initial', to_jsonb(action)
FROM public.account_deletion_stripe_actions AS action
WHERE action.business_id = '10000000-0000-4000-a000-000000000002';

SELECT lives_ok(
  $$
    SELECT public.prepare_account_reactivation(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002'
    )
  $$,
  'identical reactivation preparation succeeds'
);

SELECT ok(
  (
    SELECT action.generation = (state.payload ->> 'generation')::bigint
       AND action.idempotency_key = state.payload ->> 'idempotency_key'
    FROM public.account_deletion_stripe_actions AS action
    CROSS JOIN account_deletion_029_test_state AS state
    WHERE action.business_id = '10000000-0000-4000-a000-000000000002'
      AND state.name = 'reactivation_b_initial'
  ),
  'identical reactivation preparation retains generation and key'
);

SELECT throws_ok(
  $$
    SELECT public.complete_account_reactivation(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002',
      1
    )
  $$,
  '55000'
);

SELECT throws_ok(
  $$
    SELECT public.complete_account_reactivation(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002',
      2
    )
  $$,
  '55000'
);

SELECT ok(
  (
    SELECT deleted_at IS NOT NULL AND deletion_scheduled_for IS NOT NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000002'
  ),
  'failed or stale resume completion leaves the account deleted'
);

INSERT INTO account_deletion_029_test_state (name, payload)
SELECT 'reactivation_b_claim', public.claim_account_deletion_stripe_action(
  '10000000-0000-4000-a000-000000000002',
  2,
  'test-resume-worker',
  60
);

SELECT ok(
  (
    SELECT payload ->> 'desired_action' = 'resume'
       AND payload ->> 'lease_owner' = 'test-resume-worker'
    FROM account_deletion_029_test_state
    WHERE name = 'reactivation_b_claim'
  ),
  'the resume generation can be claimed'
);

SELECT is(
  public.finish_account_deletion_stripe_action(
    '10000000-0000-4000-a000-000000000002',
    2,
    (
      SELECT (payload ->> 'lease_token')::uuid
      FROM account_deletion_029_test_state
      WHERE name = 'reactivation_b_claim'
    ),
    'applied',
    'resume',
    NULL,
    NULL
  ),
  true,
  'the reconciler can record resume as applied'
);

SELECT is(
  public.complete_account_reactivation(
    '10000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000002',
    2
  ),
  true,
  'the exact applied resume generation reactivates the business'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL AND deletion_scheduled_for IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a000-000000000002'
  )
  AND EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  ),
  'reactivation preserves the subscription and removes deletion action state'
);

SELECT is(
  public.complete_account_reactivation(
    '10000000-0000-4000-a000-000000000002',
    '00000000-0000-4000-a000-000000000002',
    2
  ),
  true,
  'reactivation completion is idempotent after the business is active'
);

SELECT ok(
  (
    public.prepare_account_reactivation(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002'
    ) ->> 'already_active'
  )::boolean,
  'preparing an already-active business is idempotent'
);

SELECT is(
  public.mark_stripe_subscription_past_due_if_business_active(
    'cus_account_delete_b',
    now()
  ),
  true,
  'invoice.payment_failed updates an active business'
);

SELECT is(
  (
    SELECT status
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  ),
  'past_due',
  'active-business payment failure persists past_due'
);

UPDATE public.subscriptions
SET status = 'active'
WHERE business_id = '10000000-0000-4000-a000-000000000002';

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a000-000000000002',
      '00000000-0000-4000-a000-000000000002',
      timestamptz '2099-01-02 00:00:00+00',
      timestamptz '2099-03-03 00:00:00+00'
    )
  $$,
  'reactivated fixture can be deleted again'
);

SELECT is(
  public.mark_stripe_subscription_past_due_if_business_active(
    'cus_account_delete_b',
    now()
  ),
  false,
  'invoice.payment_failed skips a deleted business'
);

SELECT is(
  (
    SELECT status
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  ),
  'active',
  'deleted-business payment failure leaves local status unchanged'
);

SELECT is(
  public.sync_stripe_subscription_if_business_active(
    '10000000-0000-4000-a000-000000000002',
    'cus_account_delete_b',
    'sub_should_not_replace_deleted_business',
    'sms_and_chat',
    'active',
    now(),
    now() + interval '30 days',
    'price_should_not_replace_deleted_business',
    NULL,
    NULL,
    NULL,
    false,
    now()
  ),
  false,
  'subscription sync explicitly reports a deleted-business skip'
);

SELECT is(
  (
    SELECT stripe_subscription_id
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a000-000000000002'
  ),
  'sub_account_delete_b',
  'deleted-business sync cannot replace the durable local linkage'
);

SELECT * FROM finish();

ROLLBACK;
