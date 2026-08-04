BEGIN;

-- Migration 045 is already deployed. This surgical replacement closes the
-- remaining settings-row race without changing the RPC signature, privilege
-- boundary, workspace locks, token schema, or redirect contract.

CREATE OR REPLACE FUNCTION public.complete_google_calendar_oauth_connection(
  p_attempt_id uuid,
  p_business_id uuid,
  p_owner_user_id uuid,
  p_origin_partner_id uuid,
  p_origin_hostname text,
  p_access_token text,
  p_refresh_token text,
  p_token_expiry timestamptz,
  p_google_email text,
  p_calendar_id text DEFAULT 'primary'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_attempt public.google_calendar_oauth_attempts%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_partner public.partners%ROWTYPE;
  v_settings_id uuid;
  v_settings_updated integer;
BEGIN
  IF p_access_token IS NULL
     OR p_access_token = ''
     OR p_refresh_token IS NULL
     OR p_refresh_token = ''
     OR p_token_expiry IS NULL
     OR p_token_expiry <= now()
     OR p_calendar_id IS NULL
     OR btrim(p_calendar_id) = '' THEN
    RAISE EXCEPTION 'invalid_google_credentials'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.id = p_attempt_id;

  IF NOT FOUND
     OR v_attempt.status <> 'claimed'
     OR v_attempt.claimed_at IS NULL
     OR v_attempt.sanitized_result IS NOT NULL
     OR v_attempt.expires_at <= now()
     OR v_attempt.business_id IS DISTINCT FROM p_business_id
     OR v_attempt.owner_user_id IS DISTINCT FROM p_owner_user_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM p_origin_partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.owner_id = p_owner_user_id
    AND business.partner_id IS NOT DISTINCT FROM p_origin_partner_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'oauth_workspace_changed'
      USING ERRCODE = '55000';
  END IF;

  SELECT attempt.*
  INTO v_attempt
  FROM public.google_calendar_oauth_attempts AS attempt
  WHERE attempt.id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_attempt.status <> 'claimed'
     OR v_attempt.claimed_at IS NULL
     OR v_attempt.sanitized_result IS NOT NULL
     OR v_attempt.expires_at <= now()
     OR v_attempt.business_id IS DISTINCT FROM v_business.id
     OR v_attempt.owner_user_id IS DISTINCT FROM v_business.owner_id
     OR v_attempt.origin_partner_id IS DISTINCT FROM v_business.partner_id
     OR v_attempt.origin_hostname IS DISTINCT FROM p_origin_hostname THEN
    RAISE EXCEPTION 'oauth_attempt_invalid_or_expired'
      USING ERRCODE = '55000';
  END IF;

  IF p_origin_partner_id IS NOT NULL THEN
    SELECT partner.*
    INTO v_partner
    FROM public.partners AS partner
    WHERE partner.id = p_origin_partner_id
      AND partner.status = 'active'
      AND partner.domain_status = 'connected'
      AND partner.custom_domain = p_origin_hostname
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'oauth_workspace_changed'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  -- The settings row is part of the atomic connection contract. Lock it
  -- before credentials are written so a concurrent customer deletion either
  -- wins first and makes this transaction fail, or waits until the complete
  -- token/settings/attempt transition commits.
  SELECT settings.id
  INTO v_settings_id
  FROM public.ai_settings AS settings
  WHERE settings.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'google_calendar_settings_missing'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.google_calendar_tokens (
    business_id,
    access_token,
    refresh_token,
    token_expiry,
    google_email,
    calendar_id
  ) VALUES (
    p_business_id,
    p_access_token,
    p_refresh_token,
    p_token_expiry,
    p_google_email,
    p_calendar_id
  )
  ON CONFLICT (business_id) DO UPDATE
  SET access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      token_expiry = EXCLUDED.token_expiry,
      google_email = EXCLUDED.google_email,
      calendar_id = EXCLUDED.calendar_id,
      updated_at = now();

  UPDATE public.ai_settings
  SET booking_enabled = true,
      booking_mode = 'schedule_direct',
      updated_at = now()
  WHERE id = v_settings_id
    AND business_id = p_business_id;

  GET DIAGNOSTICS v_settings_updated = ROW_COUNT;
  IF v_settings_updated <> 1 THEN
    RAISE EXCEPTION 'google_calendar_settings_missing'
      USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.google_calendar_oauth_attempts
  WHERE id = v_attempt.id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) TO service_role;

COMMENT ON FUNCTION public.complete_google_calendar_oauth_connection(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text
) IS
  'Atomically requires Calendar settings, revalidates a claimed one-use OAuth attempt, writes credentials/settings, and removes the attempt.';

COMMIT;
