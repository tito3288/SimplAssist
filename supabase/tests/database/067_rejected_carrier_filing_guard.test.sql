BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions;

SELECT plan(19);

SELECT has_function(
  'public',
  'guard_customer_rejected_carrier_filing_fields',
  ARRAY[]::text[],
  'the rejected carrier-filing guard exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.businesses'::regclass
      AND tgname = 'guard_customer_rejected_carrier_filing_fields'
      AND NOT tgisinternal
  ),
  'business updates run the rejected carrier-filing guard'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.guard_customer_rejected_carrier_filing_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.guard_customer_rejected_carrier_filing_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_customer_rejected_carrier_filing_fields()',
    'EXECUTE'
  ),
  'the trigger function is not directly callable'
);

SELECT has_function(
  'public',
  'guard_customer_rejected_campaign_language',
  ARRAY[]::text[],
  'the rejected campaign-language guard exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.ai_settings'::regclass
      AND tgname = 'guard_customer_rejected_campaign_language'
      AND NOT tgisinternal
  ),
  'AI settings writes run the rejected campaign-language guard'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.guard_customer_rejected_campaign_language()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.guard_customer_rejected_campaign_language()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_customer_rejected_campaign_language()',
    'EXECUTE'
  ),
  'the campaign-language trigger function is not directly callable'
);

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a067-000000000001',
    'rejected-filing-owner-a067@example.test'
  ),
  (
    '00000000-0000-4000-a067-000000000002',
    'rejected-language-owner-a067@example.test'
  );

UPDATE public.businesses
SET name = 'Carrier Filing Guard 067',
    legal_business_name = 'Carrier Filing Guard 067 LLC',
    ein = '12-3456789',
    has_ein = true,
    a2p_brand_tier = 'low_volume_standard',
    use_case_description = 'Existing customer service notifications and replies.',
    privacy_terms_mode = 'hosted',
    primary_goal = 'book'
WHERE owner_id = '00000000-0000-4000-a067-000000000001';

INSERT INTO public.ai_settings (business_id, language, tone)
SELECT id, 'en', 'friendly'
FROM public.businesses
WHERE owner_id = '00000000-0000-4000-a067-000000000001';

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a067-000000000001',
  true
);
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Editable Before Rejection'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  'owners can edit carrier inputs before a rejection'
);

RESET ROLE;
SET LOCAL ROLE service_role;

UPDATE public.businesses
SET brand_status = 'rejected',
    onboarding_registration_status = 'failed'
WHERE owner_id = '00000000-0000-4000-a067-000000000001';

UPDATE public.businesses
SET campaign_status = 'rejected',
    onboarding_registration_status = 'failed'
WHERE owner_id = '00000000-0000-4000-a067-000000000002';

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET name = 'Drifted Rejected Name'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  '42501',
  'customer writes cannot change carrier-filed fields after rejection',
  'owners cannot drift business identity after brand rejection'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET ein = '98-7654321'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  '42501',
  'customer writes cannot change carrier-filed fields after rejection',
  'owners cannot drift legal identity after brand rejection'
);

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET use_case_description = 'Changed after the carrier decision.'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  '42501',
  'customer writes cannot change carrier-filed fields after rejection',
  'owners cannot drift campaign content after brand rejection'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET onboarding_step = 'business_hours'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  'unrelated onboarding resume markers remain writable'
);

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = name
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  'idempotent writes do not fail when protected values are unchanged'
);

SELECT throws_ok(
  $$
    UPDATE public.ai_settings
    SET language = 'es'
    WHERE business_id IN (
      SELECT id
      FROM public.businesses
      WHERE owner_id = '00000000-0000-4000-a067-000000000001'
    )
  $$,
  '42501',
  'customer writes cannot change campaign language after rejection',
  'owners cannot drift the message-flow language after rejection'
);

SELECT lives_ok(
  $$
    UPDATE public.ai_settings
    SET tone = 'professional'
    WHERE business_id IN (
      SELECT id
      FROM public.businesses
      WHERE owner_id = '00000000-0000-4000-a067-000000000001'
    )
  $$,
  'unrelated assistant personality settings remain editable'
);

SELECT throws_ok(
  $$
    DELETE FROM public.ai_settings
    WHERE business_id IN (
      SELECT id
      FROM public.businesses
      WHERE owner_id = '00000000-0000-4000-a067-000000000001'
    )
  $$,
  '42501',
  'customer writes cannot change campaign language after rejection',
  'owners cannot remove the filed language after rejection'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a067-000000000002',
  true
);

SELECT throws_ok(
  $$
    INSERT INTO public.ai_settings (business_id, language)
    SELECT id, 'both'
    FROM public.businesses
    WHERE owner_id = '00000000-0000-4000-a067-000000000002'
  $$,
  '42501',
  'customer writes cannot change campaign language after rejection',
  'owners cannot add a different filed language after rejection'
);

RESET ROLE;
SET LOCAL ROLE service_role;

SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Support Corrected Name'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  'trusted support writes can correct a rejected filing'
);

SELECT lives_ok(
  $$
    UPDATE public.ai_settings
    SET language = 'both'
    WHERE business_id IN (
      SELECT id
      FROM public.businesses
      WHERE owner_id = '00000000-0000-4000-a067-000000000001'
    )
  $$,
  'trusted support writes can correct rejected campaign language'
);

UPDATE public.businesses
SET brand_status = NULL,
    campaign_status = 'rejected'
WHERE owner_id = '00000000-0000-4000-a067-000000000001';

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a067-000000000001',
  true
);

RESET ROLE;
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET privacy_terms_mode = 'self_hosted',
        privacy_url_override = 'https://example.test/privacy',
        terms_url_override = 'https://example.test/terms'
    WHERE owner_id = '00000000-0000-4000-a067-000000000001'
  $$,
  '42501',
  'customer writes cannot change carrier-filed fields after rejection',
  'owners cannot drift policy inputs after campaign rejection'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
