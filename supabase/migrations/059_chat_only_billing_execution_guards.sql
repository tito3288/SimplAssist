BEGIN;

-- A current subscription/partner-plan row is not enough to remember plan
-- family: either authority can be cleared before a second assignment. Keep a
-- durable per-business family claim until a future, explicit lifecycle flow
-- verifies that every retained provider resource can safely transition.
CREATE TABLE public.business_plan_family_locks (
  business_id uuid PRIMARY KEY
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  family text NOT NULL CHECK (family IN ('sms', 'chat_only')),
  claimed_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text NOT NULL CHECK (btrim(claimed_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_plan_family_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_plan_family_locks
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_plan_family_locks
  TO service_role;

CREATE FUNCTION public.infer_business_plan_family(
  p_business_id uuid
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_chat boolean;
  v_has_sms boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1
      FROM public.subscriptions AS subscription
      WHERE subscription.business_id = p_business_id
        AND (
          subscription.plan = 'chat_only'
          OR subscription.pending_plan = 'chat_only'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.partner_client_provisioning_jobs AS job
      WHERE job.business_id = p_business_id
        AND job.partner_plan = 'chat_only'
    )
    OR EXISTS (
      SELECT 1
      FROM public.businesses AS business
      WHERE business.id = p_business_id
        AND business.partner_plan = 'chat_only'
    )
    OR EXISTS (
      SELECT 1
      FROM public.billing_usage_periods AS usage_period
      WHERE usage_period.business_id = p_business_id
        AND usage_period.plan = 'chat_only'
    ),
    EXISTS (
      SELECT 1
      FROM public.subscriptions AS subscription
      WHERE subscription.business_id = p_business_id
        AND (
          subscription.plan IN ('sms_only', 'sms_and_chat', 'full')
          OR subscription.pending_plan IN (
            'sms_only', 'sms_and_chat', 'full'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.businesses AS business
      WHERE business.id = p_business_id
        AND (
          business.partner_plan IN ('sms_only', 'sms_and_chat', 'full')
          OR (
            business.billing_mode = 'stripe'
            AND business.partner_plan IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.subscriptions AS override_subscription
              WHERE override_subscription.business_id = business.id
            )
            AND (
              business.billing_pilot
              OR business.billing_comped
              OR business.billing_exempt
            )
          )
          OR business.telnyx_brand_id IS NOT NULL
          OR business.telnyx_campaign_id IS NOT NULL
          OR business.telnyx_messaging_profile_id IS NOT NULL
          OR business.telnyx_voice_application_id IS NOT NULL
          OR business.active_telnyx_release_run_id IS NOT NULL
          OR business.telnyx_resource_state IN (
            'active',
            'parked',
            'release_pending',
            'releasing',
            'blocked',
            'protected_hold'
          )
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.partner_client_provisioning_jobs AS job
      WHERE job.business_id = p_business_id
        AND job.partner_plan IN ('sms_only', 'sms_and_chat', 'full')
    )
    OR EXISTS (
      SELECT 1
      FROM public.billing_usage_periods AS usage_period
      WHERE usage_period.business_id = p_business_id
        AND usage_period.plan IN ('sms_only', 'sms_and_chat', 'full')
    )
    OR EXISTS (
      SELECT 1
      FROM public.phone_numbers AS phone_number
      WHERE phone_number.business_id = p_business_id
        AND phone_number.resource_status <> 'released'
        AND (
          phone_number.is_active
          OR phone_number.telnyx_phone_number_id IS NOT NULL
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.telnyx_managed_resources AS resource
      WHERE resource.business_id = p_business_id
        AND resource.local_claim_active
        AND resource.ownership_state <> 'released'
    )
  INTO v_has_chat, v_has_sms;

  IF v_has_chat AND v_has_sms THEN
    RAISE EXCEPTION 'business_plan_family_evidence_conflict'
      USING ERRCODE = '55000';
  END IF;

  IF v_has_chat THEN
    RETURN 'chat_only';
  END IF;
  IF v_has_sms THEN
    RETURN 'sms';
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.infer_business_plan_family(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.infer_business_plan_family(uuid)
  TO service_role;

INSERT INTO public.business_plan_family_locks (
  business_id,
  family,
  claimed_by
)
SELECT
  business.id,
  inferred.family,
  'migration_059_backfill'
FROM public.businesses AS business
CROSS JOIN LATERAL (
  SELECT public.infer_business_plan_family(business.id) AS family
) AS inferred
WHERE inferred.family IS NOT NULL;

CREATE FUNCTION public.claim_business_plan_family(
  p_business_id uuid,
  p_family text,
  p_claimed_by text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_existing_family text;
  v_existing_claimed_by text;
  v_inferred_family text;
  v_has_existing_lock boolean;
BEGIN
  IF p_business_id IS NULL
     OR p_family IS NULL
     OR p_family NOT IN ('sms', 'chat_only')
     OR p_claimed_by IS NULL
     OR btrim(p_claimed_by) = '' THEN
    RAISE EXCEPTION 'invalid_business_plan_family_claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF p_claimed_by = 'direct_checkout'
     AND (
       v_business.billing_mode <> 'stripe'
       OR v_business.partner_plan IS NOT NULL
       OR (
         p_family = 'chat_only'
         AND v_business.partner_id IS NOT NULL
       )
     ) THEN
    RETURN false;
  END IF;

  SELECT family, claimed_by
  INTO v_existing_family, v_existing_claimed_by
  FROM public.business_plan_family_locks
  WHERE business_id = v_business.id;
  v_has_existing_lock := FOUND;

  v_inferred_family := public.infer_business_plan_family(v_business.id);

  IF v_has_existing_lock THEN
    IF v_inferred_family IS NOT NULL
       AND v_inferred_family <> v_existing_family THEN
      RAISE EXCEPTION 'business_plan_family_evidence_conflict'
        USING ERRCODE = '55000';
    END IF;
    IF v_existing_family <> p_family THEN
      RAISE EXCEPTION 'plan_family_transition_not_supported'
        USING ERRCODE = '55000';
    END IF;

    -- A direct Chat Checkout can remain open after the family preflight.
    -- Do not let a same-family partner assignment change billing authority in
    -- that external-payment window; Stripe sync promotes the audit source once
    -- the subscription is real. An abandoned session intentionally remains a
    -- support-reviewed lock in this conservative phase.
    IF p_family = 'chat_only'
       AND p_claimed_by = 'partner_assignment'
       AND v_existing_claimed_by = 'direct_checkout' THEN
      RAISE EXCEPTION 'plan_family_transition_not_supported'
        USING ERRCODE = '55000';
    END IF;

    IF p_claimed_by IN ('stripe_sync', 'partner_assignment') THEN
      UPDATE public.business_plan_family_locks
      SET claimed_by = p_claimed_by,
          updated_at = now()
      WHERE business_id = v_business.id;
    END IF;
    RETURN true;
  END IF;

  IF v_inferred_family IS NOT NULL AND v_inferred_family <> p_family THEN
    RAISE EXCEPTION 'plan_family_transition_not_supported'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.business_plan_family_locks (
    business_id,
    family,
    claimed_by
  ) VALUES (
    v_business.id,
    COALESCE(v_inferred_family, p_family),
    p_claimed_by
  );

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_business_plan_family(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_business_plan_family(uuid, text, text)
  TO service_role;

-- Starting Checkout must claim the exact selected plan, not only its family.
-- New onboarding acquisition requires the advisory intent to remain unchanged
-- under the same business lock; canceled-subscription reacquisition and legacy
-- SMS billing paths explicitly opt out of that advisory prerequisite.
CREATE FUNCTION public.claim_direct_checkout_plan(
  p_business_id uuid,
  p_plan text,
  p_require_intent boolean
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
BEGIN
  IF p_business_id IS NULL
     OR p_plan IS NULL
     OR p_plan NOT IN ('sms_only', 'sms_and_chat', 'full', 'chat_only')
     OR p_require_intent IS NULL THEN
    RAISE EXCEPTION 'invalid_direct_checkout_plan_claim'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND
     OR v_business.billing_mode <> 'stripe'
     OR v_business.partner_plan IS NOT NULL
     OR (p_plan = 'chat_only' AND v_business.partner_id IS NOT NULL) THEN
    RETURN false;
  END IF;

  IF p_require_intent
     AND (
       v_business.partner_id IS NOT NULL
       OR v_business.onboarding_selected_plan IS DISTINCT FROM p_plan
       OR EXISTS (
         SELECT 1
         FROM public.subscriptions AS subscription
         WHERE subscription.business_id = v_business.id
       )
     ) THEN
    RETURN false;
  END IF;

  RETURN public.claim_business_plan_family(
    v_business.id,
    CASE WHEN p_plan = 'chat_only' THEN 'chat_only' ELSE 'sms' END,
    'direct_checkout'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_direct_checkout_plan(
  uuid, text, boolean
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_direct_checkout_plan(
  uuid, text, boolean
) TO service_role;

-- Advisory selection must stay consistent with any durable family claim. A
-- business-row lock serializes this compare-and-swap with Stripe sync, partner
-- assignment, and direct Checkout family claims without turning selection
-- itself into billing authority.
CREATE FUNCTION public.save_direct_onboarding_plan_intent(
  p_business_id uuid,
  p_owner_id uuid,
  p_expected_plan text,
  p_requested_plan text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_existing_family text;
  v_requested_family text;
BEGIN
  IF p_business_id IS NULL
     OR p_owner_id IS NULL
     OR p_requested_plan IS NULL
     OR p_requested_plan NOT IN (
       'sms_only',
       'sms_and_chat',
       'full',
       'chat_only'
     )
     OR (
       p_expected_plan IS NOT NULL
       AND p_expected_plan NOT IN (
         'sms_only',
         'sms_and_chat',
         'full',
         'chat_only'
       )
     ) THEN
    RAISE EXCEPTION 'invalid_direct_onboarding_plan_intent'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_business.billing_mode <> 'stripe'
     OR v_business.partner_id IS NOT NULL
     OR v_business.partner_plan IS NOT NULL
     OR v_business.onboarding_selected_plan IS DISTINCT FROM p_expected_plan
     OR EXISTS (
       SELECT 1
       FROM public.subscriptions AS subscription
       WHERE subscription.business_id = v_business.id
     ) THEN
    RETURN false;
  END IF;

  v_requested_family := CASE
    WHEN p_requested_plan = 'chat_only' THEN 'chat_only'
    ELSE 'sms'
  END;

  SELECT family
  INTO v_existing_family
  FROM public.business_plan_family_locks
  WHERE business_id = v_business.id;

  IF FOUND AND v_existing_family <> v_requested_family THEN
    RAISE EXCEPTION 'plan_family_transition_not_supported'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.businesses AS business
  SET onboarding_selected_plan = p_requested_plan,
      onboarding_last_saved_at = now()
  WHERE business.id = v_business.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.save_direct_onboarding_plan_intent(
  uuid, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.save_direct_onboarding_plan_intent(
  uuid, uuid, text, text
) TO service_role;

-- Owners retain the Phase 1 ability to edit advisory intent directly, but a
-- durable family claim is a stronger system-owned boundary. Because an UPDATE
-- already owns the business row, this trigger serializes with both RPCs above;
-- SECURITY DEFINER permits the narrow lookup without exposing the lock table.
CREATE FUNCTION public.guard_business_onboarding_plan_intent_family()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_family text;
  v_requested_family text;
BEGIN
  IF NEW.onboarding_selected_plan IS NOT DISTINCT FROM
       OLD.onboarding_selected_plan
     OR NEW.onboarding_selected_plan IS NULL THEN
    RETURN NEW;
  END IF;

  v_requested_family := CASE
    WHEN NEW.onboarding_selected_plan = 'chat_only' THEN 'chat_only'
    ELSE 'sms'
  END;

  SELECT family
  INTO v_existing_family
  FROM public.business_plan_family_locks
  WHERE business_id = NEW.id;

  IF FOUND AND v_existing_family <> v_requested_family THEN
    RAISE EXCEPTION 'plan_family_transition_not_supported'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_business_onboarding_plan_intent_family()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER guard_business_onboarding_plan_intent_family
BEFORE UPDATE OF onboarding_selected_plan ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_onboarding_plan_intent_family();

-- Chat Only never charges the SMS activation fee. Phase 1 admitted the plan
-- identifier before hosted acquisition existed, but rollout stayed off. Any
-- pre-existing fee-bearing row is therefore unexpected audit evidence: stop
-- for review instead of silently rewriting billing history.
DO $chat_only_setup_fee_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.subscriptions AS subscription
    WHERE subscription.plan = 'chat_only'
      AND (
        subscription.stripe_setup_fee_price_id IS NOT NULL
        OR subscription.setup_fee_paid_at IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'chat_only_setup_fee_history_requires_review'
      USING ERRCODE = '55000';
  END IF;
END;
$chat_only_setup_fee_preflight$;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_chat_only_has_no_setup_fee
  CHECK (
    plan <> 'chat_only'
    OR (
      stripe_setup_fee_price_id IS NULL
      AND setup_fee_paid_at IS NULL
    )
  ) NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_chat_only_has_no_setup_fee;

-- Preserve the complete active definitions and signatures while adding the
-- narrow Phase 2 guards. Strict occurrence counts turn upstream drift into a
-- failed migration instead of rewriting an unexpected function body.
DO $chat_only_stripe_sync_guard$
DECLARE
  v_definition text;
  v_lock_occurrences integer;
  v_insert_occurrences integer;
  v_insert_needle constant text :=
    '  INSERT INTO public.subscriptions (';
  v_guarded_insert constant text := $guarded_insert$
  IF p_plan = 'chat_only'
     AND EXISTS (
       SELECT 1
       FROM public.businesses AS business
       WHERE business.id = p_business_id
         AND (
           business.partner_id IS NOT NULL
           OR business.partner_plan IS NOT NULL
         )
     ) THEN
    RAISE EXCEPTION 'plan_family_transition_not_supported'
      USING ERRCODE = '55000';
  END IF;

  IF p_plan = 'chat_only'
     AND (
       p_stripe_setup_fee_price_id IS NOT NULL
       OR p_setup_fee_paid_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'chat_only_setup_fee_not_allowed'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.claim_business_plan_family(
    p_business_id,
    CASE WHEN p_plan = 'chat_only' THEN 'chat_only' ELSE 'sms' END,
    'stripe_sync'
  );

  INSERT INTO public.subscriptions ($guarded_insert$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.sync_stripe_subscription_if_business_active(uuid,text,text,text,text,timestamptz,timestamptz,text,text,text,timestamptz,boolean,timestamptz)'
      ::regprocedure
  );

  v_lock_occurrences :=
    (length(v_definition) - length(replace(v_definition, '  FOR SHARE;', '')))
    / length('  FOR SHARE;');
  IF v_lock_occurrences <> 1 THEN
    RAISE EXCEPTION
      'migration_059_stripe_sync_lock_drift: expected 1, found %',
      v_lock_occurrences
      USING ERRCODE = '55000';
  END IF;
  v_definition := replace(v_definition, '  FOR SHARE;', '  FOR UPDATE;');

  v_insert_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_insert_needle, '')))
    / length(v_insert_needle);
  IF v_insert_occurrences <> 1 THEN
    RAISE EXCEPTION
      'migration_059_stripe_sync_insert_drift: expected 1, found %',
      v_insert_occurrences
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_definition, v_insert_needle, v_guarded_insert);
END;
$chat_only_stripe_sync_guard$;

DO $chat_only_partner_transition_guard$
DECLARE
  v_definition text;
  v_update_occurrences integer;
  v_update_needle constant text :=
    '  UPDATE public.businesses AS business';
  v_guarded_update constant text := $guarded_update$
  IF v_resolved_partner_plan IS NOT NULL THEN
    PERFORM public.claim_business_plan_family(
      v_business.id,
      CASE
        WHEN v_resolved_partner_plan = 'chat_only' THEN 'chat_only'
        ELSE 'sms'
      END,
      'partner_assignment'
    );
  END IF;

  UPDATE public.businesses AS business$guarded_update$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.assign_business_partner_billing(uuid,uuid,text,uuid,text)'
      ::regprocedure
  );

  v_update_occurrences :=
    (length(v_definition) - length(replace(v_definition, v_update_needle, '')))
    / length(v_update_needle);
  IF v_update_occurrences <> 1 THEN
    RAISE EXCEPTION
      'migration_059_partner_assignment_update_drift: expected 1, found %',
      v_update_occurrences
      USING ERRCODE = '55000';
  END IF;

  EXECUTE replace(v_definition, v_update_needle, v_guarded_update);
END;
$chat_only_partner_transition_guard$;

-- Browser finalization and Stripe webhook delivery can race each other, a
-- cancellation event, or partner assignment. One business-row lock makes the
-- exact paid authority check and completion marker a single atomic decision.
CREATE FUNCTION public.finalize_chat_only_onboarding_if_paid(
  p_business_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_was_incomplete boolean;
  v_business_ready boolean;
  v_hours_count integer;
  v_service_count integer;
  v_faq_count integer;
BEGIN
  IF p_business_id IS NULL
     OR p_stripe_customer_id IS NULL
     OR btrim(p_stripe_customer_id) = ''
     OR p_stripe_subscription_id IS NULL
     OR btrim(p_stripe_subscription_id) = '' THEN
    RAISE EXCEPTION 'invalid_chat_only_finalize_payload'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    business.id,
    business.onboarding_completed_at IS NULL,
    business.primary_goal IS NOT NULL
      AND business.name IS NOT NULL
      AND business.name <> ''
      AND business.name <> 'My Business'
      AND business.business_type IS NOT NULL
      AND business.phone_number IS NOT NULL
      AND business.phone_number <> ''
      AND business.email IS NOT NULL
      AND business.email <> ''
      AND business.address IS NOT NULL
      AND business.address <> ''
      AND business.city IS NOT NULL
      AND business.city <> ''
      AND business.state IS NOT NULL
      AND business.state <> ''
      AND business.zip IS NOT NULL
      AND business.zip <> ''
  INTO v_business_id, v_was_incomplete, v_business_ready
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
    AND business.billing_mode = 'stripe'
    AND business.partner_id IS NULL
    AND business.partner_plan IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.subscriptions AS subscription
  JOIN public.business_plan_family_locks AS family_lock
    ON family_lock.business_id = subscription.business_id
   AND family_lock.family = 'chat_only'
  WHERE subscription.business_id = v_business_id
    AND subscription.plan = 'chat_only'
    AND subscription.status IN ('active', 'trialing')
    AND subscription.stripe_customer_id = p_stripe_customer_id
    AND subscription.stripe_subscription_id = p_stripe_subscription_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_business_ready IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Hours and AI settings do not use the knowledge-quality business lock, so
  -- hold their current rows through the completion write. With the unique
  -- business/day constraint, seven rows means every day is represented.
  SELECT count(*)
  INTO v_hours_count
  FROM (
    SELECT business_hour.id
    FROM public.business_hours AS business_hour
    WHERE business_hour.business_id = v_business_id
    FOR SHARE
  ) AS locked_business_hour;

  IF v_hours_count < 7 THEN
    RETURN false;
  END IF;

  PERFORM 1
  FROM public.ai_settings AS ai_setting
  WHERE ai_setting.business_id = v_business_id
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Service/FAQ mutation guards also take this business row FOR UPDATE, so
  -- these normalized counts cannot be degraded between this read and marking
  -- onboarding complete. Match the application quality policy exactly.
  SELECT count(DISTINCT public.normalize_ai_knowledge_key(service.name))
  INTO v_service_count
  FROM public.services AS service
  WHERE service.business_id = v_business_id
    AND service.is_active IS TRUE
    AND public.normalize_ai_knowledge_key(service.name) <> '';

  IF v_service_count < 3 THEN
    RETURN false;
  END IF;

  SELECT count(DISTINCT public.normalize_ai_knowledge_key(faq.question))
  INTO v_faq_count
  FROM public.faqs AS faq
  WHERE faq.business_id = v_business_id
    AND faq.is_active IS TRUE
    AND public.normalize_ai_knowledge_key(faq.question) <> ''
    AND public.normalize_ai_knowledge_key(faq.answer) <> ''
    AND char_length(faq.answer) <= 2000;

  IF v_faq_count < 3 THEN
    RETURN false;
  END IF;

  UPDATE public.businesses AS business
  SET onboarding_step = 'complete',
      onboarding_completed_at = COALESCE(
        business.onboarding_completed_at,
        now()
      ),
      onboarding_last_saved_at = CASE
        WHEN v_was_incomplete THEN now()
        ELSE business.onboarding_last_saved_at
      END
  WHERE business.id = v_business_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_chat_only_onboarding_if_paid(
  uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.finalize_chat_only_onboarding_if_paid(
  uuid, text, text
) TO service_role;

COMMENT ON CONSTRAINT subscriptions_chat_only_has_no_setup_fee
  ON public.subscriptions IS
  'Chat Only has no SMS activation fee; both setup-fee history fields must remain NULL.';

COMMENT ON TABLE public.business_plan_family_locks IS
  'Service-owned durable SMS-versus-Chat-Only family claim. Unassignment does not clear it; a future lifecycle flow must explicitly authorize transitions.';

COMMENT ON FUNCTION public.infer_business_plan_family(uuid) IS
  'Service-only evidence resolver for subscription, partner, usage, and retained Telnyx/SMS resource history. Pending local number selection alone is not evidence.';

COMMENT ON FUNCTION public.claim_business_plan_family(uuid, text, text) IS
  'Service-only business-locked, idempotent plan-family claim; conflicting durable or inferred evidence raises plan_family_transition_not_supported.';

COMMENT ON FUNCTION public.claim_direct_checkout_plan(
  uuid, text, boolean
) IS
  'Service-only exact-plan Checkout claim; optionally requires unchanged direct onboarding intent and no subscription under the family-claim business lock.';

COMMENT ON FUNCTION public.save_direct_onboarding_plan_intent(
  uuid, uuid, text, text
) IS
  'Service-only business-locked compare-and-swap for direct advisory plan intent; subscriptions, partner authority, and opposing durable family locks fail closed.';

COMMENT ON FUNCTION public.guard_business_onboarding_plan_intent_family() IS
  'Allows owner advisory intent edits only when they do not contradict a durable system-owned plan-family lock.';

COMMENT ON FUNCTION public.finalize_chat_only_onboarding_if_paid(
  uuid, text, text
) IS
  'Service-role-only atomic, idempotent Chat Only onboarding completion after exact active/trialing direct Stripe authority is synchronized.';

COMMIT;
