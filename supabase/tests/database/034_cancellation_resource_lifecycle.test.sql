BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(101);

-- ---------------------------------------------------------------------------
-- Catalog shape, guards, RLS, and exact service-only grants
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'telnyx_managed_resources',
  'managed Telnyx resource registry exists'
);

SELECT has_table(
  'public',
  'telnyx_release_protections',
  'immutable Telnyx protection manifest exists'
);

SELECT has_table(
  'public',
  'telnyx_resource_release_runs',
  'durable Telnyx release runs exist'
);

SELECT has_table(
  'public',
  'telnyx_resource_release_reasons',
  'independent Telnyx release reasons exist'
);

SELECT has_table(
  'public',
  'telnyx_resource_release_actions',
  'provider-confirmed Telnyx release actions exist'
);

SELECT has_table(
  'public',
  'telnyx_resource_release_events',
  'PII-free Telnyx release events exist'
);

SELECT has_table(
  'public',
  'telnyx_resource_release_config',
  'singleton Telnyx release configuration exists'
);

SELECT has_column(
  'public',
  'businesses',
  'telnyx_unique_claims_released_at',
  'terminal tombstones can relinquish Telnyx uniqueness claims'
);

SELECT has_column(
  'public',
  'phone_numbers',
  'resource_status',
  'phone rows carry an explicit lifecycle status'
);

SELECT has_column(
  'public',
  'telnyx_resource_release_runs',
  'checkout_reservation_token',
  'release runs carry a reactivation checkout reservation token'
);

SELECT has_column(
  'public',
  'telnyx_resource_release_actions',
  'previous_resource_status',
  'release actions preserve each phone previous state'
);

SELECT has_column(
  'public',
  'telnyx_resource_release_actions',
  'lease_authorization_epoch',
  'leases are bound to the release-configuration authorization epoch'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_account_deletion_business_transition',
  'account-deletion structural validation is an AFTER trigger'
);

SELECT is(
  (
    SELECT trigger_row.tgtype::integer & 2
    FROM pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.businesses'::regclass
      AND trigger_row.tgname = 'guard_account_deletion_business_transition'
      AND NOT trigger_row.tgisinternal
  ),
  0,
  'account-deletion structural validation is not a BEFORE trigger'
);

SELECT ok(
  (
    SELECT bool_and(class_row.relrowsecurity)
    FROM pg_class AS class_row
    WHERE class_row.oid IN (
      'public.telnyx_managed_resources'::regclass,
      'public.telnyx_release_protections'::regclass,
      'public.telnyx_resource_release_runs'::regclass,
      'public.telnyx_resource_release_reasons'::regclass,
      'public.telnyx_resource_release_actions'::regclass,
      'public.telnyx_resource_release_events'::regclass,
      'public.telnyx_resource_release_config'::regclass
    )
  ),
  'every lifecycle table has RLS enabled'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid IN (
      'public.telnyx_managed_resources'::regclass,
      'public.telnyx_release_protections'::regclass,
      'public.telnyx_resource_release_runs'::regclass,
      'public.telnyx_resource_release_reasons'::regclass,
      'public.telnyx_resource_release_actions'::regclass,
      'public.telnyx_resource_release_events'::regclass,
      'public.telnyx_resource_release_config'::regclass
    )
  ),
  'lifecycle tables intentionally expose no customer RLS policies'
);

SELECT table_privs_are(
  'public',
  'telnyx_managed_resources',
  'service_role',
  ARRAY['INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has the exact managed-resource table privileges'
);

SELECT table_privs_are(
  'public',
  'telnyx_release_protections',
  'service_role',
  ARRAY['SELECT']::name[],
  'service_role can read but cannot mutate the protection manifest'
);

SELECT table_privs_are(
  'public',
  'telnyx_resource_release_config',
  'service_role',
  ARRAY['SELECT']::name[],
  'service_role can read but cannot enable the rollout gate'
);

SELECT table_privs_are(
  'public',
  'telnyx_resource_release_runs',
  'service_role',
  ARRAY['INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has the exact release-run table privileges'
);

SELECT table_privs_are(
  'public',
  'telnyx_resource_release_reasons',
  'service_role',
  ARRAY['INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has the exact release-reason table privileges'
);

SELECT table_privs_are(
  'public',
  'telnyx_resource_release_actions',
  'service_role',
  ARRAY['INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has the exact release-action table privileges'
);

SELECT table_privs_are(
  'public',
  'telnyx_resource_release_events',
  'service_role',
  ARRAY['INSERT', 'SELECT']::name[],
  'service_role has the exact release-event table privileges'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM information_schema.table_privileges AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name IN (
        'telnyx_managed_resources',
        'telnyx_release_protections',
        'telnyx_resource_release_runs',
        'telnyx_resource_release_reasons',
        'telnyx_resource_release_actions',
        'telnyx_resource_release_events',
        'telnyx_resource_release_config'
      )
      AND privilege.grantee IN ('PUBLIC', 'anon', 'authenticated')
  ),
  'PUBLIC, anon, and authenticated have no lifecycle-table privileges'
);

SELECT has_function(
  'public',
  'claim_telnyx_release_action',
  ARRAY['text', 'integer'],
  'leased release-action claim RPC exists'
);

SELECT has_function(
  'public',
  'authorize_telnyx_remote_mutation',
  ARRAY[
    'uuid', 'text', 'text', 'text',
    'uuid', 'uuid', 'text', 'text'
  ],
  'last-moment Telnyx mutation authorization RPC exists'
);

SELECT has_function(
  'public',
  'complete_account_reactivation',
  ARRAY['uuid', 'uuid', 'bigint', 'uuid'],
  'reactivation completion accepts the exact reservation token'
);

SELECT has_function(
  'public',
  'account_reactivation_stripe_in_progress',
  ARRAY['uuid'],
  'Stripe reactivation in-progress hold helper exists'
);

SELECT ok(
  (
    WITH expected(signature, service_execute) AS (
      VALUES
        ('public.guard_telnyx_release_configuration()', false),
        ('public.invalidate_telnyx_release_configuration()', false),
        ('public.telnyx_release_manifest_fingerprint(text,text)', true),
        ('public.guard_business_telnyx_lifecycle_fields()', false),
        ('public.guard_phone_number_telnyx_lifecycle_fields()', false),
        ('public.guard_account_deletion_business_transition()', false),
        (
          'public.telnyx_release_protection_id(uuid,text,text,text,text,text)',
          true
        ),
        ('public.account_reactivation_stripe_in_progress(uuid)', true),
        ('public.refresh_telnyx_release_run(uuid)', true),
        ('public.snapshot_telnyx_release_actions(uuid,uuid)', true),
        (
          'public.ensure_telnyx_release_reason(uuid,text,timestamp with time zone,timestamp with time zone,text,text,text)',
          true
        ),
        ('public.cancel_telnyx_release_reason(uuid,text,text)', true),
        ('public.claim_telnyx_release_action(text,integer)', true),
        (
          'public.authorize_telnyx_remote_mutation(uuid,text,text,text,uuid,uuid,text,text)',
          true
        ),
        (
          'public.finish_telnyx_release_action(uuid,uuid,text,text,text,text,timestamp with time zone)',
          true
        ),
        (
          'public.schedule_account_deletion(uuid,uuid,timestamp with time zone,timestamp with time zone)',
          true
        ),
        ('public.prepare_account_reactivation(uuid,uuid)', true),
        (
          'public.complete_account_reactivation(uuid,uuid,bigint,uuid)',
          true
        ),
        ('public.complete_account_reactivation(uuid,uuid,bigint)', true),
        ('public.cleanup_expired_business(uuid)', true),
        ('public.complete_expired_business_cleanup(uuid,bigint)', true)
    )
    SELECT count(*) = 21
       AND bool_and(to_regprocedure(signature) IS NOT NULL)
       AND bool_and(
         has_function_privilege(
           'service_role',
           to_regprocedure(signature),
           'EXECUTE'
         ) = service_execute
       )
    FROM expected
  ),
  'service_role has the exact grant on every migration-034 function overload'
);

SELECT ok(
  (
    WITH expected(signature) AS (
      VALUES
        ('public.guard_telnyx_release_configuration()'),
        ('public.invalidate_telnyx_release_configuration()'),
        ('public.telnyx_release_manifest_fingerprint(text,text)'),
        ('public.guard_business_telnyx_lifecycle_fields()'),
        ('public.guard_phone_number_telnyx_lifecycle_fields()'),
        ('public.guard_account_deletion_business_transition()'),
        ('public.telnyx_release_protection_id(uuid,text,text,text,text,text)'),
        ('public.account_reactivation_stripe_in_progress(uuid)'),
        ('public.refresh_telnyx_release_run(uuid)'),
        ('public.snapshot_telnyx_release_actions(uuid,uuid)'),
        ('public.ensure_telnyx_release_reason(uuid,text,timestamp with time zone,timestamp with time zone,text,text,text)'),
        ('public.cancel_telnyx_release_reason(uuid,text,text)'),
        ('public.claim_telnyx_release_action(text,integer)'),
        ('public.authorize_telnyx_remote_mutation(uuid,text,text,text,uuid,uuid,text,text)'),
        ('public.finish_telnyx_release_action(uuid,uuid,text,text,text,text,timestamp with time zone)'),
        ('public.schedule_account_deletion(uuid,uuid,timestamp with time zone,timestamp with time zone)'),
        ('public.prepare_account_reactivation(uuid,uuid)'),
        ('public.complete_account_reactivation(uuid,uuid,bigint,uuid)'),
        ('public.complete_account_reactivation(uuid,uuid,bigint)'),
        ('public.cleanup_expired_business(uuid)'),
        ('public.complete_expired_business_cleanup(uuid,bigint)')
    )
    SELECT count(*) = 21
       AND bool_and(to_regprocedure(signature) IS NOT NULL)
       AND bool_and(
         NOT has_function_privilege(
           'anon',
           to_regprocedure(signature),
           'EXECUTE'
         )
       )
       AND bool_and(
         NOT has_function_privilege(
           'authenticated',
           to_regprocedure(signature),
           'EXECUTE'
         )
       )
    FROM expected
  ),
  'PUBLIC inheritance, anon, and authenticated cannot execute any migration-034 function overload'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row
      ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname =
            'phone_numbers_unreleased_normalized_e164_unique'
      AND index_row.indisunique
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
            LIKE '%is_active IS TRUE%resource_status <>%released%'
  ),
  'phone E.164 uniqueness excludes inactive or released history'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS class_row
      ON class_row.oid = index_row.indexrelid
    WHERE class_row.relname =
            'businesses_live_telnyx_brand_id_lower_unique'
      AND index_row.indisunique
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
            LIKE '%telnyx_unique_claims_released_at IS NULL%'
  ),
  'business brand uniqueness excludes terminal claims-released tombstones'
);

-- ---------------------------------------------------------------------------
-- Exact built-in protection values and disabled-by-default gate
-- ---------------------------------------------------------------------------

SELECT is(
  (
    SELECT jsonb_build_object(
      'scope', scope,
      'resource_type', resource_type,
      'provider_id', provider_id,
      'canonical_e164', canonical_e164,
      'public_tcr_id', public_tcr_id
    )
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_live_phone'
  ),
  jsonb_build_object(
    'scope', 'resource',
    'resource_type', 'phone_number',
    'provider_id', NULL,
    'canonical_e164', '+15742133931',
    'public_tcr_id', NULL
  ),
  'the live production phone protection matches the exact E.164 value'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'scope', scope,
      'resource_type', resource_type,
      'provider_id', provider_id,
      'canonical_e164', canonical_e164,
      'public_tcr_id', public_tcr_id
    )
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_live_campaign'
  ),
  jsonb_build_object(
    'scope', 'resource',
    'resource_type', 'campaign',
    'provider_id', 'CYLIGTZ',
    'canonical_e164', NULL,
    'public_tcr_id', 'CYLIGTZ'
  ),
  'the live campaign is protected by both provider and public TCR IDs'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'scope', scope,
      'resource_type', resource_type,
      'provider_id', provider_id,
      'canonical_e164', canonical_e164,
      'public_tcr_id', public_tcr_id
    )
    FROM public.telnyx_release_protections
    WHERE protection_key = 'simplassist_shared_brand'
  ),
  jsonb_build_object(
    'scope', 'resource',
    'resource_type', 'brand',
    'provider_id', NULL,
    'canonical_e164', NULL,
    'public_tcr_id', 'BL69PDP'
  ),
  'the linked-existing shared brand protection matches BL69PDP exactly'
);

SELECT is(
  (
    SELECT mode
    FROM public.telnyx_resource_release_config
    WHERE id = 1
  ),
  'disabled',
  'remote Telnyx release starts disabled'
);

SELECT is(
  public.claim_telnyx_release_action('test-disabled-worker', 30),
  NULL::jsonb,
  'a disabled rollout gate returns no remote work'
);

-- ---------------------------------------------------------------------------
-- Isolated fixtures and exact readiness manifest
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE cancellation_034_test_state (
  name text PRIMARY KEY,
  payload jsonb,
  text_value text,
  uuid_value uuid,
  timestamptz_value timestamptz
) ON COMMIT DROP;

GRANT ALL ON TABLE cancellation_034_test_state TO service_role;

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a034-000000000001',
    'telnyx-lifecycle-future@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000002',
    'telnyx-lifecycle-due@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000003',
    'telnyx-lifecycle-reactivate@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000004',
    'telnyx-lifecycle-reuse@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000005',
    'telnyx-lifecycle-stage@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000006',
    'telnyx-lifecycle-reservation-only@example.test'
  ),
  (
    '00000000-0000-4000-a034-000000000007',
    'telnyx-lifecycle-after-ponr@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000001',
    name = 'Lifecycle Future',
    slug = 'lifecycle-future',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a034-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000002',
    name = 'Lifecycle Due',
    slug = 'lifecycle-due',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a034-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000003',
    name = 'Lifecycle Reactivation',
    slug = 'lifecycle-reactivation',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a034-000000000003';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000004',
    name = 'Lifecycle Reuse',
    slug = 'lifecycle-reuse'
WHERE owner_id = '00000000-0000-4000-a034-000000000004';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000005',
    name = 'Lifecycle Stage',
    slug = 'lifecycle-stage',
    legal_business_name = 'Lifecycle Stage LLC',
    business_entity_type = 'llc',
    business_registration_state = 'IN',
    has_ein = true,
    tax_id_type = 'ein',
    ein = '34-0000005',
    state = 'IN',
    zip = '46205',
    a2p_risk_review_status = 'passed',
    onboarding_registration_status = 'not_started'
WHERE owner_id = '00000000-0000-4000-a034-000000000005';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000006',
    name = 'Lifecycle Reservation Only',
    slug = 'lifecycle-reservation-only',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a034-000000000006';

UPDATE public.businesses
SET id = '10000000-0000-4000-a034-000000000007',
    name = 'Lifecycle After PONR',
    slug = 'lifecycle-after-ponr',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a034-000000000007';

INSERT INTO public.businesses (
  id,
  owner_id,
  name,
  slug,
  business_type,
  telnyx_brand_id,
  telnyx_brand_source,
  telnyx_campaign_id,
  telnyx_messaging_profile_id,
  telnyx_voice_application_id,
  telnyx_resource_state
) VALUES (
  'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
  NULL,
  'Bryan Develops Protected Fixture',
  'bryan-develops-protected-fixture',
  'general',
  '03400000-0000-4000-a000-0000000000bd',
  'linked_existing',
  'CYLIGTZ',
  '03400000-0000-4000-a000-0000000000aa',
  '340000000001',
  'protected_hold'
);

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
  'test_034'
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
    '03400000-0000-4000-a000-0000000000aa',
    'known_shared_production_messaging_profile',
    'test_034'
  ),
  (
    'simplassist_shared_voice_application',
    'resource',
    'voice_application',
    '340000000001',
    'known_shared_production_voice_application',
    'test_034'
  )
ON CONFLICT (protection_key) DO NOTHING;

SELECT is(
  (
    SELECT to_jsonb(protection) - 'id' - 'created_at'
    FROM public.telnyx_release_protections AS protection
    WHERE protection.protection_key =
            'simplassist_shared_messaging_profile'
  ),
  jsonb_build_object(
    'protection_key', 'simplassist_shared_messaging_profile',
    'scope', 'resource',
    'business_id', NULL,
    'resource_type', 'messaging_profile',
    'provider_id', '03400000-0000-4000-a000-0000000000aa',
    'canonical_e164', NULL,
    'public_tcr_id', NULL,
    'reason_code', 'known_shared_production_messaging_profile',
    'reviewed_by', 'test_034'
  ),
  'shared messaging-profile protection has the exact complete row shape'
);

SELECT is(
  (
    SELECT to_jsonb(protection) - 'id' - 'created_at'
    FROM public.telnyx_release_protections AS protection
    WHERE protection.protection_key =
            'simplassist_shared_voice_application'
  ),
  jsonb_build_object(
    'protection_key', 'simplassist_shared_voice_application',
    'scope', 'resource',
    'business_id', NULL,
    'resource_type', 'voice_application',
    'provider_id', '340000000001',
    'canonical_e164', NULL,
    'public_tcr_id', NULL,
    'reason_code', 'known_shared_production_voice_application',
    'reviewed_by', 'test_034'
  ),
  'shared voice-application protection has the exact complete row shape'
);

SELECT is(
  (
    SELECT jsonb_build_object(
      'scope', scope,
      'business_id', business_id,
      'resource_type', resource_type,
      'provider_id', provider_id,
      'canonical_e164', canonical_e164,
      'public_tcr_id', public_tcr_id
    )
    FROM public.telnyx_release_protections
    WHERE protection_key = 'bryan_develops_retain_all'
  ),
  jsonb_build_object(
    'scope', 'business_all',
    'business_id', 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'::uuid,
    'resource_type', NULL,
    'provider_id', NULL,
    'canonical_e164', NULL,
    'public_tcr_id', NULL
  ),
  'Bryan Develops is protected by the exact production business UUID'
);

INSERT INTO cancellation_034_test_state (name, text_value)
VALUES (
  'manifest_fingerprint',
  public.telnyx_release_manifest_fingerprint(
    '03400000-0000-4000-a000-0000000000aa',
    '340000000001'
  )
);

SELECT matches(
  (
    SELECT text_value
    FROM cancellation_034_test_state
    WHERE name = 'manifest_fingerprint'
  ),
  '^[0-9a-f]{64}$',
  'readiness computes a fingerprint only for the exact six protections'
);

SELECT is(
  public.telnyx_release_manifest_fingerprint(
    '03400000-0000-4000-a000-0000000000ab',
    '340000000001'
  ),
  NULL::text,
  'a wrong shared messaging-profile value cannot pass readiness'
);

SELECT is(
  public.telnyx_release_manifest_fingerprint(
    '03400000-0000-4000-a000-0000000000aa',
    '340000000002'
  ),
  NULL::text,
  'a wrong shared voice-application value cannot pass readiness'
);

-- ---------------------------------------------------------------------------
-- Future parking and exact previous-state restoration
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active
) VALUES (
  '20000000-0000-4000-a034-000000000001',
  '10000000-0000-4000-a034-000000000001',
  '+13175550001',
  '1293384261075734001',
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
) VALUES (
  '30000000-0000-4000-a034-000000000001',
  '10000000-0000-4000-a034-000000000001',
  '20000000-0000-4000-a034-000000000001',
  'phone_number',
  '1293384261075734001',
  '+13175550001',
  'created_by_simplassist',
  'managed_releaseable',
  'test_034',
  now()
);

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  stripe_price_id,
  setup_fee_paid_at
) VALUES (
  '10000000-0000-4000-a034-000000000003',
  'cus_034_reactivation',
  'sub_034_reactivation',
  'sms_only',
  'active',
  'price_034_reactivation',
  now()
);

INSERT INTO cancellation_034_test_state (name, uuid_value)
VALUES (
  'future_run',
  public.ensure_telnyx_release_reason(
    '10000000-0000-4000-a034-000000000001',
    'subscription_ended',
    now(),
    now() + interval '30 days',
    'sub_034_future',
    'evt_034_future',
    'test_034'
  )
);

SELECT is(
  (
    SELECT run.status
    FROM public.telnyx_resource_release_runs AS run
    JOIN cancellation_034_test_state AS state
      ON state.uuid_value = run.id
    WHERE state.name = 'future_run'
  ),
  'parked',
  'a future-dated release run remains parked'
);

SELECT is(
  (
    SELECT telnyx_resource_state
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a034-000000000001'
  ),
  'parked',
  'a future-dated resource is parked rather than blocked'
);

SELECT is(
  (
    SELECT resource_status
    FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a034-000000000001'
  ),
  'parked',
  'the phone parks until its paid-through release date'
);

SELECT is(
  (
    SELECT previous_resource_state
    FROM public.telnyx_resource_release_runs AS run
    JOIN cancellation_034_test_state AS state
      ON state.uuid_value = run.id
    WHERE state.name = 'future_run'
  ),
  'active',
  'the run records the exact previous business resource state'
);

SELECT is(
  (
    SELECT previous_resource_status
    FROM public.telnyx_resource_release_actions AS action
    JOIN cancellation_034_test_state AS state
      ON state.uuid_value = action.run_id
    WHERE state.name = 'future_run'
      AND action.resource_type = 'phone_number'
  ),
  'active',
  'the phone action records its exact previous resource status'
);

SELECT is(
  public.cancel_telnyx_release_reason(
    '10000000-0000-4000-a034-000000000001',
    'subscription_ended',
    'test_034_reactivate'
  ),
  true,
  'reactivation cancels a future release reason'
);

SELECT ok(
  (
    SELECT telnyx_resource_state = 'active'
       AND active_telnyx_release_run_id IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a034-000000000001'
  ),
  'cancellation restores the exact previous business state'
);

SELECT is(
  (
    SELECT resource_status
    FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a034-000000000001'
  ),
  'active',
  'cancellation restores the exact previous phone state'
);

-- ---------------------------------------------------------------------------
-- True kill switch: disabling revokes an already-leased action
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active
) VALUES (
  '20000000-0000-4000-a034-000000000002',
  '10000000-0000-4000-a034-000000000002',
  '+13175550002',
  '1293384261075734002',
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
) VALUES (
  '30000000-0000-4000-a034-000000000002',
  '10000000-0000-4000-a034-000000000002',
  '20000000-0000-4000-a034-000000000002',
  'phone_number',
  '1293384261075734002',
  '+13175550002',
  'created_by_simplassist',
  'managed_releaseable',
  'test_034',
  now()
);

INSERT INTO cancellation_034_test_state (name, uuid_value)
VALUES (
  'due_run',
  public.ensure_telnyx_release_reason(
    '10000000-0000-4000-a034-000000000002',
    'subscription_ended',
    now() - interval '30 days',
    now(),
    'sub_034_due',
    'evt_034_due',
    'test_034'
  )
);

UPDATE public.telnyx_resource_release_config
SET mode = 'single_business',
    single_business_id = '10000000-0000-4000-a034-000000000002',
    expected_shared_messaging_profile_id =
      '03400000-0000-4000-a000-0000000000aa',
    expected_shared_voice_application_id = '340000000001',
    protection_manifest_fingerprint = (
      SELECT text_value
      FROM cancellation_034_test_state
      WHERE name = 'manifest_fingerprint'
    ),
    protection_manifest_verified_at = now(),
    protection_manifest_verified_by = 'test_034',
    dry_run_completed_at = now(),
    dry_run_completed_by = 'test_034',
    updated_by = 'test_034'
WHERE id = 1;

INSERT INTO cancellation_034_test_state (name, payload)
VALUES (
  'leased_action',
  public.claim_telnyx_release_action('test-034-worker', 120)
);

SELECT ok(
  (
    SELECT (payload ->> 'state') = 'leased'
       AND (payload ->> 'business_id')::uuid =
             '10000000-0000-4000-a034-000000000002'
    FROM cancellation_034_test_state
    WHERE name = 'leased_action'
  ),
  'a ready single-business rollout leases only its due business action'
);

SELECT ok(
  (
    SELECT point_of_no_return_at IS NOT NULL
    FROM public.telnyx_resource_release_runs AS run
    JOIN cancellation_034_test_state AS state
      ON state.uuid_value = run.id
    WHERE state.name = 'due_run'
  ),
  'the first lease records the point of no return'
);

SELECT is(
  public.cancel_telnyx_release_reason(
    '10000000-0000-4000-a034-000000000002',
    'subscription_ended',
    'test_034_too_late'
  ),
  false,
  'a release reason cannot cancel after the point of no return'
);

UPDATE public.telnyx_resource_release_config
SET mode = 'disabled',
    single_business_id = NULL,
    updated_by = 'test_034_kill_switch'
WHERE id = 1;

INSERT INTO cancellation_034_test_state (name, payload)
SELECT
  'authorization_after_disable',
  public.authorize_telnyx_remote_mutation(
    (leased.payload ->> 'business_id')::uuid,
    'release_worker',
    'release_phone_number',
    leased.payload ->> 'provider_id',
    (leased.payload ->> 'id')::uuid,
    (leased.payload ->> 'lease_token')::uuid,
    '03400000-0000-4000-a000-0000000000aa',
    '340000000001'
  )
FROM cancellation_034_test_state AS leased
WHERE leased.name = 'leased_action';

SELECT is(
  (
    SELECT payload
    FROM cancellation_034_test_state
    WHERE name = 'authorization_after_disable'
  ),
  NULL::jsonb,
  'the database kill switch denies the already-leased remote mutation'
);

SELECT ok(
  (
    SELECT action.state = 'pending'
       AND action.lease_token IS NULL
       AND action.lease_owner IS NULL
       AND action.lease_expires_at IS NULL
       AND action.lease_authorization_epoch IS NULL
    FROM public.telnyx_resource_release_actions AS action
    JOIN cancellation_034_test_state AS state
      ON (state.payload ->> 'id')::uuid = action.id
    WHERE state.name = 'leased_action'
  ),
  'disabling revokes and clears the stale lease before any remote call'
);

-- ---------------------------------------------------------------------------
-- Exact reservation token, deadline crossing, and cleanup deferral
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active
) VALUES (
  '20000000-0000-4000-a034-000000000003',
  '10000000-0000-4000-a034-000000000003',
  '+13175550003',
  '1293384261075734003',
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
) VALUES (
  '30000000-0000-4000-a034-000000000003',
  '10000000-0000-4000-a034-000000000003',
  '20000000-0000-4000-a034-000000000003',
  'phone_number',
  '1293384261075734003',
  '+13175550003',
  'created_by_simplassist',
  'managed_releaseable',
  'test_034',
  now()
);

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a034-000000000003',
      '00000000-0000-4000-a034-000000000003',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'account deletion creates a 60-day parked release reason'
);

INSERT INTO cancellation_034_test_state (name, payload)
VALUES (
  'reactivation_prepare',
  public.prepare_account_reactivation(
    '10000000-0000-4000-a034-000000000003',
    '00000000-0000-4000-a034-000000000003'
  )
);

SELECT ok(
  (
    SELECT payload ->> 'reactivation_reservation_token' IS NOT NULL
       AND (
         payload ->> 'reactivation_reservation_expires_at'
       )::timestamptz > now()
    FROM cancellation_034_test_state
    WHERE name = 'reactivation_prepare'
  ),
  'reactivation preparation returns a live server-held reservation'
);

DO $cross_reactivation_deadline$
DECLARE
  v_triggered_at timestamptz := now() - interval '60 days 1 second';
  v_release_at timestamptz := now() - interval '1 second';
BEGIN
  UPDATE public.businesses
  SET deleted_at = v_triggered_at,
      deletion_scheduled_for = v_release_at
  WHERE id = '10000000-0000-4000-a034-000000000003';

  UPDATE public.telnyx_resource_release_reasons
  SET triggered_at = v_triggered_at,
      release_at = v_release_at,
      updated_at = now()
  WHERE business_id = '10000000-0000-4000-a034-000000000003'
    AND reason_type = 'account_deletion'
    AND status = 'active';

  UPDATE public.telnyx_resource_release_runs
  SET effective_release_at = v_release_at,
      checkout_reservation_expires_at = now() - interval '1 second',
      updated_at = now()
  WHERE business_id = '10000000-0000-4000-a034-000000000003'
    AND status = 'parked';
END;
$cross_reactivation_deadline$;

SELECT is(
  public.account_reactivation_stripe_in_progress(
    '10000000-0000-4000-a034-000000000003'
  ),
  true,
  'a pending Stripe resume remains an explicit release hold after token expiry'
);

SELECT is(
  public.refresh_telnyx_release_run(
    (
      SELECT active_telnyx_release_run_id
      FROM public.businesses
      WHERE id = '10000000-0000-4000-a034-000000000003'
    )
  ),
  'parked',
  'an expired token cannot unpark resources while Stripe resume is pending'
);

UPDATE public.telnyx_resource_release_config
SET mode = 'single_business',
    single_business_id = '10000000-0000-4000-a034-000000000003',
    protection_manifest_fingerprint = (
      SELECT text_value
      FROM cancellation_034_test_state
      WHERE name = 'manifest_fingerprint'
    ),
    protection_manifest_verified_at = now(),
    protection_manifest_verified_by = 'test_034',
    dry_run_completed_at = now(),
    dry_run_completed_by = 'test_034',
    updated_by = 'test_034_reactivation_hold'
WHERE id = 1;

SELECT is(
  public.claim_telnyx_release_action(
    'test-034-expired-reservation-worker',
    120
  ),
  NULL::jsonb,
  'the worker cannot claim resources while Stripe resume is pending'
);

SELECT throws_ok(
  $$
    SELECT public.cleanup_expired_business(
      '10000000-0000-4000-a034-000000000003'
    )
  $$,
  '55000',
  'business 10000000-0000-4000-a034-000000000003 has an active reactivation reservation',
  'nightly cleanup defers while a reactivation reservation is live'
);

INSERT INTO cancellation_034_test_state (name, payload)
VALUES (
  'reactivation_renewed',
  public.prepare_account_reactivation(
    '10000000-0000-4000-a034-000000000003',
    '00000000-0000-4000-a034-000000000003'
  )
);

SELECT ok(
  (
    SELECT payload ->> 'reactivation_reservation_token' IS NOT NULL
       AND (
         payload ->> 'reactivation_reservation_expires_at'
       )::timestamptz > now()
       AND (payload #>> '{stripe_action,desired_action}') = 'resume'
       AND (payload #>> '{stripe_action,status}') = 'pending'
    FROM cancellation_034_test_state
    WHERE name = 'reactivation_renewed'
  ),
  'prepare renews the reservation after deadline while resume work is pending'
);

SELECT throws_ok(
  $$
    SELECT public.complete_account_reactivation(
      '10000000-0000-4000-a034-000000000003',
      '00000000-0000-4000-a034-000000000003',
      NULL,
      'ffffffff-ffff-4fff-afff-ffffffffffff'
    )
  $$,
  '55000',
  'business 10000000-0000-4000-a034-000000000003 has no active reactivation reservation',
  'reactivation completion rejects a different reservation token'
);

UPDATE public.account_deletion_stripe_actions
SET status = 'applied',
    applied_action = 'resume',
    applied_at = now(),
    updated_at = now()
WHERE business_id = '10000000-0000-4000-a034-000000000003'
  AND desired_action = 'resume';

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_account_reactivation(
        '10000000-0000-4000-a034-000000000003',
        '00000000-0000-4000-a034-000000000003',
        %s,
        %L::uuid
      )
    $sql$,
    (
      SELECT (payload #>> '{stripe_action,generation}')::bigint + 1
      FROM cancellation_034_test_state
      WHERE name = 'reactivation_renewed'
    ),
    (
      SELECT payload ->> 'reactivation_reservation_token'
      FROM cancellation_034_test_state
      WHERE name = 'reactivation_renewed'
    )
  ),
  '55000',
  format(
    'business 10000000-0000-4000-a034-000000000003 reactivation generation %s is not applied',
    (
      SELECT (payload #>> '{stripe_action,generation}')::bigint + 1
      FROM cancellation_034_test_state
      WHERE name = 'reactivation_renewed'
    )
  ),
  'an applied resume survives a failed completion with the wrong generation'
);

SELECT ok(
  (
    SELECT action.status = 'applied'
       AND action.desired_action = 'resume'
       AND action.applied_action = 'resume'
       AND business.deleted_at IS NOT NULL
       AND business.cleanup_pii_scrubbed_at IS NULL
       AND business.telnyx_resource_state = 'parked'
       AND phone.resource_status = 'parked'
       AND phone.telnyx_phone_number_id =
             '1293384261075734003'
    FROM public.account_deletion_stripe_actions AS action
    JOIN public.businesses AS business
      ON business.id = action.business_id
    JOIN public.phone_numbers AS phone
      ON phone.business_id = business.id
    WHERE action.business_id =
            '10000000-0000-4000-a034-000000000003'
  ),
  'failed completion leaves applied resume proof and parked resources intact'
);

SELECT lives_ok(
  format(
    $sql$
      SELECT public.complete_account_reactivation(
        '10000000-0000-4000-a034-000000000003',
        '00000000-0000-4000-a034-000000000003',
        %s,
        %L::uuid
      )
    $sql$,
    (
      SELECT (payload #>> '{stripe_action,generation}')::bigint
      FROM cancellation_034_test_state
      WHERE name = 'reactivation_renewed'
    ),
    (
      SELECT payload ->> 'reactivation_reservation_token'
      FROM cancellation_034_test_state
      WHERE name = 'reactivation_renewed'
    )
  ),
  'the exact live reservation completes even just after the deadline'
);

SELECT ok(
  (
    SELECT deleted_at IS NULL
       AND deletion_scheduled_for IS NULL
       AND telnyx_resource_state = 'active'
       AND active_telnyx_release_run_id IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a034-000000000003'
  ),
  'deadline retry atomically restores the active business state'
);

SELECT is(
  (
    SELECT resource_status
    FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a034-000000000003'
  ),
  'active',
  'deadline retry restores the exact previous phone state'
);

SELECT ok(
  (
    SELECT checkout_reservation_token IS NULL
       AND checkout_reservation_expires_at IS NULL
       AND status = 'canceled'
    FROM public.telnyx_resource_release_runs
    WHERE business_id = '10000000-0000-4000-a034-000000000003'
    ORDER BY generation DESC
    LIMIT 1
  ),
  'successful reactivation consumes the reservation and cancels the run'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM public.subscriptions
    WHERE business_id = '10000000-0000-4000-a034-000000000003'
      AND status = 'active'
  ),
  1::bigint,
  'successful reactivation preserves the active local subscription linkage'
);

-- ---------------------------------------------------------------------------
-- Cleanup guard: unexpired reservation with no Stripe action
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active
) VALUES (
  '20000000-0000-4000-a034-000000000006',
  '10000000-0000-4000-a034-000000000006',
  '+13175550006',
  '1293384261075734006',
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
) VALUES (
  '30000000-0000-4000-a034-000000000006',
  '10000000-0000-4000-a034-000000000006',
  '20000000-0000-4000-a034-000000000006',
  'phone_number',
  '1293384261075734006',
  '+13175550006',
  'created_by_simplassist',
  'managed_releaseable',
  'test_034',
  now()
);

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a034-000000000006',
      '00000000-0000-4000-a034-000000000006',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'reservation-only fixture enters the normal deletion grace period'
);

INSERT INTO cancellation_034_test_state (name, payload)
VALUES (
  'reservation_only_prepare',
  public.prepare_account_reactivation(
    '10000000-0000-4000-a034-000000000006',
    '00000000-0000-4000-a034-000000000006'
  )
);

SELECT ok(
  (
    SELECT payload ->> 'reactivation_reservation_token' IS NOT NULL
       AND (
         payload ->> 'reactivation_reservation_expires_at'
       )::timestamptz > now()
       AND payload -> 'stripe_action' = 'null'::jsonb
    FROM cancellation_034_test_state
    WHERE name = 'reservation_only_prepare'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a034-000000000006'
  ),
  'reservation-only fixture has a live token and no Stripe action'
);

DO $expire_reservation_only_fixture$
DECLARE
  v_deleted_at timestamptz := now() - interval '60 days 1 second';
  v_release_at timestamptz := v_deleted_at + interval '60 days';
BEGIN
  UPDATE public.businesses
  SET deleted_at = v_deleted_at,
      deletion_scheduled_for = v_release_at
  WHERE id = '10000000-0000-4000-a034-000000000006';

  UPDATE public.telnyx_resource_release_reasons
  SET triggered_at = v_deleted_at,
      release_at = v_release_at,
      updated_at = now()
  WHERE business_id = '10000000-0000-4000-a034-000000000006'
    AND reason_type = 'account_deletion'
    AND status = 'active';

  UPDATE public.telnyx_resource_release_runs
  SET effective_release_at = v_release_at,
      updated_at = now()
  WHERE business_id = '10000000-0000-4000-a034-000000000006'
    AND status = 'parked';
END;
$expire_reservation_only_fixture$;

SELECT throws_ok(
  $$
    SELECT public.cleanup_expired_business(
      '10000000-0000-4000-a034-000000000006'
    )
  $$,
  '55000',
  'business 10000000-0000-4000-a034-000000000006 has an active reactivation reservation',
  'cleanup rejects an unexpired reservation even without Stripe state'
);

SELECT ok(
  (
    SELECT business.owner_id =
             '00000000-0000-4000-a034-000000000006'::uuid
       AND business.name = 'Lifecycle Reservation Only'
       AND business.deleted_at IS NOT NULL
       AND business.cleanup_auth_user_id IS NULL
       AND business.cleanup_pii_scrubbed_at IS NULL
       AND business.telnyx_resource_state = 'parked'
       AND run.status = 'parked'
       AND run.point_of_no_return_at IS NULL
       AND run.checkout_reservation_token::text =
             state.payload ->> 'reactivation_reservation_token'
       AND run.checkout_reservation_expires_at > now()
       AND phone.resource_status = 'parked'
       AND phone.telnyx_phone_number_id =
             '1293384261075734006'
    FROM public.businesses AS business
    JOIN public.telnyx_resource_release_runs AS run
      ON run.id = business.active_telnyx_release_run_id
    JOIN public.phone_numbers AS phone
      ON phone.business_id = business.id
    JOIN cancellation_034_test_state AS state
      ON state.name = 'reservation_only_prepare'
    WHERE business.id = '10000000-0000-4000-a034-000000000006'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_stripe_actions
    WHERE business_id = '10000000-0000-4000-a034-000000000006'
  ),
  'failed cleanup preserves every business, run, phone, and no-Stripe invariant'
);

-- ---------------------------------------------------------------------------
-- Four-argument reactivation is rejected after the point of no return
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active
) VALUES (
  '20000000-0000-4000-a034-000000000007',
  '10000000-0000-4000-a034-000000000007',
  '+13175550007',
  '1293384261075734007',
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
) VALUES (
  '30000000-0000-4000-a034-000000000007',
  '10000000-0000-4000-a034-000000000007',
  '20000000-0000-4000-a034-000000000007',
  'phone_number',
  '1293384261075734007',
  '+13175550007',
  'created_by_simplassist',
  'managed_releaseable',
  'test_034',
  now()
);

SELECT lives_ok(
  $$
    SELECT public.schedule_account_deletion(
      '10000000-0000-4000-a034-000000000007',
      '00000000-0000-4000-a034-000000000007',
      timestamptz '2099-01-01 00:00:00+00',
      timestamptz '2099-03-02 00:00:00+00'
    )
  $$,
  'point-of-no-return fixture enters the normal deletion grace period'
);

INSERT INTO cancellation_034_test_state (name, payload)
VALUES (
  'ponr_prepare',
  public.prepare_account_reactivation(
    '10000000-0000-4000-a034-000000000007',
    '00000000-0000-4000-a034-000000000007'
  )
);

UPDATE public.telnyx_resource_release_runs
SET status = 'releasing',
    point_of_no_return_at = now(),
    updated_at = now()
WHERE business_id = '10000000-0000-4000-a034-000000000007'
  AND status = 'parked';

SELECT throws_ok(
  format(
    $sql$
      SELECT public.complete_account_reactivation(
        '10000000-0000-4000-a034-000000000007',
        '00000000-0000-4000-a034-000000000007',
        %s,
        %L::uuid
      )
    $sql$,
    (
      SELECT run.generation
      FROM public.telnyx_resource_release_runs AS run
      WHERE run.business_id = '10000000-0000-4000-a034-000000000007'
      ORDER BY run.generation DESC
      LIMIT 1
    ),
    (
      SELECT payload ->> 'reactivation_reservation_token'
      FROM cancellation_034_test_state
      WHERE name = 'ponr_prepare'
    )
  ),
  '55000',
  'business 10000000-0000-4000-a034-000000000007 has no active reactivation reservation',
  'the direct four-argument completion rejects reactivation after PONR'
);

SELECT ok(
  (
    SELECT business.deleted_at IS NOT NULL
       AND business.deletion_scheduled_for IS NOT NULL
       AND business.telnyx_resource_state = 'parked'
       AND business.active_telnyx_release_run_id = run.id
       AND run.status = 'releasing'
       AND run.point_of_no_return_at IS NOT NULL
       AND run.checkout_reservation_token::text =
             state.payload ->> 'reactivation_reservation_token'
       AND reason.status = 'active'
       AND phone.resource_status = 'parked'
       AND phone.telnyx_phone_number_id =
             '1293384261075734007'
    FROM public.businesses AS business
    JOIN public.telnyx_resource_release_runs AS run
      ON run.id = business.active_telnyx_release_run_id
    JOIN public.telnyx_resource_release_reasons AS reason
      ON reason.run_id = run.id
     AND reason.reason_type = 'account_deletion'
    JOIN public.phone_numbers AS phone
      ON phone.business_id = business.id
    JOIN cancellation_034_test_state AS state
      ON state.name = 'ponr_prepare'
    WHERE business.id = '10000000-0000-4000-a034-000000000007'
  ),
  'failed post-PONR completion preserves the exact business, run, reason, and phone state'
);

-- ---------------------------------------------------------------------------
-- Released tombstone reuse: brand pointers, brand-link flow, and E.164
-- ---------------------------------------------------------------------------

INSERT INTO public.businesses (
  id,
  name,
  slug,
  business_type,
  telnyx_brand_id,
  telnyx_brand_source,
  telnyx_campaign_id,
  telnyx_messaging_profile_id,
  telnyx_voice_application_id,
  telnyx_resource_state,
  telnyx_unique_claims_released_at,
  deleted_at
) VALUES (
  '10000000-0000-4000-a034-000000000010',
  '[deleted]',
  'deleted-10000000-0000-4000-a034-000000000010',
  'general',
  '03400000-0000-4000-a010-000000000010',
  'created_by_simplassist',
  'REUSE034',
  '03400000-0000-4000-a010-000000000011',
  '340000000010',
  'released',
  now(),
  now() - interval '90 days'
), (
  '10000000-0000-4000-a034-000000000011',
  '[deleted]',
  'deleted-10000000-0000-4000-a034-000000000011',
  'general',
  '03400000-0000-4000-a011-000000000011',
  'linked_existing',
  NULL,
  NULL,
  NULL,
  'protected_hold',
  now(),
  now() - interval '90 days'
);

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status,
  released_at
) VALUES (
  '20000000-0000-4000-a034-000000000010',
  '10000000-0000-4000-a034-000000000010',
  '+13175550010',
  NULL,
  false,
  'released',
  now()
);

INSERT INTO public.telnyx_managed_resources (
  id,
  business_id,
  resource_type,
  provider_id,
  canonical_e164,
  provider_origin,
  ownership_state,
  local_claim_active,
  verified_by,
  verified_at,
  released_at
) VALUES (
  '30000000-0000-4000-a034-000000000010',
  '10000000-0000-4000-a034-000000000010',
  'phone_number',
  '1293384261075734012',
  '+13175550010',
  'created_by_simplassist',
  'released',
  false,
  'test_034',
  now(),
  now()
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_brand_id = '03400000-0000-4000-a010-000000000010',
        telnyx_brand_source = 'created_by_simplassist',
        telnyx_campaign_id = 'REUSE034',
        telnyx_messaging_profile_id =
          '03400000-0000-4000-a010-000000000011',
        telnyx_voice_application_id = '340000000010'
    WHERE id = '10000000-0000-4000-a034-000000000004'
  $$,
  'a live business can reuse all claims from a terminal tombstone'
);

SELECT lives_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      is_active
    ) VALUES (
      '20000000-0000-4000-a034-000000000011',
      '10000000-0000-4000-a034-000000000004',
      '+13175550010',
      '1293384261075734012',
      true
    )
  $$,
  'an inactive released phone row no longer blocks E.164 reuse'
);

SELECT lives_ok(
  $$
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
    ) VALUES (
      '30000000-0000-4000-a034-000000000011',
      '10000000-0000-4000-a034-000000000004',
      '20000000-0000-4000-a034-000000000011',
      'phone_number',
      '1293384261075734012',
      '+13175550010',
      'created_by_simplassist',
      'managed_releaseable',
      'test_034',
      now()
    )
  $$,
  'a released managed-resource claim no longer blocks reissued E.164 reuse'
);

SELECT lives_ok(
  $$
    SELECT public.stage_existing_telnyx_brand_link(
      '10000000-0000-4000-a034-000000000005',
      'REUSEB2',
      '03400000-0000-4000-a011-000000000011',
      'test_034_admin'
    )
  $$,
  'brand-link staging ignores a terminal claims-released tombstone'
);

SELECT is(
  (
    SELECT status
    FROM public.telnyx_brand_link_requests
    WHERE business_id = '10000000-0000-4000-a034-000000000005'
  ),
  'pending_admin',
  'supported brand reuse still enters the normal reviewed link workflow'
);

INSERT INTO cancellation_034_test_state (name, text_value)
SELECT
  'brand_reuse_identity_fingerprint',
  identity_fingerprint
FROM public.telnyx_brand_link_requests
WHERE business_id = '10000000-0000-4000-a034-000000000005';

SELECT is(
  (
    public.approve_existing_telnyx_brand_link(
      '10000000-0000-4000-a034-000000000005',
      'REUSEB2',
      '03400000-0000-4000-a011-000000000011',
      (
        SELECT text_value
        FROM cancellation_034_test_state
        WHERE name = 'brand_reuse_identity_fingerprint'
      ),
      'test_034_admin'
    )
  ).status,
  'approved',
  'claims-released tombstone reuse passes the normal admin approval gate'
);

UPDATE public.businesses
SET onboarding_registration_status = 'submitting'
WHERE id = '10000000-0000-4000-a034-000000000005';

SELECT is(
  (
    public.consume_existing_telnyx_brand_link(
      '10000000-0000-4000-a034-000000000005',
      'REUSEB2',
      '03400000-0000-4000-a011-000000000011',
      (
        SELECT text_value
        FROM cancellation_034_test_state
        WHERE name = 'brand_reuse_identity_fingerprint'
      ),
      'test_034_launch'
    )
  ).status,
  'consumed',
  'claims-released tombstone reuse completes the normal launch consumption'
);

SELECT ok(
  (
    SELECT business.telnyx_brand_id =
             '03400000-0000-4000-a011-000000000011'
       AND business.telnyx_brand_source = 'linked_existing'
       AND business.brand_status = 'approved'
       AND request.status = 'consumed'
       AND request.consumed_at IS NOT NULL
    FROM public.businesses AS business
    JOIN public.telnyx_brand_link_requests AS request
      ON request.business_id = business.id
    WHERE business.id = '10000000-0000-4000-a034-000000000005'
  ),
  'stage, approve, and consume transfer the exact reused brand claim'
);

-- ---------------------------------------------------------------------------
-- Bryan Develops regression: no claim, no authorization, no local release
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status,
  parked_at,
  telnyx_campaign_assignment_status,
  telnyx_campaign_assignment_campaign_id
) VALUES (
  '20000000-0000-4000-a034-0000000000bd',
  'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
  '+15742133931',
  'known-stale-wrong-local-id',
  true,
  'protected_hold',
  now(),
  'assigned',
  'CYLIGTZ'
);

INSERT INTO public.telnyx_managed_resources (
  business_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  public_tcr_id,
  provider_origin,
  ownership_state
) VALUES
  (
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    '20000000-0000-4000-a034-0000000000bd',
    'phone_number',
    NULL,
    '+15742133931',
    NULL,
    'manually_attested',
    'unverified_hold'
  ),
  (
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    NULL,
    'campaign',
    'CYLIGTZ',
    NULL,
    'CYLIGTZ',
    'linked_existing',
    'unverified_hold'
  ),
  (
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    NULL,
    'messaging_profile',
    '03400000-0000-4000-a000-0000000000aa',
    NULL,
    NULL,
    'linked_existing',
    'unverified_hold'
  ),
  (
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    NULL,
    'voice_application',
    '340000000001',
    NULL,
    NULL,
    'linked_existing',
    'unverified_hold'
  ),
  (
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    NULL,
    'brand',
    '03400000-0000-4000-a000-0000000000bd',
    NULL,
    'BL69PDP',
    'linked_existing',
    'unverified_hold'
  );

DO $expire_bryan_develops$
DECLARE
  v_deleted_at timestamptz := now() - interval '60 days 1 second';
BEGIN
  UPDATE public.businesses
  SET deleted_at = v_deleted_at,
      deletion_scheduled_for = v_deleted_at + interval '60 days'
  WHERE id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb';
END;
$expire_bryan_develops$;

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.telnyx_resource_release_actions
    WHERE business_id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
      AND state IN ('pending', 'retryable', 'leased', 'succeeded')
  ),
  'Bryan Develops snapshots only retained or held actions'
);

UPDATE public.telnyx_resource_release_config
SET mode = 'single_business',
    single_business_id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    protection_manifest_fingerprint = (
      SELECT text_value
      FROM cancellation_034_test_state
      WHERE name = 'manifest_fingerprint'
    ),
    protection_manifest_verified_at = now(),
    protection_manifest_verified_by = 'test_034',
    dry_run_completed_at = now(),
    dry_run_completed_by = 'test_034',
    updated_by = 'test_034_bryan_regression'
WHERE id = 1;

SELECT is(
  public.claim_telnyx_release_action('test-034-bryan-worker', 120),
  NULL::jsonb,
  'Bryan Develops can never produce a remote release claim'
);

SELECT is(
  public.authorize_telnyx_remote_mutation(
    'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
    'rejection_recovery',
    'deactivate_campaign',
    'CYLIGTZ',
    NULL,
    NULL,
    '03400000-0000-4000-a000-0000000000aa',
    '340000000001'
  ),
  NULL::jsonb,
  'Bryan Develops cannot authorize rejection-recovery mutation either'
);

SELECT lives_ok(
  $$
    SELECT public.cleanup_expired_business(
      'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
    )
  $$,
  'Bryan Develops cleanup preserves protected Telnyx resources'
);

SELECT lives_ok(
  $$
    SELECT public.complete_expired_business_cleanup(
      'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb',
      NULL
    )
  $$,
  'Bryan Develops reaches a protected terminal cleanup disposition'
);

SELECT ok(
  (
    SELECT telnyx_brand_id =
             '03400000-0000-4000-a000-0000000000bd'
       AND telnyx_campaign_id = 'CYLIGTZ'
       AND telnyx_messaging_profile_id =
             '03400000-0000-4000-a000-0000000000aa'
       AND telnyx_voice_application_id = '340000000001'
       AND telnyx_unique_claims_released_at IS NULL
    FROM public.businesses
    WHERE id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
  ),
  'Bryan cleanup preserves every protected business pointer and claim'
);

SELECT ok(
  (
    SELECT phone_number = '+15742133931'
       AND telnyx_phone_number_id = 'known-stale-wrong-local-id'
       AND is_active IS TRUE
       AND resource_status = 'protected_hold'
       AND telnyx_campaign_assignment_campaign_id = 'CYLIGTZ'
    FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a034-0000000000bd'
  ),
  'Bryan cleanup preserves the live phone row despite its stale local ID'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.telnyx_managed_resources
    WHERE business_id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
      AND (
        ownership_state = 'released'
        OR local_claim_active IS FALSE
      )
  ),
  'Bryan cleanup releases no managed-resource claim'
);

SELECT is(
  (
    SELECT status
    FROM public.telnyx_resource_release_runs
    WHERE business_id = 'aa30a10e-13c1-4c9b-b9d5-6804cf01e6cb'
    ORDER BY generation DESC
    LIMIT 1
  ),
  'protected_hold',
  'Bryan cleanup ends in protected_hold, never released'
);

-- ---------------------------------------------------------------------------
-- Live local claims remain unique until a terminal release
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      is_active
    ) VALUES (
      '20000000-0000-4000-a034-000000000021',
      '10000000-0000-4000-a034-000000000005',
      '+1 (317) 555-0010',
      '03400000-0000-4000-a021-000000000021',
      true
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "phone_numbers_unreleased_normalized_e164_unique"',
  'a second active phone cannot claim an equivalent normalized E.164'
);

SELECT throws_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      is_active
    ) VALUES (
      '20000000-0000-4000-a034-000000000022',
      '10000000-0000-4000-a034-000000000005',
      '+13175559992',
      '1293384261075734012',
      true
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "phone_numbers_telnyx_id_lower_unique"',
  'a second active phone cannot claim the same provider resource ID'
);

SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      id,
      business_id,
      resource_type,
      provider_id,
      canonical_e164,
      provider_origin,
      ownership_state,
      verified_by,
      verified_at
    ) VALUES (
      '30000000-0000-4000-a034-000000000021',
      '10000000-0000-4000-a034-000000000005',
      'phone_number',
      '1293384261075734012',
      '+13175559993',
      'created_by_simplassist',
      'managed_releaseable',
      'test_034',
      now()
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "telnyx_managed_resources_provider_unique"',
  'a live managed resource cannot duplicate a provider claim'
);

SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      id,
      business_id,
      resource_type,
      provider_id,
      canonical_e164,
      provider_origin,
      ownership_state,
      verified_by,
      verified_at
    ) VALUES (
      '30000000-0000-4000-a034-000000000022',
      '10000000-0000-4000-a034-000000000005',
      'phone_number',
      '1293384261075734022',
      '+13175550010',
      'created_by_simplassist',
      'managed_releaseable',
      'test_034',
      now()
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "telnyx_managed_resources_e164_unique"',
  'a live managed resource cannot duplicate an E.164 claim'
);

-- ---------------------------------------------------------------------------
-- Constraints reject unsafe action shapes
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_resource_release_actions (
      run_id,
      business_id,
      resource_type,
      classification,
      desired_action,
      state,
      action_order,
      previous_resource_status
    )
    SELECT
      run.id,
      run.business_id,
      'phone_number',
      'managed_releaseable',
      'release',
      'pending',
      99,
      NULL
    FROM public.telnyx_resource_release_runs AS run
    WHERE run.business_id = '10000000-0000-4000-a034-000000000002'
    ORDER BY run.generation DESC
    LIMIT 1
  $$,
  '23514',
  format(
    'new row for relation "telnyx_resource_release_actions" violates check constraint "%s"',
    'telnyx_release_actions_phone_previous_status_required'
  ),
  'phone actions cannot omit the previous resource status'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET resource_status = 'released',
        is_active = false,
        released_at = now()
    WHERE id = '20000000-0000-4000-a034-000000000002'
      AND telnyx_phone_number_id IS NOT NULL
  $$,
  '23514',
  'new row for relation "phone_numbers" violates check constraint "phone_numbers_release_state_check"',
  'local phone state cannot claim release before clearing its provider ID'
);

SELECT * FROM finish();

ROLLBACK;
