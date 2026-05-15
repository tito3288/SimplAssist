-- Phase 6 of per-customer A2P 10DLC registration: per-business privacy/terms URLs.
-- See project_post_isv_roadmap.md (Phase 6) for full scope.
--
-- This migration adds the data model behind the three-mode compliance hybrid:
--   1. 'hosted'      (default) — SimplAssist serves /c/[slug]/privacy and /terms.
--   2. 'self_hosted'           — customer hosts on their own domain; we store their URLs.
--   3. 'existing'              — customer already has an SMS-compliant policy; we store URLs.
--
-- The `slug` column powers the hosted-mode URLs and the brand-website fallback
-- (when a customer has no website_url, Phase 3's brand.ts uses /c/[slug] as the
-- brand website on Telnyx submissions).
--
-- SLUG FREEZE RULE:
-- The slug is generated on the FIRST brand-verification submit (when the real
-- business name is known) by /api/onboarding/brand-verification and is FROZEN
-- thereafter. Business renames do NOT update the slug, because any URL already
-- submitted to Telnyx must remain reachable for the lifetime of the campaign.
-- The handle_new_user trigger fills slug with a 'pending-<short-id>' placeholder
-- so the NOT NULL constraint is satisfied at row creation; the brand-verification
-- route overwrites it on first submit. Phase 3's resolveLegalUrls helper has a
-- defensive guard that throws if a 'pending-' slug ever reaches it.

-- ============================================================================
-- 1. Add slug column (nullable for backfill)
-- ============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS slug text;

-- ============================================================================
-- 2. Backfill slugs for existing rows
-- ============================================================================
--
-- Algorithm: lowercase + kebab-case from name, strip non-alphanumerics, cap at
-- 60 chars. On collision, append a short slice of the row's id until unique.
-- 'business' is the fallback base if name is null/empty.

DO $$
DECLARE
  rec RECORD;
  base_slug text;
  candidate_slug text;
  suffix_len int;
BEGIN
  FOR rec IN SELECT id, name FROM businesses WHERE slug IS NULL LOOP
    base_slug := lower(regexp_replace(coalesce(rec.name, 'business'), '[^a-zA-Z0-9]+', '-', 'g'));
    base_slug := regexp_replace(base_slug, '(^-+)|(-+$)', '', 'g');
    base_slug := substr(base_slug, 1, 60);
    IF base_slug = '' THEN
      base_slug := 'business';
    END IF;

    -- 'My Business' is the placeholder name from handle_new_user; for those rows
    -- mark the slug as 'pending-*' so the brand-verification API knows to
    -- overwrite it on first submit. Any other name is a real business name and
    -- gets a real slug here.
    IF coalesce(rec.name, '') = 'My Business' THEN
      candidate_slug := 'pending-' || substr(rec.id::text, 1, 8);
    ELSE
      candidate_slug := base_slug;
      suffix_len := 4;
      WHILE EXISTS (SELECT 1 FROM businesses WHERE slug = candidate_slug) LOOP
        candidate_slug := base_slug || '-' || substr(rec.id::text, 1, suffix_len);
        suffix_len := suffix_len + 1;
        EXIT WHEN suffix_len > 12;
      END LOOP;
    END IF;

    UPDATE businesses SET slug = candidate_slug WHERE id = rec.id;
  END LOOP;
END $$;

-- ============================================================================
-- 3. Constraints + unique index on slug
-- ============================================================================

ALTER TABLE businesses ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_slug_key ON businesses (slug);

COMMENT ON COLUMN businesses.slug IS
  'URL-safe identifier used for per-business public pages at /c/[slug]/privacy, /terms, and / (Phase 6). Generated on first brand-verification submit from the real business name; frozen thereafter so URLs already submitted to Telnyx remain reachable. Auto-row creation (handle_new_user) seeds a pending-* placeholder; the brand-verification API overwrites it. See migration 015 header.';

-- ============================================================================
-- 4. Compliance-mode columns
-- ============================================================================

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS privacy_terms_mode text
  NOT NULL DEFAULT 'hosted'
  CHECK (privacy_terms_mode IN ('hosted', 'self_hosted', 'existing'));

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS privacy_url_override text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS terms_url_override text;

COMMENT ON COLUMN businesses.privacy_terms_mode IS
  'Phase 6 compliance hybrid mode: hosted (default — SimplAssist serves the pages), self_hosted (customer hosts on own domain; URLs in *_override columns), or existing (customer has pre-existing SMS-compliant pages; URLs in *_override columns). Read by Phase 3 registration helpers via resolveLegalUrls() to decide which URLs to submit to Telnyx.';

COMMENT ON COLUMN businesses.privacy_url_override IS
  'Customer-provided privacy policy URL, used when privacy_terms_mode is self_hosted or existing. Null when mode is hosted. Validated as HTTPS + reachable via HEAD/GET when set.';

COMMENT ON COLUMN businesses.terms_url_override IS
  'Customer-provided terms of service URL, used when privacy_terms_mode is self_hosted or existing. Null when mode is hosted. Validated as HTTPS + reachable via HEAD/GET when set.';

-- ============================================================================
-- 5. Update handle_new_user to seed the placeholder slug
-- ============================================================================
--
-- New auth.users rows still get an auto-created businesses row with placeholder
-- name + slug. The brand-verification API overwrites both once the real name
-- is known.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  new_business_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.businesses (id, owner_id, name, business_type, slug)
  VALUES (
    new_business_id,
    NEW.id,
    'My Business',
    'general',
    'pending-' || substr(new_business_id::text, 1, 8)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
