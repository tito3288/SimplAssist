BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SET LOCAL search_path = public, extensions;

SELECT plan(58);

-- ---------------------------------------------------------------------------
-- Catalog and authorization boundary
-- ---------------------------------------------------------------------------

-- 1
SELECT ok(
  to_regprocedure(
    'public.list_admin_business_health(uuid,text,text,uuid,text,text)'
  ) IS NOT NULL,
  'the admin health read-model function exists with the approved signature'
);

-- 2
SELECT ok(
  (
    SELECT NOT procedure_row.prosecdef
       AND procedure_row.provolatile = 's'
       AND procedure_row.proconfig @> ARRAY['search_path=public, pg_temp']
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.list_admin_business_health(uuid,text,text,uuid,text,text)'::regprocedure
  ),
  'admin health is stable, security-invoker, and has a fixed search path'
);

-- 3
SELECT ok(
  has_function_privilege(
    'service_role',
    'public.list_admin_business_health(uuid,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.list_admin_business_health(uuid,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.list_admin_business_health(uuid,text,text,uuid,text,text)',
    'EXECUTE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))
    ) AS acl_row
    WHERE procedure_row.oid =
      'public.list_admin_business_health(uuid,text,text,uuid,text,text)'::regprocedure
      AND acl_row.grantee = 0
      AND acl_row.privilege_type = 'EXECUTE'
  ),
  'only service_role receives execute privilege'
);

-- 4
SELECT ok(
  pg_get_indexdef('public.idx_messages_business_created_at'::regclass)
    LIKE '%public.messages USING btree (business_id, created_at DESC)%',
  'message activity has the composite business/time index'
);

-- 5
SELECT ok(
  pg_get_indexdef(
    'public.idx_conversations_business_last_message_at'::regclass
  ) LIKE '%public.conversations USING btree (business_id, last_message_at DESC)%',
  'conversation activity has the composite business/time index'
);

-- 6
SELECT ok(
  pg_get_indexdef(
    'public.idx_phone_numbers_business_active_created_at'::regclass
  ) LIKE '%(business_id, is_active, created_at DESC)%WHERE (is_active IS TRUE)%',
  'active-phone aggregation has a partial composite lookup index'
);

-- 7
SELECT ok(
  pg_get_indexdef('public.idx_businesses_admin_created_at'::regclass)
    LIKE '%(created_at DESC NULLS LAST, id DESC)%',
  'default admin ordering has a deterministic null-safe index'
);

-- 8
SELECT ok(
  (
    SELECT pg_get_functiondef(procedure_row.oid) !~
      '(access_token|refresh_token|guardrails|raw_payload|message\.content)'
    FROM pg_proc AS procedure_row
    WHERE procedure_row.oid =
      'public.list_admin_business_health(uuid,text,text,uuid,text,text)'::regprocedure
  ),
  'the read model never selects credentials, prompts, payloads, or message content'
);

-- 9
SELECT policies_are(
  'public',
  'businesses',
  ARRAY[
    'businesses_delete',
    'businesses_insert',
    'businesses_select',
    'businesses_update'
  ]::name[],
  'customer business RLS policies are unchanged'
);

-- 10
SELECT policies_are(
  'public',
  'phone_numbers',
  ARRAY[
    'phone_numbers_delete',
    'phone_numbers_insert',
    'phone_numbers_select',
    'phone_numbers_update'
  ]::name[],
  'customer phone-number RLS policies are unchanged'
);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

INSERT INTO public.partners (id, name, slug, status)
VALUES
  (
    '20000000-0000-4000-a047-000000000001',
    'AV047 Active Partner',
    'av047-active-partner',
    'active'
  ),
  (
    '20000000-0000-4000-a047-000000000002',
    'AV047 Inactive Partner',
    'av047-inactive-partner',
    'inactive'
  );

-- The auth trigger creates the owner-linked business used to prove orphaned
-- provisioning attribution through auth_user_id.
INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-a047-000000000018',
  'av047-orphan-owner@example.test'
);

UPDATE public.businesses
SET id = '10000000-0000-4000-a047-000000000018',
    name = 'AV047 Orphan Invite Failure',
    email = 'av047-orphan-contact@example.test',
    slug = 'av047-business-18',
    created_at = '2026-07-18 12:00:00+00'
WHERE owner_id = '00000000-0000-4000-a047-000000000018';

INSERT INTO public.businesses (
  id,
  name,
  email,
  business_type,
  slug,
  created_at,
  deleted_at,
  deletion_scheduled_for
)
SELECT
  ('10000000-0000-4000-a047-' || lpad(series.value::text, 12, '0'))::uuid,
  CASE
    WHEN series.value = 1 THEN 'AV047 Filter Before Limit Target'
    ELSE 'AV047 Business ' || series.value::text
  END,
  CASE
    WHEN series.value = 1 THEN 'health-search-av047@example.test'
    ELSE 'av047-business-' || series.value::text || '@example.test'
  END,
  'general',
  'av047-business-' || series.value::text,
  timestamptz '2026-07-01 12:00:00+00'
    + (series.value * interval '1 day'),
  CASE
    WHEN series.value IN (5, 6)
      THEN timestamptz '2026-06-01 00:00:00+00'
    ELSE NULL
  END,
  CASE
    WHEN series.value = 5
      THEN timestamptz '2026-07-31 00:00:00+00'
    ELSE NULL
  END
FROM generate_series(1, 19) AS series(value)
WHERE series.value <> 18;

UPDATE public.businesses
SET onboarding_completed_at = '2026-07-01 10:00:00+00',
    onboarding_step = 'complete',
    telnyx_messaging_profile_id =
      '30000000-0000-4000-a047-000000000001',
    telnyx_campaign_id = 'campaign_av047_core',
    campaign_status = 'approved'
WHERE id = '10000000-0000-4000-a047-000000000001';

UPDATE public.businesses
SET partner_id = '20000000-0000-4000-a047-000000000001',
    billing_mode = 'invoiced',
    partner_plan = 'sms_and_chat',
    telnyx_submission_disabled = true
WHERE id = '10000000-0000-4000-a047-000000000002';

UPDATE public.businesses
SET partner_id = '20000000-0000-4000-a047-000000000002',
    billing_mode = 'comped',
    partner_plan = 'full'
WHERE id = '10000000-0000-4000-a047-000000000003';

UPDATE public.businesses
SET onboarding_registration_status = 'failed'
WHERE id = '10000000-0000-4000-a047-000000000010';

UPDATE public.businesses
SET onboarding_registration_status = 'submitting',
    onboarding_registration_started_at = now() - interval '15 minutes'
WHERE id = '10000000-0000-4000-a047-000000000011';

UPDATE public.businesses
SET a2p_risk_review_status = 'blocked'
WHERE id = '10000000-0000-4000-a047-000000000012';

UPDATE public.businesses
SET brand_status = 'rejected'
WHERE id = '10000000-0000-4000-a047-000000000013';

UPDATE public.businesses
SET campaign_status = 'rejected'
WHERE id = '10000000-0000-4000-a047-000000000014';

UPDATE public.businesses
SET pending_phone_number = '+13175550116',
    pending_phone_number_failure_reason = 'sanitized failure text must not project'
WHERE id = '10000000-0000-4000-a047-000000000016';

INSERT INTO public.subscriptions (
  id,
  business_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan,
  status,
  cancel_at_period_end
)
VALUES
  (
    '40000000-0000-4000-a047-000000000001',
    '10000000-0000-4000-a047-000000000001',
    'cus_av047_core',
    'sub_av047_core',
    'full',
    'active',
    false
  ),
  (
    '40000000-0000-4000-a047-000000000004',
    '10000000-0000-4000-a047-000000000004',
    'cus_av047_past_due',
    'sub_av047_past_due',
    'sms_only',
    'past_due',
    false
  );

INSERT INTO public.billing_usage_periods (
  id,
  business_id,
  period_start,
  period_end,
  plan,
  included_sms_parts,
  inbound_sms_parts,
  outbound_sms_parts,
  inbound_mms_events,
  outbound_mms_events
)
VALUES
  (
    '50000000-0000-4000-a047-000000000001',
    '10000000-0000-4000-a047-000000000001',
    '2026-06-01 00:00:00+00',
    '2026-07-01 00:00:00+00',
    'full',
    2500,
    10,
    20,
    1,
    2
  ),
  (
    '50000000-0000-4000-a047-000000000002',
    '10000000-0000-4000-a047-000000000001',
    '2026-07-01 00:00:00+00',
    '2026-08-01 00:00:00+00',
    'full',
    2500,
    30,
    40,
    3,
    4
  );

INSERT INTO public.ai_settings (
  id,
  business_id,
  booking_enabled,
  booking_mode
)
VALUES (
  '60000000-0000-4000-a047-000000000001',
  '10000000-0000-4000-a047-000000000001',
  true,
  'schedule_direct'
);

INSERT INTO public.widget_configs (id, business_id, is_active)
VALUES (
  '61000000-0000-4000-a047-000000000001',
  '10000000-0000-4000-a047-000000000001',
  true
);

INSERT INTO public.google_calendar_tokens (
  id,
  business_id,
  access_token,
  refresh_token,
  token_expiry,
  created_at
)
VALUES (
  '62000000-0000-4000-a047-000000000001',
  '10000000-0000-4000-a047-000000000001',
  'secret-access-av047',
  'secret-refresh-av047',
  '2027-01-01 00:00:00+00',
  '2026-07-03 00:00:00+00'
);

INSERT INTO public.phone_numbers (
  id,
  business_id,
  phone_number,
  telnyx_phone_number_id,
  is_active,
  telnyx_campaign_assignment_status,
  telnyx_campaign_assignment_campaign_id
)
VALUES
  (
    '70000000-0000-4000-a047-000000000001',
    '10000000-0000-4000-a047-000000000001',
    '+13175550101',
    '71000000-0000-4000-a047-000000000001',
    true,
    'assigned',
    'campaign_av047_core'
  ),
  (
    '70000000-0000-4000-a047-000000000007',
    '10000000-0000-4000-a047-000000000007',
    '+13175550107',
    '71000000-0000-4000-a047-000000000007',
    true,
    'assigned',
    'campaign_av047_ambiguous'
  ),
  (
    '70000000-0000-4000-a047-000000000008',
    '10000000-0000-4000-a047-000000000007',
    '+13175550108',
    '71000000-0000-4000-a047-000000000008',
    true,
    'failed',
    NULL
  ),
  (
    '70000000-0000-4000-a047-000000000015',
    '10000000-0000-4000-a047-000000000015',
    '+13175550115',
    '71000000-0000-4000-a047-000000000015',
    true,
    'failed',
    NULL
  );

INSERT INTO public.conversations (
  id,
  business_id,
  channel,
  last_message_at
)
VALUES (
  '80000000-0000-4000-a047-000000000001',
  '10000000-0000-4000-a047-000000000001',
  'sms',
  '2026-07-12 00:00:00+00'
);

INSERT INTO public.messages (
  id,
  conversation_id,
  business_id,
  role,
  content,
  channel,
  created_at
)
VALUES
  (
    '81000000-0000-4000-a047-000000000001',
    '80000000-0000-4000-a047-000000000001',
    '10000000-0000-4000-a047-000000000001',
    'customer',
    'never projected',
    'sms',
    '2026-07-10 00:00:00+00'
  ),
  (
    '81000000-0000-4000-a047-000000000002',
    NULL,
    '10000000-0000-4000-a047-000000000002',
    'customer',
    'never projected either',
    'sms',
    '2026-07-13 00:00:00+00'
  );

INSERT INTO public.partner_client_provisioning_jobs (
  id,
  email,
  requested_business_name,
  partner_id,
  billing_mode,
  partner_plan,
  auth_user_id,
  business_id,
  status,
  last_error_code,
  operation_token,
  operation_kind,
  operation_started_at,
  operation_expires_at,
  created_by_admin_id,
  created_at,
  updated_at
)
VALUES
  (
    '90000000-0000-4000-a047-000000000002',
    'av047-invite-pending@example.test',
    'AV047 Invite Pending',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    '10000000-0000-4000-a047-000000000002',
    'invite_pending',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '91000000-0000-4000-a047-000000000001',
    now() - interval '1 hour',
    now() - interval '1 hour'
  ),
  (
    '90000000-0000-4000-a047-000000000008',
    'av047-admin-setup@example.test',
    'AV047 Admin Setup',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    '10000000-0000-4000-a047-000000000008',
    'admin_setup',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '91000000-0000-4000-a047-000000000001',
    now() - interval '1 hour',
    now() - interval '1 hour'
  ),
  (
    '90000000-0000-4000-a047-000000000009',
    'av047-setup-email-sent@example.test',
    'AV047 Setup Email Sent',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    '10000000-0000-4000-a047-000000000009',
    'setup_email_sent',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    '91000000-0000-4000-a047-000000000001',
    now() - interval '1 hour',
    now() - interval '1 hour'
  ),
  (
    '90000000-0000-4000-a047-000000000017',
    'av047-needs-attention@example.test',
    'AV047 Needs Attention',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    '10000000-0000-4000-a047-000000000017',
    'needs_attention',
    'provisioning_failed',
    NULL,
    NULL,
    NULL,
    NULL,
    '91000000-0000-4000-a047-000000000001',
    now() - interval '1 hour',
    now() - interval '1 hour'
  ),
  (
    '90000000-0000-4000-a047-000000000018',
    'av047-invite-failed@example.test',
    'AV047 Invite Failed',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    '00000000-0000-4000-a047-000000000018',
    NULL,
    'invite_pending',
    'link_generation_failed',
    NULL,
    NULL,
    NULL,
    NULL,
    '91000000-0000-4000-a047-000000000001',
    now() - interval '1 hour',
    now() - interval '1 hour'
  ),
  (
    '90000000-0000-4000-a047-000000000019',
    'av047-lease-expired@example.test',
    'AV047 Lease Expired',
    '20000000-0000-4000-a047-000000000001',
    'invoiced',
    'sms_and_chat',
    NULL,
    '10000000-0000-4000-a047-000000000019',
    'assigned',
    NULL,
    '92000000-0000-4000-a047-000000000019',
    'provision',
    now() - interval '20 minutes',
    now() - interval '5 minutes',
    '91000000-0000-4000-a047-000000000001',
    now() - interval '30 minutes',
    now() - interval '20 minutes'
  );

-- ---------------------------------------------------------------------------
-- Aggregation and normalization facts
-- ---------------------------------------------------------------------------

-- 11
SELECT is(
  (
    SELECT count(*)
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000001'
    )
  ),
  1::bigint,
  'one-to-one and lateral joins return exactly one row per business'
);

-- 12
SELECT is(
  (
    SELECT jsonb_build_object(
      'period_start', usage_period_start,
      'included', usage_included_sms_parts,
      'inbound', usage_inbound_sms_parts,
      'outbound', usage_outbound_sms_parts,
      'inbound_mms', usage_inbound_mms_events,
      'outbound_mms', usage_outbound_mms_events
    )
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000001'
    )
  ),
  jsonb_build_object(
    'period_start', timestamptz '2026-07-01 00:00:00+00',
    'included', 2500,
    'inbound', 30,
    'outbound', 40,
    'inbound_mms', 3,
    'outbound_mms', 4
  ),
  'latest usage period wins without duplicating the business'
);

-- 13
SELECT is(
  (
    SELECT last_activity_at
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000001'
    )
  ),
  timestamptz '2026-07-12 00:00:00+00',
  'last activity chooses a newer conversation timestamp over messages'
);

-- 14
SELECT is(
  (
    SELECT last_activity_at
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000002'
    )
  ),
  timestamptz '2026-07-13 00:00:00+00',
  'last activity also works when only a message maximum exists'
);

-- 15
SELECT is(
  (
    SELECT jsonb_build_object(
      'count', active_phone_count,
      'number', active_phone_number,
      'status', active_phone_assignment_status,
      'campaign', active_phone_assignment_campaign_id,
      'matches', active_phone_assignment_matches_campaign,
      'failed', active_phone_assignment_failed
    )
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000001'
    )
  ),
  jsonb_build_object(
    'count', 1,
    'number', '+13175550101',
    'status', 'assigned',
    'campaign', 'campaign_av047_core',
    'matches', true,
    'failed', false
  ),
  'one active phone preserves exact shared-reducer inputs'
);

-- 16
SELECT is(
  (
    SELECT jsonb_build_object(
      'ai', ai_configured,
      'booking', ai_booking_enabled,
      'mode', ai_booking_mode,
      'chat', web_chat_enabled,
      'calendar', calendar_connected
    )
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000001'
    )
  ),
  jsonb_build_object(
    'ai', true,
    'booking', true,
    'mode', 'schedule_direct',
    'chat', true,
    'calendar', true
  ),
  'AI, booking, web-chat, and Calendar facts are aggregated safely'
);

-- 17
SELECT is(
  (
    SELECT jsonb_build_object(
      'count', active_phone_count,
      'number', active_phone_number,
      'status', active_phone_assignment_status,
      'campaign', active_phone_assignment_campaign_id,
      'matches', active_phone_assignment_matches_campaign,
      'failed', active_phone_assignment_failed
    )
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000007'
    )
  ),
  jsonb_build_object(
    'count', 2,
    'number', NULL,
    'status', NULL,
    'campaign', NULL,
    'matches', false,
    'failed', true
  ),
  'ambiguous active phones expose count and aggregate failure, never a chosen row'
);

-- 18
SELECT is(
  (
    SELECT failed_setup_reasons
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000007'
    )
  ),
  ARRAY['phone_assignment_failed']::text[],
  'ambiguous phones retain the failed-assignment setup signal'
);

-- 19-28: every persisted failed-setup predicate.
SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000010')),
  ARRAY['registration_failed']::text[],
  'registration failure needs attention'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000011')),
  ARRAY['registration_submission_stale']::text[],
  'a submission lease at the fifteen-minute boundary is stale'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000012')),
  ARRAY['risk_review_blocked']::text[],
  'blocked risk review needs attention'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000013')),
  ARRAY['brand_rejected']::text[],
  'brand rejection needs attention'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000014')),
  ARRAY['campaign_rejected']::text[],
  'campaign rejection needs attention'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000015')),
  ARRAY['phone_assignment_failed']::text[],
  'failed active-number assignment needs attention'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000016')),
  ARRAY['pending_phone_failed']::text[],
  'pending-number failure needs attention without projecting its text'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000017')),
  ARRAY['provisioning_needs_attention']::text[],
  'an exactly linked needs-attention provisioning job is attributable'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000018')),
  ARRAY['provisioning_invite_failed']::text[],
  'an orphaned errored invite is attributable through its auth owner'
);

SELECT is(
  (SELECT failed_setup_reasons FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000019')),
  ARRAY['provisioning_lease_expired']::text[],
  'an expired unresolved provisioning lease needs attention'
);

-- 29-32: ordinary states that must not become failed setup.
SELECT ok(
  (
    SELECT NOT failed_setup
       AND failed_setup_reasons = ARRAY[]::text[]
       AND telnyx_submission_disabled
       AND provisioning_status = 'invite_pending'
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000002'
    )
  ),
  'ordinary invite pending and Telnyx submission disablement are not failures'
);

SELECT ok(
  (
    SELECT NOT failed_setup AND provisioning_status = 'admin_setup'
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000008'
    )
  ),
  'ordinary administrator setup is not a failure'
);

SELECT ok(
  (
    SELECT NOT failed_setup AND provisioning_status = 'setup_email_sent'
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000009'
    )
  ),
  'a sent setup email is not a failure'
);

SELECT ok(
  (
    SELECT NOT failed_setup
       AND subscription_status = 'past_due'
       AND effective_plan = 'sms_only'
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000004'
    )
  ),
  'past-due billing remains a separate warning with its synchronized plan'
);

-- 33
SELECT ok(
  (
    SELECT snapshot_at = now()
       AND snapshot_at IS NOT NULL
       AND failed_setup
    FROM public.list_admin_business_health(
      p_business_id => '10000000-0000-4000-a047-000000000011'
    )
  ),
  'the snapshot exposes its stable predicate boundary instant'
);

-- ---------------------------------------------------------------------------
-- Valid filters combine with AND
-- ---------------------------------------------------------------------------

-- 34-38
SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_lifecycle => 'live')), 1::bigint, 'live means active and completed');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000002',
  p_lifecycle => 'onboarding')), 1::bigint, 'onboarding means active and incomplete');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000004',
  p_lifecycle => 'past_due')), 1::bigint, 'past due reads synchronized subscription state');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000005',
  p_lifecycle => 'pending_deletion')), 1::bigint, 'pending deletion requires both timestamps');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000010',
  p_lifecycle => 'failed_setup')), 1::bigint, 'failed setup uses persisted needs-attention facts');

-- 39-40: lifecycle choices are predicates and may overlap.
SELECT ok(
  (SELECT count(*) FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000004',
    p_lifecycle => 'onboarding')) = 1
  AND
  (SELECT count(*) FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000004',
    p_lifecycle => 'past_due')) = 1,
  'the same onboarding account can also match the past-due predicate'
);

SELECT ok(
  (SELECT count(*) FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000010',
    p_lifecycle => 'onboarding')) = 1
  AND
  (SELECT count(*) FROM public.list_admin_business_health(
    p_business_id => '10000000-0000-4000-a047-000000000010',
    p_lifecycle => 'failed_setup')) = 1,
  'the same onboarding account can also match the failed-setup predicate'
);

-- 41-44
SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_ownership => 'direct')), 1::bigint, 'direct ownership matches no partner');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000002',
  p_ownership => 'partner')), 1::bigint, 'partner ownership matches assigned accounts');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000002',
  p_ownership => 'partner',
  p_partner => '20000000-0000-4000-a047-000000000001')), 1::bigint,
  'specific partner narrows partner-owned accounts');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_ownership => 'direct',
  p_partner => '20000000-0000-4000-a047-000000000002')), 1::bigint,
  'specific partner is ignored outside partner ownership');

-- 45-47
SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000004',
  p_plan => 'sms_only')), 1::bigint, 'sms-only filters effective Stripe plan');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000002',
  p_plan => 'sms_and_chat')), 1::bigint, 'SMS and chat filters partner plan');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000003',
  p_plan => 'full')), 1::bigint, 'full filters an inactive partner-owned account');

-- 48-50
SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_query => 'Before Limit Target')), 1::bigint, 'search matches business name');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_query => '  HEALTH-SEARCH-AV047@EXAMPLE.TEST  ')), 1::bigint,
  'search trims input and matches business contact email case-insensitively');

SELECT is((SELECT count(*) FROM public.list_admin_business_health(
  p_business_id => '10000000-0000-4000-a047-000000000001',
  p_lifecycle => 'live',
  p_ownership => 'direct',
  p_plan => 'full',
  p_query => 'filter before limit target')), 1::bigint,
  'all valid filters combine with AND');

-- ---------------------------------------------------------------------------
-- Invalid arguments fail closed
-- ---------------------------------------------------------------------------

-- 51-54
SELECT throws_ok(
  $$SELECT * FROM public.list_admin_business_health(p_lifecycle => 'terminal')$$,
  '22023',
  'invalid_admin_lifecycle_filter',
  'invalid lifecycle is rejected'
);

SELECT throws_ok(
  $$SELECT * FROM public.list_admin_business_health(p_ownership => 'reseller')$$,
  '22023',
  'invalid_admin_ownership_filter',
  'invalid ownership is rejected'
);

SELECT throws_ok(
  $$SELECT * FROM public.list_admin_business_health(p_plan => 'enterprise')$$,
  '22023',
  'invalid_admin_plan_filter',
  'invalid plan is rejected'
);

SELECT throws_ok(
  $$SELECT * FROM public.list_admin_business_health(p_query => repeat('x', 101))$$,
  '22023',
  'invalid_admin_query_filter',
  'search longer than one hundred trimmed characters is rejected'
);

-- 55
SELECT ok(
  EXISTS (
    SELECT 1
    FROM public.list_admin_business_health()
    WHERE business_id = '10000000-0000-4000-a047-000000000006'
      AND deleted_at IS NOT NULL
      AND deletion_scheduled_for IS NULL
  ),
  'the unfiltered pre-cap view retains a terminal tombstone'
);

-- ---------------------------------------------------------------------------
-- Filter-before-limit and service-role execution
-- ---------------------------------------------------------------------------

INSERT INTO public.businesses (
  id,
  name,
  email,
  business_type,
  slug,
  created_at
)
SELECT
  ('a0000000-0000-4000-a047-' || lpad(series.value::text, 12, '0'))::uuid,
  'AV047 Newer Filler ' || series.value::text,
  'av047-filler-' || series.value::text || '@example.test',
  'general',
  'av047-filler-' || series.value::text,
  timestamptz '2047-01-01 00:00:00+00'
    + (series.value * interval '1 day')
FROM generate_series(1, 76) AS series(value);

-- 56
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.list_admin_business_health()
    WHERE business_id = '10000000-0000-4000-a047-000000000001'
  )
  AND (
    SELECT count(*) FROM public.list_admin_business_health()
  ) = 75,
  'the default view orders newest-first and retains the seventy-five row cap'
);

-- 57
SELECT is(
  (
    SELECT count(*)
    FROM public.list_admin_business_health(
      p_lifecycle => 'onboarding',
      p_ownership => 'partner',
      p_partner => '20000000-0000-4000-a047-000000000001',
      p_plan => 'sms_and_chat'
    )
    WHERE business_id = '10000000-0000-4000-a047-000000000002'
  ),
  1::bigint,
  'lifecycle, ownership, partner, and plan filters all run before the cap'
);

-- 58
SET LOCAL ROLE service_role;

SELECT is(
  (
    SELECT count(*)
    FROM public.list_admin_business_health(
      p_query => 'AV047 Filter Before Limit Target'
    )
  ),
  1::bigint,
  'service_role executes the RPC and filtering occurs before the limit'
);

RESET ROLE;

SELECT * FROM finish();

ROLLBACK;
