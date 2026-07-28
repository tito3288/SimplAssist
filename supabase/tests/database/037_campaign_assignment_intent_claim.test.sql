BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(56);

-- ---------------------------------------------------------------------------
-- Catalog shape and direct-execution boundaries
-- ---------------------------------------------------------------------------

SELECT has_column(
  'public',
  'businesses',
  'telnyx_campaign_assignment_claim_token',
  'businesses carry an assignment lease token'
);

SELECT has_column(
  'public',
  'businesses',
  'telnyx_campaign_assignment_claimed_at',
  'businesses carry an assignment lease timestamp'
);

SELECT has_column(
  'public',
  'businesses',
  'telnyx_campaign_assignment_claim_campaign_id',
  'business assignment leases bind the campaign identity'
);

SELECT has_column(
  'public',
  'businesses',
  'telnyx_campaign_assignment_claim_profile_id',
  'business assignment leases bind the messaging-profile identity'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.businesses'::regclass
      AND attribute.attname IN (
        'telnyx_campaign_assignment_claim_token',
        'telnyx_campaign_assignment_claimed_at',
        'telnyx_campaign_assignment_claim_campaign_id',
        'telnyx_campaign_assignment_claim_profile_id'
      )
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'telnyx_campaign_assignment_claim_token', 'uuid',
    'telnyx_campaign_assignment_claimed_at', 'timestamp with time zone',
    'telnyx_campaign_assignment_claim_campaign_id', 'text',
    'telnyx_campaign_assignment_claim_profile_id', 'text'
  ),
  'assignment lease columns have the exact intended types'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.businesses'::regclass
      AND constraint_row.conname =
            'businesses_campaign_assignment_claim_shape'
      AND constraint_row.contype = 'c'
  ),
  'business assignment leases have an all-null-or-all-present constraint'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_campaign_assignment_claim_fields',
  'businesses protect and stamp assignment claim fields'
);

SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_campaign_assignment_lifecycle_fence',
  'business lifecycle transitions honor fresh assignment leases'
);

SELECT has_trigger(
  'public',
  'phone_numbers',
  'guard_phone_campaign_assignment_authorization_fields',
  'phone rows protect campaign assignment authorization state'
);

SELECT has_trigger(
  'public',
  'phone_numbers',
  'guard_phone_campaign_assignment_lifecycle_fence',
  'phone lifecycle transitions honor fresh assignment leases'
);

SELECT ok(
  (
    SELECT count(*) = 4
       AND bool_and(NOT procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @>
           ARRAY['search_path=public, pg_temp']::text[]
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'guard_business_campaign_assignment_claim_fields',
        'guard_business_campaign_assignment_lifecycle_fence',
        'guard_phone_campaign_assignment_authorization_fields',
        'guard_phone_campaign_assignment_lifecycle_fence'
      )
  ),
  'assignment trigger functions are SECURITY INVOKER with a fixed search path'
);

SELECT ok(
  (
    WITH assignment_functions AS (
      SELECT procedure_row.oid
      FROM pg_proc AS procedure_row
      WHERE procedure_row.pronamespace = 'public'::regnamespace
        AND procedure_row.proname IN (
          'guard_business_campaign_assignment_claim_fields',
          'guard_business_campaign_assignment_lifecycle_fence',
          'guard_phone_campaign_assignment_authorization_fields',
          'guard_phone_campaign_assignment_lifecycle_fence'
        )
    )
    SELECT count(*) = 4
       AND bool_and(
         NOT has_function_privilege(
           'anon',
           assignment_function.oid,
           'EXECUTE'
         )
       )
       AND bool_and(
         NOT has_function_privilege(
           'authenticated',
           assignment_function.oid,
           'EXECUTE'
         )
       )
       AND bool_and(
         NOT has_function_privilege(
           'service_role',
           assignment_function.oid,
           'EXECUTE'
         )
       )
       AND NOT EXISTS (
         SELECT 1
         FROM assignment_functions AS public_function
         CROSS JOIN LATERAL aclexplode(
           COALESCE(
             (SELECT procedure_row.proacl
              FROM pg_proc AS procedure_row
              WHERE procedure_row.oid = public_function.oid),
             acldefault(
               'f',
               (SELECT procedure_row.proowner
                FROM pg_proc AS procedure_row
                WHERE procedure_row.oid = public_function.oid)
             )
           )
         ) AS privilege
         WHERE privilege.grantee = 0
           AND privilege.privilege_type = 'EXECUTE'
       )
    FROM assignment_functions AS assignment_function
  ),
  'PUBLIC, anon, authenticated, and service_role cannot call assignment trigger functions directly'
);

-- ---------------------------------------------------------------------------
-- Isolated fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a037-000000000001',
    'assignment-lease-a@example.test'
  ),
  (
    '00000000-0000-4000-a037-000000000002',
    'assignment-lease-b@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a037-000000000001',
    name = 'Assignment Lease A',
    slug = 'assignment-lease-a-037',
    telnyx_brand_id = '37000000-0000-4000-a000-000000000001',
    telnyx_campaign_id = 'CFENCEA',
    telnyx_messaging_profile_id =
      '37000000-0000-4000-a100-000000000001',
    brand_status = 'approved',
    campaign_status = 'approved',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a037-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a037-000000000002',
    name = 'Assignment Lease B',
    slug = 'assignment-lease-b-037',
    telnyx_brand_id = '37000000-0000-4000-a000-000000000002',
    telnyx_campaign_id = 'CFENCEB',
    telnyx_messaging_profile_id =
      '37000000-0000-4000-a100-000000000002',
    brand_status = 'approved',
    campaign_status = 'approved',
    telnyx_resource_state = 'active'
WHERE owner_id = '00000000-0000-4000-a037-000000000002';

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  resource_status
) VALUES (
  '20000000-0000-4000-a037-000000000001',
  '10000000-0000-4000-a037-000000000001',
  '+13175550371',
  '37000000-0000-4000-a200-000000000001',
  true,
  'active'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claimed_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '23514',
  'new row for relation "businesses" violates check constraint "businesses_campaign_assignment_claim_shape"',
  'partial assignment lease state is rejected'
);

-- ---------------------------------------------------------------------------
-- Trusted claim/release CAS and database-clock stamping
-- ---------------------------------------------------------------------------

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token =
          '37000000-0000-4000-a300-000000000001',
        telnyx_campaign_assignment_claimed_at =
          '2000-01-01 00:00:00+00',
        telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_claim_profile_id =
          '37000000-0000-4000-a100-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'service role can acquire one complete assignment lease'
);

SELECT ok(
  (
    SELECT telnyx_campaign_assignment_claim_token =
             '37000000-0000-4000-a300-000000000001'::uuid
       AND telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA'
       AND telnyx_campaign_assignment_claim_profile_id =
             '37000000-0000-4000-a100-000000000001'
       AND telnyx_campaign_assignment_claimed_at >
             clock_timestamp() - interval '5 seconds'
       AND telnyx_campaign_assignment_claimed_at <= clock_timestamp()
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'a new lease ignores caller time and is stamped from the database clock'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claimed_at =
          '2000-01-01 00:00:00+00'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'service role can renew the lease while retaining its exact token'
);

SELECT ok(
  (
    SELECT telnyx_campaign_assignment_claim_token =
             '37000000-0000-4000-a300-000000000001'::uuid
       AND telnyx_campaign_assignment_claimed_at >
             clock_timestamp() - interval '5 seconds'
       AND telnyx_campaign_assignment_claimed_at <= clock_timestamp()
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'same-token lease renewal also ignores caller time and uses the database clock'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token =
          '37000000-0000-4000-a300-000000000099',
        telnyx_campaign_assignment_claimed_at =
          '2000-01-01 00:00:00+00',
        telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_claim_profile_id =
          '37000000-0000-4000-a100-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'active campaign assignment claim cannot be replaced',
  'a trusted caller cannot replace a fresh lease using a skewed caller clock'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_profile_id =
          'temporary-profile-037'
    WHERE id = '10000000-0000-4000-a037-000000000001';
  $$,
  '55000',
  'campaign assignment claim identity cannot change without release',
  'a live token cannot drift to a different profile identity'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token = NULL,
        telnyx_campaign_assignment_claimed_at = NULL,
        telnyx_campaign_assignment_claim_campaign_id = NULL,
        telnyx_campaign_assignment_claim_profile_id = NULL
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'service role can release the assignment lease to its all-null state'
);

SELECT ok(
  (
    SELECT ROW(
      telnyx_campaign_assignment_claim_token,
      telnyx_campaign_assignment_claimed_at,
      telnyx_campaign_assignment_claim_campaign_id,
      telnyx_campaign_assignment_claim_profile_id
    ) IS NOT DISTINCT FROM ROW(NULL::uuid, NULL::timestamptz, NULL::text, NULL::text)
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'lease release remains all-null without a replacement clock stamp'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token =
          '37000000-0000-4000-a300-000000000002',
        telnyx_campaign_assignment_claimed_at =
          '2000-01-01 00:00:00+00',
        telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_claim_profile_id =
          '37000000-0000-4000-a100-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'service role can acquire a replacement fresh lease'
);

-- ---------------------------------------------------------------------------
-- Fresh business lease lifecycle fence
-- ---------------------------------------------------------------------------

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET owner_id = '00000000-0000-4000-a037-000000000002'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing business ownership'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET deleted_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks deletion tombstoning'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET active_telnyx_release_run_id =
          '37000000-0000-4000-a400-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks attaching a release run'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_resource_state = 'parked'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing the business resource state'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_unique_claims_released_at = clock_timestamp()
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks relinquishing provider uniqueness claims'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_submission_disabled = true
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing the Telnyx kill switch'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_brand_id =
          '37000000-0000-4000-a000-000000000099'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing the brand pointer'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_id = 'CFENCEA-CHANGED'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing the campaign pointer'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_messaging_profile_id =
          '37000000-0000-4000-a100-000000000099'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks changing the messaging-profile pointer'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET brand_status = 'pending'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks revoking brand approval'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET campaign_status = 'pending'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks revoking campaign approval'
);

SELECT throws_ok(
  $$
    DELETE FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'business lifecycle change blocked by active campaign assignment claim',
  'a fresh lease blocks deleting the business'
);

-- ---------------------------------------------------------------------------
-- Fresh business lease phone lifecycle fence
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    UPDATE public.phone_numbers
    SET telnyx_campaign_assignment_status = 'pending',
        telnyx_campaign_assignment_task_id = NULL,
        telnyx_campaign_assignment_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_failure_reason = NULL,
        telnyx_campaign_assignment_updated_at = clock_timestamp()
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  'ordinary service assignment-field CAS is not lifecycle-blocked'
);

SELECT throws_ok(
  $$
    DELETE FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks deleting its phone'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET business_id = '10000000-0000-4000-a037-000000000002'
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks moving its phone'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET is_active = false
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks deactivating its phone'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET resource_status = 'parked'
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks changing phone resource state'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET phone_number = '+13175550372'
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks changing the canonical number'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET telnyx_phone_number_id =
          '37000000-0000-4000-a200-000000000099'
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '55000',
  'phone lifecycle change blocked by active campaign assignment claim',
  'a fresh business lease blocks changing the provider number identity'
);

-- ---------------------------------------------------------------------------
-- Customer authorization guard
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a037-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Assignment Lease Customer Rename'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'ordinary owner profile updates remain available during a lease'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a037-000000000002',
  true
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token =
          '37000000-0000-4000-a300-000000000003',
        telnyx_campaign_assignment_claimed_at = clock_timestamp(),
        telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_claim_profile_id =
          '37000000-0000-4000-a100-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000002'
  $$,
  '42501',
  'customer writes cannot change campaign assignment claim fields',
  'customers cannot forge an assignment lease'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a037-000000000001',
  true
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token = NULL,
        telnyx_campaign_assignment_claimed_at = NULL,
        telnyx_campaign_assignment_claim_campaign_id = NULL,
        telnyx_campaign_assignment_claim_profile_id = NULL
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  '42501',
  'customer writes cannot change campaign assignment claim fields',
  'customers cannot clear a trusted assignment lease'
);

SELECT throws_ok(
  $$
    INSERT INTO public.businesses (
      owner_id,
      name,
      business_type,
      slug,
      telnyx_campaign_assignment_claim_token,
      telnyx_campaign_assignment_claimed_at,
      telnyx_campaign_assignment_claim_campaign_id,
      telnyx_campaign_assignment_claim_profile_id
    ) VALUES (
      '00000000-0000-4000-a037-000000000001',
      'Forged Assignment Lease',
      'general',
      'forged-assignment-lease-037',
      '37000000-0000-4000-a300-000000000004',
      clock_timestamp(),
      'CFORGE',
      '37000000-0000-4000-a100-000000000004'
    )
  $$,
  '42501',
  'customer writes cannot set campaign assignment claim fields',
  'customers cannot seed an assignment lease during insert'
);

SELECT throws_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id
    ) VALUES (
      '20000000-0000-4000-a037-000000000002',
      '10000000-0000-4000-a037-000000000001',
      '+13175550372',
      '37000000-0000-4000-a200-000000000002'
    )
  $$,
  '42501',
  'customer writes cannot insert managed phone numbers',
  'customers cannot insert an unverified managed phone identity'
);

SELECT throws_ok(
  $$
    INSERT INTO public.phone_numbers (
      id,
      business_id,
      phone_number,
      telnyx_phone_number_id,
      telnyx_campaign_assignment_status,
      telnyx_campaign_assignment_task_id,
      telnyx_campaign_assignment_campaign_id,
      telnyx_campaign_assignment_updated_at
    ) VALUES (
      '20000000-0000-4000-a037-000000000003',
      '10000000-0000-4000-a037-000000000001',
      '+13175550373',
      '37000000-0000-4000-a200-000000000003',
      'pending',
      'forged-task-037',
      'CFENCEA',
      clock_timestamp()
    )
  $$,
  '42501',
  'customer writes cannot insert managed phone numbers',
  'customers cannot seed phone assignment authorization during insert'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET telnyx_campaign_assignment_status = 'assigned',
        telnyx_campaign_assigned_at = clock_timestamp()
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '42501',
  'customer writes cannot change managed phone numbers',
  'customers cannot forge assigned state on an existing phone'
);

SELECT throws_ok(
  $$
    UPDATE public.phone_numbers
    SET phone_number = '+13175550999',
        telnyx_phone_number_id =
          '37000000-0000-4000-a200-000000000099'
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '42501',
  'customer writes cannot change managed phone numbers',
  'customers cannot rewrite a managed provider phone identity'
);

SELECT throws_ok(
  $$
    DELETE FROM public.phone_numbers
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  '42501',
  'customer writes cannot delete managed phone numbers',
  'customers cannot delete a managed provider phone identity'
);

-- ---------------------------------------------------------------------------
-- Expired lease releases lifecycle transitions
-- ---------------------------------------------------------------------------

RESET ROLE;

ALTER TABLE public.businesses
  DISABLE TRIGGER guard_business_campaign_assignment_claim_fields;

UPDATE public.businesses
SET telnyx_campaign_assignment_claimed_at =
      clock_timestamp() - interval '61 seconds'
WHERE id = '10000000-0000-4000-a037-000000000001';

ALTER TABLE public.businesses
  ENABLE TRIGGER guard_business_campaign_assignment_claim_fields;

SELECT ok(
  (
    SELECT telnyx_campaign_assignment_claimed_at <
             clock_timestamp() - interval '60 seconds'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'owner-only test setup establishes one expired lease with the stamp trigger restored'
);

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_campaign_assignment_claim_token =
          '37000000-0000-4000-a300-000000000005',
        telnyx_campaign_assignment_claimed_at =
          '2000-01-01 00:00:00+00',
        telnyx_campaign_assignment_claim_campaign_id = 'CFENCEA',
        telnyx_campaign_assignment_claim_profile_id =
          '37000000-0000-4000-a100-000000000001'
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'an expired assignment lease may be taken over by a new trusted token'
);

SELECT ok(
  (
    SELECT telnyx_campaign_assignment_claim_token =
             '37000000-0000-4000-a300-000000000005'::uuid
       AND telnyx_campaign_assignment_claimed_at >
             clock_timestamp() - interval '5 seconds'
       AND telnyx_campaign_assignment_claimed_at <= clock_timestamp()
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'stale takeover receives a fresh database-clock lease'
);

RESET ROLE;

ALTER TABLE public.businesses
  DISABLE TRIGGER guard_business_campaign_assignment_claim_fields;

UPDATE public.businesses
SET telnyx_campaign_assignment_claimed_at =
      clock_timestamp() - interval '61 seconds'
WHERE id = '10000000-0000-4000-a037-000000000001';

ALTER TABLE public.businesses
  ENABLE TRIGGER guard_business_campaign_assignment_claim_fields;

SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    UPDATE public.phone_numbers
    SET is_active = false
    WHERE id = '20000000-0000-4000-a037-000000000001'
  $$,
  'an expired assignment lease no longer blocks phone lifecycle updates'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET telnyx_submission_disabled = true
    WHERE id = '10000000-0000-4000-a037-000000000001'
  $$,
  'an expired assignment lease no longer blocks business lifecycle updates'
);

SELECT ok(
  (
    SELECT ROW(
      telnyx_campaign_assignment_claim_token,
      telnyx_campaign_assignment_claimed_at,
      telnyx_campaign_assignment_claim_campaign_id,
      telnyx_campaign_assignment_claim_profile_id
    ) IS NOT DISTINCT FROM ROW(NULL::uuid, NULL::timestamptz, NULL::text, NULL::text)
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a037-000000000001'
  ),
  'an expired lease is cleared when business assignment authorization changes'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
