BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(65);

-- ---------------------------------------------------------------------------
-- Catalog, authorization, and lifecycle contract
-- ---------------------------------------------------------------------------

-- 1
SELECT has_table(
  'public',
  'knowledge_gaps',
  'knowledge gaps have a durable aggregate table'
);

-- 2
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attname IN (
        'id',
        'business_id',
        'question_text',
        'normalized_question',
        'ai_response_text',
        'channel',
        'conversation_id',
        'source_message_id',
        'occurrence_count',
        'status',
        'resolved_faq_id',
        'created_at',
        'last_seen_at',
        'updated_at'
      )
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'business_id', 'uuid',
    'question_text', 'text',
    'normalized_question', 'text',
    'ai_response_text', 'text',
    'channel', 'text',
    'conversation_id', 'uuid',
    'source_message_id', 'uuid',
    'occurrence_count', 'bigint',
    'status', 'text',
    'resolved_faq_id', 'uuid',
    'created_at', 'timestamp with time zone',
    'last_seen_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'knowledge gaps have the exact approved column types'
);

-- 3
SELECT is(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  ARRAY[
    'ai_response_text',
    'business_id',
    'channel',
    'created_at',
    'id',
    'last_seen_at',
    'occurrence_count',
    'question_text',
    'status',
    'updated_at'
  ]::name[],
  'required aggregate and lifecycle fields are not nullable'
);

-- 4
SELECT ok(
  (
    SELECT attribute.attgenerated = 's'
      AND pg_get_expr(default_value.adbin, default_value.adrelid)
        = 'normalize_ai_knowledge_key(question_text)'
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attname = 'normalized_question'
  ),
  'normalized questions are stored generated knowledge keys'
);

-- 5
SELECT ok(
  (
    SELECT pg_get_expr(default_value.adbin, default_value.adrelid)
      = 'gen_random_uuid()'
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attname = 'id'
  )
  AND (
    SELECT pg_get_expr(default_value.adbin, default_value.adrelid) = '1'
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attname = 'occurrence_count'
  )
  AND (
    SELECT pg_get_expr(default_value.adbin, default_value.adrelid)
      = '''open''::text'
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.knowledge_gaps'::regclass
      AND attribute.attname = 'status'
  ),
  'knowledge gaps default to generated open single-occurrence rows'
);

-- 6
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.knowledge_gaps'::regclass
      AND constraint_row.conname IN (
        'knowledge_gaps_question_not_blank',
        'knowledge_gaps_response_not_blank',
        'knowledge_gaps_channel_check',
        'knowledge_gaps_occurrence_count_check',
        'knowledge_gaps_status_check',
        'knowledge_gaps_resolved_link_status_check'
      )
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  6,
  'all gap value and lifecycle checks are validated'
);

-- 7
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_class AS index_class
    JOIN pg_index AS index_row
      ON index_row.indexrelid = index_class.oid
    WHERE index_row.indrelid = 'public.knowledge_gaps'::regclass
      AND index_class.relname IN (
        'knowledge_gaps_open_business_question_unique',
        'knowledge_gaps_business_status_sort_idx',
        'knowledge_gaps_conversation_idx',
        'knowledge_gaps_source_message_idx',
        'knowledge_gaps_resolved_faq_idx'
      )
  ),
  5,
  'all gap deduplication, dashboard, and reference indexes exist'
);

-- 8
SELECT ok(
  (
    SELECT index_row.indisunique
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
        = '(status = ''open''::text)'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.knowledge_gaps_open_business_question_unique'::regclass
  ),
  'only open normalized questions deduplicate per business'
);

-- 9
SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.knowledge_gaps'::regclass
  ),
  'knowledge gaps have row-level security enabled'
);

-- 10
SELECT policies_are(
  'public',
  'knowledge_gaps',
  ARRAY['knowledge_gaps_select', 'knowledge_gaps_update'],
  'owners receive only read and lifecycle-update policies'
);

-- 11
SELECT ok(
  has_table_privilege('authenticated', 'public.knowledge_gaps', 'SELECT')
  AND NOT has_table_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'INSERT'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'DELETE'
  )
  AND NOT has_table_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'UPDATE'
  ),
  'authenticated owners can read but have no table-wide mutation privilege'
);

-- 12
SELECT ok(
  has_column_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'status',
    'UPDATE'
  )
  AND has_column_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'resolved_faq_id',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'question_text',
    'UPDATE'
  )
  AND NOT has_column_privilege(
    'authenticated',
    'public.knowledge_gaps',
    'ai_response_text',
    'UPDATE'
  ),
  'authenticated updates are limited to status and resolved FAQ linkage'
);

-- 13
SELECT ok(
  NOT has_table_privilege('anon', 'public.knowledge_gaps', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.knowledge_gaps', 'INSERT')
  AND NOT has_table_privilege('anon', 'public.knowledge_gaps', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.knowledge_gaps', 'DELETE'),
  'anonymous clients have no knowledge-gap table privileges'
);

-- 14
SELECT ok(
  has_table_privilege('service_role', 'public.knowledge_gaps', 'SELECT')
  AND has_table_privilege('service_role', 'public.knowledge_gaps', 'INSERT')
  AND has_table_privilege('service_role', 'public.knowledge_gaps', 'UPDATE')
  AND has_table_privilege('service_role', 'public.knowledge_gaps', 'DELETE'),
  'the server role can maintain knowledge gaps'
);

-- 15
SELECT has_function(
  'public',
  'record_knowledge_gap',
  ARRAY['uuid', 'uuid', 'text'],
  'the server capture RPC exists'
);

-- 16
SELECT has_function(
  'public',
  'resolve_knowledge_gap_with_faq',
  ARRAY['uuid', 'text', 'text'],
  'the atomic FAQ conversion RPC exists'
);

-- 17
SELECT ok(
  (
    SELECT bool_and(NOT procedure_row.prosecdef)
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid IN (
      'public.record_knowledge_gap(uuid,uuid,text)'::regprocedure,
      'public.resolve_knowledge_gap_with_faq(uuid,text,text)'::regprocedure
    )
  ),
  'capture and conversion execute with invoker permissions'
);

-- 18
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.record_knowledge_gap(uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_knowledge_gap(uuid,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.record_knowledge_gap(uuid,uuid,text)',
    'EXECUTE'
  ),
  'only the service role can call the capture RPC'
);

-- 19
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_knowledge_gap_with_faq(uuid,text,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.resolve_knowledge_gap_with_faq(uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.resolve_knowledge_gap_with_faq(uuid,text,text)',
    'EXECUTE'
  ),
  'owners and the server can convert gaps while anonymous clients cannot'
);

-- 20
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.guard_knowledge_gap_mutation()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_knowledge_gap_mutation()',
    'EXECUTE'
  ),
  'the mutation guard is trigger-only'
);

-- 21
SELECT has_trigger(
  'public',
  'knowledge_gaps',
  'guard_knowledge_gap_mutation',
  'knowledge-gap relationships and terminal states have a mutation guard'
);

-- ---------------------------------------------------------------------------
-- Tenant fixtures and server-side capture
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a042-000000000001',
    'knowledge-gap-a@example.test'
  ),
  (
    '00000000-0000-4000-a042-000000000002',
    'knowledge-gap-b@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a042-000000000001',
    name = 'Knowledge Gap A',
    slug = 'knowledge-gap-a-042'
WHERE owner_id = '00000000-0000-4000-a042-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a042-000000000002',
    name = 'Knowledge Gap B',
    slug = 'knowledge-gap-b-042'
WHERE owner_id = '00000000-0000-4000-a042-000000000002';

INSERT INTO public.conversations (
  id,
  business_id,
  channel
)
VALUES
  (
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'sms'
  ),
  (
    '20000000-0000-4000-a042-000000000002',
    '10000000-0000-4000-a042-000000000001',
    'web_chat'
  ),
  (
    '20000000-0000-4000-a042-000000000003',
    '10000000-0000-4000-a042-000000000002',
    'sms'
  );

INSERT INTO public.messages (
  id,
  conversation_id,
  business_id,
  role,
  content,
  channel
)
VALUES
  (
    '30000000-0000-4000-a042-000000000001',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'Do you offer free trials?',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000002',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    E'  DO YOU\tOFFER FREE TRIALS?  ',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000003',
    '20000000-0000-4000-a042-000000000002',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'do you offer free trials?',
    'web_chat'
  ),
  (
    '30000000-0000-4000-a042-000000000004',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'Do you provide financing?',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000005',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'assistant',
    'I do not see financing mentioned.',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000006',
    '20000000-0000-4000-a042-000000000003',
    '10000000-0000-4000-a042-000000000002',
    'customer',
    'Do you offer free trials?',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000007',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'Do you offer free trials?',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000008',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'Do you offer free trials?',
    'sms'
  ),
  (
    '30000000-0000-4000-a042-000000000009',
    '20000000-0000-4000-a042-000000000001',
    '10000000-0000-4000-a042-000000000001',
    'customer',
    'Do you offer coupons?',
    'sms'
  );

INSERT INTO public.faqs (
  id,
  business_id,
  question,
  answer,
  source
)
VALUES (
  '40000000-0000-4000-a042-000000000001',
  '10000000-0000-4000-a042-000000000002',
  'Foreign FAQ?',
  'Foreign answer.',
  'manual'
);

CREATE TEMP TABLE gap_042_state (
  name text PRIMARY KEY,
  uuid_value uuid NOT NULL
) ON COMMIT DROP;

GRANT SELECT ON gap_042_state TO authenticated;

-- 22
SELECT throws_ok(
  $$
    SELECT public.record_knowledge_gap(
      '10000000-0000-4000-a042-000000000001',
      '30000000-0000-4000-a042-000000000006',
      'I do not see free trials mentioned.'
    )
  $$,
  '22023',
  'Source customer message was not found for this business',
  'capture rejects a source message owned by another business'
);

-- 23
SELECT throws_ok(
  $$
    SELECT public.record_knowledge_gap(
      '10000000-0000-4000-a042-000000000001',
      '30000000-0000-4000-a042-000000000005',
      'I do not see financing mentioned.'
    )
  $$,
  '22023',
  'Source customer message was not found for this business',
  'capture requires a customer source message'
);

-- 24
SELECT throws_ok(
  $$
    SELECT public.record_knowledge_gap(
      '10000000-0000-4000-a042-000000000001',
      '30000000-0000-4000-a042-000000000001',
      E' \t\n '
    )
  $$,
  '22023',
  'Knowledge-gap AI response cannot be blank',
  'capture rejects a blank customer-visible response'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'trial_original',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000001',
    'I do not see free trials mentioned. Please call us.'
  );

-- 25
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  ),
  1,
  'the capture RPC creates one durable gap'
);

-- 26
SELECT is(
  (
    SELECT normalized_question
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  ),
  'do you offer free trials?',
  'captured questions use the shared exact-normalization key'
);

-- 27
SELECT results_eq(
  $$
    SELECT
      status,
      occurrence_count,
      channel,
      conversation_id,
      source_message_id,
      ai_response_text
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES (
      'open'::text,
      1::bigint,
      'sms'::text,
      '20000000-0000-4000-a042-000000000001'::uuid,
      '30000000-0000-4000-a042-000000000001'::uuid,
      'I do not see free trials mentioned. Please call us.'::text
    )
  $$,
  'a new capture retains its initial lifecycle and latest-message metadata'
);

-- 28
SELECT is(
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000001',
    'A retry must not rewrite this response.'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  ),
  'a replayed source message returns its original gap id'
);

-- 29
SELECT results_eq(
  $$
    SELECT occurrence_count, ai_response_text
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES (
      1::bigint,
      'I do not see free trials mentioned. Please call us.'::text
    )
  $$,
  'a replayed source message neither increments nor rewrites its aggregate'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'trial_sms_repeat',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000002',
    'Trial details are not in our current info. Please email us.'
  );

-- 30
SELECT is(
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_sms_repeat'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  ),
  'a normalized repeat merges into the existing open aggregate'
);

-- 31
SELECT results_eq(
  $$
    SELECT
      occurrence_count,
      question_text,
      ai_response_text,
      source_message_id
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES (
      2::bigint,
      E'  DO YOU\tOFFER FREE TRIALS?  '::text,
      'Trial details are not in our current info. Please email us.'::text,
      '30000000-0000-4000-a042-000000000002'::uuid
    )
  $$,
  'a repeat increments once and refreshes the latest question and response'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'trial_web_repeat',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000003',
    'I do not see trial information. Please contact us.'
  );

-- 32
SELECT is(
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_web_repeat'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  ),
  'open deduplication spans SMS and web chat'
);

-- 33
SELECT results_eq(
  $$
    SELECT
      occurrence_count,
      channel,
      conversation_id,
      source_message_id
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES (
      3::bigint,
      'web_chat'::text,
      '20000000-0000-4000-a042-000000000002'::uuid,
      '30000000-0000-4000-a042-000000000003'::uuid
    )
  $$,
  'the aggregate exposes metadata from its latest occurrence'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'financing',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000004',
    'I do not see financing mentioned. Please call us.'
  );

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'foreign_trial',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000002',
    '30000000-0000-4000-a042-000000000006',
    'I do not see free trials mentioned. Please call us.'
  );

-- 34
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.knowledge_gaps
    WHERE normalized_question = 'do you offer free trials?'
      AND status = 'open'
  ),
  2,
  'the same normalized question remains independent across businesses'
);

-- 35
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id,
      question_text,
      ai_response_text,
      channel,
      conversation_id
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Mismatched conversation?',
      'Unknown.',
      'sms',
      '20000000-0000-4000-a042-000000000003'
    )
  $$,
  '23514',
  'Knowledge-gap conversation does not match its business and channel',
  'the guard rejects cross-business conversation references'
);

-- 36
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id,
      question_text,
      ai_response_text,
      channel,
      conversation_id,
      source_message_id
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Mismatched message?',
      'Unknown.',
      'sms',
      '20000000-0000-4000-a042-000000000001',
      '30000000-0000-4000-a042-000000000005'
    )
  $$,
  '23514',
  'Knowledge-gap source message does not match its business, conversation, and channel',
  'the guard requires a matching customer source message'
);

-- 37
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id,
      question_text,
      ai_response_text,
      channel,
      status,
      resolved_faq_id
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Foreign resolution?',
      'Unknown.',
      'sms',
      'resolved',
      '40000000-0000-4000-a042-000000000001'
    )
  $$,
  '23514',
  'Knowledge-gap FAQ does not belong to the same business',
  'the guard rejects cross-business resolution links'
);

-- 38
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      E' \t\n ',
      'Unknown.',
      'sms'
    )
  $$,
  '23514',
  NULL,
  'knowledge-gap questions cannot be blank'
);

-- 39
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Question?',
      E' \t\n ',
      'sms'
    )
  $$,
  '23514',
  NULL,
  'knowledge-gap responses cannot be blank'
);

-- 40
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Question?',
      'Unknown.',
      'email'
    )
  $$,
  '23514',
  NULL,
  'knowledge gaps accept only shared-engine channels'
);

-- 41
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id,
      question_text,
      ai_response_text,
      channel,
      occurrence_count
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Question?',
      'Unknown.',
      'sms',
      0
    )
  $$,
  '23514',
  NULL,
  'knowledge-gap occurrence counts remain positive'
);

-- 42
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel, status
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Question?',
      'Unknown.',
      'sms',
      'ignored'
    )
  $$,
  '23514',
  NULL,
  'knowledge gaps accept only the approved lifecycle statuses'
);

-- 43
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel, status
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Unlinked resolution?',
      'Unknown.',
      'sms',
      'resolved'
    )
  $$,
  '23514',
  'A newly resolved knowledge gap must link an FAQ',
  'new resolved rows must link an FAQ'
);

-- ---------------------------------------------------------------------------
-- Owner RLS, restricted updates, conversion, and terminal repetition
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA extensions TO authenticated;
-- These are the pre-existing owner permissions used by the Settings FAQ write
-- path, dashboard conversation reads, and the businesses-based RLS policies.
-- The assertions above verify that migration 042 itself grants only the two
-- lifecycle UPDATE columns on knowledge_gaps.
GRANT SELECT ON public.businesses TO authenticated;
-- Migration 036's SECURITY INVOKER FAQ guard uses SELECT ... FOR UPDATE on
-- the owning business row to serialize duplicate checks. PostgreSQL therefore
-- requires UPDATE on at least one business column; id is sufficient here.
GRANT UPDATE (id) ON public.businesses TO authenticated;
GRANT SELECT, INSERT ON public.faqs TO authenticated;
GRANT SELECT ON public.conversations, public.messages TO authenticated;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a042-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- 44
SELECT is(
  (SELECT count(*)::integer FROM public.knowledge_gaps),
  2,
  'an owner sees only their own knowledge gaps'
);

-- 45
SELECT throws_ok(
  $$
    INSERT INTO public.knowledge_gaps (
      business_id, question_text, ai_response_text, channel
    )
    VALUES (
      '10000000-0000-4000-a042-000000000001',
      'Forged gap?',
      'Forged response.',
      'sms'
    )
  $$,
  '42501',
  NULL,
  'owners cannot forge knowledge-gap captures'
);

-- 46
SELECT throws_ok(
  $$
    UPDATE public.knowledge_gaps
    SET question_text = 'Rewritten customer question'
    WHERE id = (
      SELECT uuid_value
      FROM pg_temp.gap_042_state
      WHERE name = 'financing'
    )
  $$,
  '42501',
  NULL,
  'owners cannot rewrite captured customer content'
);

-- 47
SELECT lives_ok(
  $$
    UPDATE public.knowledge_gaps
    SET status = 'dismissed'
    WHERE id = (
      SELECT uuid_value
      FROM pg_temp.gap_042_state
      WHERE name = 'financing'
    )
      AND status = 'open'
  $$,
  'owners can use their column-level status grant to dismiss an open gap'
);

-- 48
SELECT throws_ok(
  $$
    UPDATE public.knowledge_gaps
    SET status = 'open'
    WHERE id = (
      SELECT uuid_value
      FROM pg_temp.gap_042_state
      WHERE name = 'financing'
    )
  $$,
  '23514',
  'Terminal knowledge-gap statuses cannot be reopened',
  'terminal knowledge-gap rows cannot be reopened in place'
);

-- 49
SELECT lives_ok(
  $$
    SELECT public.resolve_knowledge_gap_with_faq(
      (
        SELECT uuid_value
        FROM pg_temp.gap_042_state
        WHERE name = 'trial_original'
      ),
      '  Do you offer free trials?  ',
      '  We offer a fourteen-day trial.  '
    )
  $$,
  'an authenticated owner can convert through the invoker RPC with only lifecycle-column UPDATE grants'
);

RESET ROLE;

-- 50
SELECT results_eq(
  $$
    SELECT gap.status, faq.id IS NOT NULL
    FROM public.knowledge_gaps AS gap
    LEFT JOIN public.faqs AS faq
      ON faq.id = gap.resolved_faq_id
    WHERE gap.id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES ('resolved'::text, true)
  $$,
  'conversion atomically resolves and links the gap'
);

-- 51
SELECT results_eq(
  $$
    SELECT
      faq.business_id,
      faq.question,
      faq.answer,
      faq.source,
      faq.is_active
    FROM public.faqs AS faq
    JOIN public.knowledge_gaps AS gap
      ON gap.resolved_faq_id = faq.id
    WHERE gap.id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a042-000000000001'::uuid,
      'Do you offer free trials?'::text,
      'We offer a fourteen-day trial.'::text,
      'suggested'::text,
      true
    )
  $$,
  'conversion creates a trimmed active suggested FAQ for the same business'
);

-- 52
SELECT is(
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000003',
    'A delayed retry must not create another gap.'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  ),
  'same-source idempotence survives after the aggregate becomes terminal'
);

-- 53
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000001'
      AND normalized_question = 'do you offer free trials?'
  ),
  1,
  'a terminal same-source replay does not create a false new occurrence'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'trial_after_resolution',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000007',
    'I still do not see trial information. Please contact us.'
  );

-- 54
SELECT isnt(
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_after_resolution'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  ),
  'a new customer message after resolution creates a new open aggregate'
);

-- 55
SELECT results_eq(
  $$
    SELECT status, count(*)::bigint
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000001'
      AND normalized_question = 'do you offer free trials?'
    GROUP BY status
    ORDER BY status
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('open'::text, 1::bigint),
        ('resolved'::text, 1::bigint)
    ) AS expected(status, aggregate_count)
    ORDER BY status
  $$,
  'partial uniqueness preserves resolved history beside the new open aggregate'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a042-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- 56
SELECT throws_ok(
  $$
    SELECT public.resolve_knowledge_gap_with_faq(
      (
        SELECT uuid_value
        FROM pg_temp.gap_042_state
        WHERE name = 'trial_after_resolution'
      ),
      'Do you offer free trials?',
      'A duplicate answer.'
    )
  $$,
  '23505',
  'An active FAQ with the same normalized question already exists',
  'duplicate FAQ conversion fails through the existing normalized guard'
);

RESET ROLE;

-- 57
SELECT is(
  (
    SELECT status
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_after_resolution'
    )
  ),
  'open',
  'a failed duplicate conversion rolls back the gap lifecycle update'
);

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'coupon',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000009',
    'I do not see coupons mentioned. Please contact us.'
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a042-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- 58
SELECT throws_ok(
  $$
    SELECT public.resolve_knowledge_gap_with_faq(
      (
        SELECT uuid_value
        FROM pg_temp.gap_042_state
        WHERE name = 'coupon'
      ),
      'Do you offer coupons?',
      repeat('x', 2001)
    )
  $$,
  '23514',
  'Active FAQ answer cannot exceed 2000 characters',
  'conversion enforces the existing active FAQ answer limit'
);

RESET ROLE;

-- 59
SELECT is(
  (
    SELECT status
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'coupon'
    )
  ),
  'open',
  'invalid FAQ content leaves its gap open'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a042-000000000002',
  true
);
SET LOCAL ROLE authenticated;

-- 60
SELECT is(
  (SELECT count(*)::integer FROM public.knowledge_gaps),
  1,
  'a second owner sees only the second business gap'
);

-- 61
SELECT throws_ok(
  $$
    SELECT public.resolve_knowledge_gap_with_faq(
      (
        SELECT uuid_value
        FROM pg_temp.gap_042_state
        WHERE name = 'trial_after_resolution'
      ),
      'Stolen question?',
      'Stolen answer.'
    )
  $$,
  'P0002',
  'Knowledge gap is not open or is not accessible',
  'an owner cannot convert another business knowledge gap'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a042-000000000001',
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.knowledge_gaps
SET status = 'dismissed'
WHERE id = (
  SELECT uuid_value
  FROM pg_temp.gap_042_state
  WHERE name = 'trial_after_resolution'
);

RESET ROLE;

INSERT INTO gap_042_state (name, uuid_value)
SELECT
  'trial_after_dismissal',
  public.record_knowledge_gap(
    '10000000-0000-4000-a042-000000000001',
    '30000000-0000-4000-a042-000000000008',
    'Trial information is still unresolved. Please contact us.'
  );

-- 62
SELECT isnt(
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_after_dismissal'
  ),
  (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_after_resolution'
  ),
  'a new customer message after dismissal creates a new open aggregate'
);

-- 63
SELECT results_eq(
  $$
    SELECT status, count(*)::bigint
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000001'
      AND normalized_question = 'do you offer free trials?'
    GROUP BY status
    ORDER BY status
  $$,
  $$
    SELECT *
    FROM (
      VALUES
        ('dismissed'::text, 1::bigint),
        ('open'::text, 1::bigint),
        ('resolved'::text, 1::bigint)
    ) AS expected(status, aggregate_count)
    ORDER BY status
  $$,
  'resolved and dismissed history remains beside the latest open aggregate'
);

DELETE FROM public.faqs
WHERE id = (
  SELECT resolved_faq_id
  FROM public.knowledge_gaps
  WHERE id = (
    SELECT uuid_value
    FROM gap_042_state
    WHERE name = 'trial_original'
  )
);

-- 64
SELECT results_eq(
  $$
    SELECT status, resolved_faq_id
    FROM public.knowledge_gaps
    WHERE id = (
      SELECT uuid_value
      FROM gap_042_state
      WHERE name = 'trial_original'
    )
  $$,
  $$
    VALUES ('resolved'::text, NULL::uuid)
  $$,
  'deleting a converted FAQ preserves resolved history and clears its link'
);

-- 65
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.knowledge_gaps
    WHERE business_id = '10000000-0000-4000-a042-000000000001'
      AND status = 'open'
  ),
  2,
  'the owner dashboard retains the expected open trial and coupon gaps'
);

SELECT * FROM finish();

ROLLBACK;
