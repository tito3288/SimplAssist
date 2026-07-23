BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(20);

-- ---------------------------------------------------------------------------
-- Exact catalog shape
-- ---------------------------------------------------------------------------

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_index AS index_row
    JOIN pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_class.relnamespace
    WHERE index_namespace.nspname = 'public'
      AND index_class.relname =
            'telnyx_registration_events_active_create_intent_unique'
      AND index_row.indrelid =
            'public.telnyx_registration_events'::regclass
  ),
  1,
  'the active create-intent index exists exactly once on the audit table'
);

SELECT ok(
  (
    SELECT index_row.indisunique
       AND index_row.indisvalid
       AND index_row.indisready
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  'the active create-intent index is unique, valid, and ready'
);

SELECT is(
  (
    SELECT access_method.amname
    FROM pg_index AS index_row
    JOIN pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    JOIN pg_am AS access_method
      ON access_method.oid = index_class.relam
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  'btree',
  'the active create-intent fence uses a btree index'
);

SELECT ok(
  (
    SELECT index_row.indnkeyatts = 2
       AND index_row.indnatts = 2
       AND index_row.indexprs IS NULL
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  'the index has exactly two plain key columns and no INCLUDE columns'
);

SELECT is(
  (
    SELECT pg_get_indexdef(index_row.indexrelid, 1, true)
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  'business_id',
  'business_id is the first create-intent fence key'
);

SELECT is(
  (
    SELECT pg_get_indexdef(index_row.indexrelid, 2, true)
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  'event_type',
  'event_type is the second create-intent fence key'
);

SELECT is(
  (
    SELECT pg_get_expr(index_row.indpred, index_row.indrelid)
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.telnyx_registration_events_active_create_intent_unique'::regclass
  ),
  '((status = ''started''::text) AND (event_type = ANY (ARRAY[''messaging_profile_create_intent''::text, ''voice_application_create_intent''::text])))',
  'the partial predicate covers only unresolved profile and voice create intents'
);

SELECT is(
  obj_description(
    'public.telnyx_registration_events_active_create_intent_unique'::regclass,
    'pg_class'
  ),
  'Allows only one unresolved Telnyx profile/voice create intent per business and resource kind.',
  'the index documents its unresolved-intent safety boundary'
);

-- ---------------------------------------------------------------------------
-- Isolated businesses for behavioral checks
-- ---------------------------------------------------------------------------

INSERT INTO public.businesses (
  id,
  owner_id,
  name,
  slug,
  business_type
) VALUES
  (
    '10000000-0000-4000-a035-000000000001',
    NULL,
    'Create Intent Fence A',
    'create-intent-fence-a-035',
    'general'
  ),
  (
    '10000000-0000-4000-a035-000000000002',
    NULL,
    'Create Intent Fence B',
    'create-intent-fence-b-035',
    'general'
  );

-- ---------------------------------------------------------------------------
-- Predicate and uniqueness behavior
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000001',
      'messaging_profile_create_intent',
      'messaging_profile',
      'started'
    )
  $$,
  'the first unresolved messaging-profile create intent is accepted'
);

SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000001',
      'messaging_profile_create_intent',
      'messaging_profile',
      'started'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "telnyx_registration_events_active_create_intent_unique"',
  'a business cannot hold two unresolved messaging-profile create intents'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000001',
      'voice_application_create_intent',
      'voice_application',
      'started'
    )
  $$,
  'one unresolved voice intent may coexist with a profile intent'
);

SELECT throws_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000001',
      'voice_application_create_intent',
      'voice_application',
      'started'
    )
  $$,
  '23505',
  'duplicate key value violates unique constraint "telnyx_registration_events_active_create_intent_unique"',
  'a business cannot hold two unresolved voice-application create intents'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000002',
      'messaging_profile_create_intent',
      'messaging_profile',
      'started'
    )
  $$,
  'a different business receives its own profile create-intent slot'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES
      (
        '10000000-0000-4000-a035-000000000001',
        'messaging_profile_create_intent',
        'messaging_profile',
        'resolved'
      ),
      (
        '10000000-0000-4000-a035-000000000001',
        'messaging_profile_create_intent',
        'messaging_profile',
        'resolved'
      )
  $$,
  'resolved create-intent history remains append-only and non-unique'
);

SELECT lives_ok(
  $$
    UPDATE public.telnyx_registration_events
    SET status = 'resolved'
    WHERE business_id = '10000000-0000-4000-a035-000000000001'
      AND event_type = 'messaging_profile_create_intent'
      AND status = 'started'
  $$,
  'resolving the active profile intent releases its unique slot'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES (
      '10000000-0000-4000-a035-000000000001',
      'messaging_profile_create_intent',
      'messaging_profile',
      'started'
    )
  $$,
  'a new profile attempt is accepted after the prior intent resolves'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES
      (
        '10000000-0000-4000-a035-000000000001',
        'campaign_preflight_checked',
        'campaign',
        'started'
      ),
      (
        '10000000-0000-4000-a035-000000000001',
        'campaign_preflight_checked',
        'campaign',
        'started'
      )
  $$,
  'unrelated started audit events are outside the create-intent fence'
);

SELECT lives_ok(
  $$
    INSERT INTO public.telnyx_registration_events (
      business_id,
      event_type,
      telnyx_resource_type,
      status
    ) VALUES
      (
        '10000000-0000-4000-a035-000000000001',
        'voice_application_create_intent',
        'voice_application',
        NULL
      ),
      (
        '10000000-0000-4000-a035-000000000001',
        'voice_application_create_intent',
        'voice_application',
        NULL
      )
  $$,
  'non-started voice intent history is outside the create-intent fence'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.telnyx_registration_events
    WHERE business_id = '10000000-0000-4000-a035-000000000001'
      AND status = 'started'
      AND event_type IN (
        'messaging_profile_create_intent',
        'voice_application_create_intent'
      )
  ),
  2,
  'the first business retains exactly one active intent per protected kind'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.telnyx_registration_events
    WHERE business_id = '10000000-0000-4000-a035-000000000002'
      AND status = 'started'
      AND event_type = 'messaging_profile_create_intent'
  ),
  1,
  'the second business retains its independent active profile intent'
);

SELECT * FROM finish();

ROLLBACK;
