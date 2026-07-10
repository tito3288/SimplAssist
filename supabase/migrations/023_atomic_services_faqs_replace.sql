-- Atomic replacement of a business's services and FAQs.
--
-- The onboarding Services & FAQs step previously saved via client-side
-- delete-then-insert (two tables, four statements): a failure after a delete
-- permanently lost the saved rows. This function performs the same replace
-- semantics inside a single transaction — any failure (NOT NULL, CHECK, RLS)
-- rolls back both deletes and all inserts.
--
-- SECURITY INVOKER (default, explicit here): RLS on businesses/services/faqs
-- applies to the caller, so an authenticated user can only affect rows of
-- businesses they own. The visibility guard below turns "foreign business"
-- into an explicit error instead of a silent no-op (and is a no-op for
-- service_role, which bypasses RLS).

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
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE id = p_business_id) THEN
    RAISE EXCEPTION 'business % not found or not accessible', p_business_id
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM services WHERE business_id = p_business_id;
  INSERT INTO services (business_id, name, description, price)
  SELECT p_business_id, s.name, s.description, s.price
  FROM jsonb_to_recordset(coalesce(p_services, '[]'::jsonb))
    AS s(name text, description text, price text);

  DELETE FROM faqs WHERE business_id = p_business_id;
  INSERT INTO faqs (business_id, question, answer, source)
  SELECT p_business_id, f.question, f.answer, coalesce(f.source, 'manual')
  FROM jsonb_to_recordset(coalesce(p_faqs, '[]'::jsonb))
    AS f(question text, answer text, source text);
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions; restrict to
-- the roles that should call this (authenticated users via RLS, and the
-- service role for server-side use).
REVOKE EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_services_and_faqs(uuid, jsonb, jsonb) TO service_role;
