BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(5);

SELECT ok(
  to_regprocedure(
    'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'
  ) IS NOT NULL,
  'the existing OAuth completion signature is preserved'
);

SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
  ),
  'OAuth completion remains security-invoker with a fixed search path'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)',
    'EXECUTE'
  ),
  'only service_role can execute OAuth completion'
);

SELECT ok(
  (
    SELECT pg_get_functiondef(procedure_row.oid) ~
      'FROM public\.ai_settings AS settings[[:space:][:print:]]*FOR UPDATE'
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
  ),
  'OAuth completion locks the required settings row before writing tokens'
);

SELECT ok(
  (
    SELECT pg_get_functiondef(procedure_row.oid) LIKE
      '%google_calendar_settings_missing%'
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.complete_google_calendar_oauth_connection(uuid,uuid,uuid,uuid,text,text,text,timestamptz,text,text)'::regprocedure
  ),
  'OAuth completion has a stable missing-settings rollback failure'
);

SELECT * FROM finish();

ROLLBACK;
