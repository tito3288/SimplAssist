-- Safe reuse of an existing 10DLC brand in SimplAssist's Telnyx account.
--
-- This migration is deliberately provider-call free. It adds:
--   * one retained SimplAssist business per normalized EIN;
--   * private admin-only brand-link reservation/approval state;
--   * provenance so imported brands can never enter delete/refile recovery;
--   * atomic link lifecycle RPCs used by trusted server code;
--   * direct-client write guards for registration authorization state; and
--   * final-cleanup support based on the exact migration-029 function body.

-- ============================================================================
-- A. Fail-closed EIN preflight + database guarantee
-- ============================================================================
-- REVIEW ONLY -- run these two redacted queries before `supabase db push`.
-- The first returns only the number of duplicate normalized-EIN groups:
--
--   SELECT count(*) AS duplicate_normalized_ein_groups
--   FROM (
--     SELECT 1
--     FROM public.businesses
--     WHERE ein IS NOT NULL
--     GROUP BY regexp_replace(ein, '[^0-9]', '', 'g')
--     HAVING count(*) > 1
--   ) AS duplicate_groups;
--
-- If that count is nonzero, this second query identifies the affected rows
-- without printing the EIN itself:
--
--   SELECT array_agg(id ORDER BY id) AS business_ids, count(*) AS row_count
--   FROM public.businesses
--   WHERE ein IS NOT NULL
--   GROUP BY regexp_replace(ein, '[^0-9]', '', 'g')
--   HAVING count(*) > 1;
--
-- If duplicates are found: stop. Do not auto-merge, delete, or choose a row.
-- Review ownership/account history and resolve each group in a separately
-- approved cleanup before applying this migration. The executable guards below
-- still abort if review was skipped or data changed after the review.

DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE ein IS NOT NULL
      AND ein !~ '^[0-9]{2}-[0-9]{7}$'
  ) THEN
    RAISE EXCEPTION
      'cannot add EIN constraints: non-canonical EIN values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE ein IS NOT NULL
    GROUP BY regexp_replace(ein, '[^0-9]', '', 'g')
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot add EIN uniqueness: duplicate normalized EIN values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE telnyx_brand_id IS NOT NULL
    GROUP BY lower(telnyx_brand_id)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'cannot add Telnyx brand uniqueness: case-variant brand IDs exist';
  END IF;
END;
$migration_guard$;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_ein_format_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_ein_format_check
  CHECK (ein IS NULL OR ein ~ '^[0-9]{2}-[0-9]{7}$')
  NOT VALID;

ALTER TABLE public.businesses
  VALIDATE CONSTRAINT businesses_ein_format_check;

-- The format constraint makes replace('-', '') a complete normalization and
-- avoids relying on a regular-expression function in the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS businesses_normalized_ein_unique
  ON public.businesses ((replace(ein, '-', '')))
  WHERE ein IS NOT NULL;

-- ============================================================================
-- B. Active-brand provenance
-- ============================================================================

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS telnyx_brand_source text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_telnyx_brand_source_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_telnyx_brand_source_check
  CHECK (
    telnyx_brand_source IS NULL
    OR telnyx_brand_source IN (
      'created_by_simplassist',
      'linked_existing'
    )
  );

UPDATE public.businesses
SET telnyx_brand_source = 'created_by_simplassist'
WHERE telnyx_brand_id IS NOT NULL
  AND telnyx_brand_source IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS businesses_telnyx_brand_id_lower_unique
  ON public.businesses (lower(telnyx_brand_id))
  WHERE telnyx_brand_id IS NOT NULL;

-- Compatibility for migration-first deployment: old app code that writes a
-- freshly-created brand ID still receives safe created_by_simplassist
-- provenance. Clearing a rejected created brand also clears provenance.
CREATE OR REPLACE FUNCTION public.maintain_telnyx_brand_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.telnyx_brand_source = 'linked_existing'
     AND EXISTS (
       SELECT 1
       FROM public.telnyx_brand_link_requests AS request
       WHERE request.business_id = OLD.id
         AND request.status = 'consumed'
     ) THEN
    IF NEW.telnyx_brand_id IS DISTINCT FROM OLD.telnyx_brand_id
       OR NEW.telnyx_brand_source IS DISTINCT FROM 'linked_existing' THEN
      RAISE EXCEPTION
        'consumed linked-existing brand attachment cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.telnyx_brand_id IS NULL THEN
    NEW.telnyx_brand_source := NULL;
  ELSIF TG_OP = 'UPDATE'
        AND OLD.telnyx_brand_source = 'linked_existing'
        AND NEW.telnyx_brand_id IS NOT DISTINCT FROM OLD.telnyx_brand_id THEN
    IF NEW.telnyx_brand_source IS NULL THEN
      NEW.telnyx_brand_source := 'linked_existing';
    ELSIF NEW.telnyx_brand_source <> 'linked_existing' THEN
      RAISE EXCEPTION
        'linked-existing brand provenance cannot be downgraded'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.telnyx_brand_source IS NULL THEN
    NEW.telnyx_brand_source := 'created_by_simplassist';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintain_telnyx_brand_source
  ON public.businesses;

CREATE TRIGGER maintain_telnyx_brand_source
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.maintain_telnyx_brand_source();

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_telnyx_brand_source_consistency_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_telnyx_brand_source_consistency_check
  CHECK (
    (telnyx_brand_id IS NULL AND telnyx_brand_source IS NULL)
    OR
    (telnyx_brand_id IS NOT NULL AND telnyx_brand_source IS NOT NULL)
  )
  NOT VALID;

ALTER TABLE public.businesses
  VALIDATE CONSTRAINT businesses_telnyx_brand_source_consistency_check;

COMMENT ON COLUMN public.businesses.telnyx_brand_id IS
  'Telnyx internal 10DLC brandId used by API calls; not the public TCR brand ID such as BL69PDP.';

COMMENT ON COLUMN public.businesses.telnyx_brand_source IS
  'How the current brand was obtained: created_by_simplassist or linked_existing; NULL when no current brand is attached.';

-- ============================================================================
-- C. Private existing-brand link state + PII-free audit
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telnyx_brand_link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL UNIQUE
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  tcr_brand_id text NOT NULL,
  telnyx_brand_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending_admin'
    CHECK (
      status IN (
        'pending_admin',
        'approved',
        'blocked',
        'consumed'
      )
    ),
  identity_fingerprint text,
  inspected_at timestamptz NOT NULL DEFAULT now(),
  inspected_by text NOT NULL,
  approved_at timestamptz,
  approved_by text,
  consumed_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telnyx_brand_link_requests_tcr_format_check
    CHECK (
      tcr_brand_id = upper(btrim(tcr_brand_id))
      AND btrim(tcr_brand_id) <> ''
      AND tcr_brand_id ~ '^[A-Z0-9_-]{1,64}$'
    ),
  CONSTRAINT telnyx_brand_link_requests_internal_id_check
    CHECK (
      telnyx_brand_id = lower(btrim(telnyx_brand_id))
      AND telnyx_brand_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ),
  CONSTRAINT telnyx_brand_link_requests_actor_check
    CHECK (
      btrim(inspected_by) <> ''
      AND length(inspected_by) <= 128
      AND (
        approved_by IS NULL
        OR (
          btrim(approved_by) <> ''
          AND length(approved_by) <= 128
        )
      )
    ),
  CONSTRAINT telnyx_brand_link_requests_error_code_check
    CHECK (
      last_error_code IS NULL
      OR last_error_code ~ '^[a-z0-9_]{1,100}$'
    ),
  CONSTRAINT telnyx_brand_link_requests_fingerprint_check
    CHECK (
      identity_fingerprint IS NULL
      OR identity_fingerprint ~ '^[0-9a-f]{64}$'
    ),
  CONSTRAINT telnyx_brand_link_requests_approval_check
    CHECK (
      status NOT IN ('approved', 'consumed')
      OR (
        identity_fingerprint IS NOT NULL
        AND approved_at IS NOT NULL
        AND approved_by IS NOT NULL
      )
    ),
  CONSTRAINT telnyx_brand_link_requests_consumed_check
    CHECK (
      (status = 'consumed' AND consumed_at IS NOT NULL)
      OR
      (status <> 'consumed' AND consumed_at IS NULL)
    ),
  CONSTRAINT telnyx_brand_link_requests_blocked_reason_check
    CHECK (
      status <> 'blocked'
      OR last_error_code IS NOT NULL
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS telnyx_brand_link_requests_tcr_unique
  ON public.telnyx_brand_link_requests (upper(tcr_brand_id));

CREATE UNIQUE INDEX IF NOT EXISTS telnyx_brand_link_requests_internal_unique
  ON public.telnyx_brand_link_requests (lower(telnyx_brand_id));

DROP TRIGGER IF EXISTS set_updated_at_telnyx_brand_link_requests
  ON public.telnyx_brand_link_requests;

CREATE TRIGGER set_updated_at_telnyx_brand_link_requests
BEFORE UPDATE ON public.telnyx_brand_link_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.telnyx_brand_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL
    REFERENCES public.businesses(id) ON DELETE CASCADE,
  request_id uuid
    REFERENCES public.telnyx_brand_link_requests(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  status text,
  reason_code text,
  tcr_brand_id text,
  telnyx_brand_id text,
  actor_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telnyx_brand_link_events_type_check
    CHECK (event_type ~ '^[a-z0-9_]{1,100}$'),
  CONSTRAINT telnyx_brand_link_events_status_check
    CHECK (status IS NULL OR status ~ '^[a-z0-9_]{1,100}$'),
  CONSTRAINT telnyx_brand_link_events_reason_check
    CHECK (reason_code IS NULL OR reason_code ~ '^[a-z0-9_]{1,100}$'),
  CONSTRAINT telnyx_brand_link_events_tcr_check
    CHECK (
      tcr_brand_id IS NULL
      OR (
        tcr_brand_id = upper(btrim(tcr_brand_id))
        AND tcr_brand_id ~ '^[A-Z0-9_-]{1,64}$'
      )
    ),
  CONSTRAINT telnyx_brand_link_events_internal_id_check
    CHECK (
      telnyx_brand_id IS NULL
      OR (
        telnyx_brand_id = lower(btrim(telnyx_brand_id))
        AND telnyx_brand_id ~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      )
    ),
  CONSTRAINT telnyx_brand_link_events_actor_check
    CHECK (
      actor_user_id IS NULL
      OR (
        btrim(actor_user_id) <> ''
        AND length(actor_user_id) <= 128
      )
    )
);

CREATE INDEX IF NOT EXISTS telnyx_brand_link_events_business_created
  ON public.telnyx_brand_link_events (business_id, created_at DESC);

ALTER TABLE public.telnyx_brand_link_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telnyx_brand_link_events ENABLE ROW LEVEL SECURITY;

-- No anon/authenticated policies by design. Admin routes use supabaseAdmin.
REVOKE ALL ON TABLE public.telnyx_brand_link_requests
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.telnyx_brand_link_events
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.telnyx_brand_link_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.telnyx_brand_link_events TO service_role;

COMMENT ON TABLE public.telnyx_brand_link_requests IS
  'Service-role-only reservation and approval state for linking a pre-existing brand in SimplAssist''s own Telnyx account.';

COMMENT ON COLUMN public.telnyx_brand_link_requests.identity_fingerprint IS
  'Server-only SHA-256 fingerprint of normalized local identity fields; never expose to customers.';

COMMENT ON TABLE public.telnyx_brand_link_events IS
  'Service-role-only, PII-free transition audit for existing-brand inspection and linking.';

-- ============================================================================
-- D. Server-only identity fingerprint + immediate invalidation
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.telnyx_brand_link_identity_fingerprint(
  p_business_id uuid
) RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT encode(
    extensions.digest(
      convert_to(
        jsonb_build_array(
          b.has_ein,
          regexp_replace(b.ein, '[^0-9]', '', 'g'),
          upper(
            regexp_replace(
              btrim(b.legal_business_name),
              '[[:space:]]+',
              ' ',
              'g'
            )
          ),
          lower(btrim(b.business_entity_type)),
          upper(btrim(b.business_registration_state)),
          upper(btrim(b.state)),
          regexp_replace(b.zip, '[^0-9]', '', 'g')
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  FROM public.businesses AS b
  WHERE b.id = p_business_id
    AND b.has_ein IS TRUE
    AND b.ein IS NOT NULL
    AND b.legal_business_name IS NOT NULL
    AND btrim(b.legal_business_name) <> ''
    AND b.business_entity_type IS NOT NULL
    AND b.business_registration_state IS NOT NULL
    AND btrim(b.business_registration_state) <> ''
    AND b.state IS NOT NULL
    AND btrim(b.state) <> ''
    AND b.zip IS NOT NULL
    AND btrim(b.zip) <> '';
$$;

CREATE OR REPLACE FUNCTION public.invalidate_telnyx_brand_link_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.telnyx_brand_link_requests%ROWTYPE;
BEGIN
  SELECT *
  INTO v_request
  FROM public.telnyx_brand_link_requests
  WHERE business_id = NEW.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Once consumed, the linked carrier identity is active. Direct DB writes
  -- must not drift the stored legal identity away from that brand.
  IF v_request.status = 'consumed' THEN
    RAISE EXCEPTION
      'carrier identity cannot change after brand-link consumption'
      USING ERRCODE = '42501';
  END IF;

  IF v_request.status = 'approved' THEN
    INSERT INTO public.telnyx_brand_link_events (
      business_id,
      request_id,
      event_type,
      status,
      reason_code,
      tcr_brand_id,
      telnyx_brand_id,
      actor_user_id
    ) VALUES (
      NEW.id,
      v_request.id,
      'approval_invalidated',
      'pending_admin',
      'business_identity_changed',
      v_request.tcr_brand_id,
      v_request.telnyx_brand_id,
      auth.uid()::text
    );

    UPDATE public.telnyx_brand_link_requests
    SET status = 'pending_admin',
        identity_fingerprint = NULL,
        approved_at = NULL,
        approved_by = NULL,
        last_error_code = 'business_identity_changed',
        updated_at = now()
    WHERE id = v_request.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invalidate_telnyx_brand_link_on_identity_change
  ON public.businesses;

CREATE TRIGGER invalidate_telnyx_brand_link_on_identity_change
AFTER UPDATE OF
  has_ein,
  ein,
  legal_business_name,
  business_entity_type,
  business_registration_state,
  state,
  zip
ON public.businesses
FOR EACH ROW
WHEN (
  OLD.has_ein IS DISTINCT FROM NEW.has_ein
  OR OLD.ein IS DISTINCT FROM NEW.ein
  OR OLD.legal_business_name IS DISTINCT FROM NEW.legal_business_name
  OR OLD.business_entity_type IS DISTINCT FROM NEW.business_entity_type
  OR OLD.business_registration_state IS DISTINCT FROM NEW.business_registration_state
  OR OLD.state IS DISTINCT FROM NEW.state
  OR OLD.zip IS DISTINCT FROM NEW.zip
)
EXECUTE FUNCTION public.invalidate_telnyx_brand_link_on_identity_change();

-- ============================================================================
-- E. Direct-client authorization guard
-- ============================================================================
-- businesses_update currently permits owner writes to the full row. Normal
-- onboarding/risk/provider writes already go through trusted server routes;
-- reject direct anon/authenticated changes to their authorization state.

CREATE OR REPLACE FUNCTION public.guard_business_telnyx_authorization_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.telnyx_brand_id IS NOT NULL
       OR NEW.telnyx_brand_source IS NOT NULL
       OR NEW.telnyx_campaign_id IS NOT NULL
       OR NEW.telnyx_messaging_profile_id IS NOT NULL
       OR NEW.telnyx_voice_application_id IS NOT NULL
       OR NEW.brand_status IS NOT NULL
       OR NEW.brand_status_updated_at IS NOT NULL
       OR NEW.brand_rejection_reason IS NOT NULL
       OR NEW.campaign_status IS NOT NULL
       OR NEW.campaign_status_updated_at IS NOT NULL
       OR NEW.campaign_rejection_reason IS NOT NULL
       OR NEW.compliance_info_completed_at IS NOT NULL
       OR COALESCE(NEW.onboarding_registration_status, 'not_started') <> 'not_started'
       OR NEW.onboarding_registration_started_at IS NOT NULL
       OR NEW.onboarding_registration_submitted_at IS NOT NULL
       OR NEW.onboarding_registration_error IS NOT NULL
       OR NEW.onboarding_completed_at IS NOT NULL
       OR COALESCE(NEW.a2p_risk_review_status, 'not_started') <> 'not_started'
       OR NEW.a2p_risk_review_input_hash IS NOT NULL
       OR NEW.a2p_risk_review_message IS NOT NULL
       OR NEW.a2p_risk_review_reason IS NOT NULL
       OR NEW.a2p_risk_review_findings IS NOT NULL
       OR NEW.a2p_risk_review_customer_answer IS NOT NULL
       OR NEW.a2p_risk_review_customer_selections IS NOT NULL
       OR NEW.a2p_risk_review_scanned_at IS NOT NULL
       OR NEW.a2p_risk_review_notified_at IS NOT NULL
       OR NEW.a2p_risk_review_reviewed_at IS NOT NULL
       OR NEW.a2p_risk_review_reviewed_by IS NOT NULL
       OR NEW.a2p_risk_review_override_note IS NOT NULL
       OR NEW.a2p_risk_review_updated_at IS NOT NULL THEN
      RAISE EXCEPTION
        'customer writes cannot set protected registration fields'
        USING ERRCODE = '42501';
    END IF;
  ELSIF ROW(
    NEW.telnyx_brand_id,
    NEW.telnyx_brand_source,
    NEW.telnyx_campaign_id,
    NEW.telnyx_messaging_profile_id,
    NEW.telnyx_voice_application_id,
    NEW.brand_status,
    NEW.brand_status_updated_at,
    NEW.brand_rejection_reason,
    NEW.campaign_status,
    NEW.campaign_status_updated_at,
    NEW.campaign_rejection_reason,
    NEW.compliance_info_completed_at,
    NEW.onboarding_registration_status,
    NEW.onboarding_registration_started_at,
    NEW.onboarding_registration_submitted_at,
    NEW.onboarding_registration_error,
    NEW.onboarding_completed_at,
    NEW.a2p_risk_review_status,
    NEW.a2p_risk_review_input_hash,
    NEW.a2p_risk_review_message,
    NEW.a2p_risk_review_reason,
    NEW.a2p_risk_review_findings,
    NEW.a2p_risk_review_customer_answer,
    NEW.a2p_risk_review_customer_selections,
    NEW.a2p_risk_review_scanned_at,
    NEW.a2p_risk_review_notified_at,
    NEW.a2p_risk_review_reviewed_at,
    NEW.a2p_risk_review_reviewed_by,
    NEW.a2p_risk_review_override_note,
    NEW.a2p_risk_review_updated_at
  ) IS DISTINCT FROM ROW(
    OLD.telnyx_brand_id,
    OLD.telnyx_brand_source,
    OLD.telnyx_campaign_id,
    OLD.telnyx_messaging_profile_id,
    OLD.telnyx_voice_application_id,
    OLD.brand_status,
    OLD.brand_status_updated_at,
    OLD.brand_rejection_reason,
    OLD.campaign_status,
    OLD.campaign_status_updated_at,
    OLD.campaign_rejection_reason,
    OLD.compliance_info_completed_at,
    OLD.onboarding_registration_status,
    OLD.onboarding_registration_started_at,
    OLD.onboarding_registration_submitted_at,
    OLD.onboarding_registration_error,
    OLD.onboarding_completed_at,
    OLD.a2p_risk_review_status,
    OLD.a2p_risk_review_input_hash,
    OLD.a2p_risk_review_message,
    OLD.a2p_risk_review_reason,
    OLD.a2p_risk_review_findings,
    OLD.a2p_risk_review_customer_answer,
    OLD.a2p_risk_review_customer_selections,
    OLD.a2p_risk_review_scanned_at,
    OLD.a2p_risk_review_notified_at,
    OLD.a2p_risk_review_reviewed_at,
    OLD.a2p_risk_review_reviewed_by,
    OLD.a2p_risk_review_override_note,
    OLD.a2p_risk_review_updated_at
  ) THEN
    RAISE EXCEPTION
      'customer writes cannot change protected registration fields'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_telnyx_authorization_fields
  ON public.businesses;

CREATE TRIGGER guard_business_telnyx_authorization_fields
BEFORE INSERT OR UPDATE ON public.businesses
FOR EACH ROW
EXECUTE FUNCTION public.guard_business_telnyx_authorization_fields();

-- ============================================================================
-- F. Service-role-only brand-link lifecycle RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_existing_telnyx_brand_inspection(
  p_business_id uuid,
  p_tcr_brand_id text,
  p_telnyx_brand_id text,
  p_outcome_code text,
  p_actor_user_id text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_request_id uuid;
  v_event_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_outcome_code IS NULL
     OR p_outcome_code !~ '^[a-z0-9_]{1,100}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_outcome_code'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.id
  INTO v_business_id
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.id
  INTO v_request_id
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
    AND p_tcr_brand_id IS NOT NULL
    AND p_telnyx_brand_id IS NOT NULL
    AND request.tcr_brand_id = upper(btrim(p_tcr_brand_id))
    AND request.telnyx_brand_id = lower(btrim(p_telnyx_brand_id))
  FOR UPDATE;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    v_business_id,
    v_request_id,
    'inspection_recorded',
    p_outcome_code,
    NULL,
    NULLIF(upper(btrim(p_tcr_brand_id)), ''),
    NULLIF(lower(btrim(p_telnyx_brand_id)), ''),
    p_actor_user_id
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.stage_existing_telnyx_brand_link(
  p_business_id uuid,
  p_tcr_brand_id text,
  p_telnyx_brand_id text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_telnyx_brand_id));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF v_request.id IS NOT NULL AND v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.id IS NOT NULL AND v_request.status = 'approved' THEN
    RAISE EXCEPTION 'existing_brand_link_already_approved_reset_first'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  IF v_business.onboarding_registration_status NOT IN (
    'not_started',
    'failed'
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_registration_already_submitted'
      USING ERRCODE = '55000';
  END IF;

  v_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_fingerprint IS NULL THEN
    RAISE EXCEPTION 'existing_brand_link_identity_incomplete'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    IF v_request.id IS NULL THEN
      INSERT INTO public.telnyx_brand_link_requests (
        business_id,
        tcr_brand_id,
        telnyx_brand_id,
        status,
        identity_fingerprint,
        inspected_at,
        inspected_by,
        approved_at,
        approved_by,
        consumed_at,
        last_error_code
      ) VALUES (
        p_business_id,
        v_tcr_brand_id,
        v_telnyx_brand_id,
        'pending_admin',
        v_fingerprint,
        now(),
        p_actor_user_id,
        NULL,
        NULL,
        NULL,
        NULL
      )
      RETURNING * INTO v_request;
    ELSE
      UPDATE public.telnyx_brand_link_requests
      SET tcr_brand_id = v_tcr_brand_id,
          telnyx_brand_id = v_telnyx_brand_id,
          status = 'pending_admin',
          identity_fingerprint = v_fingerprint,
          inspected_at = now(),
          inspected_by = p_actor_user_id,
          approved_at = NULL,
          approved_by = NULL,
          consumed_at = NULL,
          last_error_code = NULL,
          updated_at = now()
      WHERE id = v_request.id
      RETURNING * INTO v_request;
    END IF;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'existing_brand_link_brand_already_reserved'
        USING ERRCODE = '23505';
  END;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_staged',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_existing_telnyx_brand_link(
  p_business_id uuid,
  p_expected_tcr_brand_id text,
  p_expected_telnyx_brand_id text,
  p_expected_identity_fingerprint text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_current_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_expected_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_expected_telnyx_brand_id));
  v_expected_fingerprint text := lower(btrim(p_expected_identity_fingerprint));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_fingerprint IS NULL
     OR v_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_identity_fingerprint'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status NOT IN ('pending_admin', 'approved') THEN
    RAISE EXCEPTION 'existing_brand_link_not_ready_for_approval'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.tcr_brand_id IS DISTINCT FROM v_tcr_brand_id
     OR v_request.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id THEN
    RAISE EXCEPTION 'existing_brand_link_provider_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  IF v_business.onboarding_registration_status NOT IN (
    'not_started',
    'failed'
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_registration_already_submitted'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.a2p_risk_review_status IS NULL
     OR v_business.a2p_risk_review_status NOT IN (
       'passed',
       'admin_approved'
     ) THEN
    RAISE EXCEPTION 'existing_brand_link_risk_review_not_cleared'
      USING ERRCODE = '55000';
  END IF;

  v_current_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_current_fingerprint IS NULL
     OR v_request.identity_fingerprint IS DISTINCT FROM v_expected_fingerprint
     OR v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'existing_brand_link_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  IF v_request.status = 'approved' THEN
    RETURN v_request;
  END IF;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'approved',
      approved_at = now(),
      approved_by = p_actor_user_id,
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_approved',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.block_existing_telnyx_brand_link(
  p_business_id uuid,
  p_expected_tcr_brand_id text,
  p_expected_telnyx_brand_id text,
  p_expected_identity_fingerprint text,
  p_reason_code text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_tcr_brand_id text := upper(btrim(p_expected_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_expected_telnyx_brand_id));
  v_expected_fingerprint text := lower(btrim(p_expected_identity_fingerprint));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF p_reason_code IS NULL OR p_reason_code !~ '^[a-z0-9_]{1,100}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_reason_code'
      USING ERRCODE = '22023';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_fingerprint IS NULL
     OR v_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_identity_fingerprint'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.id
  INTO v_business_id
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'existing_brand_link_not_approved'
      USING ERRCODE = '55000';
  END IF;

  -- Guard the exact request that failed provider revalidation. An admin may
  -- reset/restage a different brand while launch is in flight; that newer
  -- request must never be blocked because an older provider snapshot failed.
  IF v_request.tcr_brand_id IS DISTINCT FROM v_tcr_brand_id
     OR v_request.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id THEN
    RAISE EXCEPTION 'existing_brand_link_provider_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  IF v_request.identity_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'existing_brand_link_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'blocked',
      approved_at = NULL,
      approved_by = NULL,
      consumed_at = NULL,
      last_error_code = p_reason_code,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    v_business_id,
    v_request.id,
    'link_blocked',
    v_request.status,
    p_reason_code,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_existing_telnyx_brand_link(
  p_business_id uuid,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_business_id uuid;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  SELECT business.id
  INTO v_business_id
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.status = 'consumed' THEN
    RAISE EXCEPTION 'existing_brand_link_already_consumed'
      USING ERRCODE = '55000';
  END IF;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'pending_admin',
      identity_fingerprint = NULL,
      approved_at = NULL,
      approved_by = NULL,
      consumed_at = NULL,
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    v_business_id,
    v_request.id,
    'link_reset',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_existing_telnyx_brand_link(
  p_business_id uuid,
  p_expected_tcr_brand_id text,
  p_expected_telnyx_brand_id text,
  p_expected_identity_fingerprint text,
  p_actor_user_id text
) RETURNS public.telnyx_brand_link_requests
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business public.businesses%ROWTYPE;
  v_request public.telnyx_brand_link_requests%ROWTYPE;
  v_current_fingerprint text;
  v_tcr_brand_id text := upper(btrim(p_expected_tcr_brand_id));
  v_telnyx_brand_id text := lower(btrim(p_expected_telnyx_brand_id));
  v_expected_fingerprint text := lower(btrim(p_expected_identity_fingerprint));
BEGIN
  IF p_actor_user_id IS NULL OR btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION 'existing_brand_link_actor_required'
      USING ERRCODE = '22004';
  END IF;

  IF v_tcr_brand_id IS NULL OR v_tcr_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_tcr_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_telnyx_brand_id IS NULL OR v_telnyx_brand_id = '' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_telnyx_brand_id'
      USING ERRCODE = '22023';
  END IF;

  IF v_expected_fingerprint IS NULL
     OR v_expected_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'existing_brand_link_invalid_identity_fingerprint'
      USING ERRCODE = '22023';
  END IF;

  SELECT business.*
  INTO v_business
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_business_not_available'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT request.*
  INTO v_request
  FROM public.telnyx_brand_link_requests AS request
  WHERE request.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'existing_brand_link_request_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_request.tcr_brand_id IS DISTINCT FROM v_tcr_brand_id
     OR v_request.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id THEN
    RAISE EXCEPTION 'existing_brand_link_provider_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  v_current_fingerprint := public.telnyx_brand_link_identity_fingerprint(
    p_business_id
  );

  IF v_current_fingerprint IS NULL
     OR v_request.identity_fingerprint IS DISTINCT FROM v_expected_fingerprint
     OR v_current_fingerprint IS DISTINCT FROM v_expected_fingerprint THEN
    RAISE EXCEPTION 'existing_brand_link_identity_changed'
      USING ERRCODE = '23514';
  END IF;

  -- Recheck the mutable safety gates for both first consumption and an
  -- idempotent consumed retry. Consumed retries may legitimately run after
  -- registration advances beyond 'submitting', but a newly applied kill
  -- switch or risk hold must still stop provider work.
  IF v_business.a2p_risk_review_status IS NULL
     OR v_business.a2p_risk_review_status NOT IN (
       'passed',
       'admin_approved'
     ) THEN
    RAISE EXCEPTION 'existing_brand_link_risk_review_not_cleared'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_submission_disabled THEN
    RAISE EXCEPTION 'existing_brand_link_telnyx_submission_disabled'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status = 'consumed' THEN
    IF v_business.telnyx_brand_id IS DISTINCT FROM v_telnyx_brand_id
       OR v_business.telnyx_brand_source IS DISTINCT FROM 'linked_existing'
       OR v_business.brand_status IS DISTINCT FROM 'approved' THEN
      RAISE EXCEPTION 'existing_brand_link_consumed_state_mismatch'
        USING ERRCODE = '23514';
    END IF;

    RETURN v_request;
  END IF;

  IF v_business.onboarding_registration_status <> 'submitting' THEN
    RAISE EXCEPTION 'existing_brand_link_launch_not_claimed'
      USING ERRCODE = '55000';
  END IF;

  IF v_request.status <> 'approved' THEN
    RAISE EXCEPTION 'existing_brand_link_not_approved'
      USING ERRCODE = '55000';
  END IF;

  IF v_business.telnyx_brand_id IS NOT NULL
     OR v_business.telnyx_brand_source IS NOT NULL
     OR v_business.telnyx_campaign_id IS NOT NULL
     OR v_business.telnyx_messaging_profile_id IS NOT NULL
     OR v_business.telnyx_voice_application_id IS NOT NULL
     OR v_business.brand_status IS NOT NULL
     OR v_business.campaign_status IS NOT NULL
     OR v_business.onboarding_completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'existing_brand_link_resources_already_exist'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.businesses AS attached_business
    WHERE attached_business.id <> p_business_id
      AND lower(attached_business.telnyx_brand_id) = lower(v_telnyx_brand_id)
  ) THEN
    RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
      USING ERRCODE = '23505';
  END IF;

  BEGIN
    UPDATE public.businesses
    SET telnyx_brand_id = v_telnyx_brand_id,
        telnyx_brand_source = 'linked_existing',
        brand_status = 'approved',
        brand_status_updated_at = now(),
        brand_rejection_reason = NULL,
        updated_at = now()
    WHERE id = p_business_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'existing_brand_link_brand_already_attached'
        USING ERRCODE = '23505';
  END;

  UPDATE public.telnyx_brand_link_requests
  SET status = 'consumed',
      consumed_at = now(),
      last_error_code = NULL,
      updated_at = now()
  WHERE id = v_request.id
  RETURNING * INTO v_request;

  INSERT INTO public.telnyx_brand_link_events (
    business_id,
    request_id,
    event_type,
    status,
    reason_code,
    tcr_brand_id,
    telnyx_brand_id,
    actor_user_id
  ) VALUES (
    p_business_id,
    v_request.id,
    'link_consumed',
    v_request.status,
    NULL,
    v_request.tcr_brand_id,
    v_request.telnyx_brand_id,
    p_actor_user_id
  );

  RETURN v_request;
END;
$$;

-- Trigger functions are callable only as triggers. The fingerprint and all
-- lifecycle transitions are available only to trusted service-role routes.
REVOKE ALL ON FUNCTION public.maintain_telnyx_brand_source()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.invalidate_telnyx_brand_link_on_identity_change()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_business_telnyx_authorization_fields()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.telnyx_brand_link_identity_fingerprint(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_existing_telnyx_brand_inspection(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.stage_existing_telnyx_brand_link(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.approve_existing_telnyx_brand_link(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.block_existing_telnyx_brand_link(uuid, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reset_existing_telnyx_brand_link(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.consume_existing_telnyx_brand_link(uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.telnyx_brand_link_identity_fingerprint(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_existing_telnyx_brand_inspection(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.stage_existing_telnyx_brand_link(uuid, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_existing_telnyx_brand_link(uuid, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.block_existing_telnyx_brand_link(uuid, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_existing_telnyx_brand_link(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_existing_telnyx_brand_link(uuid, text, text, text, text)
  TO service_role;

-- ============================================================================
-- G. Final account cleanup
-- ============================================================================
-- This replacement starts from the exact current migration-029
-- cleanup_expired_business body. It adds only:
--   1. link-event deletion followed by link-request deletion before identity
--      fields are scrubbed; and
--   2. telnyx_brand_source = NULL beside the existing carrier pointers.

-- Migration 028's full scrub, extended so the Stripe cancellation linkage is
-- queued before the local subscription row is deleted. The business row lock
-- serializes this transaction with guarded webhook writes.
CREATE OR REPLACE FUNCTION public.cleanup_expired_business(
  p_business_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner_id uuid;
  v_auth_user uuid;
  v_existing_auth_user uuid;
  v_local_stripe_subscription_id text;
  v_stripe_subscription_id text;
  v_action public.account_deletion_stripe_actions%ROWTYPE;
BEGIN
  SELECT business.owner_id, business.cleanup_auth_user_id
  INTO v_owner_id, v_existing_auth_user
  FROM public.businesses AS business
  WHERE business.id = p_business_id
    AND business.deleted_at IS NOT NULL
    AND business.deletion_scheduled_for < now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'business % is not an expired deleted account', p_business_id
      USING ERRCODE = '42501';
  END IF;

  v_auth_user := COALESCE(v_owner_id, v_existing_auth_user);

  -- Durable linkage to the auth user BEFORE owner_id is nulled. COALESCE
  -- keeps the value across re-runs (owner_id is already NULL on a retry).
  UPDATE public.businesses
  SET cleanup_auth_user_id = COALESCE(owner_id, cleanup_auth_user_id)
  WHERE id = p_business_id
  RETURNING cleanup_auth_user_id INTO v_auth_user;

  SELECT subscription.stripe_subscription_id
  INTO v_local_stripe_subscription_id
  FROM public.subscriptions AS subscription
  WHERE subscription.business_id = p_business_id;

  SELECT action.*
  INTO v_action
  FROM public.account_deletion_stripe_actions AS action
  WHERE action.business_id = p_business_id
  FOR UPDATE;

  IF FOUND THEN
    v_stripe_subscription_id := v_action.stripe_subscription_id;
  END IF;

  IF v_stripe_subscription_id IS NOT NULL
     AND v_local_stripe_subscription_id IS NOT NULL
     AND v_stripe_subscription_id <> v_local_stripe_subscription_id THEN
    RAISE EXCEPTION
      'Stripe subscription linkage mismatch for business %: durable %, local %',
      p_business_id,
      v_stripe_subscription_id,
      v_local_stripe_subscription_id
      USING ERRCODE = '23514';
  END IF;

  v_stripe_subscription_id := COALESCE(
    v_stripe_subscription_id,
    v_local_stripe_subscription_id
  );

  IF v_stripe_subscription_id IS NOT NULL THEN
    v_action := public.queue_account_deletion_stripe_action(
      p_business_id,
      v_stripe_subscription_id,
      'cancel'
    );
  END IF;

  -- Anonymize messages: two statements so each uses its index — the OR form
  -- is structurally unindexable. content guard keeps re-runs cheap.
  UPDATE public.messages SET content = '[deleted]'
  WHERE business_id = p_business_id AND content <> '[deleted]';
  UPDATE public.messages SET content = '[deleted]'
  WHERE conversation_id IN (
      SELECT id FROM public.conversations WHERE business_id = p_business_id
    )
    AND content <> '[deleted]';

  -- Anonymize contacts: strip PII, keep lead_score and timestamps.
  UPDATE public.contacts
  SET name = NULL, email = NULL, phone_number = NULL, notes = NULL
  WHERE business_id = p_business_id;

  -- Link state must be removed before the legal-identity scrub. A consumed
  -- link intentionally rejects identity drift while it exists.
  DELETE FROM public.telnyx_brand_link_events
  WHERE business_id = p_business_id;
  DELETE FROM public.telnyx_brand_link_requests
  WHERE business_id = p_business_id;

  -- Hard delete config tables (the business row is kept as a tombstone).
  DELETE FROM public.ai_settings            WHERE business_id = p_business_id;
  DELETE FROM public.services               WHERE business_id = p_business_id;
  DELETE FROM public.faqs                   WHERE business_id = p_business_id;
  DELETE FROM public.business_hours         WHERE business_id = p_business_id;
  DELETE FROM public.phone_numbers          WHERE business_id = p_business_id;
  DELETE FROM public.widget_configs         WHERE business_id = p_business_id;
  DELETE FROM public.google_calendar_tokens WHERE business_id = p_business_id;
  DELETE FROM public.subscriptions          WHERE business_id = p_business_id;

  -- Full tombstone scrub. Kept for analytics: business_type, timezone,
  -- billing flags, created_at, lead_score on contacts, message volumes.
  UPDATE public.businesses
  SET name = '[deleted]',
      slug = 'deleted-' || p_business_id,
      email = NULL, phone_number = NULL, website_url = NULL,
      address = NULL, city = NULL, state = NULL, zip = NULL,
      -- legal identity / A2P registration PII (012/015/019/021/022)
      legal_business_name = NULL, business_entity_type = NULL,
      business_registration_state = NULL, tax_id_type = NULL,
      ein = NULL, last_4_ssn = NULL, registrant_mobile = NULL,
      authorized_rep_name = NULL, authorized_rep_title = NULL,
      authorized_rep_email = NULL, authorized_rep_phone = NULL,
      business_type_other = NULL,
      forward_to_number = NULL,
      pending_phone_number = NULL, pending_phone_number_area_code = NULL,
      pending_phone_number_failure_reason = NULL,
      -- customer-supplied compliance URLs on the customer's own domain
      privacy_url_override = NULL, terms_url_override = NULL,
      -- customer-authored SMS content and risk-screen output (may embed
      -- identity and website-derived text)
      use_case_description = NULL, sample_messages = NULL,
      opt_in_description = NULL, estimated_monthly_volume = NULL,
      a2p_risk_review_message = NULL, a2p_risk_review_reason = NULL,
      a2p_risk_review_findings = NULL,
      a2p_risk_review_customer_answer = NULL,
      a2p_risk_review_customer_selections = NULL,
      a2p_risk_review_input_hash = NULL,
      a2p_risk_review_override_note = NULL,
      onboarding_registration_error = NULL,
      -- admin free text that can embed identity
      billing_admin_notes = NULL,
      -- carrier resource pointers: late Telnyx webhooks must not resolve a
      -- tombstone, and rejection reasons can embed carrier identity text
      telnyx_brand_id = NULL, telnyx_brand_source = NULL,
      telnyx_campaign_id = NULL,
      telnyx_messaging_profile_id = NULL, telnyx_voice_application_id = NULL,
      brand_status = NULL, brand_rejection_reason = NULL,
      campaign_status = NULL, campaign_rejection_reason = NULL,
      owner_id = NULL
  WHERE id = p_business_id;

  RETURN v_auth_user;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_expired_business(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_business(uuid)
  TO service_role;
