BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(53);

-- ---------------------------------------------------------------------------
-- Catalog shape, defaults, constraints, indexes, RLS, and grants
-- ---------------------------------------------------------------------------

SELECT has_table(
  'public',
  'waitlist_signups',
  'Full Suite waitlist signup table exists'
);

SELECT col_is_pk(
  'public',
  'waitlist_signups',
  'id',
  'waitlist signup id is the primary key'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute_row.attname,
      format_type(attribute_row.atttypid, attribute_row.atttypmod)
    )
    FROM pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = 'public.waitlist_signups'::regclass
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'email', 'text',
    'feature_interest', 'text',
    'created_at', 'timestamp with time zone',
    'notified_at', 'timestamp with time zone',
    'unsubscribed_at', 'timestamp with time zone',
    'launch_send_claim_token', 'uuid',
    'launch_send_claimed_at', 'timestamp with time zone'
  ),
  'waitlist columns have the exact intended types'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute_row.attname,
      attribute_row.attnotnull
    )
    FROM pg_attribute AS attribute_row
    WHERE attribute_row.attrelid = 'public.waitlist_signups'::regclass
      AND attribute_row.attnum > 0
      AND NOT attribute_row.attisdropped
  ),
  jsonb_build_object(
    'id', true,
    'email', true,
    'feature_interest', false,
    'created_at', true,
    'notified_at', false,
    'unsubscribed_at', false,
    'launch_send_claim_token', false,
    'launch_send_claimed_at', false
  ),
  'only signup identity, email, and creation time are required'
);

SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute_row.attname,
      pg_get_expr(default_row.adbin, default_row.adrelid)
    )
    FROM pg_attribute AS attribute_row
    JOIN pg_attrdef AS default_row
      ON default_row.adrelid = attribute_row.attrelid
     AND default_row.adnum = attribute_row.attnum
    WHERE attribute_row.attrelid = 'public.waitlist_signups'::regclass
  ),
  jsonb_build_object(
    'id', 'gen_random_uuid()',
    'created_at', 'now()'
  ),
  'only id and created_at have database defaults'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.waitlist_signups'::regclass
      AND constraint_row.conname IN (
        'waitlist_signups_email_normalized',
        'waitlist_signups_email_unique',
        'waitlist_signups_launch_claim_shape'
      )
  ),
  3,
  'all named waitlist invariants exist'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.waitlist_signups'::regclass
      AND constraint_row.conname = 'waitlist_signups_email_unique'
      AND constraint_row.contype = 'u'
      AND constraint_row.conkey = ARRAY[
        (
          SELECT attribute_row.attnum
          FROM pg_attribute AS attribute_row
          WHERE attribute_row.attrelid =
                  'public.waitlist_signups'::regclass
            AND attribute_row.attname = 'email'
        )
      ]::smallint[]
  ),
  'normalized email is globally unique'
);

SELECT ok(
  (
    SELECT constraint_row.contype = 'c'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%email = lower(btrim(email))%'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%char_length(email) >= 3%'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%char_length(email) <= 320%'
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.waitlist_signups'::regclass
      AND constraint_row.conname = 'waitlist_signups_email_normalized'
  ),
  'email normalization and length are database-enforced'
);

SELECT ok(
  (
    SELECT constraint_row.contype = 'c'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%launch_send_claim_token IS NULL%'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%launch_send_claimed_at IS NULL%'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%launch_send_claim_token IS NOT NULL%'
       AND pg_get_constraintdef(constraint_row.oid)
             LIKE '%launch_send_claimed_at IS NOT NULL%'
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.waitlist_signups'::regclass
      AND constraint_row.conname = 'waitlist_signups_launch_claim_shape'
  ),
  'launch claim token and timestamp are all-null or all-present'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_row.indrelid = 'public.waitlist_signups'::regclass
      AND index_class.relname = 'waitlist_signups_created_at_idx'
      AND NOT index_row.indisunique
      AND index_row.indpred IS NULL
      AND pg_get_indexdef(index_row.indexrelid) LIKE '%(created_at DESC)%'
  ),
  'newest-first waitlist index exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_index AS index_row
    JOIN pg_class AS index_class
      ON index_class.oid = index_row.indexrelid
    WHERE index_row.indrelid = 'public.waitlist_signups'::regclass
      AND index_class.relname = 'waitlist_signups_pending_idx'
      AND NOT index_row.indisunique
      AND pg_get_indexdef(index_row.indexrelid) LIKE '%(created_at, id)%'
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
            LIKE '%notified_at IS NULL%'
      AND pg_get_expr(index_row.indpred, index_row.indrelid)
            LIKE '%unsubscribed_at IS NULL%'
  ),
  'pending-recipient index covers ordered eligible signups'
);

SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.waitlist_signups'::regclass
  ),
  'RLS is enabled on waitlist signups'
);

SELECT is(
  (
    SELECT count(*)::bigint
    FROM pg_policy AS policy_row
    WHERE policy_row.polrelid = 'public.waitlist_signups'::regclass
  ),
  0::bigint,
  'the service-only waitlist table has no RLS policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid = 'public.waitlist_signups'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC has no waitlist table privileges'
);

SELECT table_privs_are(
  'public',
  'waitlist_signups',
  'anon',
  ARRAY[]::name[],
  'anon has no waitlist table privileges'
);

SELECT table_privs_are(
  'public',
  'waitlist_signups',
  'authenticated',
  ARRAY[]::name[],
  'authenticated has no waitlist table privileges'
);

SELECT table_privs_are(
  'public',
  'waitlist_signups',
  'service_role',
  ARRAY['INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has only the intended waitlist table privileges'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
      AND procedure_row.pronargs = 2
      AND procedure_row.proargtypes = '2950 2950'::oidvector
  ),
  3,
  'all three waitlist launch-send RPCs have stable uuid signatures'
);

SELECT ok(
  (
    SELECT count(*) = 3
       AND bool_and(
         CASE procedure_row.proname
           WHEN 'claim_waitlist_launch_send'
             THEN procedure_row.proretset
                  AND procedure_row.prorettype = 'record'::regtype
           ELSE
             NOT procedure_row.proretset
             AND procedure_row.prorettype = 'boolean'::regtype
         END
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
  ),
  'claim returns one eligible row while complete and release return booleans'
);

SELECT ok(
  (
    SELECT count(*) = 3
       AND bool_and(NOT procedure_row.prosecdef)
       AND bool_and(
         procedure_row.proconfig @>
           ARRAY['search_path=public, pg_temp']::text[]
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
  ),
  'waitlist RPCs are SECURITY INVOKER with a fixed search path'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        procedure_row.proacl,
        acldefault('f', procedure_row.proowner)
      )
    ) AS acl_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
      AND acl_row.grantee = 0
  ),
  'PUBLIC cannot execute waitlist launch-send RPCs'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
      AND has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
  ),
  'anon cannot execute waitlist launch-send RPCs'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
      AND has_function_privilege(
        'authenticated',
        procedure_row.oid,
        'EXECUTE'
      )
  ),
  'authenticated cannot execute waitlist launch-send RPCs'
);

SELECT ok(
  (
    SELECT count(*) = 3
       AND bool_and(
         has_function_privilege(
           'service_role',
           procedure_row.oid,
           'EXECUTE'
         )
       )
    FROM pg_proc AS procedure_row
    WHERE procedure_row.pronamespace = 'public'::regnamespace
      AND procedure_row.proname IN (
        'claim_waitlist_launch_send',
        'complete_waitlist_launch_send',
        'release_waitlist_launch_send'
      )
  ),
  'service_role can execute every waitlist launch-send RPC'
);

SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT count(*) FROM public.waitlist_signups$$,
  '42501',
  NULL,
  'authenticated receives a runtime table-permission denial'
);
RESET ROLE;

SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT count(*) FROM public.waitlist_signups$$,
  '42501',
  NULL,
  'anon receives a runtime table-permission denial'
);
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT lives_ok(
  $$SELECT count(*) FROM public.waitlist_signups$$,
  'service_role can read the RLS-protected waitlist table'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Normalization, defaults, and constraint behavior
-- ---------------------------------------------------------------------------

SELECT lives_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES ('defaults@example.test')
  $$,
  'a normalized email can be inserted without optional fields'
);

SELECT ok(
  (
    SELECT id IS NOT NULL
       AND created_at > clock_timestamp() - interval '5 seconds'
       AND created_at <= clock_timestamp()
       AND feature_interest IS NULL
       AND notified_at IS NULL
       AND unsubscribed_at IS NULL
       AND launch_send_claim_token IS NULL
       AND launch_send_claimed_at IS NULL
    FROM public.waitlist_signups
    WHERE email = 'defaults@example.test'
  ),
  'database defaults create a pending signup with private claim fields clear'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES ('Uppercase@example.test')
  $$,
  '23514',
  NULL,
  'uppercase email is rejected at the database boundary'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES (' leading-space@example.test')
  $$,
  '23514',
  NULL,
  'untrimmed email is rejected at the database boundary'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES ('ab')
  $$,
  '23514',
  NULL,
  'emails shorter than three characters are rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES (repeat('a', 321))
  $$,
  '23514',
  NULL,
  'emails longer than 320 characters are rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (email)
    VALUES ('defaults@example.test')
  $$,
  '23505',
  NULL,
  'duplicate normalized email is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (
      email,
      launch_send_claim_token
    ) VALUES (
      'partial-token@example.test',
      '40000000-0000-4000-a040-000000000001'
    )
  $$,
  '23514',
  NULL,
  'a launch claim token without its timestamp is rejected'
);

SELECT throws_ok(
  $$
    INSERT INTO public.waitlist_signups (
      email,
      launch_send_claimed_at
    ) VALUES (
      'partial-time@example.test',
      now()
    )
  $$,
  '23514',
  NULL,
  'a launch claim timestamp without its token is rejected'
);

INSERT INTO public.waitlist_signups (
  id,
  email,
  feature_interest
) VALUES (
  '40000000-0000-4000-a040-000000000010',
  'claim@example.test',
  'full_suite'
);

INSERT INTO public.waitlist_signups (
  id,
  email,
  notified_at
) VALUES (
  '40000000-0000-4000-a040-000000000020',
  'notified@example.test',
  now()
);

INSERT INTO public.waitlist_signups (
  id,
  email,
  unsubscribed_at
) VALUES (
  '40000000-0000-4000-a040-000000000030',
  'unsubscribed@example.test',
  now()
);

-- ---------------------------------------------------------------------------
-- Claim ownership, completion, release, and recipient eligibility
-- ---------------------------------------------------------------------------

SET LOCAL ROLE service_role;

SELECT throws_ok(
  $$
    SELECT *
    FROM public.claim_waitlist_launch_send(
      NULL,
      '40000000-0000-4000-a040-000000000101'
    )
  $$,
  '22023',
  NULL,
  'claim rejects null identity arguments'
);

SELECT throws_ok(
  $$
    SELECT public.complete_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000010',
      NULL
    )
  $$,
  '22023',
  NULL,
  'completion rejects null identity arguments'
);

SELECT throws_ok(
  $$
    SELECT public.release_waitlist_launch_send(
      NULL,
      '40000000-0000-4000-a040-000000000101'
    )
  $$,
  '22023',
  NULL,
  'release rejects null identity arguments'
);

SELECT is(
  (
    SELECT signup_email
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000010',
      '40000000-0000-4000-a040-000000000101'
    )
  ),
  'claim@example.test',
  'claim returns the eligible recipient from the database'
);

SELECT ok(
  (
    SELECT launch_send_claim_token =
             '40000000-0000-4000-a040-000000000101'::uuid
       AND launch_send_claimed_at >
             clock_timestamp() - interval '5 seconds'
       AND launch_send_claimed_at <= clock_timestamp()
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000010'
  ),
  'claim ownership and database-clock timestamp are stored together'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000010',
      '40000000-0000-4000-a040-000000000102'
    )
  ),
  0,
  'an already claimed signup cannot be claimed again'
);

SELECT is(
  public.complete_waitlist_launch_send(
    '40000000-0000-4000-a040-000000000010',
    '40000000-0000-4000-a040-000000000199'
  ),
  false,
  'a non-owner token cannot complete a launch send'
);

SELECT is(
  public.release_waitlist_launch_send(
    '40000000-0000-4000-a040-000000000010',
    '40000000-0000-4000-a040-000000000199'
  ),
  false,
  'a non-owner token cannot release a launch-send claim'
);

SELECT is(
  public.release_waitlist_launch_send(
    '40000000-0000-4000-a040-000000000010',
    '40000000-0000-4000-a040-000000000101'
  ),
  true,
  'the owning token can release a launch-send claim'
);

SELECT ok(
  (
    SELECT launch_send_claim_token IS NULL
       AND launch_send_claimed_at IS NULL
       AND notified_at IS NULL
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000010'
  ),
  'release clears claim state without marking the signup notified'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000010',
      '40000000-0000-4000-a040-000000000102'
    )
  ),
  1,
  'a released pending signup can be claimed again'
);

SELECT is(
  public.complete_waitlist_launch_send(
    '40000000-0000-4000-a040-000000000010',
    '40000000-0000-4000-a040-000000000102'
  ),
  true,
  'the owning token can complete a launch send'
);

SELECT ok(
  (
    SELECT notified_at > clock_timestamp() - interval '5 seconds'
       AND notified_at <= clock_timestamp()
       AND launch_send_claim_token IS NULL
       AND launch_send_claimed_at IS NULL
    FROM public.waitlist_signups
    WHERE id = '40000000-0000-4000-a040-000000000010'
  ),
  'completion stamps notification time and clears claim ownership'
);

SELECT is(
  public.complete_waitlist_launch_send(
    '40000000-0000-4000-a040-000000000010',
    '40000000-0000-4000-a040-000000000102'
  ),
  false,
  'completion is not replayable after notification is stamped'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000010',
      '40000000-0000-4000-a040-000000000103'
    )
  ),
  0,
  'a just-completed signup cannot be claimed again'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000020',
      '40000000-0000-4000-a040-000000000104'
    )
  ),
  0,
  'an already notified signup cannot be claimed'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM public.claim_waitlist_launch_send(
      '40000000-0000-4000-a040-000000000030',
      '40000000-0000-4000-a040-000000000105'
    )
  ),
  0,
  'an unsubscribed signup cannot be claimed'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
