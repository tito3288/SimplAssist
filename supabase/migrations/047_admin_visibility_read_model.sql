BEGIN;

-- Phase 3 Slice 1: one bounded, service-role-only read model for administrator
-- account health. This function deliberately projects operational state only:
-- no message content, OAuth credentials, AI prompt content, or provider payloads.

CREATE INDEX IF NOT EXISTS idx_messages_business_created_at
  ON public.messages (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_business_last_message_at
  ON public.conversations (business_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_business_active_created_at
  ON public.phone_numbers (business_id, is_active, created_at DESC)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_businesses_admin_created_at
  ON public.businesses (created_at DESC NULLS LAST, id DESC);

-- SECURITY INVOKER keeps the function inside the caller's authorization
-- boundary. Grant its sole executable role only the columns used below; in
-- particular, message content, OAuth credentials, AI prompts, and raw provider
-- payloads are not part of this read path.
GRANT SELECT (
  id, owner_id, name, email, website_url, business_type, created_at,
  deleted_at, deletion_scheduled_for, onboarding_completed_at,
  onboarding_step, partner_id, billing_mode, partner_plan, billing_pilot,
  billing_comped, billing_exempt, telnyx_submission_disabled,
  sms_overage_opt_in, a2p_risk_review_status, a2p_risk_review_message,
  onboarding_registration_status, onboarding_registration_started_at,
  brand_status, campaign_status, telnyx_messaging_profile_id,
  telnyx_campaign_id, pending_phone_number,
  pending_phone_number_failure_reason
) ON public.businesses TO service_role;

GRANT SELECT (id, name, slug)
  ON public.partners TO service_role;

GRANT SELECT (id, business_id, plan, status, cancel_at_period_end)
  ON public.subscriptions TO service_role;

GRANT SELECT (id, business_id, booking_enabled, booking_mode)
  ON public.ai_settings TO service_role;

GRANT SELECT (id, business_id, is_active)
  ON public.widget_configs TO service_role;

GRANT SELECT (id, business_id)
  ON public.google_calendar_tokens TO service_role;

GRANT SELECT (
  business_id, period_start, period_end, included_sms_parts,
  inbound_sms_parts, outbound_sms_parts, inbound_mms_events,
  outbound_mms_events
) ON public.billing_usage_periods TO service_role;

GRANT SELECT (
  business_id, phone_number, is_active,
  telnyx_campaign_assignment_status,
  telnyx_campaign_assignment_campaign_id
) ON public.phone_numbers TO service_role;

GRANT SELECT (
  id, business_id, auth_user_id, status, last_error_code, operation_token,
  operation_expires_at
) ON public.partner_client_provisioning_jobs TO service_role;

GRANT SELECT (business_id, created_at)
  ON public.messages TO service_role;

GRANT SELECT (business_id, last_message_at)
  ON public.conversations TO service_role;

CREATE FUNCTION public.list_admin_business_health(
  p_business_id uuid DEFAULT NULL,
  p_lifecycle text DEFAULT NULL,
  p_ownership text DEFAULT NULL,
  p_partner uuid DEFAULT NULL,
  p_plan text DEFAULT NULL,
  p_query text DEFAULT NULL
) RETURNS TABLE (
  business_id uuid,
  business_name text,
  business_email text,
  website_url text,
  business_type text,
  business_created_at timestamptz,
  snapshot_at timestamptz,
  deleted_at timestamptz,
  deletion_scheduled_for timestamptz,
  onboarding_completed_at timestamptz,
  onboarding_step text,
  partner_id uuid,
  partner_name text,
  partner_slug text,
  billing_mode text,
  partner_plan text,
  billing_pilot boolean,
  billing_comped boolean,
  billing_exempt boolean,
  telnyx_submission_disabled boolean,
  sms_overage_opt_in boolean,
  subscription_plan text,
  subscription_status text,
  subscription_cancel_at_period_end boolean,
  effective_plan text,
  usage_period_start timestamptz,
  usage_period_end timestamptz,
  usage_included_sms_parts integer,
  usage_inbound_sms_parts integer,
  usage_outbound_sms_parts integer,
  usage_inbound_mms_events integer,
  usage_outbound_mms_events integer,
  a2p_risk_review_status text,
  a2p_risk_review_message text,
  onboarding_registration_status text,
  onboarding_registration_started_at timestamptz,
  brand_status text,
  campaign_status text,
  telnyx_messaging_profile_id text,
  telnyx_campaign_id text,
  messaging_profile_configured boolean,
  campaign_configured boolean,
  pending_phone_number_present boolean,
  pending_phone_number_failed boolean,
  active_phone_count bigint,
  active_phone_number text,
  active_phone_assignment_status text,
  active_phone_assignment_campaign_id text,
  active_phone_assignment_matches_campaign boolean,
  active_phone_assignment_failed boolean,
  ai_configured boolean,
  ai_booking_enabled boolean,
  ai_booking_mode text,
  web_chat_enabled boolean,
  calendar_connected boolean,
  provisioning_job_count bigint,
  provisioning_status text,
  provisioning_needs_attention boolean,
  provisioning_invite_failed boolean,
  provisioning_lease_expired boolean,
  failed_setup boolean,
  failed_setup_reasons text[],
  last_activity_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_query text := NULLIF(btrim(p_query), '');
BEGIN
  IF p_lifecycle IS NOT NULL
     AND p_lifecycle NOT IN (
       'live',
       'onboarding',
       'past_due',
       'pending_deletion',
       'failed_setup'
     ) THEN
    RAISE EXCEPTION 'invalid_admin_lifecycle_filter'
      USING ERRCODE = '22023';
  END IF;

  IF p_ownership IS NOT NULL
     AND p_ownership NOT IN ('direct', 'partner') THEN
    RAISE EXCEPTION 'invalid_admin_ownership_filter'
      USING ERRCODE = '22023';
  END IF;

  IF p_plan IS NOT NULL
     AND p_plan NOT IN ('sms_only', 'sms_and_chat', 'full') THEN
    RAISE EXCEPTION 'invalid_admin_plan_filter'
      USING ERRCODE = '22023';
  END IF;

  IF v_query IS NOT NULL AND length(v_query) > 100 THEN
    RAISE EXCEPTION 'invalid_admin_query_filter'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH base_businesses AS (
    SELECT
      business.id,
      business.owner_id,
      business.name,
      business.email,
      business.website_url,
      business.business_type,
      business.created_at,
      business.deleted_at,
      business.deletion_scheduled_for,
      business.onboarding_completed_at,
      business.onboarding_step,
      business.partner_id,
      business.billing_mode,
      business.partner_plan,
      business.billing_pilot,
      business.billing_comped,
      business.billing_exempt,
      business.telnyx_submission_disabled,
      business.sms_overage_opt_in,
      business.a2p_risk_review_status,
      business.a2p_risk_review_message,
      business.onboarding_registration_status,
      business.onboarding_registration_started_at,
      business.brand_status,
      business.campaign_status,
      business.telnyx_messaging_profile_id,
      business.telnyx_campaign_id,
      business.pending_phone_number,
      business.pending_phone_number_failure_reason
    FROM public.businesses AS business
    WHERE (p_business_id IS NULL OR business.id = p_business_id)
      AND (
        p_ownership IS NULL
        OR (p_ownership = 'direct' AND business.partner_id IS NULL)
        OR (p_ownership = 'partner' AND business.partner_id IS NOT NULL)
      )
      -- A specific partner has meaning only inside partner ownership. This
      -- keeps a stale partner query parameter from narrowing direct/all views.
      AND (
        p_partner IS NULL
        OR p_ownership IS DISTINCT FROM 'partner'
        OR business.partner_id = p_partner
      )
      AND (
        v_query IS NULL
        OR position(lower(v_query) IN lower(COALESCE(business.name, ''))) > 0
        OR position(lower(v_query) IN lower(COALESCE(business.email, ''))) > 0
      )
  ),
  raw_snapshots AS (
    SELECT
      business.id AS snapshot_business_id,
      business.name AS snapshot_business_name,
      business.email AS snapshot_business_email,
      business.website_url AS snapshot_website_url,
      business.business_type AS snapshot_business_type,
      business.created_at AS snapshot_business_created_at,
      now() AS snapshot_snapshot_at,
      business.deleted_at AS snapshot_deleted_at,
      business.deletion_scheduled_for AS snapshot_deletion_scheduled_for,
      business.onboarding_completed_at AS snapshot_onboarding_completed_at,
      business.onboarding_step AS snapshot_onboarding_step,
      business.partner_id AS snapshot_partner_id,
      partner.name AS snapshot_partner_name,
      partner.slug AS snapshot_partner_slug,
      business.billing_mode AS snapshot_billing_mode,
      business.partner_plan AS snapshot_partner_plan,
      business.billing_pilot AS snapshot_billing_pilot,
      business.billing_comped AS snapshot_billing_comped,
      business.billing_exempt AS snapshot_billing_exempt,
      business.telnyx_submission_disabled
        AS snapshot_telnyx_submission_disabled,
      business.sms_overage_opt_in AS snapshot_sms_overage_opt_in,
      subscription.plan AS snapshot_subscription_plan,
      subscription.status AS snapshot_subscription_status,
      subscription.cancel_at_period_end
        AS snapshot_subscription_cancel_at_period_end,
      CASE
        WHEN subscription.id IS NOT NULL THEN subscription.plan
        WHEN business.billing_mode IN ('invoiced', 'comped')
          THEN business.partner_plan
        WHEN business.billing_mode = 'stripe'
             AND business.partner_plan IS NULL
             AND (
               business.billing_pilot
               OR business.billing_comped
               OR business.billing_exempt
             )
          THEN 'full'::text
        ELSE NULL
      END AS snapshot_effective_plan,
      usage.period_start AS snapshot_usage_period_start,
      usage.period_end AS snapshot_usage_period_end,
      usage.included_sms_parts AS snapshot_usage_included_sms_parts,
      usage.inbound_sms_parts AS snapshot_usage_inbound_sms_parts,
      usage.outbound_sms_parts AS snapshot_usage_outbound_sms_parts,
      usage.inbound_mms_events AS snapshot_usage_inbound_mms_events,
      usage.outbound_mms_events AS snapshot_usage_outbound_mms_events,
      business.a2p_risk_review_status
        AS snapshot_a2p_risk_review_status,
      business.a2p_risk_review_message
        AS snapshot_a2p_risk_review_message,
      business.onboarding_registration_status
        AS snapshot_onboarding_registration_status,
      business.onboarding_registration_started_at
        AS snapshot_onboarding_registration_started_at,
      business.brand_status AS snapshot_brand_status,
      business.campaign_status AS snapshot_campaign_status,
      business.telnyx_messaging_profile_id
        AS snapshot_telnyx_messaging_profile_id,
      business.telnyx_campaign_id AS snapshot_telnyx_campaign_id,
      business.telnyx_messaging_profile_id IS NOT NULL
        AS snapshot_messaging_profile_configured,
      business.telnyx_campaign_id IS NOT NULL
        AS snapshot_campaign_configured,
      business.pending_phone_number IS NOT NULL
        AS snapshot_pending_phone_number_present,
      business.pending_phone_number_failure_reason IS NOT NULL
        AS snapshot_pending_phone_number_failed,
      phone.active_phone_count AS snapshot_active_phone_count,
      phone.active_phone_number AS snapshot_active_phone_number,
      phone.assignment_status AS snapshot_active_phone_assignment_status,
      phone.assignment_campaign_id
        AS snapshot_active_phone_assignment_campaign_id,
      COALESCE(phone.assignment_matches_campaign, false)
        AS snapshot_active_phone_assignment_matches_campaign,
      ai.id IS NOT NULL AS snapshot_ai_configured,
      ai.booking_enabled AS snapshot_ai_booking_enabled,
      ai.booking_mode AS snapshot_ai_booking_mode,
      COALESCE(widget.is_active, false) AS snapshot_web_chat_enabled,
      calendar_token.id IS NOT NULL AS snapshot_calendar_connected,
      provisioning.job_count AS snapshot_provisioning_job_count,
      provisioning.status AS snapshot_provisioning_status,
      activity.last_activity_at AS snapshot_last_activity_at,
      COALESCE(phone.any_assignment_failed, false)
        AS snapshot_phone_assignment_failed,
      COALESCE(provisioning.needs_attention, false)
        AS snapshot_provisioning_needs_attention,
      COALESCE(provisioning.invite_failed, false)
        AS snapshot_provisioning_invite_failed,
      COALESCE(provisioning.lease_expired, false)
        AS snapshot_provisioning_lease_expired
    FROM base_businesses AS business
    LEFT JOIN public.partners AS partner
      ON partner.id = business.partner_id
    LEFT JOIN public.subscriptions AS subscription
      ON subscription.business_id = business.id
    LEFT JOIN public.ai_settings AS ai
      ON ai.business_id = business.id
    LEFT JOIN public.widget_configs AS widget
      ON widget.business_id = business.id
    LEFT JOIN public.google_calendar_tokens AS calendar_token
      ON calendar_token.business_id = business.id
    LEFT JOIN LATERAL (
      SELECT
        period.period_start,
        period.period_end,
        period.included_sms_parts,
        period.inbound_sms_parts,
        period.outbound_sms_parts,
        period.inbound_mms_events,
        period.outbound_mms_events
      FROM public.billing_usage_periods AS period
      WHERE period.business_id = business.id
      ORDER BY period.period_start DESC
      LIMIT 1
    ) AS usage ON true
    CROSS JOIN LATERAL (
      SELECT
        count(*)::bigint AS active_phone_count,
        CASE WHEN count(*) = 1 THEN min(number.phone_number) END
          AS active_phone_number,
        CASE
          WHEN count(*) = 1
            THEN min(number.telnyx_campaign_assignment_status)
        END AS assignment_status,
        CASE
          WHEN count(*) = 1
            THEN min(number.telnyx_campaign_assignment_campaign_id)
        END AS assignment_campaign_id,
        CASE
          WHEN count(*) = 1 THEN bool_and(
            number.telnyx_campaign_assignment_status = 'assigned'
            AND business.telnyx_campaign_id IS NOT NULL
            AND number.telnyx_campaign_assignment_campaign_id =
                  business.telnyx_campaign_id
          )
          ELSE false
        END AS assignment_matches_campaign,
        COALESCE(
          bool_or(number.telnyx_campaign_assignment_status = 'failed'),
          false
        ) AS any_assignment_failed
      FROM public.phone_numbers AS number
      WHERE number.business_id = business.id
        AND number.is_active IS TRUE
    ) AS phone
    CROSS JOIN LATERAL (
      SELECT
        count(job.id)::bigint AS job_count,
        CASE WHEN count(job.id) = 1 THEN min(job.status) END AS status,
        COALESCE(bool_or(job.status = 'needs_attention'), false)
          AS needs_attention,
        COALESCE(
          bool_or(
            job.status = 'invite_pending'
            AND job.last_error_code IS NOT NULL
          ),
          false
        ) AS invite_failed,
        COALESCE(
          bool_or(
            job.operation_token IS NOT NULL
            AND job.operation_expires_at <= now()
          ),
          false
        ) AS lease_expired
      FROM public.partner_client_provisioning_jobs AS job
      WHERE job.business_id = business.id
        OR (
          job.business_id IS NULL
          AND job.auth_user_id = business.owner_id
        )
    ) AS provisioning
    CROSS JOIN LATERAL (
      SELECT max(source.activity_at) AS last_activity_at
      FROM (
        SELECT max(message.created_at) AS activity_at
        FROM public.messages AS message
        WHERE message.business_id = business.id

        UNION ALL

        SELECT max(conversation.last_message_at) AS activity_at
        FROM public.conversations AS conversation
        WHERE conversation.business_id = business.id
      ) AS source
    ) AS activity
  ),
  snapshots AS (
    SELECT
      raw.*,
      array_remove(
        ARRAY[
          CASE
            WHEN raw.snapshot_onboarding_registration_status = 'failed'
              THEN 'registration_failed'
          END,
          CASE
            WHEN raw.snapshot_onboarding_registration_status = 'submitting'
                 AND (
                   raw.snapshot_onboarding_registration_started_at IS NULL
                   OR raw.snapshot_onboarding_registration_started_at <=
                        now() - interval '15 minutes'
                 )
              THEN 'registration_submission_stale'
          END,
          CASE
            WHEN raw.snapshot_a2p_risk_review_status = 'blocked'
              THEN 'risk_review_blocked'
          END,
          CASE
            WHEN raw.snapshot_brand_status = 'rejected'
              THEN 'brand_rejected'
          END,
          CASE
            WHEN raw.snapshot_campaign_status = 'rejected'
              THEN 'campaign_rejected'
          END,
          CASE
            WHEN raw.snapshot_phone_assignment_failed
              THEN 'phone_assignment_failed'
          END,
          CASE
            WHEN raw.snapshot_pending_phone_number_failed
              THEN 'pending_phone_failed'
          END,
          CASE
            WHEN raw.snapshot_provisioning_needs_attention
              THEN 'provisioning_needs_attention'
          END,
          CASE
            WHEN raw.snapshot_provisioning_invite_failed
              THEN 'provisioning_invite_failed'
          END,
          CASE
            WHEN raw.snapshot_provisioning_lease_expired
              THEN 'provisioning_lease_expired'
          END
        ]::text[],
        NULL
      ) AS snapshot_failed_setup_reasons
    FROM raw_snapshots AS raw
  ),
  filtered_snapshots AS (
    SELECT snapshot.*
    FROM snapshots AS snapshot
    WHERE (
      p_plan IS NULL
      OR snapshot.snapshot_effective_plan = p_plan
    )
      AND (
        p_lifecycle IS NULL
        OR (
          p_lifecycle = 'live'
          AND snapshot.snapshot_deleted_at IS NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NULL
          AND snapshot.snapshot_onboarding_completed_at IS NOT NULL
        )
        OR (
          p_lifecycle = 'onboarding'
          AND snapshot.snapshot_deleted_at IS NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NULL
          AND snapshot.snapshot_onboarding_completed_at IS NULL
        )
        OR (
          p_lifecycle = 'past_due'
          AND snapshot.snapshot_subscription_status = 'past_due'
        )
        OR (
          p_lifecycle = 'pending_deletion'
          AND snapshot.snapshot_deleted_at IS NOT NULL
          AND snapshot.snapshot_deletion_scheduled_for IS NOT NULL
        )
        OR (
          p_lifecycle = 'failed_setup'
          AND cardinality(snapshot.snapshot_failed_setup_reasons) > 0
        )
      )
  )
  SELECT
    snapshot.snapshot_business_id,
    snapshot.snapshot_business_name,
    snapshot.snapshot_business_email,
    snapshot.snapshot_website_url,
    snapshot.snapshot_business_type,
    snapshot.snapshot_business_created_at,
    snapshot.snapshot_snapshot_at,
    snapshot.snapshot_deleted_at,
    snapshot.snapshot_deletion_scheduled_for,
    snapshot.snapshot_onboarding_completed_at,
    snapshot.snapshot_onboarding_step,
    snapshot.snapshot_partner_id,
    snapshot.snapshot_partner_name,
    snapshot.snapshot_partner_slug,
    snapshot.snapshot_billing_mode,
    snapshot.snapshot_partner_plan,
    snapshot.snapshot_billing_pilot,
    snapshot.snapshot_billing_comped,
    snapshot.snapshot_billing_exempt,
    snapshot.snapshot_telnyx_submission_disabled,
    snapshot.snapshot_sms_overage_opt_in,
    snapshot.snapshot_subscription_plan,
    snapshot.snapshot_subscription_status,
    snapshot.snapshot_subscription_cancel_at_period_end,
    snapshot.snapshot_effective_plan,
    snapshot.snapshot_usage_period_start,
    snapshot.snapshot_usage_period_end,
    snapshot.snapshot_usage_included_sms_parts,
    snapshot.snapshot_usage_inbound_sms_parts,
    snapshot.snapshot_usage_outbound_sms_parts,
    snapshot.snapshot_usage_inbound_mms_events,
    snapshot.snapshot_usage_outbound_mms_events,
    snapshot.snapshot_a2p_risk_review_status,
    snapshot.snapshot_a2p_risk_review_message,
    snapshot.snapshot_onboarding_registration_status,
    snapshot.snapshot_onboarding_registration_started_at,
    snapshot.snapshot_brand_status,
    snapshot.snapshot_campaign_status,
    snapshot.snapshot_telnyx_messaging_profile_id,
    snapshot.snapshot_telnyx_campaign_id,
    snapshot.snapshot_messaging_profile_configured,
    snapshot.snapshot_campaign_configured,
    snapshot.snapshot_pending_phone_number_present,
    snapshot.snapshot_pending_phone_number_failed,
    snapshot.snapshot_active_phone_count,
    snapshot.snapshot_active_phone_number,
    snapshot.snapshot_active_phone_assignment_status,
    snapshot.snapshot_active_phone_assignment_campaign_id,
    snapshot.snapshot_active_phone_assignment_matches_campaign,
    snapshot.snapshot_phone_assignment_failed,
    snapshot.snapshot_ai_configured,
    snapshot.snapshot_ai_booking_enabled,
    snapshot.snapshot_ai_booking_mode,
    snapshot.snapshot_web_chat_enabled,
    snapshot.snapshot_calendar_connected,
    snapshot.snapshot_provisioning_job_count,
    snapshot.snapshot_provisioning_status,
    snapshot.snapshot_provisioning_needs_attention,
    snapshot.snapshot_provisioning_invite_failed,
    snapshot.snapshot_provisioning_lease_expired,
    cardinality(snapshot.snapshot_failed_setup_reasons) > 0,
    snapshot.snapshot_failed_setup_reasons,
    snapshot.snapshot_last_activity_at
  FROM filtered_snapshots AS snapshot
  ORDER BY
    snapshot.snapshot_business_created_at DESC NULLS LAST,
    snapshot.snapshot_business_id DESC
  LIMIT 75;
END;
$function$;

COMMENT ON FUNCTION public.list_admin_business_health(
  uuid, text, text, uuid, text, text
) IS
  'Bounded service-role-only administrator account health snapshot. Filters are applied before created-at ordering and the 75-row cap.';

REVOKE ALL ON FUNCTION public.list_admin_business_health(
  uuid, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.list_admin_business_health(
  uuid, text, text, uuid, text, text
) TO service_role;

COMMIT;
