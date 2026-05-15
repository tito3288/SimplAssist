import { isPendingSlug } from "@/lib/util/slug";
import type { PrivacyTermsMode } from "@/types/database";

// Re-exported for callers that already import this type via legalUrls.
// Canonical definition lives in @/types/database alongside other column-typed
// enums (BusinessEntityType, RegistrationStatus, etc.).
export type { PrivacyTermsMode };

/**
 * Privacy + Terms URL resolution for Telnyx campaign registration (Phase 6).
 *
 * Reads the business's `privacy_terms_mode` (from migration 015) and returns
 * the correct pair of URLs to submit to Telnyx:
 *   - hosted        → SimplAssist-served pages at /c/[slug]/privacy and /terms
 *   - self_hosted   → customer's own URLs from privacy_url_override + terms_url_override
 *   - existing      → same override columns as self_hosted (the modes only differ in dashboard UX)
 *
 * Also exposes `buildBusinessLandingUrl()` for the brand-website fallback in
 * brand.ts (when the customer has no website_url of their own).
 *
 * Defense in depth: throws if called with a 'pending-*' placeholder slug.
 * The primary gate is the pre-flight check in
 * /api/onboarding/brand-verification, which only triggers registration after
 * the real slug is set. This throw is a backstop so a race condition cannot
 * silently leak a placeholder slug to Telnyx.
 */

// Inlined to match brand.ts / campaign.ts / messagingProfile.ts /
// voiceApplication.ts — they each define their own copy of this helper. Worth
// extracting to a shared module in a future cleanup batch (all 5 callers).
function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for per-business legal URLs"
    );
  }
  return url.replace(/\/+$/, "");
}

export interface LegalUrlsBusiness {
  slug: string;
  privacy_terms_mode: PrivacyTermsMode;
  privacy_url_override: string | null;
  terms_url_override: string | null;
}

export interface LegalUrls {
  privacyUrl: string;
  termsUrl: string;
}

export function resolveLegalUrls(business: LegalUrlsBusiness): LegalUrls {
  if (isPendingSlug(business.slug)) {
    throw new Error(
      `[resolveLegalUrls] Slug "${business.slug}" is a placeholder — brand verification must complete first before legal URLs can be resolved`
    );
  }

  if (business.privacy_terms_mode === "hosted") {
    const base = appBaseUrl();
    return {
      privacyUrl: `${base}/c/${business.slug}/privacy`,
      termsUrl: `${base}/c/${business.slug}/terms`,
    };
  }

  // self_hosted and existing both read from the override columns. The
  // dashboard UX differs (generated copy vs. self-check checklist) but the
  // submission path is identical.
  const privacyUrl = business.privacy_url_override?.trim();
  const termsUrl = business.terms_url_override?.trim();
  if (!privacyUrl || !termsUrl) {
    throw new Error(
      `[resolveLegalUrls] Mode is "${business.privacy_terms_mode}" but override URLs are missing (privacy: ${privacyUrl ?? "null"}, terms: ${termsUrl ?? "null"})`
    );
  }

  return { privacyUrl, termsUrl };
}

/**
 * URL of the business's public landing page at /c/[slug]. Used by brand.ts
 * as the fallback `website` value when the customer has no website_url.
 * Same pending-slug guard as resolveLegalUrls.
 */
export function buildBusinessLandingUrl(slug: string): string {
  if (isPendingSlug(slug)) {
    throw new Error(
      `[buildBusinessLandingUrl] Slug "${slug}" is a placeholder — brand verification must complete first`
    );
  }
  return `${appBaseUrl()}/c/${slug}`;
}
