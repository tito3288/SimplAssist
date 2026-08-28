BEGIN;

-- Carrier rejection recovery is support-owned. The businesses_update RLS
-- policy intentionally lets owners maintain their profile, so enforce the
-- narrower carrier-filing boundary in a trigger: an authenticated browser
-- must not drift fields that were submitted to the carrier after either the
-- brand or campaign is rejected. Trusted service-role support/provider flows
-- remain able to make an intentional correction.
CREATE OR REPLACE FUNCTION public.guard_customer_rejected_carrier_filing_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  -- Inspect OLD so the trusted webhook statement that first records the
  -- rejection is never blocked by this guard.
  IF OLD.brand_status IS DISTINCT FROM 'rejected'
     AND OLD.campaign_status IS DISTINCT FROM 'rejected' THEN
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.name,
    NEW.business_type,
    NEW.business_type_other,
    NEW.website_url,
    NEW.phone_number,
    NEW.email,
    NEW.address,
    NEW.city,
    NEW.state,
    NEW.zip,
    NEW.legal_business_name,
    NEW.business_entity_type,
    NEW.business_registration_state,
    NEW.tax_id_type,
    NEW.has_ein,
    NEW.a2p_brand_tier,
    NEW.ein,
    NEW.authorized_rep_name,
    NEW.authorized_rep_title,
    NEW.authorized_rep_email,
    NEW.authorized_rep_phone,
    NEW.use_case_description,
    NEW.estimated_monthly_volume,
    NEW.sample_messages,
    NEW.opt_in_description,
    NEW.privacy_terms_mode,
    NEW.privacy_url_override,
    NEW.terms_url_override,
    NEW.slug,
    NEW.primary_goal,
    NEW.goal_url
  ) IS DISTINCT FROM ROW(
    OLD.name,
    OLD.business_type,
    OLD.business_type_other,
    OLD.website_url,
    OLD.phone_number,
    OLD.email,
    OLD.address,
    OLD.city,
    OLD.state,
    OLD.zip,
    OLD.legal_business_name,
    OLD.business_entity_type,
    OLD.business_registration_state,
    OLD.tax_id_type,
    OLD.has_ein,
    OLD.a2p_brand_tier,
    OLD.ein,
    OLD.authorized_rep_name,
    OLD.authorized_rep_title,
    OLD.authorized_rep_email,
    OLD.authorized_rep_phone,
    OLD.use_case_description,
    OLD.estimated_monthly_volume,
    OLD.sample_messages,
    OLD.opt_in_description,
    OLD.privacy_terms_mode,
    OLD.privacy_url_override,
    OLD.terms_url_override,
    OLD.slug,
    OLD.primary_goal,
    OLD.goal_url
  ) THEN
    RAISE EXCEPTION
      'customer writes cannot change carrier-filed fields after rejection'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_customer_rejected_carrier_filing_fields
  ON public.businesses;

CREATE TRIGGER guard_customer_rejected_carrier_filing_fields
BEFORE UPDATE OF
  name,
  business_type,
  business_type_other,
  website_url,
  phone_number,
  email,
  address,
  city,
  state,
  zip,
  legal_business_name,
  business_entity_type,
  business_registration_state,
  tax_id_type,
  has_ein,
  a2p_brand_tier,
  ein,
  authorized_rep_name,
  authorized_rep_title,
  authorized_rep_email,
  authorized_rep_phone,
  use_case_description,
  estimated_monthly_volume,
  sample_messages,
  opt_in_description,
  privacy_terms_mode,
  privacy_url_override,
  terms_url_override,
  slug,
  primary_goal,
  goal_url
ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_rejected_carrier_filing_fields();

REVOKE ALL
  ON FUNCTION public.guard_customer_rejected_carrier_filing_fields()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.guard_customer_rejected_carrier_filing_fields() IS
  'Prevents direct customer writes from drifting carrier-filed inputs after a brand or campaign rejection; trusted server and support roles bypass the guard.';

-- Campaign message-flow copy also depends on ai_settings.language. Keep other
-- assistant-personality settings editable, but prevent direct customers from
-- changing, inserting, or deleting the filed language after rejection.
CREATE OR REPLACE FUNCTION public.guard_customer_rejected_campaign_language()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_business_id uuid;
  v_new_business_id uuid;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.business_id IS NOT DISTINCT FROM OLD.business_id
     AND NEW.language IS NOT DISTINCT FROM OLD.language THEN
    RETURN NEW;
  END IF;

  v_old_business_id := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE OLD.business_id
  END;
  v_new_business_id := CASE
    WHEN TG_OP = 'DELETE' THEN NULL
    ELSE NEW.business_id
  END;

  -- Serialize against the webhook's businesses-row UPDATE even while the
  -- current status is still non-rejected. If the webhook owns the row first,
  -- this waits and then observes its committed rejection; if this lock wins,
  -- the language change is ordered before the later carrier decision.
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id IN (v_old_business_id, v_new_business_id)
  ORDER BY business.id
  FOR SHARE;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE business.id IN (v_old_business_id, v_new_business_id)
      AND (
        business.brand_status = 'rejected'
        OR business.campaign_status = 'rejected'
      )
  ) THEN
    RAISE EXCEPTION
      'customer writes cannot change campaign language after rejection'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_customer_rejected_campaign_language
  ON public.ai_settings;

CREATE TRIGGER guard_customer_rejected_campaign_language
BEFORE INSERT OR UPDATE OR DELETE ON public.ai_settings
FOR EACH ROW
EXECUTE FUNCTION public.guard_customer_rejected_campaign_language();

REVOKE ALL
  ON FUNCTION public.guard_customer_rejected_campaign_language()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.guard_customer_rejected_campaign_language() IS
  'Prevents direct customers from drifting the assistant language used in a rejected carrier campaign while preserving trusted support access.';

COMMIT;
