BEGIN;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_claim_token uuid,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_claim_campaign_id text,
  ADD COLUMN IF NOT EXISTS telnyx_campaign_assignment_claim_profile_id text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_campaign_assignment_claim_shape;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_campaign_assignment_claim_shape
  CHECK (
    (
      telnyx_campaign_assignment_claim_token IS NULL
      AND telnyx_campaign_assignment_claimed_at IS NULL
      AND telnyx_campaign_assignment_claim_campaign_id IS NULL
      AND telnyx_campaign_assignment_claim_profile_id IS NULL
    )
    OR
    (
      telnyx_campaign_assignment_claim_token IS NOT NULL
      AND telnyx_campaign_assignment_claimed_at IS NOT NULL
      AND telnyx_campaign_assignment_claim_campaign_id IS NOT NULL
      AND telnyx_campaign_assignment_claim_profile_id IS NOT NULL
    )
  );

COMMENT ON COLUMN public.businesses.telnyx_campaign_assignment_claim_token IS
  'Short business-scoped lease owner for exact-number Telnyx campaign assignment.';
COMMENT ON COLUMN public.businesses.telnyx_campaign_assignment_claimed_at IS
  'Database-clock lease start or renewal for the assignment run.';
COMMENT ON COLUMN public.businesses.telnyx_campaign_assignment_claim_campaign_id IS
  'Campaign identity fenced by the active assignment intent.';
COMMENT ON COLUMN public.businesses.telnyx_campaign_assignment_claim_profile_id IS
  'Messaging-profile identity fenced by the active assignment intent.';

-- Customer policies permit owners to update their full business row. Keep the
-- assignment lease server-owned, and ensure every acquisition or renewal uses
-- the database clock rather than a caller-supplied timestamp.
CREATE OR REPLACE FUNCTION public.guard_business_campaign_assignment_claim_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.telnyx_campaign_assignment_claim_token IS NOT NULL
         OR NEW.telnyx_campaign_assignment_claimed_at IS NOT NULL
         OR NEW.telnyx_campaign_assignment_claim_campaign_id IS NOT NULL
         OR NEW.telnyx_campaign_assignment_claim_profile_id IS NOT NULL THEN
        RAISE EXCEPTION
          'customer writes cannot set campaign assignment claim fields'
          USING ERRCODE = '42501';
      END IF;
    ELSIF ROW(
      NEW.telnyx_campaign_assignment_claim_token,
      NEW.telnyx_campaign_assignment_claimed_at,
      NEW.telnyx_campaign_assignment_claim_campaign_id,
      NEW.telnyx_campaign_assignment_claim_profile_id
    ) IS DISTINCT FROM ROW(
      OLD.telnyx_campaign_assignment_claim_token,
      OLD.telnyx_campaign_assignment_claimed_at,
      OLD.telnyx_campaign_assignment_claim_campaign_id,
      OLD.telnyx_campaign_assignment_claim_profile_id
    ) THEN
      RAISE EXCEPTION
        'customer writes cannot change campaign assignment claim fields'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.telnyx_campaign_assignment_claim_token IS NOT NULL
     AND NEW.telnyx_campaign_assignment_claim_token =
           OLD.telnyx_campaign_assignment_claim_token
     AND ROW(
       NEW.telnyx_campaign_assignment_claim_campaign_id,
       NEW.telnyx_campaign_assignment_claim_profile_id
     ) IS DISTINCT FROM ROW(
       OLD.telnyx_campaign_assignment_claim_campaign_id,
       OLD.telnyx_campaign_assignment_claim_profile_id
     ) THEN
    RAISE EXCEPTION
      'campaign assignment claim identity cannot change without release'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.telnyx_campaign_assignment_claim_token IS NOT NULL THEN
      NEW.telnyx_campaign_assignment_claimed_at := clock_timestamp();
    END IF;
  ELSIF NEW.telnyx_campaign_assignment_claim_token IS NOT NULL
        AND (
          NEW.telnyx_campaign_assignment_claim_token IS DISTINCT FROM
            OLD.telnyx_campaign_assignment_claim_token
          OR NEW.telnyx_campaign_assignment_claimed_at IS DISTINCT FROM
            OLD.telnyx_campaign_assignment_claimed_at
        ) THEN
    IF NEW.telnyx_campaign_assignment_claim_token IS DISTINCT FROM
         OLD.telnyx_campaign_assignment_claim_token
       AND OLD.telnyx_campaign_assignment_claim_token IS NOT NULL
       AND OLD.telnyx_campaign_assignment_claimed_at IS NOT NULL
       AND OLD.telnyx_campaign_assignment_claimed_at >=
             clock_timestamp() - interval '60 seconds' THEN
      RAISE EXCEPTION
        'active campaign assignment claim cannot be replaced'
        USING ERRCODE = '55000';
    END IF;

    NEW.telnyx_campaign_assignment_claimed_at := clock_timestamp();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_campaign_assignment_claim_fields
  ON public.businesses;

CREATE TRIGGER guard_business_campaign_assignment_claim_fields
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_campaign_assignment_claim_fields();

-- A fresh assignment lease is a short mutual-exclusion window around the
-- provider mutation. Destructive/lifecycle changes must wait for that window to
-- finish so assignment authorization cannot disappear mid-flight. Assignment
-- claim fields themselves are intentionally absent from this comparison.
CREATE OR REPLACE FUNCTION public.guard_business_campaign_assignment_lifecycle_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  authorization_changed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.telnyx_campaign_assignment_claim_token IS NULL
       OR OLD.telnyx_campaign_assignment_claimed_at IS NULL
       OR OLD.telnyx_campaign_assignment_claimed_at <
            clock_timestamp() - interval '60 seconds' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'business lifecycle change blocked by active campaign assignment claim'
      USING ERRCODE = '55000';
  END IF;

  authorization_changed := ROW(
    NEW.owner_id,
    NEW.deleted_at,
    NEW.active_telnyx_release_run_id,
    NEW.telnyx_resource_state,
    NEW.telnyx_unique_claims_released_at,
    NEW.telnyx_submission_disabled,
    NEW.telnyx_brand_id,
    NEW.telnyx_campaign_id,
    NEW.telnyx_messaging_profile_id,
    NEW.brand_status,
    NEW.campaign_status
  ) IS DISTINCT FROM ROW(
    OLD.owner_id,
    OLD.deleted_at,
    OLD.active_telnyx_release_run_id,
    OLD.telnyx_resource_state,
    OLD.telnyx_unique_claims_released_at,
    OLD.telnyx_submission_disabled,
    OLD.telnyx_brand_id,
    OLD.telnyx_campaign_id,
    OLD.telnyx_messaging_profile_id,
    OLD.brand_status,
    OLD.campaign_status
  );

  IF OLD.telnyx_campaign_assignment_claim_token IS NULL
     OR OLD.telnyx_campaign_assignment_claimed_at IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.telnyx_campaign_assignment_claimed_at <
       clock_timestamp() - interval '60 seconds' THEN
    IF authorization_changed THEN
      NEW.telnyx_campaign_assignment_claim_token := NULL;
      NEW.telnyx_campaign_assignment_claimed_at := NULL;
      NEW.telnyx_campaign_assignment_claim_campaign_id := NULL;
      NEW.telnyx_campaign_assignment_claim_profile_id := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF authorization_changed THEN
    RAISE EXCEPTION
      'business lifecycle change blocked by active campaign assignment claim'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_campaign_assignment_lifecycle_fence
  ON public.businesses;

CREATE TRIGGER guard_business_campaign_assignment_lifecycle_fence
BEFORE UPDATE OR DELETE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_campaign_assignment_lifecycle_fence();

CREATE OR REPLACE FUNCTION public.guard_phone_campaign_assignment_authorization_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION
      'customer writes cannot insert managed phone numbers'
      USING ERRCODE = '42501';
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'customer writes cannot change managed phone numbers'
      USING ERRCODE = '42501';
  ELSE
    RAISE EXCEPTION
      'customer writes cannot delete managed phone numbers'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS guard_phone_campaign_assignment_authorization_fields
  ON public.phone_numbers;

CREATE TRIGGER guard_phone_campaign_assignment_authorization_fields
BEFORE INSERT OR UPDATE OR DELETE ON public.phone_numbers
FOR EACH ROW
EXECUTE FUNCTION public.guard_phone_campaign_assignment_authorization_fields();

CREATE OR REPLACE FUNCTION public.guard_phone_campaign_assignment_lifecycle_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_business_id uuid;
  has_fresh_claim boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(
      NEW.business_id,
      NEW.is_active,
      NEW.resource_status,
      NEW.phone_number,
      NEW.telnyx_phone_number_id
    ) IS NOT DISTINCT FROM ROW(
      OLD.business_id,
      OLD.is_active,
      OLD.resource_status,
      OLD.phone_number,
      OLD.telnyx_phone_number_id
    ) THEN
      RETURN NEW;
    END IF;

    target_business_id := NEW.business_id;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.businesses AS business
    WHERE (
      business.id = OLD.business_id
      OR (
        TG_OP = 'UPDATE'
        AND business.id = target_business_id
      )
    )
      AND business.telnyx_campaign_assignment_claim_token IS NOT NULL
      AND business.telnyx_campaign_assignment_claimed_at IS NOT NULL
      AND business.telnyx_campaign_assignment_claimed_at >=
            clock_timestamp() - interval '60 seconds'
  )
  INTO has_fresh_claim;

  IF has_fresh_claim THEN
    RAISE EXCEPTION
      'phone lifecycle change blocked by active campaign assignment claim'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_phone_campaign_assignment_lifecycle_fence
  ON public.phone_numbers;

CREATE TRIGGER guard_phone_campaign_assignment_lifecycle_fence
BEFORE UPDATE OR DELETE ON public.phone_numbers
FOR EACH ROW
EXECUTE FUNCTION public.guard_phone_campaign_assignment_lifecycle_fence();

REVOKE ALL ON FUNCTION
  public.guard_business_campaign_assignment_claim_fields()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_business_campaign_assignment_lifecycle_fence()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_phone_campaign_assignment_authorization_fields()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION
  public.guard_phone_campaign_assignment_lifecycle_fence()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
