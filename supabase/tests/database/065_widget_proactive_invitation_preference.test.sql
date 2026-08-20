BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(11);

-- ---------------------------------------------------------------------------
-- Durable schema and unchanged security surface
-- ---------------------------------------------------------------------------

SELECT has_column(
  'public',
  'widget_configs',
  'proactive_invitation_enabled',
  'widget configs store the proactive invitation preference'
);

SELECT col_not_null(
  'public',
  'widget_configs',
  'proactive_invitation_enabled',
  'the proactive invitation preference is always explicit'
);

SELECT is(
  (
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'widget_configs'
      AND column_name = 'proactive_invitation_enabled'
  ),
  'true',
  'new widget configs default proactive invitations on'
);

SELECT is(
  col_description(
    'public.widget_configs'::regclass,
    (
      SELECT attnum
      FROM pg_attribute
      WHERE attrelid = 'public.widget_configs'::regclass
        AND attname = 'proactive_invitation_enabled'
        AND NOT attisdropped
    )
  ),
  'Owner preference for automatically revealing the saved welcome message. Public delivery also requires the server-only runtime gate.',
  'the preference documents its separation from public rollout authority'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.widget_configs
    WHERE proactive_invitation_enabled IS DISTINCT FROM true
  ),
  'the additive default backfills every pre-existing widget preference to true'
);

SELECT ok(
  (
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = 'public.widget_configs'::regclass
  ),
  'widget configs retain row-level security'
);

SELECT policies_are(
  'public',
  'widget_configs',
  ARRAY[
    'widget_configs_delete',
    'widget_configs_insert',
    'widget_configs_select',
    'widget_configs_update'
  ]::name[],
  'the migration adds no public or cross-tenant policy'
);

SELECT ok(
  (
    SELECT bool_and(
      has_column_privilege(
        role_name,
        'public.widget_configs',
        'proactive_invitation_enabled',
        privilege_name
      ) = has_column_privilege(
        role_name,
        'public.widget_configs',
        'welcome_message',
        privilege_name
      )
    )
    FROM (VALUES ('anon'), ('authenticated'), ('service_role'))
      AS roles(role_name)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'))
      AS privileges(privilege_name)
  ),
  'the new preference receives no privileges beyond an existing owner setting'
);

-- ---------------------------------------------------------------------------
-- Default behavior and owner mutation through the established RLS policy
-- ---------------------------------------------------------------------------

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a065-000000000001',
    'widget-owner-a065@example.test'
  ),
  (
    '00000000-0000-4000-a065-000000000002',
    'other-widget-owner-a065@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a065-000000000001',
    name = 'Widget Owner 065',
    email = 'widget-owner-a065@example.test',
    slug = 'widget-owner-a065',
    website_url = 'https://owner-a065.example.test'
WHERE owner_id = '00000000-0000-4000-a065-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a065-000000000002',
    name = 'Other Widget Owner 065',
    email = 'other-widget-owner-a065@example.test',
    slug = 'other-widget-owner-a065',
    website_url = 'https://other-a065.example.test'
WHERE owner_id = '00000000-0000-4000-a065-000000000002';

INSERT INTO public.widget_configs (business_id, allowed_hostnames)
VALUES
  (
    '10000000-0000-4000-a065-000000000001',
    ARRAY['owner-a065.example.test']::text[]
  ),
  (
    '10000000-0000-4000-a065-000000000002',
    ARRAY['other-a065.example.test']::text[]
  );

SELECT is(
  (
    SELECT proactive_invitation_enabled
    FROM public.widget_configs
    WHERE business_id = '10000000-0000-4000-a065-000000000001'
  ),
  true,
  'a new row that omits the preference receives true'
);

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a065-000000000001',
  true
);
GRANT SELECT, UPDATE ON public.widget_configs, public.businesses
  TO authenticated;
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  $$
    UPDATE public.widget_configs
    SET proactive_invitation_enabled = false
    WHERE business_id = '10000000-0000-4000-a065-000000000001'
  $$,
  'the existing owner update policy accepts an owner preference change'
);

SELECT is(
  (
    SELECT proactive_invitation_enabled
    FROM public.widget_configs
    WHERE business_id = '10000000-0000-4000-a065-000000000001'
  ),
  false,
  'the owner preference change is durable and readable through RLS'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
