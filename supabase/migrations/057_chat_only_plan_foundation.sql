BEGIN;

-- Phase 1 makes chat_only durable without making it purchasable. Application
-- rollout gates remain the authority for starting a direct sale or partner
-- assignment. This migration only expands existing plan value boundaries.

-- Install and validate the expanded checks before removing the old checks so
-- every write remains constrained throughout the migration. Renaming the
-- candidates back to the established names preserves catalog compatibility.
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_chat_only_candidate
  CHECK (plan IN ('sms_only', 'sms_and_chat', 'full', 'chat_only')) NOT VALID,
  ADD CONSTRAINT subscriptions_pending_plan_chat_only_candidate
  CHECK (
    pending_plan IS NULL
    OR pending_plan IN ('sms_only', 'sms_and_chat', 'full', 'chat_only')
  ) NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_plan_chat_only_candidate;
ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_pending_plan_chat_only_candidate;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT subscriptions_plan_check,
  DROP CONSTRAINT subscriptions_pending_plan_check;

ALTER TABLE public.subscriptions
  RENAME CONSTRAINT subscriptions_plan_chat_only_candidate
  TO subscriptions_plan_check;
ALTER TABLE public.subscriptions
  RENAME CONSTRAINT subscriptions_pending_plan_chat_only_candidate
  TO subscriptions_pending_plan_check;

ALTER TABLE public.billing_usage_periods
  ADD CONSTRAINT billing_usage_plan_chat_only_candidate
  CHECK (plan IN ('sms_only', 'sms_and_chat', 'full', 'chat_only')) NOT VALID;

ALTER TABLE public.billing_usage_periods
  VALIDATE CONSTRAINT billing_usage_plan_chat_only_candidate;

ALTER TABLE public.billing_usage_periods
  DROP CONSTRAINT billing_usage_periods_plan_check;

ALTER TABLE public.billing_usage_periods
  RENAME CONSTRAINT billing_usage_plan_chat_only_candidate
  TO billing_usage_periods_plan_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_partner_plan_chat_only_candidate
  CHECK (
    partner_plan IS NULL
    OR partner_plan IN ('sms_only', 'sms_and_chat', 'full', 'chat_only')
  ) NOT VALID;

ALTER TABLE public.businesses
  VALIDATE CONSTRAINT businesses_partner_plan_chat_only_candidate;

ALTER TABLE public.businesses
  DROP CONSTRAINT businesses_partner_plan_valid;

ALTER TABLE public.businesses
  RENAME CONSTRAINT businesses_partner_plan_chat_only_candidate
  TO businesses_partner_plan_valid;

ALTER TABLE public.partner_client_provisioning_jobs
  ADD CONSTRAINT pcpj_partner_plan_chat_only_candidate
  CHECK (partner_plan IN ('sms_only', 'sms_and_chat', 'full', 'chat_only'))
  NOT VALID;

ALTER TABLE public.partner_client_provisioning_jobs
  VALIDATE CONSTRAINT pcpj_partner_plan_chat_only_candidate;

ALTER TABLE public.partner_client_provisioning_jobs
  DROP CONSTRAINT partner_client_provisioning_jobs_partner_plan_check;

ALTER TABLE public.partner_client_provisioning_jobs
  RENAME CONSTRAINT pcpj_partner_plan_chat_only_candidate
  TO partner_client_provisioning_jobs_partner_plan_check;

-- Preserve the complete active function definitions, including their lock
-- order, search_path, volatility, security mode, return shape, defaults, and
-- grants. The strict occurrence counts fail the migration closed if an earlier
-- definition has drifted instead of silently rewriting an unexpected body.
DO $chat_only_function_allowlists$
DECLARE
  v_definition text;
  v_occurrences integer;
  v_old_allowlist constant text :=
    '(''sms_only'', ''sms_and_chat'', ''full'')';
  v_new_allowlist constant text :=
    '(''sms_only'', ''sms_and_chat'', ''full'', ''chat_only'')';
BEGIN
  v_definition := pg_get_functiondef(
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)'
      ::regprocedure
  );
  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_allowlist, '')))
    / length(v_old_allowlist);

  IF v_occurrences <> 2 THEN
    RAISE EXCEPTION
      'migration_057_assign_partner_plan_allowlist_drift: expected 2, found %',
      v_occurrences
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_definition, v_old_allowlist, v_new_allowlist);

  v_definition := pg_get_functiondef(
    'public.sync_stripe_subscription_if_business_active(uuid,text,text,text,text,timestamptz,timestamptz,text,text,text,timestamptz,boolean,timestamptz)'
      ::regprocedure
  );
  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_allowlist, '')))
    / length(v_old_allowlist);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'migration_057_stripe_sync_plan_allowlist_drift: expected 1, found %',
      v_occurrences
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_definition, v_old_allowlist, v_new_allowlist);

  v_definition := pg_get_functiondef(
    'public.list_admin_business_health_v2(uuid,text,text,uuid,text,text)'
      ::regprocedure
  );
  v_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_old_allowlist, '')))
    / length(v_old_allowlist);

  IF v_occurrences <> 1 THEN
    RAISE EXCEPTION
      'migration_057_admin_health_plan_allowlist_drift: expected 1, found %',
      v_occurrences
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_definition, v_old_allowlist, v_new_allowlist);
END;
$chat_only_function_allowlists$;

COMMENT ON COLUMN public.subscriptions.plan IS
  'Durable direct Stripe plan snapshot: sms_only, sms_and_chat, full, or chat_only. Sales availability is enforced outside this column.';

COMMENT ON COLUMN public.subscriptions.pending_plan IS
  'Pending direct plan transition, including chat_only. A stored value is not proof that a rollout gate is open.';

COMMENT ON COLUMN public.billing_usage_periods.plan IS
  'Plan snapshot for the usage period, including chat_only; limits are stored separately from the plan label.';

COMMENT ON COLUMN public.businesses.partner_plan IS
  'Plan entitlement selected by a partner for invoiced or comped billing, including chat_only; NULL in Stripe mode.';

COMMENT ON COLUMN public.partner_client_provisioning_jobs.partner_plan IS
  'Requested partner-managed plan, including chat_only. Application rollout gates control whether a new request may be created.';

COMMIT;
