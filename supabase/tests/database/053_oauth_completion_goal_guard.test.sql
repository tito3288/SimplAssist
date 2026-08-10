BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(13);

-- 1
WITH function_definition AS (
  SELECT pg_get_functiondef(procedure_row.oid) AS source
  FROM pg_proc AS procedure_row
  WHERE procedure_row.oid =
    'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
), function_positions AS (
  SELECT
    strpos(source, 'SELECT business.*') AS business_select_position,
    strpos(source, 'FOR UPDATE;') AS business_lock_position,
    strpos(
      source,
      E'IF v_business.primary_goal IS NOT DISTINCT FROM \'signup\' THEN\n    RAISE EXCEPTION \'google_calendar_goal_unavailable\'\n      USING ERRCODE = \'55000\';\n  END IF;'
    ) AS goal_guard_position,
    strpos(
      source,
      'INSERT INTO public.google_calendar_tokens'
    ) AS token_insert_position,
    strpos(source, 'UPDATE public.ai_settings') AS settings_update_position,
    strpos(
      source,
      'DELETE FROM public.google_calendar_oauth_attempts'
    ) AS attempt_delete_position
  FROM function_definition
)
SELECT ok(
  business_select_position > 0
  AND business_lock_position > business_select_position
  AND goal_guard_position > business_lock_position
  AND token_insert_position > goal_guard_position
  AND settings_update_position > token_insert_position
  AND attempt_delete_position > settings_update_position,
  'OAuth completion checks the primary goal under the business lock before every completion write'
)
FROM function_positions;

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a053-000000000001',
    'oauth-signup-owner-053@example.test'
  ),
  (
    '00000000-0000-4000-a053-000000000002',
    'oauth-book-owner-053@example.test'
  ),
  (
    '00000000-0000-4000-a053-000000000003',
    'oauth-null-owner-053@example.test'
  ),
  (
    '00000000-0000-4000-a053-000000000004',
    'oauth-quote-owner-053@example.test'
  ),
  (
    '00000000-0000-4000-a053-000000000005',
    'oauth-callback-owner-053@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a053-000000000001',
    name = 'OAuth Signup Business 053',
    slug = 'oauth-signup-business-053',
    primary_goal = 'signup',
    goal_url = 'https://signup-oauth-053.example.test'
WHERE owner_id = '00000000-0000-4000-a053-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a053-000000000002',
    name = 'OAuth Book Business 053',
    slug = 'oauth-book-business-053',
    primary_goal = 'book',
    goal_url = NULL
WHERE owner_id = '00000000-0000-4000-a053-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a053-000000000003',
    name = 'OAuth Null Business 053',
    slug = 'oauth-null-business-053',
    primary_goal = NULL,
    goal_url = NULL
WHERE owner_id = '00000000-0000-4000-a053-000000000003';

UPDATE public.businesses
SET id = '10000000-0000-4000-a053-000000000004',
    name = 'OAuth Quote Business 053',
    slug = 'oauth-quote-business-053',
    primary_goal = 'quote',
    goal_url = NULL
WHERE owner_id = '00000000-0000-4000-a053-000000000004';

UPDATE public.businesses
SET id = '10000000-0000-4000-a053-000000000005',
    name = 'OAuth Callback Business 053',
    slug = 'oauth-callback-business-053',
    primary_goal = 'callback',
    goal_url = NULL
WHERE owner_id = '00000000-0000-4000-a053-000000000005';

INSERT INTO public.ai_settings (
  business_id,
  booking_enabled,
  booking_mode,
  updated_at
) VALUES
  (
    '10000000-0000-4000-a053-000000000001',
    false,
    'collect_info',
    '2053-01-01 00:00:00+00'
  ),
  (
    '10000000-0000-4000-a053-000000000002',
    false,
    'collect_info',
    '2053-01-01 00:00:00+00'
  ),
  (
    '10000000-0000-4000-a053-000000000003',
    false,
    'collect_info',
    '2053-01-01 00:00:00+00'
  ),
  (
    '10000000-0000-4000-a053-000000000004',
    false,
    'collect_info',
    '2053-01-01 00:00:00+00'
  ),
  (
    '10000000-0000-4000-a053-000000000005',
    false,
    'collect_info',
    '2053-01-01 00:00:00+00'
  );

INSERT INTO public.google_calendar_oauth_attempts (
  id,
  state_digest,
  origin_verifier_digest,
  handoff_digest,
  business_id,
  owner_user_id,
  origin_partner_id,
  origin_hostname,
  status,
  authorization_code,
  sanitized_result,
  expires_at,
  handoff_expires_at,
  claimed_at
) VALUES
  (
    '30000000-0000-4000-a053-000000000001',
    repeat('1', 64),
    repeat('a', 64),
    repeat('6', 64),
    '10000000-0000-4000-a053-000000000001',
    '00000000-0000-4000-a053-000000000001',
    NULL,
    'oauth-signup-053.example.test',
    'claimed',
    NULL,
    NULL,
    now() + interval '10 minutes',
    now() + interval '5 minutes',
    now()
  ),
  (
    '30000000-0000-4000-a053-000000000002',
    repeat('2', 64),
    repeat('b', 64),
    repeat('7', 64),
    '10000000-0000-4000-a053-000000000002',
    '00000000-0000-4000-a053-000000000002',
    NULL,
    'oauth-book-053.example.test',
    'claimed',
    NULL,
    NULL,
    now() + interval '10 minutes',
    now() + interval '5 minutes',
    now()
  ),
  (
    '30000000-0000-4000-a053-000000000003',
    repeat('3', 64),
    repeat('c', 64),
    repeat('8', 64),
    '10000000-0000-4000-a053-000000000003',
    '00000000-0000-4000-a053-000000000003',
    NULL,
    'oauth-null-053.example.test',
    'claimed',
    NULL,
    NULL,
    now() + interval '10 minutes',
    now() + interval '5 minutes',
    now()
  ),
  (
    '30000000-0000-4000-a053-000000000004',
    repeat('4', 64),
    repeat('d', 64),
    repeat('9', 64),
    '10000000-0000-4000-a053-000000000004',
    '00000000-0000-4000-a053-000000000004',
    NULL,
    'oauth-quote-053.example.test',
    'claimed',
    NULL,
    NULL,
    now() + interval '10 minutes',
    now() + interval '5 minutes',
    now()
  ),
  (
    '30000000-0000-4000-a053-000000000005',
    repeat('5', 64),
    repeat('e', 64),
    repeat('f', 64),
    '10000000-0000-4000-a053-000000000005',
    '00000000-0000-4000-a053-000000000005',
    NULL,
    'oauth-callback-053.example.test',
    'claimed',
    NULL,
    NULL,
    now() + interval '10 minutes',
    now() + interval '5 minutes',
    now()
  );

-- 2
SELECT throws_ok(
  $$
    SELECT public.complete_google_calendar_oauth_connection(
      '30000000-0000-4000-a053-000000000001',
      '10000000-0000-4000-a053-000000000001',
      '00000000-0000-4000-a053-000000000001',
      NULL,
      'oauth-signup-053.example.test',
      'signup-access-053',
      'signup-refresh-053',
      '2053-01-02 00:00:00+00',
      'signup-calendar-053@example.test',
      'primary'
    )
  $$,
  '55000',
  'google_calendar_goal_unavailable',
  'signup-goal businesses cannot complete Google Calendar OAuth'
);

-- 3
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a053-000000000001'
  ),
  0,
  'a rejected signup completion writes no Google credentials'
);

-- 4
SELECT results_eq(
  $$
    SELECT booking_enabled, booking_mode, updated_at
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a053-000000000001'
  $$,
  $$
    VALUES (
      false,
      'collect_info'::text,
      '2053-01-01 00:00:00+00'::timestamptz
    )
  $$,
  'a rejected signup completion leaves Calendar settings byte-for-byte unchanged'
);

-- 5
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '30000000-0000-4000-a053-000000000001'
      AND status = 'claimed'
  ),
  'a rejected signup completion preserves the claimed OAuth attempt'
);

-- 6
SELECT is(
  public.complete_google_calendar_oauth_connection(
    '30000000-0000-4000-a053-000000000002',
    '10000000-0000-4000-a053-000000000002',
    '00000000-0000-4000-a053-000000000002',
    NULL,
    'oauth-book-053.example.test',
    'book-access-053',
    'book-refresh-053',
    '2053-01-02 00:00:00+00',
    'book-calendar-053@example.test',
    'primary'
  ),
  true,
  'book-goal businesses retain OAuth completion behavior'
);

-- 7
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a053-000000000002'
      AND access_token = 'book-access-053'
      AND refresh_token = 'book-refresh-053'
      AND token_expiry = '2053-01-02 00:00:00+00'
      AND google_email = 'book-calendar-053@example.test'
      AND calendar_id = 'primary'
  )
  AND EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a053-000000000002'
      AND booking_enabled IS TRUE
      AND booking_mode = 'schedule_direct'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '30000000-0000-4000-a053-000000000002'
  ),
  'book completion writes credentials/settings and consumes its attempt'
);

-- 8
SELECT is(
  public.complete_google_calendar_oauth_connection(
    '30000000-0000-4000-a053-000000000003',
    '10000000-0000-4000-a053-000000000003',
    '00000000-0000-4000-a053-000000000003',
    NULL,
    'oauth-null-053.example.test',
    'null-access-053',
    'null-refresh-053',
    '2053-01-02 00:00:00+00',
    'null-calendar-053@example.test',
    'primary'
  ),
  true,
  'NULL-goal businesses retain legacy OAuth completion behavior'
);

-- 9
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a053-000000000003'
      AND access_token = 'null-access-053'
      AND refresh_token = 'null-refresh-053'
      AND token_expiry = '2053-01-02 00:00:00+00'
      AND google_email = 'null-calendar-053@example.test'
      AND calendar_id = 'primary'
  )
  AND EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a053-000000000003'
      AND booking_enabled IS TRUE
      AND booking_mode = 'schedule_direct'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '30000000-0000-4000-a053-000000000003'
  ),
  'NULL-goal completion writes credentials/settings and consumes its attempt'
);

-- 10
SELECT is(
  public.complete_google_calendar_oauth_connection(
    '30000000-0000-4000-a053-000000000004',
    '10000000-0000-4000-a053-000000000004',
    '00000000-0000-4000-a053-000000000004',
    NULL,
    'oauth-quote-053.example.test',
    'quote-access-053',
    'quote-refresh-053',
    '2053-01-02 00:00:00+00',
    'quote-calendar-053@example.test',
    'primary'
  ),
  true,
  'quote-goal businesses remain book-compatible for OAuth completion'
);

-- 11
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a053-000000000004'
      AND access_token = 'quote-access-053'
      AND refresh_token = 'quote-refresh-053'
      AND token_expiry = '2053-01-02 00:00:00+00'
      AND google_email = 'quote-calendar-053@example.test'
      AND calendar_id = 'primary'
  )
  AND EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a053-000000000004'
      AND booking_enabled IS TRUE
      AND booking_mode = 'schedule_direct'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '30000000-0000-4000-a053-000000000004'
  ),
  'quote completion writes credentials/settings and consumes its attempt'
);

-- 12
SELECT is(
  public.complete_google_calendar_oauth_connection(
    '30000000-0000-4000-a053-000000000005',
    '10000000-0000-4000-a053-000000000005',
    '00000000-0000-4000-a053-000000000005',
    NULL,
    'oauth-callback-053.example.test',
    'callback-access-053',
    'callback-refresh-053',
    '2053-01-02 00:00:00+00',
    'callback-calendar-053@example.test',
    'primary'
  ),
  true,
  'callback-goal businesses remain book-compatible for OAuth completion'
);

-- 13
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.google_calendar_tokens
    WHERE business_id = '10000000-0000-4000-a053-000000000005'
      AND access_token = 'callback-access-053'
      AND refresh_token = 'callback-refresh-053'
      AND token_expiry = '2053-01-02 00:00:00+00'
      AND google_email = 'callback-calendar-053@example.test'
      AND calendar_id = 'primary'
  )
  AND EXISTS (
    SELECT 1
    FROM public.ai_settings
    WHERE business_id = '10000000-0000-4000-a053-000000000005'
      AND booking_enabled IS TRUE
      AND booking_mode = 'schedule_direct'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.google_calendar_oauth_attempts
    WHERE id = '30000000-0000-4000-a053-000000000005'
  ),
  'callback completion writes credentials/settings and consumes its attempt'
);

SELECT * FROM finish();

ROLLBACK;
