-- Keep the AI's customer-facing knowledge above the minimum quality floor.
--
-- Existing rows are intentionally grandfathered: NOT VALID checks do not
-- scan historical data, and the mutation guards let a deficient completed
-- account improve incrementally. New or modified active rows must be valid
-- and distinct, while completed accounts can never reduce their valid count
-- below min(their current count, 3).

CREATE OR REPLACE FUNCTION public.normalize_ai_knowledge_key(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT lower(
    btrim(
      regexp_replace(
        coalesce(p_value, ''),
        '[[:space:]]+',
        ' ',
        'g'
      )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_ai_knowledge_key(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_ai_knowledge_key(text)
  TO authenticated, service_role;

ALTER TABLE public.services
  ADD CONSTRAINT services_active_name_not_blank
  CHECK (
    is_active IS NOT TRUE
    OR public.normalize_ai_knowledge_key(name) <> ''
  ) NOT VALID;

ALTER TABLE public.faqs
  ADD CONSTRAINT faqs_active_question_not_blank
  CHECK (
    is_active IS NOT TRUE
    OR public.normalize_ai_knowledge_key(question) <> ''
  ) NOT VALID;

ALTER TABLE public.faqs
  ADD CONSTRAINT faqs_active_answer_not_blank
  CHECK (
    is_active IS NOT TRUE
    OR public.normalize_ai_knowledge_key(answer) <> ''
  ) NOT VALID;

ALTER TABLE public.faqs
  ADD CONSTRAINT faqs_active_answer_max_length
  CHECK (
    is_active IS NOT TRUE
    OR char_length(answer) <= 2000
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.guard_service_ai_knowledge_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_business_id uuid;
  v_new_business_id uuid;
  v_completed_at timestamptz;
  v_deleted_at timestamptz;
  v_previous_count integer;
  v_projected_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_business_id := NULL;
    v_new_business_id := NEW.business_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_business_id := OLD.business_id;
    v_new_business_id := NEW.business_id;
  ELSE
    v_old_business_id := OLD.business_id;
    v_new_business_id := NULL;
  END IF;

  -- Serialize every knowledge mutation for a business. This closes both the
  -- concurrent-duplicate race and two simultaneous 4 -> 3 deletes ending at
  -- 2. UUID ordering also makes the unusual cross-business UPDATE safe.
  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id IN (v_old_business_id, v_new_business_id)
  ORDER BY business.id
  FOR UPDATE;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.is_active IS TRUE THEN
      IF public.normalize_ai_knowledge_key(NEW.name) = '' THEN
        RAISE EXCEPTION 'Active service name cannot be blank'
          USING ERRCODE = '23514',
                CONSTRAINT = 'services_active_name_not_blank';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.services AS service
        WHERE service.business_id = NEW.business_id
          AND service.is_active IS TRUE
          AND service.id <> NEW.id
          AND public.normalize_ai_knowledge_key(service.name)
            = public.normalize_ai_knowledge_key(NEW.name)
      ) THEN
        RAISE EXCEPTION 'An active service with the same normalized name already exists'
          USING ERRCODE = '23505',
                CONSTRAINT = 'services_active_distinct_name';
      END IF;
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT business.onboarding_completed_at, business.deleted_at
    INTO v_completed_at, v_deleted_at
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id;

    -- Cleanup deletes configuration before scrubbing the retained business
    -- tombstone. It must be able to remove every row regardless of the floor.
    IF v_completed_at IS NOT NULL AND v_deleted_at IS NULL THEN
      SELECT count(DISTINCT public.normalize_ai_knowledge_key(service.name))
      INTO v_previous_count
      FROM public.services AS service
      WHERE service.business_id = OLD.business_id
        AND service.is_active IS TRUE
        AND public.normalize_ai_knowledge_key(service.name) <> '';

      IF TG_OP = 'DELETE' THEN
        SELECT count(DISTINCT public.normalize_ai_knowledge_key(service.name))
        INTO v_projected_count
        FROM public.services AS service
        WHERE service.business_id = OLD.business_id
          AND service.id <> OLD.id
          AND service.is_active IS TRUE
          AND public.normalize_ai_knowledge_key(service.name) <> '';
      ELSE
        SELECT count(DISTINCT candidate.normalized_name)
        INTO v_projected_count
        FROM (
          SELECT public.normalize_ai_knowledge_key(service.name) AS normalized_name
          FROM public.services AS service
          WHERE service.business_id = OLD.business_id
            AND service.id <> OLD.id
            AND service.is_active IS TRUE
            AND public.normalize_ai_knowledge_key(service.name) <> ''
          UNION ALL
          SELECT public.normalize_ai_knowledge_key(NEW.name)
          WHERE NEW.business_id = OLD.business_id
            AND NEW.is_active IS TRUE
            AND public.normalize_ai_knowledge_key(NEW.name) <> ''
        ) AS candidate;
      END IF;

      IF v_projected_count < least(v_previous_count, 3) THEN
        RAISE EXCEPTION
          'Keep at least 3 distinct active services before removing this service'
          USING ERRCODE = '23514',
                CONSTRAINT = 'services_completed_quality_floor';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_service_ai_knowledge_quality()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_service_ai_knowledge_quality()
  TO service_role;

DROP TRIGGER IF EXISTS guard_service_ai_knowledge_quality
  ON public.services;
CREATE TRIGGER guard_service_ai_knowledge_quality
BEFORE INSERT OR UPDATE OR DELETE ON public.services
FOR EACH ROW
EXECUTE FUNCTION public.guard_service_ai_knowledge_quality();

CREATE OR REPLACE FUNCTION public.guard_faq_ai_knowledge_quality()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_business_id uuid;
  v_new_business_id uuid;
  v_completed_at timestamptz;
  v_deleted_at timestamptz;
  v_previous_count integer;
  v_projected_count integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_old_business_id := NULL;
    v_new_business_id := NEW.business_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_business_id := OLD.business_id;
    v_new_business_id := NEW.business_id;
  ELSE
    v_old_business_id := OLD.business_id;
    v_new_business_id := NULL;
  END IF;

  PERFORM 1
  FROM public.businesses AS business
  WHERE business.id IN (v_old_business_id, v_new_business_id)
  ORDER BY business.id
  FOR UPDATE;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.is_active IS TRUE THEN
      IF public.normalize_ai_knowledge_key(NEW.question) = '' THEN
        RAISE EXCEPTION 'Active FAQ question cannot be blank'
          USING ERRCODE = '23514',
                CONSTRAINT = 'faqs_active_question_not_blank';
      END IF;
      IF public.normalize_ai_knowledge_key(NEW.answer) = '' THEN
        RAISE EXCEPTION 'Active FAQ answer cannot be blank'
          USING ERRCODE = '23514',
                CONSTRAINT = 'faqs_active_answer_not_blank';
      END IF;
      IF char_length(NEW.answer) > 2000 THEN
        RAISE EXCEPTION 'Active FAQ answer cannot exceed 2000 characters'
          USING ERRCODE = '23514',
                CONSTRAINT = 'faqs_active_answer_max_length';
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.faqs AS faq
        WHERE faq.business_id = NEW.business_id
          AND faq.is_active IS TRUE
          AND faq.id <> NEW.id
          AND public.normalize_ai_knowledge_key(faq.question)
            = public.normalize_ai_knowledge_key(NEW.question)
      ) THEN
        RAISE EXCEPTION 'An active FAQ with the same normalized question already exists'
          USING ERRCODE = '23505',
                CONSTRAINT = 'faqs_active_distinct_question';
      END IF;
    END IF;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT business.onboarding_completed_at, business.deleted_at
    INTO v_completed_at, v_deleted_at
    FROM public.businesses AS business
    WHERE business.id = OLD.business_id;

    IF v_completed_at IS NOT NULL AND v_deleted_at IS NULL THEN
      SELECT count(DISTINCT public.normalize_ai_knowledge_key(faq.question))
      INTO v_previous_count
      FROM public.faqs AS faq
      WHERE faq.business_id = OLD.business_id
        AND faq.is_active IS TRUE
        AND public.normalize_ai_knowledge_key(faq.question) <> ''
        AND public.normalize_ai_knowledge_key(faq.answer) <> ''
        AND char_length(faq.answer) <= 2000;

      IF TG_OP = 'DELETE' THEN
        SELECT count(DISTINCT public.normalize_ai_knowledge_key(faq.question))
        INTO v_projected_count
        FROM public.faqs AS faq
        WHERE faq.business_id = OLD.business_id
          AND faq.id <> OLD.id
          AND faq.is_active IS TRUE
          AND public.normalize_ai_knowledge_key(faq.question) <> ''
          AND public.normalize_ai_knowledge_key(faq.answer) <> ''
          AND char_length(faq.answer) <= 2000;
      ELSE
        SELECT count(DISTINCT candidate.normalized_question)
        INTO v_projected_count
        FROM (
          SELECT public.normalize_ai_knowledge_key(faq.question) AS normalized_question
          FROM public.faqs AS faq
          WHERE faq.business_id = OLD.business_id
            AND faq.id <> OLD.id
            AND faq.is_active IS TRUE
            AND public.normalize_ai_knowledge_key(faq.question) <> ''
            AND public.normalize_ai_knowledge_key(faq.answer) <> ''
            AND char_length(faq.answer) <= 2000
          UNION ALL
          SELECT public.normalize_ai_knowledge_key(NEW.question)
          WHERE NEW.business_id = OLD.business_id
            AND NEW.is_active IS TRUE
            AND public.normalize_ai_knowledge_key(NEW.question) <> ''
            AND public.normalize_ai_knowledge_key(NEW.answer) <> ''
            AND char_length(NEW.answer) <= 2000
        ) AS candidate;
      END IF;

      IF v_projected_count < least(v_previous_count, 3) THEN
        RAISE EXCEPTION
          'Keep at least 3 distinct active answered FAQs before removing this FAQ'
          USING ERRCODE = '23514',
                CONSTRAINT = 'faqs_completed_quality_floor';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_faq_ai_knowledge_quality()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_faq_ai_knowledge_quality()
  TO service_role;

DROP TRIGGER IF EXISTS guard_faq_ai_knowledge_quality
  ON public.faqs;
CREATE TRIGGER guard_faq_ai_knowledge_quality
BEFORE INSERT OR UPDATE OR DELETE ON public.faqs
FOR EACH ROW
EXECUTE FUNCTION public.guard_faq_ai_knowledge_quality();

COMMENT ON FUNCTION public.normalize_ai_knowledge_key(text) IS
  'Canonical trim/collapse/case-fold key used by the 3+3 AI knowledge policy.';
COMMENT ON FUNCTION public.guard_service_ai_knowledge_quality() IS
  'Serializes service mutations, rejects new active duplicates, and prevents completed accounts from worsening below three valid services.';
COMMENT ON FUNCTION public.guard_faq_ai_knowledge_quality() IS
  'Serializes FAQ mutations, rejects invalid/duplicate active rows, and prevents completed accounts from worsening below three valid FAQs.';
