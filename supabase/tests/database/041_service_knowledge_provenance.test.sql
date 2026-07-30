BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(12);

-- ---------------------------------------------------------------------------
-- Catalog contract
-- ---------------------------------------------------------------------------

SELECT has_column(
  'public',
  'services',
  'source',
  'services record their knowledge source'
);

SELECT col_not_null(
  'public',
  'services',
  'source',
  'service knowledge source is required'
);

SELECT is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'services'
      AND column_name = 'source'
  ),
  '''manual''::text',
  'service knowledge defaults to manual'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint
    WHERE conrelid = 'public.services'::regclass
      AND conname = 'services_source_check'
      AND contype = 'c'
      AND convalidated IS TRUE
  ),
  1,
  'services enforce the allowed knowledge sources'
);

SELECT is(
  col_description(
    'public.services'::regclass,
    (
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'public.services'::regclass
        AND attname = 'source'
        AND NOT attisdropped
    )
  ),
  'Origin of the service knowledge: scraped, manual, or suggested. Existing and source-omitting rows default to manual.',
  'service source documents its provenance contract'
);

-- ---------------------------------------------------------------------------
-- Defaults and constraint behavior
-- ---------------------------------------------------------------------------

INSERT INTO public.businesses (
  id,
  name,
  business_type,
  slug
)
VALUES (
  '10000000-0000-4000-a000-000000000411',
  'Provenance Test',
  'general',
  'provenance-test-041'
);

INSERT INTO public.services (
  business_id,
  name
)
VALUES (
  '10000000-0000-4000-a000-000000000411',
  'Defaulted Service'
);

SELECT is(
  (
    SELECT source
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a000-000000000411'
      AND name = 'Defaulted Service'
  ),
  'manual',
  'source-omitting service inserts use the manual default'
);

SELECT throws_ok(
  $$
    INSERT INTO public.services (
      business_id,
      name,
      source
    )
    VALUES (
      '10000000-0000-4000-a000-000000000411',
      'Invalid Source',
      'imported'
    )
  $$,
  '23514',
  NULL,
  'services reject knowledge sources outside the approved set'
);

-- ---------------------------------------------------------------------------
-- Atomic replacement preserves and defaults both knowledge sources
-- ---------------------------------------------------------------------------

SELECT public.replace_services_and_faqs(
  '10000000-0000-4000-a000-000000000411',
  '[
    {
      "name": "Scanned Service",
      "description": "From the website",
      "price": "$50",
      "source": "scraped"
    },
    {
      "name": "Manual Fallback",
      "description": null,
      "price": null
    },
    {
      "name": "Suggested Service",
      "description": "Started from a suggestion",
      "price": null,
      "source": "suggested"
    }
  ]'::jsonb,
  '[
    {
      "question": "Suggested FAQ",
      "answer": "Suggested answer",
      "source": "suggested"
    },
    {
      "question": "Manual FAQ",
      "answer": "Manual answer"
    },
    {
      "question": "Scanned FAQ",
      "answer": "Scanned answer",
      "source": "scraped"
    }
  ]'::jsonb
);

SELECT results_eq(
  $$
    SELECT name, source
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a000-000000000411'
    ORDER BY name
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('Manual Fallback'::text, 'manual'::text),
        ('Scanned Service'::text, 'scraped'::text),
        ('Suggested Service'::text, 'suggested'::text)
    ) AS expected(name, source)
    ORDER BY name
  $$,
  'service replacement preserves supplied source and defaults omitted source'
);

SELECT results_eq(
  $$
    SELECT question, source
    FROM public.faqs
    WHERE business_id = '10000000-0000-4000-a000-000000000411'
    ORDER BY question
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('Manual FAQ'::text, 'manual'::text),
        ('Scanned FAQ'::text, 'scraped'::text),
        ('Suggested FAQ'::text, 'suggested'::text)
    ) AS expected(question, source)
    ORDER BY question
  $$,
  'FAQ replacement continues preserving supplied source and defaulting omitted source'
);

SELECT throws_ok(
  $$
    SELECT public.replace_services_and_faqs(
      '10000000-0000-4000-a000-000000000411',
      '[
        {
          "name": "Replacement Service",
          "description": null,
          "price": null,
          "source": "suggested"
        }
      ]'::jsonb,
      '[
        {
          "question": "Invalid FAQ",
          "answer": "This must roll back",
          "source": "imported"
        }
      ]'::jsonb
    )
  $$,
  '23514',
  NULL,
  'an invalid source rejects the complete atomic replacement'
);

SELECT results_eq(
  $$
    SELECT name, source
    FROM public.services
    WHERE business_id = '10000000-0000-4000-a000-000000000411'
    ORDER BY name
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('Manual Fallback'::text, 'manual'::text),
        ('Scanned Service'::text, 'scraped'::text),
        ('Suggested Service'::text, 'suggested'::text)
    ) AS expected(name, source)
    ORDER BY name
  $$,
  'a later FAQ source failure rolls back the service replacement'
);

SELECT results_eq(
  $$
    SELECT question, source
    FROM public.faqs
    WHERE business_id = '10000000-0000-4000-a000-000000000411'
    ORDER BY question
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('Manual FAQ'::text, 'manual'::text),
        ('Scanned FAQ'::text, 'scraped'::text),
        ('Suggested FAQ'::text, 'suggested'::text)
    ) AS expected(question, source)
    ORDER BY question
  $$,
  'an invalid replacement restores the previous FAQ rows'
);

SELECT * FROM finish();

ROLLBACK;
