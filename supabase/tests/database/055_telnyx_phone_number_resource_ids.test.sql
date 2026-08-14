BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(47);

-- ---------------------------------------------------------------------------
-- Catalog, identity domains, and exact service boundary
-- ---------------------------------------------------------------------------

-- 1
SELECT has_column(
  'public',
  'phone_numbers',
  'telnyx_number_order_phone_number_id',
  'phone rows retain number-order child provenance'
);

-- 2
SELECT has_column(
  'public',
  'phone_numbers',
  'telnyx_number_order_id',
  'phone rows retain parent number-order provenance'
);

-- 3
SELECT col_type_is(
  'public',
  'phone_numbers',
  'telnyx_number_order_phone_number_id',
  'uuid',
  'number-order child provenance is a UUID'
);

-- 4
SELECT col_type_is(
  'public',
  'phone_numbers',
  'telnyx_number_order_id',
  'uuid',
  'parent number-order provenance is a UUID'
);

-- 5
SELECT ok(
  (
    SELECT count(*) = 2 AND bool_and(NOT attribute.attnotnull)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.phone_numbers'::regclass
      AND attribute.attname IN (
        'telnyx_number_order_phone_number_id',
        'telnyx_number_order_id'
      )
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  'both order-provenance columns are nullable'
);

-- 6
SELECT ok(
  (
    SELECT index_row.indisunique
       AND pg_get_expr(index_row.indpred, index_row.indrelid)
             LIKE '%telnyx_number_order_phone_number_id IS NOT NULL%'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.phone_numbers_telnyx_number_order_phone_number_id_unique'::regclass
  ),
  'number-order child UUIDs have a partial unique index'
);

-- 7
SELECT ok(
  (
    SELECT NOT index_row.indisunique
       AND pg_get_expr(index_row.indpred, index_row.indrelid)
             LIKE '%telnyx_number_order_id IS NOT NULL%'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.phone_numbers_telnyx_number_order_id_idx'::regclass
  ),
  'parent order UUIDs are indexed but deliberately non-unique'
);

-- 8
SELECT ok(
  (
    SELECT constraint_row.convalidated
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
            'public.telnyx_managed_resources'::regclass
      AND constraint_row.conname =
            'telnyx_managed_resources_phone_provider_id_shape_check'
  ),
  'the named phone provider-ID shape constraint is validated'
);

-- 9
SELECT ok(
  (
    SELECT pg_get_constraintdef(constraint_row.oid) LIKE ALL (ARRAY[
      '%provider_id ~ ''^[0-9]+$''::text%',
      '%ownership_state = ''unverified_hold''::text%',
      '%[0-9a-f]{8}-%'
    ])
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
            'public.telnyx_managed_resources'::regclass
      AND constraint_row.conname =
            'telnyx_managed_resources_phone_provider_id_shape_check'
  ),
  'owned numeric IDs are primary while legacy UUIDs require unverified_hold'
);

-- 10
SELECT has_function(
  'public',
  'repair_telnyx_phone_number_resource_id',
  ARRAY['uuid', 'uuid', 'text', 'text', 'text'],
  'the guarded phone-resource repair RPC has the runtime signature'
);

-- 11
SELECT ok(
  (
    SELECT pg_get_function_result(procedure_row.oid) = 'boolean'
       AND procedure_row.prosecdef
       AND procedure_row.proconfig @>
             ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.repair_telnyx_phone_number_resource_id(uuid,uuid,text,text,text)'::regprocedure
  ),
  'the repair RPC is boolean, SECURITY DEFINER, and search-path pinned'
);

-- 12
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.repair_telnyx_phone_number_resource_id(uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.repair_telnyx_phone_number_resource_id(uuid,uuid,text,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.repair_telnyx_phone_number_resource_id(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'only service_role can invoke guarded phone-resource repair'
);

-- 13
SELECT has_trigger(
  'public',
  'telnyx_managed_resources',
  'fill_telnyx_phone_managed_resource_id',
  'future lifecycle snapshots receive numeric owned-resource IDs'
);

-- 14
SELECT ok(
  NOT has_function_privilege(
    'service_role',
    'public.fill_telnyx_phone_managed_resource_id()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.fill_telnyx_phone_managed_resource_id()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.fill_telnyx_phone_managed_resource_id()',
    'EXECUTE'
  ),
  'the snapshot trigger function has no direct API execution surface'
);

-- 15
SELECT ok(
  (
    SELECT pg_get_constraintdef(constraint_row.oid) LIKE ALL (ARRAY[
      '%''phone_number''::text%',
      '%''phone_number_assignment''::text%',
      '%''messaging_profile''::text%',
      '%''voice_application''::text%'
    ])
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
            'public.telnyx_registration_events'::regclass
      AND constraint_row.conname =
            'telnyx_registration_events_telnyx_resource_type_check'
  ),
  'registration events admit phone-number resources without removing old kinds'
);

-- 16
SELECT ok(
  (
    SELECT index_row.indisunique
       AND pg_get_expr(index_row.indpred, index_row.indrelid)
             LIKE ALL (ARRAY[
               '%status = ''started''::text%',
               '%event_type = ''phone_number_order_create_intent''::text%'
             ])
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_number_order_intent_unique'::regclass
  ),
  'paid phone-number orders have their own unresolved-intent fence'
);

-- 17
SELECT is(
  obj_description(
    'public.telnyx_registration_events_active_number_order_intent_unique'::regclass,
    'pg_class'
  ),
  'Allows only one unresolved paid Telnyx phone-number order create intent per business.',
  'the paid-order intent index documents its spending boundary'
);

-- ---------------------------------------------------------------------------
-- Isolated fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.businesses (
  id,
  owner_id,
  name,
  slug,
  business_type
) VALUES
  ('10550000-0000-4000-a001-000000000001', NULL, 'Phone ID 055 A', 'phone-id-055-a', 'general'),
  ('10550000-0000-4000-a002-000000000002', NULL, 'Phone ID 055 B', 'phone-id-055-b', 'general'),
  ('10550000-0000-4000-a003-000000000003', NULL, 'Phone ID 055 C', 'phone-id-055-c', 'general'),
  ('10550000-0000-4000-a004-000000000004', NULL, 'Phone ID 055 D', 'phone-id-055-d', 'general'),
  ('10550000-0000-4000-a005-000000000005', NULL, 'Phone ID 055 E', 'phone-id-055-e', 'general'),
  ('10550000-0000-4000-a006-000000000006', NULL, 'Phone ID 055 F', 'phone-id-055-f', 'general'),
  ('10550000-0000-4000-a007-000000000007', NULL, 'Phone ID 055 G', 'phone-id-055-g', 'general'),
  ('10550000-0000-4000-a008-000000000008', NULL, 'Phone ID 055 H', 'phone-id-055-h', 'general'),
  ('10550000-0000-4000-a009-000000000009', NULL, 'Phone ID 055 I', 'phone-id-055-i', 'general'),
  ('10550000-0000-4000-a010-000000000010', NULL, 'Phone ID 055 J', 'phone-id-055-j', 'general'),
  ('10550000-0000-4000-a011-000000000011', NULL, 'Phone ID 055 K', 'phone-id-055-k', 'general');

-- ---------------------------------------------------------------------------
-- Provider-ID shape and paid-order intent behavior
-- ---------------------------------------------------------------------------

-- 18
SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      resource_type,
      provider_id,
      ownership_state
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number',
      '05500000-0000-4000-a900-000000000001',
      'unverified_hold'
    )
  $$,
  'a legacy phone UUID is retained only as an unverified hold'
);

-- 19
SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      resource_type,
      provider_id,
      provider_origin,
      ownership_state,
      verified_by,
      verified_at
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number',
      '05500000-0000-4000-a900-000000000002',
      'created_by_simplassist',
      'managed_releaseable',
      'test_055',
      now()
    )
  $$,
  '23514',
  'new row for relation "telnyx_managed_resources" violates check constraint "telnyx_managed_resources_phone_provider_id_shape_check"',
  'a legacy UUID can never be marked releaseable'
);

-- 20
SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      resource_type,
      provider_id,
      provider_origin,
      ownership_state,
      verified_by,
      verified_at
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number',
      '1293384261075735590',
      'created_by_simplassist',
      'managed_releaseable',
      'test_055',
      now()
    )
  $$,
  'a decimal owned-resource ID can be marked releaseable'
);

-- 21
SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      resource_type,
      provider_id,
      ownership_state,
      local_claim_active,
      released_at
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number',
      '1293384261075735591',
      'released',
      false,
      now()
    )
  $$,
  'a released phone retains its decimal owned-resource provenance'
);

-- 22
SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_managed_resources (
      business_id,
      resource_type,
      provider_id,
      ownership_state
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number',
      'not-an-endpoint-id',
      'unverified_hold'
    )
  $$,
  '23514',
  'new row for relation "telnyx_managed_resources" violates check constraint "telnyx_managed_resources_phone_provider_id_shape_check"',
  'malformed phone provider identifiers fail closed'
);

-- 23
SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number_order_create_intent',
      'phone_number',
      'started'
    )
  $$,
  'the first unresolved paid number-order intent is accepted'
);

-- 24
SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10550000-0000-4000-a001-000000000001',
      'phone_number_order_create_intent',
      'phone_number',
      'started'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "telnyx_registration_events_active_number_order_intent_unique"',
  'a business cannot start a second unresolved paid number order'
);

-- 25
SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES
      (
        '10550000-0000-4000-a001-000000000001',
        'phone_number_order_create_intent',
        'phone_number',
        'resolved'
      ),
      (
        '10550000-0000-4000-a001-000000000001',
        'phone_number_order_create_intent',
        'phone_number',
        'resolved'
      )
  $$,
  'resolved paid-order intent history remains append-only and non-unique'
);

-- ---------------------------------------------------------------------------
-- Existing-registry child repair and exact idempotency
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES (
  '20550000-0000-4000-a001-000000000001',
  '10550000-0000-4000-a001-000000000001',
  '+13175550551',
  '05500000-0000-4000-a101-000000000001',
  true,
  'active'
);

INSERT INTO public.telnyx_managed_resources (
  id,
  business_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  ownership_state
) VALUES (
  '30550000-0000-4000-a001-000000000001',
  '10550000-0000-4000-a001-000000000001',
  '20550000-0000-4000-a001-000000000001',
  'phone_number',
  '05500000-0000-4000-a101-000000000001',
  '+13175550551',
  'unverified_hold'
);

SET LOCAL ROLE service_role;

-- 26
SELECT is(
  public.repair_telnyx_phone_number_resource_id(
    '10550000-0000-4000-a001-000000000001',
    '20550000-0000-4000-a001-000000000001',
    '+13175550551',
    '05500000-0000-4000-a101-000000000001',
    '1293384261075735501'
  ),
  true,
  'an exact legacy child UUID repairs atomically'
);

RESET ROLE;

-- 27
SELECT ok(
  (
    SELECT telnyx_phone_number_id = '1293384261075735501'
       AND telnyx_number_order_phone_number_id =
             '05500000-0000-4000-a101-000000000001'::uuid
       AND telnyx_number_order_id IS NULL
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a001-000000000001'
  ),
  'child repair stores the numeric resource while preserving child provenance'
);

-- 28
SELECT ok(
  (
    SELECT provider_id = '1293384261075735501'
       AND business_id = '10550000-0000-4000-a001-000000000001'::uuid
       AND phone_number_id = '20550000-0000-4000-a001-000000000001'::uuid
       AND canonical_e164 = '+13175550551'
       AND ownership_state = 'unverified_hold'
       AND local_claim_active IS TRUE
    FROM public.telnyx_managed_resources
    WHERE id = '30550000-0000-4000-a001-000000000001'
  ),
  'the same transaction repairs the exact unverified registry row'
);

SET LOCAL ROLE service_role;

-- 29
SELECT is(
  public.repair_telnyx_phone_number_resource_id(
    '10550000-0000-4000-a001-000000000001',
    '20550000-0000-4000-a001-000000000001',
    '+13175550551',
    '05500000-0000-4000-a101-000000000001',
    '1293384261075735501'
  ),
  true,
  'an exact fully repaired state is idempotent'
);

RESET ROLE;

-- 30
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.telnyx_managed_resources
    WHERE phone_number_id = '20550000-0000-4000-a001-000000000001'
  ),
  1,
  'idempotent repair creates no second registry row'
);

-- ---------------------------------------------------------------------------
-- Parent-order fallback stays distinct from child provenance
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  telnyx_number_order_id,
  is_active,
  resource_status
) VALUES (
  '20550000-0000-4000-a002-000000000002',
  '10550000-0000-4000-a002-000000000002',
  '+13175550552',
  '05500000-0000-4000-a102-000000000002',
  '05500000-0000-4000-a102-000000000002',
  true,
  'active'
);

SET LOCAL ROLE service_role;

-- 31
SELECT is(
  public.repair_telnyx_phone_number_resource_id(
    '10550000-0000-4000-a002-000000000002',
    '20550000-0000-4000-a002-000000000002',
    '+13175550552',
    '05500000-0000-4000-a102-000000000002',
    '1293384261075735502'
  ),
  true,
  'a parent-order-only charged fence repairs atomically'
);

RESET ROLE;

-- 32
SELECT ok(
  (
    SELECT telnyx_phone_number_id = '1293384261075735502'
       AND telnyx_number_order_phone_number_id IS NULL
       AND telnyx_number_order_id =
             '05500000-0000-4000-a102-000000000002'::uuid
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a002-000000000002'
  ),
  'parent-order fallback is never mislabeled as a child UUID'
);

-- 33
SELECT ok(
  (
    SELECT provider_id = '1293384261075735502'
       AND ownership_state = 'unverified_hold'
    FROM public.telnyx_managed_resources
    WHERE phone_number_id = '20550000-0000-4000-a002-000000000002'
  ),
  'repair inserts one unverified registry row when none existed'
);

-- ---------------------------------------------------------------------------
-- Existing snapshot function remains safe without replacement
-- ---------------------------------------------------------------------------

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES
  (
    '20550000-0000-4000-a003-000000000003',
    '10550000-0000-4000-a003-000000000003',
    '+13175550553',
    '1293384261075735503',
    true,
    'active'
  ),
  (
    '20550000-0000-4000-a004-000000000004',
    '10550000-0000-4000-a004-000000000004',
    '+13175550554',
    '05500000-0000-4000-a104-000000000004',
    true,
    'active'
  );

INSERT INTO public.telnyx_managed_resources (
  id,
  business_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  ownership_state
) VALUES
  (
    '30550000-0000-4000-a003-000000000003',
    '10550000-0000-4000-a003-000000000003',
    '20550000-0000-4000-a003-000000000003',
    'phone_number',
    NULL,
    '+13175550553',
    'unverified_hold'
  ),
  (
    '30550000-0000-4000-a004-000000000004',
    '10550000-0000-4000-a004-000000000004',
    '20550000-0000-4000-a004-000000000004',
    'phone_number',
    NULL,
    '+13175550554',
    'unverified_hold'
  );

-- 34
SELECT is(
  (
    SELECT provider_id
    FROM public.telnyx_managed_resources
    WHERE id = '30550000-0000-4000-a003-000000000003'
  ),
  '1293384261075735503',
  'a future snapshot NULL is filled from an exact numeric phone resource ID'
);

-- 35
SELECT is(
  (
    SELECT provider_id
    FROM public.telnyx_managed_resources
    WHERE id = '30550000-0000-4000-a004-000000000004'
  ),
  NULL::text,
  'the snapshot trigger does not reinterpret a legacy UUID'
);

-- ---------------------------------------------------------------------------
-- Fail-closed repair cases leave the phone pointer untouched
-- ---------------------------------------------------------------------------

SET LOCAL ROLE service_role;

-- 36
SELECT throws_ok(
  $$
    SELECT public.repair_telnyx_phone_number_resource_id(
      '10550000-0000-4000-a001-000000000001',
      '20550000-0000-4000-a001-000000000001',
      '+13175550999',
      '05500000-0000-4000-a101-000000000001',
      '1293384261075735501'
    )
  $$,
  '23514',
  'telnyx_phone_number_repair_target_mismatch',
  'an E.164 mismatch fails closed'
);

RESET ROLE;

-- 37
SELECT is(
  (
    SELECT telnyx_phone_number_id
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a001-000000000001'
  ),
  '1293384261075735501',
  'a failed target check changes no repaired pointer'
);

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES (
  '20550000-0000-4000-a005-000000000005',
  '10550000-0000-4000-a005-000000000005',
  '+13175550555',
  '05500000-0000-4000-a105-000000000005',
  true,
  'active'
);

UPDATE public.businesses
SET telnyx_campaign_assignment_claim_token =
      '40550000-0000-4000-a005-000000000005',
    telnyx_campaign_assignment_claimed_at = clock_timestamp(),
    telnyx_campaign_assignment_claim_campaign_id = 'CLAIM055',
    telnyx_campaign_assignment_claim_profile_id =
      '05500000-0000-4000-a205-000000000005'
WHERE id = '10550000-0000-4000-a005-000000000005';

SET LOCAL ROLE service_role;

-- 38
SELECT throws_ok(
  $$
    SELECT public.repair_telnyx_phone_number_resource_id(
      '10550000-0000-4000-a005-000000000005',
      '20550000-0000-4000-a005-000000000005',
      '+13175550555',
      '05500000-0000-4000-a105-000000000005',
      '1293384261075735505'
    )
  $$,
  '55000',
  'telnyx_phone_number_repair_assignment_claim_active',
  'a fresh assignment claim blocks resource-ID repair'
);

RESET ROLE;

-- 39
SELECT is(
  (
    SELECT telnyx_phone_number_id
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a005-000000000005'
  ),
  '05500000-0000-4000-a105-000000000005',
  'assignment-claim rejection leaves the legacy pointer untouched'
);

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES
  (
    '20550000-0000-4000-a006-000000000006',
    '10550000-0000-4000-a006-000000000006',
    '+13175550556',
    '05500000-0000-4000-a106-000000000006',
    true,
    'active'
  ),
  (
    '20550000-0000-4000-a007-000000000007',
    '10550000-0000-4000-a007-000000000007',
    '+13175550557',
    '1293384261075735507',
    true,
    'active'
  );

SET LOCAL ROLE service_role;

-- 40
SELECT throws_ok(
  $$
    SELECT public.repair_telnyx_phone_number_resource_id(
      '10550000-0000-4000-a006-000000000006',
      '20550000-0000-4000-a006-000000000006',
      '+13175550556',
      '05500000-0000-4000-a106-000000000006',
      '1293384261075735507'
    )
  $$,
  '23505',
  'telnyx_phone_number_repair_resource_id_conflict',
  'another active phone cannot lose ownership of the resolved resource ID'
);

RESET ROLE;

-- 41
SELECT is(
  (
    SELECT telnyx_phone_number_id
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a006-000000000006'
  ),
  '05500000-0000-4000-a106-000000000006',
  'cross-business ID conflict leaves the target row unchanged'
);

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES (
  '20550000-0000-4000-a008-000000000008',
  '10550000-0000-4000-a008-000000000008',
  '+13175550558',
  '05500000-0000-4000-a108-000000000008',
  true,
  'active'
);

INSERT INTO public.telnyx_managed_resources (
  id,
  business_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  ownership_state
) VALUES (
  '30550000-0000-4000-a008-000000000008',
  '10550000-0000-4000-a008-000000000008',
  '20550000-0000-4000-a008-000000000008',
  'phone_number',
  '05500000-0000-4000-a108-000000000008',
  '+13175550558',
  'unverified_hold'
);

INSERT INTO public.telnyx_resource_release_runs (
  id,
  business_id,
  generation,
  previous_resource_state,
  status,
  effective_release_at,
  completed_at
) VALUES (
  '50550000-0000-4000-a008-000000000008',
  '10550000-0000-4000-a008-000000000008',
  1,
  'provisioning',
  'canceled',
  now() + interval '30 days',
  now()
);

INSERT INTO public.telnyx_resource_release_actions (
  run_id,
  business_id,
  managed_resource_id,
  phone_number_id,
  resource_type,
  provider_id,
  canonical_e164,
  previous_resource_status,
  classification,
  desired_action,
  state,
  action_order
) VALUES (
  '50550000-0000-4000-a008-000000000008',
  '10550000-0000-4000-a008-000000000008',
  '30550000-0000-4000-a008-000000000008',
  '20550000-0000-4000-a008-000000000008',
  'phone_number',
  '05500000-0000-4000-a108-000000000008',
  '+13175550558',
  'active',
  'unverified_hold',
  'hold',
  'held',
  20
);

SET LOCAL ROLE service_role;

-- 42
SELECT throws_ok(
  $$
    SELECT public.repair_telnyx_phone_number_resource_id(
      '10550000-0000-4000-a008-000000000008',
      '20550000-0000-4000-a008-000000000008',
      '+13175550558',
      '05500000-0000-4000-a108-000000000008',
      '1293384261075735508'
    )
  $$,
  '55000',
  'telnyx_phone_number_repair_release_history_exists',
  'immutable release-action history blocks identity mutation'
);

RESET ROLE;

-- 43
SELECT is(
  (
    SELECT telnyx_phone_number_id
    FROM public.phone_numbers
    WHERE id = '20550000-0000-4000-a008-000000000008'
  ),
  '05500000-0000-4000-a108-000000000008',
  'release-history rejection leaves both identity domains unchanged'
);

SET LOCAL ROLE service_role;

-- 44
SELECT throws_ok(
  $$
    SELECT public.repair_telnyx_phone_number_resource_id(
      '10550000-0000-4000-a001-000000000001',
      '20550000-0000-4000-a001-000000000001',
      '+13175550551',
      '05500000-0000-4000-a101-000000000001',
      '12x-not-decimal'
    )
  $$,
  '22023',
  'telnyx_phone_number_repair_invalid_resource_id',
  'a non-decimal owned-resource ID is rejected before locking or writing'
);

RESET ROLE;

-- 45
SELECT throws_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      telnyx_number_order_phone_number_id,
      is_active,
      resource_status
    ) VALUES (
      '20550000-0000-4000-a009-000000000009',
      '10550000-0000-4000-a009-000000000009',
      '+13175550559',
      '1293384261075735509',
      '05500000-0000-4000-a101-000000000001',
      true,
      'active'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "phone_numbers_telnyx_number_order_phone_number_id_unique"',
  'one number-order child UUID cannot belong to two phone rows'
);

-- 46
SELECT lives_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      telnyx_number_order_id,
      is_active,
      resource_status
    ) VALUES
      (
        '20550000-0000-4000-a010-000000000010',
        '10550000-0000-4000-a010-000000000010',
        '+13175550560',
        '1293384261075735510',
        '05500000-0000-4000-a999-000000000999',
        true,
        'active'
      ),
      (
        '20550000-0000-4000-a011-000000000011',
        '10550000-0000-4000-a011-000000000011',
        '+13175550561',
        '1293384261075735511',
        '05500000-0000-4000-a999-000000000999',
        true,
        'active'
      )
  $$,
  'one parent order may retain provenance for multiple phone-number children'
);

-- 47
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.phone_numbers
    WHERE telnyx_number_order_id =
      '05500000-0000-4000-a999-000000000999'
  ),
  2,
  'the non-unique parent-order index preserves both child rows'
);

SELECT * FROM finish();

ROLLBACK;
