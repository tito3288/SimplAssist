BEGIN;

ALTER TABLE public.services
  ADD COLUMN source text NOT NULL DEFAULT 'manual';

ALTER TABLE public.services
  ADD CONSTRAINT services_source_check
  CHECK (source IN ('scraped', 'manual', 'suggested'));

COMMENT ON COLUMN public.services.source IS
  'Origin of the service knowledge: scraped, manual, or suggested. Existing and source-omitting rows default to manual.';

CREATE OR REPLACE FUNCTION public.replace_services_and_faqs(
  p_business_id uuid,
  p_services jsonb,
  p_faqs jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses
    WHERE id = p_business_id
  ) THEN
    RAISE EXCEPTION 'business % not found or not accessible', p_business_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.services
  WHERE business_id = p_business_id;

  INSERT INTO public.services (
    business_id,
    name,
    description,
    price,
    source
  )
  SELECT
    p_business_id,
    service.name,
    service.description,
    service.price,
    coalesce(service.source, 'manual')
  FROM jsonb_to_recordset(coalesce(p_services, '[]'::jsonb))
    AS service(
      name text,
      description text,
      price text,
      source text
    );

  DELETE FROM public.faqs
  WHERE business_id = p_business_id;

  INSERT INTO public.faqs (
    business_id,
    question,
    answer,
    source
  )
  SELECT
    p_business_id,
    faq.question,
    faq.answer,
    coalesce(faq.source, 'manual')
  FROM jsonb_to_recordset(coalesce(p_faqs, '[]'::jsonb))
    AS faq(
      question text,
      answer text,
      source text
    );
END;
$$;

REVOKE EXECUTE
  ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb)
  FROM PUBLIC;

REVOKE EXECUTE
  ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb)
  FROM anon;

GRANT EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb)
  TO service_role;

COMMIT;
