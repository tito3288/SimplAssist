BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(39);

-- ---------------------------------------------------------------------------
-- Catalog and normalization contract
-- ---------------------------------------------------------------------------

-- 1
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid IN ('public.services'::regclass, 'public.faqs'::regclass)
      AND conname IN (
        'services_active_name_not_blank',
        'faqs_active_question_not_blank',
        'faqs_active_answer_not_blank',
        'faqs_active_answer_max_length'
      )
  ),
  4,
  'all active-content checks exist'
);

-- 2
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid IN ('public.services'::regclass, 'public.faqs'::regclass)
      AND conname IN (
        'services_active_name_not_blank',
        'faqs_active_question_not_blank',
        'faqs_active_answer_not_blank',
        'faqs_active_answer_max_length'
      )
      AND convalidated IS FALSE
  ),
  4,
  'active-content checks deploy without validating legacy rows'
);

-- 3
SELECT has_trigger(
  'public',
  'services',
  'guard_service_ai_knowledge_quality',
  'services have a serialized quality guard'
);

-- 4
SELECT has_trigger(
  'public',
  'faqs',
  'guard_faq_ai_knowledge_quality',
  'FAQs have a serialized quality guard'
);

-- 5
SELECT is(
  public.normalize_ai_knowledge_key(E'  Emergency\t  Plumbing \n'),
  'emergency plumbing',
  'knowledge keys trim, collapse whitespace, and compare case-insensitively'
);

-- 6
SELECT policies_are(
  'public',
  'services',
  ARRAY['services_delete', 'services_insert', 'services_select', 'services_update'],
  'service ownership policies are preserved'
);

-- 7
SELECT policies_are(
  'public',
  'faqs',
  ARRAY['faqs_delete', 'faqs_insert', 'faqs_select', 'faqs_update'],
  'FAQ ownership policies are preserved'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  ('00000000-0000-4000-a000-000000000361', 'quality-a@example.test'),
  ('00000000-0000-4000-a000-000000000362', 'quality-b@example.test'),
  ('00000000-0000-4000-a000-000000000363', 'quality-c@example.test'),
  ('00000000-0000-4000-a000-000000000364', 'quality-d@example.test');

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000361',
    name = 'Quality Test A',
    slug = 'quality-test-a'
WHERE owner_id = '00000000-0000-4000-a000-000000000361';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000362',
    name = 'Quality Test B',
    slug = 'quality-test-b'
WHERE owner_id = '00000000-0000-4000-a000-000000000362';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000363',
    name = 'Quality Test C',
    slug = 'quality-test-c'
WHERE owner_id = '00000000-0000-4000-a000-000000000363';

UPDATE public.businesses
SET id = '10000000-0000-4000-a000-000000000364',
    name = 'Quality Test D',
    slug = 'quality-test-d'
WHERE owner_id = '00000000-0000-4000-a000-000000000364';

-- 8
SELECT throws_ok(
  $$
    INSERT INTO public.services (business_id, name, is_active)
    VALUES ('10000000-0000-4000-a000-000000000364', '   ', true)
  $$,
  '23514',
  NULL,
  'new active services cannot be blank'
);

-- 9
SELECT throws_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer, is_active)
    VALUES ('10000000-0000-4000-a000-000000000364', '   ', 'Answer', true)
  $$,
  '23514',
  NULL,
  'new active FAQ questions cannot be blank'
);

-- 10
SELECT throws_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer, is_active)
    VALUES ('10000000-0000-4000-a000-000000000364', 'Question', E'\t\n', true)
  $$,
  '23514',
  NULL,
  'new active FAQ answers cannot be blank'
);

-- 11
SELECT throws_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer, is_active)
    VALUES (
      '10000000-0000-4000-a000-000000000364',
      'Question',
      repeat('x', 2001),
      true
    )
  $$,
  '23514',
  NULL,
  'new active FAQ answers cannot exceed 2000 characters'
);

INSERT INTO public.services (id, business_id, name, description, price)
VALUES
  ('20000000-0000-4000-a000-000000000361', '10000000-0000-4000-a000-000000000361', 'Emergency Plumbing', NULL, NULL),
  ('20000000-0000-4000-a000-000000000362', '10000000-0000-4000-a000-000000000361', 'Drain Cleaning', NULL, NULL),
  ('20000000-0000-4000-a000-000000000363', '10000000-0000-4000-a000-000000000361', 'Water Heaters', NULL, NULL),
  ('20000000-0000-4000-a000-000000000364', '10000000-0000-4000-a000-000000000361', 'Leak Repair', NULL, NULL);

INSERT INTO public.faqs (id, business_id, question, answer)
VALUES
  ('30000000-0000-4000-a000-000000000361', '10000000-0000-4000-a000-000000000361', 'Do you offer emergency service?', 'Yes.'),
  ('30000000-0000-4000-a000-000000000362', '10000000-0000-4000-a000-000000000361', 'What areas do you serve?', 'The metro area.'),
  ('30000000-0000-4000-a000-000000000363', '10000000-0000-4000-a000-000000000361', 'Do you provide estimates?', 'Yes.'),
  ('30000000-0000-4000-a000-000000000364', '10000000-0000-4000-a000-000000000361', 'Are you licensed?', 'Yes.');

-- 12
SELECT throws_ok(
  $$
    INSERT INTO public.services (business_id, name)
    VALUES (
      '10000000-0000-4000-a000-000000000361',
      E' emergency\t plumbing '
    )
  $$,
  '23505',
  NULL,
  'normalized active service duplicates are rejected'
);

-- 13
SELECT throws_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer)
    VALUES (
      '10000000-0000-4000-a000-000000000361',
      ' DO YOU OFFER   EMERGENCY SERVICE? ',
      'Duplicate'
    )
  $$,
  '23505',
  NULL,
  'normalized active FAQ duplicates are rejected'
);

UPDATE public.businesses
SET onboarding_completed_at = now()
WHERE id = '10000000-0000-4000-a000-000000000361';

-- 14
SELECT lives_ok(
  $$
    DELETE FROM public.services
    WHERE id = '20000000-0000-4000-a000-000000000364'
  $$,
  'a completed account can move from four to three services'
);

-- 15
SELECT lives_ok(
  $$
    DELETE FROM public.faqs
    WHERE id = '30000000-0000-4000-a000-000000000364'
  $$,
  'a completed account can move from four to three FAQs'
);

-- 16
SELECT throws_ok(
  $$
    DELETE FROM public.services
    WHERE id = '20000000-0000-4000-a000-000000000363'
  $$,
  '23514',
  NULL,
  'a completed account cannot move from three to two services'
);

-- 17
SELECT throws_ok(
  $$
    DELETE FROM public.faqs
    WHERE id = '30000000-0000-4000-a000-000000000363'
  $$,
  '23514',
  NULL,
  'a completed account cannot move from three to two FAQs'
);

-- 18
SELECT throws_ok(
  $$
    UPDATE public.services
    SET is_active = false
    WHERE id = '20000000-0000-4000-a000-000000000363'
  $$,
  '23514',
  NULL,
  'an exact-floor service cannot be deactivated'
);

-- 19
SELECT throws_ok(
  $$
    UPDATE public.faqs
    SET is_active = false
    WHERE id = '30000000-0000-4000-a000-000000000363'
  $$,
  '23514',
  NULL,
  'an exact-floor FAQ cannot be deactivated'
);

-- 20
SELECT lives_ok(
  $$
    UPDATE public.services
    SET description = NULL, price = NULL
    WHERE id = '20000000-0000-4000-a000-000000000361'
  $$,
  'optional service fields remain optional at the floor'
);

-- A completed legacy account with only two valid entries can improve without
-- being forced through an all-at-once replacement.
INSERT INTO public.services (id, business_id, name)
VALUES
  ('20000000-0000-4000-a000-000000000371', '10000000-0000-4000-a000-000000000362', 'Service One'),
  ('20000000-0000-4000-a000-000000000372', '10000000-0000-4000-a000-000000000362', 'Service Two');

INSERT INTO public.faqs (id, business_id, question, answer)
VALUES
  ('30000000-0000-4000-a000-000000000371', '10000000-0000-4000-a000-000000000362', 'Question One?', 'Answer one.'),
  ('30000000-0000-4000-a000-000000000372', '10000000-0000-4000-a000-000000000362', 'Question Two?', 'Answer two.');

UPDATE public.businesses
SET onboarding_completed_at = now()
WHERE id = '10000000-0000-4000-a000-000000000362';

-- 21
SELECT lives_ok(
  $$
    UPDATE public.services
    SET name = 'Renamed Service One'
    WHERE id = '20000000-0000-4000-a000-000000000371'
  $$,
  'a deficient legacy account can make a non-worsening service edit'
);

-- 22
SELECT lives_ok(
  $$
    UPDATE public.faqs
    SET answer = 'A clearer answer.'
    WHERE id = '30000000-0000-4000-a000-000000000371'
  $$,
  'a deficient legacy account can make a non-worsening FAQ edit'
);

-- 23
SELECT throws_ok(
  $$
    DELETE FROM public.services
    WHERE id = '20000000-0000-4000-a000-000000000372'
  $$,
  '23514',
  NULL,
  'a deficient legacy account cannot reduce its service count'
);

-- 24
SELECT throws_ok(
  $$
    DELETE FROM public.faqs
    WHERE id = '30000000-0000-4000-a000-000000000372'
  $$,
  '23514',
  NULL,
  'a deficient legacy account cannot reduce its FAQ count'
);

-- 25
SELECT lives_ok(
  $$
    INSERT INTO public.services (business_id, name)
    VALUES ('10000000-0000-4000-a000-000000000362', 'Service Three')
  $$,
  'a deficient legacy account can add its third service'
);

-- 26
SELECT lives_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer)
    VALUES ('10000000-0000-4000-a000-000000000362', 'Question Three?', 'Answer three.')
  $$,
  'a deficient legacy account can add its third FAQ'
);

INSERT INTO public.services (id, business_id, name, is_active)
VALUES (
  '20000000-0000-4000-a000-000000000375',
  '10000000-0000-4000-a000-000000000362',
  '',
  false
);
INSERT INTO public.faqs (id, business_id, question, answer, is_active)
VALUES (
  '30000000-0000-4000-a000-000000000375',
  '10000000-0000-4000-a000-000000000362',
  '',
  '',
  false
);

-- 27
SELECT lives_ok(
  $$
    DELETE FROM public.services
    WHERE id = '20000000-0000-4000-a000-000000000375'
  $$,
  'inactive invalid service cleanup does not affect the floor'
);

-- 28
SELECT lives_ok(
  $$
    DELETE FROM public.faqs
    WHERE id = '30000000-0000-4000-a000-000000000375'
  $$,
  'inactive invalid FAQ cleanup does not affect the floor'
);

-- Simulate historical active duplicates that predate migration 036. The
-- guard is disabled only for fixture construction.
ALTER TABLE public.services
  DISABLE TRIGGER guard_service_ai_knowledge_quality;
INSERT INTO public.services (id, business_id, name)
VALUES (
  '20000000-0000-4000-a000-000000000376',
  '10000000-0000-4000-a000-000000000362',
  ' renamed   SERVICE one '
);
ALTER TABLE public.services
  ENABLE TRIGGER guard_service_ai_knowledge_quality;

ALTER TABLE public.faqs
  DISABLE TRIGGER guard_faq_ai_knowledge_quality;
INSERT INTO public.faqs (id, business_id, question, answer)
VALUES (
  '30000000-0000-4000-a000-000000000376',
  '10000000-0000-4000-a000-000000000362',
  ' QUESTION one? ',
  'Historical duplicate.'
);
ALTER TABLE public.faqs
  ENABLE TRIGGER guard_faq_ai_knowledge_quality;

-- 29
SELECT lives_ok(
  $$
    DELETE FROM public.services
    WHERE id = '20000000-0000-4000-a000-000000000376'
  $$,
  'historical active service duplicate cleanup is non-worsening'
);

-- 30
SELECT lives_ok(
  $$
    DELETE FROM public.faqs
    WHERE id = '30000000-0000-4000-a000-000000000376'
  $$,
  'historical active FAQ duplicate cleanup is non-worsening'
);

INSERT INTO public.services (business_id, name)
VALUES
  ('10000000-0000-4000-a000-000000000363', 'Cleanup One'),
  ('10000000-0000-4000-a000-000000000363', 'Cleanup Two'),
  ('10000000-0000-4000-a000-000000000363', 'Cleanup Three');
INSERT INTO public.faqs (business_id, question, answer)
VALUES
  ('10000000-0000-4000-a000-000000000363', 'Cleanup One?', 'Yes.'),
  ('10000000-0000-4000-a000-000000000363', 'Cleanup Two?', 'Yes.'),
  ('10000000-0000-4000-a000-000000000363', 'Cleanup Three?', 'Yes.');
UPDATE public.businesses
SET onboarding_completed_at = now(),
    deleted_at = now(),
    deletion_scheduled_for = now() + interval '60 days'
WHERE id = '10000000-0000-4000-a000-000000000363';

-- 31
SELECT lives_ok(
  $$
    DELETE FROM public.services
    WHERE business_id = '10000000-0000-4000-a000-000000000363'
  $$,
  'tombstoned-account cleanup bypasses the service floor'
);

-- 32
SELECT lives_ok(
  $$
    DELETE FROM public.faqs
    WHERE business_id = '10000000-0000-4000-a000-000000000363'
  $$,
  'tombstoned-account cleanup bypasses the FAQ floor'
);

-- 33
SELECT lives_ok(
  $$
    SELECT public.replace_services_and_faqs(
      '10000000-0000-4000-a000-000000000364',
      '[
        {"name":"RPC Service One"},
        {"name":"RPC Service Two"},
        {"name":"RPC Service Three"}
      ]'::jsonb,
      '[
        {"question":"RPC Question One?","answer":"One.","source":"manual"},
        {"question":"RPC Question Two?","answer":"Two.","source":"manual"},
        {"question":"RPC Question Three?","answer":"Three.","source":"manual"}
      ]'::jsonb
    )
  $$,
  'the atomic onboarding replacement remains compatible'
);

-- 34
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a000-000000000364'
  ),
  3,
  'atomic onboarding replacement saves all three services'
);

-- 35
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.faqs
    WHERE business_id = '10000000-0000-4000-a000-000000000364'
  ),
  3,
  'atomic onboarding replacement saves all three FAQs'
);

-- ---------------------------------------------------------------------------
-- Ownership still comes from the existing RLS policies
-- ---------------------------------------------------------------------------

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a000-000000000361',
  true
);
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.services, public.faqs
  TO authenticated;
GRANT SELECT, UPDATE ON public.businesses TO authenticated;
SET LOCAL ROLE authenticated;

-- 36
SELECT lives_ok(
  $$
    INSERT INTO public.services (business_id, name)
    VALUES ('10000000-0000-4000-a000-000000000361', 'Owner Added Service')
  $$,
  'an owner can still add a valid service'
);

-- 37
SELECT lives_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer)
    VALUES ('10000000-0000-4000-a000-000000000361', 'Owner added question?', 'Yes.')
  $$,
  'an owner can still add a valid FAQ'
);

-- 38
SELECT throws_ok(
  $$
    INSERT INTO public.services (business_id, name)
    VALUES ('10000000-0000-4000-a000-000000000362', 'Foreign Service')
  $$,
  '42501',
  NULL,
  'service ownership RLS still rejects foreign writes'
);

-- 39
SELECT throws_ok(
  $$
    INSERT INTO public.faqs (business_id, question, answer)
    VALUES ('10000000-0000-4000-a000-000000000362', 'Foreign FAQ?', 'No.')
  $$,
  '42501',
  NULL,
  'FAQ ownership RLS still rejects foreign writes'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
