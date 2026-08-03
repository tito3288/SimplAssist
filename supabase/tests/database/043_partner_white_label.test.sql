BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(77);

-- ---------------------------------------------------------------------------
-- Catalog shape, defaults, constraints, and authorization boundary
-- ---------------------------------------------------------------------------

-- 1
SELECT has_table(
  'public',
  'partners',
  'partners have a private configuration table'
);

-- 2
SELECT col_is_pk(
  'public',
  'partners',
  'id',
  'partner ids are the primary key'
);

-- 3
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.partners'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'id', 'uuid',
    'name', 'text',
    'slug', 'text',
    'custom_domain', 'text',
    'domain_status', 'text',
    'logo_light_url', 'text',
    'logo_dark_url', 'text',
    'favicon_url', 'text',
    'brand_primary', 'text',
    'brand_primary_hover', 'text',
    'brand_primary_active', 'text',
    'brand_accent', 'text',
    'brand_primary_dark', 'text',
    'brand_primary_hover_dark', 'text',
    'brand_primary_active_dark', 'text',
    'brand_accent_dark', 'text',
    'email_from', 'text',
    'email_from_status', 'text',
    'email_from_verified_at', 'timestamp with time zone',
    'email_from_verified_by', 'uuid',
    'status', 'text',
    'created_at', 'timestamp with time zone',
    'updated_at', 'timestamp with time zone'
  ),
  'partners have the exact approved column types'
);

-- 4
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.partners'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  23,
  'partners have no extra or missing columns'
);

-- 5
SELECT is(
  (
    SELECT array_agg(attribute.attname ORDER BY attribute.attname)
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.partners'::regclass
      AND attribute.attnotnull
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ),
  ARRAY[
    'brand_accent',
    'brand_accent_dark',
    'brand_primary',
    'brand_primary_active',
    'brand_primary_active_dark',
    'brand_primary_dark',
    'brand_primary_hover',
    'brand_primary_hover_dark',
    'created_at',
    'domain_status',
    'email_from_status',
    'id',
    'name',
    'slug',
    'status',
    'updated_at'
  ]::name[],
  'only the approved partner fields are required'
);

-- 6
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      pg_get_expr(default_value.adbin, default_value.adrelid)
    )
    FROM pg_attribute AS attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = attribute.attrelid
     AND default_value.adnum = attribute.attnum
    WHERE attribute.attrelid = 'public.partners'::regclass
  ),
  jsonb_build_object(
    'id', 'gen_random_uuid()',
    'domain_status', '''pending''::text',
    'brand_primary', '''#ea580c''::text',
    'brand_primary_hover', '''#c2410c''::text',
    'brand_primary_active', '''#9a3412''::text',
    'brand_accent', '''#c2410c''::text',
    'brand_primary_dark', '''#ff914d''::text',
    'brand_primary_hover_dark', '''#f57f33''::text',
    'brand_primary_active_dark', '''#e8752c''::text',
    'brand_accent_dark', '''#ff914d''::text',
    'email_from_status', '''unconfigured''::text',
    'status', '''active''::text',
    'created_at', 'now()',
    'updated_at', 'now()'
  ),
  'partners have the exact approved defaults'
);

-- 7
SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.partners'::regclass
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ),
  ARRAY[
    'partners_brand_colors_hex',
    'partners_connected_domain_required',
    'partners_custom_domain_canonical',
    'partners_domain_status_check',
    'partners_email_from_mailbox',
    'partners_email_from_state',
    'partners_email_from_status_check',
    'partners_name_check',
    'partners_slug_check',
    'partners_status_check'
  ]::name[],
  'all partner value checks exist and are validated'
);

-- 8
SELECT ok(
  (
    SELECT (
      SELECT array_agg(color_attribute.attnum::smallint ORDER BY color_attribute.attnum)
      FROM pg_attribute AS color_attribute
      WHERE color_attribute.attrelid = 'public.partners'::regclass
        AND color_attribute.attname IN (
          'brand_primary',
          'brand_primary_hover',
          'brand_primary_active',
          'brand_accent',
          'brand_primary_dark',
          'brand_primary_hover_dark',
          'brand_primary_active_dark',
          'brand_accent_dark'
        )
    ) = (
      SELECT array_agg(color_key ORDER BY color_key)
      FROM unnest(constraint_row.conkey) AS color_key
    )
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.partners'::regclass
      AND constraint_row.conname = 'partners_brand_colors_hex'
  ),
  'one validated constraint covers all eight partner colors'
);

-- 9
SELECT is(
  (
    SELECT array_agg(constraint_row.conname::name ORDER BY constraint_row.conname)
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.partners'::regclass
      AND constraint_row.contype = 'u'
  ),
  ARRAY[
    'partners_custom_domain_key',
    'partners_slug_key'
  ]::name[],
  'partner slugs and non-null custom domains are independently unique'
);

-- 10
SELECT has_trigger(
  'public',
  'partners',
  'set_updated_at_partners',
  'partner writes maintain updated_at'
);

-- 11
SELECT ok(
  (
    SELECT class_row.relrowsecurity
    FROM pg_class AS class_row
    WHERE class_row.oid = 'public.partners'::regclass
  ),
  'partners have row-level security enabled'
);

-- 12
SELECT policies_are(
  'public',
  'partners',
  ARRAY[]::name[],
  'partners intentionally have no customer policies'
);

-- 13
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_class AS class_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(class_row.relacl, acldefault('r', class_row.relowner))
    ) AS acl_row
    WHERE class_row.oid = 'public.partners'::regclass
      AND acl_row.grantee = 0
  ),
  'PUBLIC has no partner-table privilege'
);

-- 14
SELECT table_privs_are(
  'public',
  'partners',
  'anon',
  ARRAY[]::name[],
  'anon has no partner-table privileges'
);

-- 15
SELECT table_privs_are(
  'public',
  'partners',
  'authenticated',
  ARRAY[]::name[],
  'authenticated has no partner-table privileges'
);

-- 16
SELECT table_privs_are(
  'public',
  'partners',
  'service_role',
  ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::name[],
  'service_role has exact partner CRUD privileges'
);

-- 17
SELECT is(
  (
    SELECT jsonb_object_agg(
      attribute.attname,
      format_type(attribute.atttypid, attribute.atttypmod)
    )
    FROM pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.businesses'::regclass
      AND attribute.attname IN ('partner_id', 'billing_mode')
      AND NOT attribute.attisdropped
  ),
  jsonb_build_object(
    'partner_id', 'uuid',
    'billing_mode', 'text'
  ),
  'businesses have the approved partner and billing column types'
);

-- 18
SELECT ok(
  (
    SELECT NOT partner_attribute.attnotnull
    FROM pg_attribute AS partner_attribute
    WHERE partner_attribute.attrelid = 'public.businesses'::regclass
      AND partner_attribute.attname = 'partner_id'
  )
  AND (
    SELECT billing_attribute.attnotnull
      AND pg_get_expr(default_value.adbin, default_value.adrelid)
        = '''stripe''::text'
    FROM pg_attribute AS billing_attribute
    JOIN pg_attrdef AS default_value
      ON default_value.adrelid = billing_attribute.attrelid
     AND default_value.adnum = billing_attribute.attnum
    WHERE billing_attribute.attrelid = 'public.businesses'::regclass
      AND billing_attribute.attname = 'billing_mode'
  )
  AND (
    SELECT pg_get_constraintdef(constraint_row.oid) =
      'CHECK ((billing_mode = ANY (ARRAY[''stripe''::text, ''invoiced''::text, ''comped''::text])))'
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.businesses'::regclass
      AND constraint_row.conname = 'businesses_billing_mode_check'
  ),
  'business billing defaults to a required, constrained Stripe mode'
);

-- 19
SELECT ok(
  (
    SELECT constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.partners'::regclass
       AND constraint_row.confdeltype = 'n'
       AND pg_get_constraintdef(constraint_row.oid)
         LIKE '%FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE SET NULL%'
    FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.businesses'::regclass
      AND constraint_row.conname = 'businesses_partner_id_fkey'
  ),
  'business partner assignment references partners with ON DELETE SET NULL'
);

-- 20
SELECT ok(
  (
    SELECT NOT index_row.indisunique
       AND pg_get_indexdef(index_row.indexrelid) LIKE '%(partner_id)%'
    FROM pg_index AS index_row
    WHERE index_row.indexrelid =
      'public.businesses_partner_id_idx'::regclass
  ),
  'business partner lookups use the approved non-unique index'
);

-- 21
SELECT has_trigger(
  'public',
  'businesses',
  'guard_business_billing_authorization_fields',
  'businesses retain the protected billing-field trigger'
);

-- 22
SELECT ok(
  pg_get_functiondef(
    'public.guard_business_billing_authorization_fields()'::regprocedure
  ) LIKE ALL (ARRAY[
    '%billing_pilot%',
    '%billing_comped%',
    '%billing_exempt%',
    '%sms_overage_opt_in%',
    '%sms_overage_opted_in_at%',
    '%sms_overage_opted_in_by%',
    '%telnyx_submission_disabled%',
    '%billing_admin_notes%',
    '%billing_flags_updated_at%',
    '%billing_flags_updated_by%',
    '%partner_id%',
    '%billing_mode%',
    '%partner_plan%'
  ]),
  'the billing guard preserves every migration-031 field and adds assignment'
);

-- 23
SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.guard_business_billing_authorization_fields()'::regprocedure
  ),
  'the billing guard remains SECURITY INVOKER with a fixed search path'
);

-- 24
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS acl_row
    WHERE procedure_row.oid =
      'public.guard_business_billing_authorization_fields()'::regprocedure
      AND acl_row.grantee = 0
  )
  AND NOT has_function_privilege(
    'anon',
    'public.guard_business_billing_authorization_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.guard_business_billing_authorization_fields()',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'service_role',
    'public.guard_business_billing_authorization_fields()',
    'EXECUTE'
  ),
  'no client or server role can invoke the billing trigger directly'
);

-- 25
SELECT has_function(
  'public',
  'assign_business_partner_billing',
  ARRAY['uuid', 'uuid', 'text', 'uuid', 'text'],
  'the atomic partner billing RPC has its stable signature'
);

-- 26
SELECT is(
  pg_get_function_result(
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)'::regprocedure
  ),
  'TABLE(business_id uuid, partner_id uuid, billing_mode text, partner_plan text, billing_comped boolean)',
  'the assignment RPC returns only its approved final state'
);

-- 27
SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
       AND pg_get_functiondef(procedure_row.oid) LIKE '%FOR UPDATE%'
       AND pg_get_functiondef(procedure_row.oid) LIKE '%FOR SHARE NOWAIT%'
       AND pg_get_functiondef(procedure_row.oid) LIKE '%deleted_at IS NULL%'
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)'::regprocedure
  ),
  'the invoker-secure RPC contains the approved business and partner lock clauses'
);

-- 28
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS acl_row
    WHERE procedure_row.oid =
      'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)'::regprocedure
      AND acl_row.grantee = 0
  )
  AND NOT has_function_privilege(
    'anon',
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)',
    'EXECUTE'
  )
  AND has_table_privilege(
    'service_role',
    'public.businesses',
    'SELECT'
  )
  AND has_table_privilege(
    'service_role',
    'public.businesses',
    'UPDATE'
  )
  AND has_table_privilege(
    'service_role',
    'public.subscriptions',
    'SELECT'
  ),
  'only service_role can execute the RPC and access its required tables'
);

-- ---------------------------------------------------------------------------
-- Partner defaults and value constraints
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (id, name, slug)
VALUES (
  '20000000-0000-4000-a043-000000000000',
  'Default Partner',
  'default-partner'
);

-- 29
SELECT ok(
  (
    SELECT custom_domain IS NULL
       AND domain_status = 'pending'
       AND logo_light_url IS NULL
       AND logo_dark_url IS NULL
       AND favicon_url IS NULL
       AND brand_primary = '#ea580c'
       AND brand_primary_hover = '#c2410c'
       AND brand_primary_active = '#9a3412'
       AND brand_accent = '#c2410c'
       AND brand_primary_dark = '#ff914d'
       AND brand_primary_hover_dark = '#f57f33'
       AND brand_primary_active_dark = '#e8752c'
       AND brand_accent_dark = '#ff914d'
       AND email_from IS NULL
       AND email_from_status = 'unconfigured'
       AND email_from_verified_at IS NULL
       AND email_from_verified_by IS NULL
       AND status = 'active'
       AND created_at IS NOT NULL
       AND updated_at IS NOT NULL
    FROM public.partners
    WHERE id = '20000000-0000-4000-a043-000000000000'
  ),
  'a minimal partner receives every approved default'
);

-- 30
SELECT lives_ok(
  $$
    INSERT INTO public.partners (id, name, slug)
    VALUES (
      '20000000-0000-4000-a043-000000000004',
      'Second Pending Partner',
      'second-pending-partner'
    )
  $$,
  'multiple pending partners may have null custom domains'
);

-- 31
SELECT lives_ok(
  $$
    INSERT INTO public.partners (
      id, name, slug, custom_domain, domain_status
    ) VALUES (
      '20000000-0000-4000-a043-000000000001',
      'Alpha Dog Agency',
      'alpha-dog',
      'app.alphadogagency.ai',
      'connected'
    )
  $$,
  'the exact first partner hostname is valid database data'
);

UPDATE public.partners
SET name = 'Second Pending Partner Updated',
    updated_at = '2000-01-01 00:00:00+00'
WHERE id = '20000000-0000-4000-a043-000000000004';

-- 32
SELECT ok(
  (
    SELECT updated_at > '2000-01-01 00:00:00+00'::timestamptz
    FROM public.partners
    WHERE id = '20000000-0000-4000-a043-000000000004'
  ),
  'partner updates refresh updated_at'
);

-- 33
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug)
    VALUES ('   ', 'blank-name')
  $$,
  '23514',
  NULL,
  'blank partner names are rejected'
);

-- 34
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug)
    VALUES ('Bad Slug', 'Bad_Slug')
  $$,
  '23514',
  NULL,
  'noncanonical partner slugs are rejected'
);

-- 35
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, custom_domain)
    VALUES ('Bad Domain', 'bad-domain', 'https://app.example.com/path')
  $$,
  '23514',
  NULL,
  'schemes and paths are rejected from partner hostnames'
);

-- 36
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, domain_status)
    VALUES ('Missing Connected Domain', 'missing-connected-domain', 'connected')
  $$,
  '23514',
  NULL,
  'connected partners must have a custom domain'
);

-- 37
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, domain_status)
    VALUES ('Bad Domain Status', 'bad-domain-status', 'verified')
  $$,
  '23514',
  NULL,
  'unknown partner domain statuses are rejected'
);

-- 38
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, status)
    VALUES ('Bad Partner Status', 'bad-partner-status', 'deleted')
  $$,
  '23514',
  NULL,
  'unknown partner lifecycle statuses are rejected'
);

-- 39
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, brand_accent_dark)
    VALUES ('Bad Color', 'bad-color', 'orange')
  $$,
  '23514',
  NULL,
  'non-hex partner colors are rejected'
);

-- 40
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug)
    VALUES ('Duplicate Slug', 'alpha-dog')
  $$,
  '23505',
  NULL,
  'partner slugs are unique'
);

-- 41
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug, custom_domain)
    VALUES (
      'Duplicate Domain',
      'duplicate-domain',
      'app.alphadogagency.ai'
    )
  $$,
  '23505',
  NULL,
  'non-null partner custom domains are unique'
);

-- 42
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE billing_mode IS DISTINCT FROM 'stripe'
       OR partner_id IS NOT NULL
       OR partner_plan IS NOT NULL
  ),
  'all businesses present when migration 043 lands backfill to Stripe mode'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (
  id, name, slug, custom_domain, domain_status, status
) VALUES
  (
    '20000000-0000-4000-a043-000000000002',
    'Inactive Partner',
    'inactive-partner',
    'inactive.example.com',
    'connected',
    'inactive'
  ),
  (
    '20000000-0000-4000-a043-000000000003',
    'Disposable Partner',
    'disposable-partner',
    'disposable.example.com',
    'connected',
    'active'
  );

INSERT INTO auth.users (id, email)
VALUES
  (
    '00000000-0000-4000-a043-000000000001',
    'partner-billing-a@example.test'
  ),
  (
    '00000000-0000-4000-a043-000000000002',
    'partner-billing-b@example.test'
  ),
  (
    '00000000-0000-4000-a043-000000000003',
    'partner-billing-c@example.test'
  ),
  (
    '00000000-0000-4000-a043-000000000004',
    'partner-billing-deleted@example.test'
  );

UPDATE public.businesses
SET id = '10000000-0000-4000-a043-000000000001',
    name = 'Partner Billing A',
    slug = 'partner-billing-a'
WHERE owner_id = '00000000-0000-4000-a043-000000000001';

UPDATE public.businesses
SET id = '10000000-0000-4000-a043-000000000002',
    name = 'Partner Billing B',
    slug = 'partner-billing-b'
WHERE owner_id = '00000000-0000-4000-a043-000000000002';

UPDATE public.businesses
SET id = '10000000-0000-4000-a043-000000000003',
    name = 'Partner Billing C',
    slug = 'partner-billing-c'
WHERE owner_id = '00000000-0000-4000-a043-000000000003';

UPDATE public.businesses
SET id = '10000000-0000-4000-a043-000000000004',
    name = 'Partner Billing Deleted',
    slug = 'partner-billing-deleted'
WHERE owner_id = '00000000-0000-4000-a043-000000000004';

-- 43
SELECT ok(
  (
    SELECT bool_and(
      billing_mode = 'stripe'
      AND partner_id IS NULL
      AND partner_plan IS NULL
    )
    FROM public.businesses
    WHERE owner_id IN (
      '00000000-0000-4000-a043-000000000001',
      '00000000-0000-4000-a043-000000000002',
      '00000000-0000-4000-a043-000000000003',
      '00000000-0000-4000-a043-000000000004'
    )
  ),
  'new trigger-created businesses default to Stripe mode without a partner'
);

UPDATE public.businesses
SET deleted_at = now(),
    deletion_scheduled_for = now() + interval '60 days'
WHERE id = '10000000-0000-4000-a043-000000000004';

INSERT INTO public.subscriptions (
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status
) VALUES (
  '10000000-0000-4000-a043-000000000002',
  'cus_partner_043_canceled',
  'sub_partner_043_canceled',
  'sms_only',
  'canceled'
);

-- ---------------------------------------------------------------------------
-- Runtime table boundary and customer-write guard
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;

-- 44
SELECT throws_ok(
  'SELECT count(*) FROM public.partners',
  '42501',
  NULL,
  'anon cannot select partners'
);

-- 45
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug)
    VALUES ('Anonymous Partner', 'anonymous-partner')
  $$,
  '42501',
  NULL,
  'anon cannot insert partners'
);

-- 46
SELECT throws_ok(
  $$
    UPDATE public.partners
    SET name = 'Anonymous Update'
    WHERE id = '20000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  NULL,
  'anon cannot update partners'
);

-- 47
SELECT throws_ok(
  $$
    DELETE FROM public.partners
    WHERE id = '20000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  NULL,
  'anon cannot delete partners'
);

RESET ROLE;

SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a043-000000000001',
  true
);
SET LOCAL ROLE authenticated;

-- 48
SELECT throws_ok(
  'SELECT count(*) FROM public.partners',
  '42501',
  NULL,
  'authenticated cannot select partners'
);

-- 49
SELECT throws_ok(
  $$
    INSERT INTO public.partners (name, slug)
    VALUES ('Customer Partner', 'customer-partner')
  $$,
  '42501',
  NULL,
  'authenticated cannot insert partners'
);

-- 50
SELECT throws_ok(
  $$
    UPDATE public.partners
    SET name = 'Customer Update'
    WHERE id = '20000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  NULL,
  'authenticated cannot update partners'
);

-- 51
SELECT throws_ok(
  $$
    DELETE FROM public.partners
    WHERE id = '20000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  NULL,
  'authenticated cannot delete partners'
);

RESET ROLE;
SET LOCAL ROLE service_role;

-- 52
SELECT lives_ok(
  $test$
    DO $body$
    BEGIN
      PERFORM count(*) FROM public.partners;

      INSERT INTO public.partners (id, name, slug)
      VALUES (
        '20000000-0000-4000-a043-000000000009',
        'Service CRUD Partner',
        'service-crud-partner'
      );

      UPDATE public.partners
      SET name = 'Service CRUD Partner Updated'
      WHERE id = '20000000-0000-4000-a043-000000000009';

      DELETE FROM public.partners
      WHERE id = '20000000-0000-4000-a043-000000000009';
    END;
    $body$
  $test$,
  'service_role can perform every granted partner CRUD operation'
);

RESET ROLE;
SELECT set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-a043-000000000001',
  true
);

-- Some historical local databases lack the baseline authenticated business
-- grants that the owner policies and migration-031 guard are designed around.
-- Restore them only inside this rolled-back test transaction so the guard,
-- rather than an unrelated table ACL, is what these assertions exercise.
GRANT SELECT, INSERT, UPDATE ON TABLE public.businesses TO authenticated;

SET LOCAL ROLE authenticated;

-- 53
SELECT lives_ok(
  $$
    UPDATE public.businesses
    SET name = 'Partner Billing A Renamed'
    WHERE id = '10000000-0000-4000-a043-000000000001'
  $$,
  'an owner can still update an ordinary business field'
);

-- 54
SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET partner_id = '20000000-0000-4000-a043-000000000001'
    WHERE id = '10000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  'customer writes cannot change protected business billing fields',
  'an owner cannot assign its business to a partner'
);

-- 55
SELECT throws_ok(
  $$
    UPDATE public.businesses
    SET billing_mode = 'invoiced'
    WHERE id = '10000000-0000-4000-a043-000000000001'
  $$,
  '42501',
  'customer writes cannot change protected business billing fields',
  'an owner cannot change its business billing mode'
);

-- 56
SELECT throws_ok(
  $$
    INSERT INTO public.businesses (
      owner_id, name, business_type, slug, partner_id
    ) VALUES (
      '00000000-0000-4000-a043-000000000001',
      'Forged Partner Business',
      'general',
      'forged-partner-business',
      '20000000-0000-4000-a043-000000000001'
    )
  $$,
  '42501',
  'customer writes cannot set protected business billing fields',
  'an owner cannot seed partner assignment on business insert'
);

-- 57
SELECT throws_ok(
  $$
    INSERT INTO public.businesses (
      owner_id, name, business_type, slug, billing_mode
    ) VALUES (
      '00000000-0000-4000-a043-000000000001',
      'Forged Billing Business',
      'general',
      'forged-billing-business',
      'comped'
    )
  $$,
  '42501',
  'customer writes cannot set protected business billing fields',
  'an owner cannot seed non-Stripe mode on business insert'
);

RESET ROLE;

-- 58
SELECT ok(
  (
    SELECT name = 'Partner Billing A Renamed'
       AND partner_id IS NULL
       AND billing_mode = 'stripe'
       AND NOT billing_comped
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a043-000000000001'
  ),
  'ordinary owner changes persist while protected changes persist nothing'
);

-- ---------------------------------------------------------------------------
-- Service-only RPC errors and billing-authority transitions
-- ---------------------------------------------------------------------------

SET LOCAL ROLE anon;

-- 59
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '42501',
  NULL,
  'anon cannot execute the assignment RPC'
);

RESET ROLE;
SET LOCAL ROLE authenticated;

-- 60
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '42501',
  NULL,
  'authenticated cannot execute the assignment RPC'
);

RESET ROLE;
SET LOCAL ROLE service_role;

-- 61
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-999999999999',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  'P0002',
  'business_not_found',
  'the assignment RPC rejects an unknown business'
);

-- 62
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000004',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  'P0002',
  'business_not_found',
  'the assignment RPC treats a soft-deleted business as unavailable'
);

-- 63
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'free',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '22023',
  'invalid_billing_mode',
  'the assignment RPC rejects an unknown billing mode'
);

-- 64
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'stripe',
      NULL
    )
  $$,
  '22004',
  'actor_required',
  'the assignment RPC requires an audit actor'
);

-- 65
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'invoiced',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '22004',
  'partner_required',
  'non-Stripe assignment requires a partner'
);

-- 66
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      '20000000-0000-4000-a043-999999999999',
      'invoiced',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '55000',
  'partner_inactive',
  'non-Stripe assignment rejects a missing partner'
);

-- 67
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      '20000000-0000-4000-a043-000000000002',
      'comped',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '55000',
  'partner_inactive',
  'non-Stripe assignment rejects an inactive partner'
);

-- 68
SELECT throws_ok(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000002',
      '20000000-0000-4000-a043-000000000001',
      'invoiced',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  '55000',
  'subscription_exists',
  'even a canceled subscription row blocks non-Stripe assignment'
);

-- 69
SELECT ok(
  (
    SELECT partner_id IS NULL
       AND billing_mode = 'stripe'
       AND partner_plan IS NULL
       AND NOT billing_comped
       AND billing_flags_updated_at IS NULL
       AND billing_flags_updated_by IS NULL
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a043-000000000002'
  ),
  'a rejected subscription conflict changes no business billing state'
);

-- 70
SELECT results_eq(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      '20000000-0000-4000-a043-000000000001',
      'invoiced',
      '90000000-0000-4000-a043-000000000001'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a043-000000000001'::uuid,
      '20000000-0000-4000-a043-000000000001'::uuid,
      'invoiced'::text,
      'sms_and_chat'::text,
      false
    )
  $$,
  'four-argument invoiced assignment defaults to the Growth partner plan'
);

-- 71
SELECT ok(
  (
    SELECT partner_id = '20000000-0000-4000-a043-000000000001'::uuid
       AND billing_mode = 'invoiced'
       AND partner_plan = 'sms_and_chat'
       AND NOT billing_pilot
       AND NOT billing_comped
       AND NOT billing_exempt
       AND billing_flags_updated_at IS NOT NULL
       AND billing_flags_updated_by =
         '90000000-0000-4000-a043-000000000001'
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a043-000000000001'
  ),
  'non-Stripe assignment stores its partner and plan without a legacy bridge'
);

-- 72
SELECT results_eq(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      '20000000-0000-4000-a043-000000000001',
      'comped',
      '90000000-0000-4000-a043-000000000002'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a043-000000000001'::uuid,
      '20000000-0000-4000-a043-000000000001'::uuid,
      'comped'::text,
      'sms_and_chat'::text,
      false
    )
  $$,
  'switching non-Stripe modes preserves the omitted same-partner plan'
);

-- 73
SELECT results_eq(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000003'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a043-000000000001'::uuid,
      NULL::uuid,
      'stripe'::text,
      NULL::text,
      false
    )
  $$,
  'returning to unassigned Stripe mode clears partner billing terms'
);

UPDATE public.businesses
SET billing_comped = true,
    billing_flags_updated_at = now(),
    billing_flags_updated_by = 'legacy-fixture'
WHERE id = '10000000-0000-4000-a043-000000000001';

-- 74
SELECT results_eq(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000001',
      NULL,
      'stripe',
      '90000000-0000-4000-a043-000000000004'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a043-000000000001'::uuid,
      NULL::uuid,
      'stripe'::text,
      NULL::text,
      true
    )
  $$,
  'an unrelated Stripe-mode save preserves a legacy comp override'
);

-- 75
SELECT results_eq(
  $$
    SELECT *
    FROM public.assign_business_partner_billing(
      '10000000-0000-4000-a043-000000000003',
      '20000000-0000-4000-a043-000000000003',
      'invoiced',
      '90000000-0000-4000-a043-000000000005'
    )
  $$,
  $$
    VALUES (
      '10000000-0000-4000-a043-000000000003'::uuid,
      '20000000-0000-4000-a043-000000000003'::uuid,
      'invoiced'::text,
      'sms_and_chat'::text,
      false
    )
  $$,
  'an active connected partner is assignable with the default plan'
);

-- 76
SELECT lives_ok(
  $$
    DELETE FROM public.partners
    WHERE id = '20000000-0000-4000-a043-000000000003'
  $$,
  'service_role can delete a partner without deleting its business'
);

RESET ROLE;

-- 77
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE id = '10000000-0000-4000-a043-000000000003'
      AND partner_id IS NULL
      AND billing_mode = 'invoiced'
      AND partner_plan = 'sms_and_chat'
      AND NOT billing_pilot
      AND NOT billing_comped
      AND NOT billing_exempt
  ),
  'ON DELETE SET NULL leaves the intentional externally managed orphan state'
);

SELECT * FROM finish();

ROLLBACK;
