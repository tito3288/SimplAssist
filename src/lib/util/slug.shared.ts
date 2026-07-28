/**
 * Client-safe slug helpers.
 *
 * Keep this module free of server-only dependencies so Client Components can
 * use these pure helpers without pulling privileged code into browser bundles.
 */

/**
 * URL-safe slug derivation rules — match migration 015's backfill DO block.
 * Any change to these rules must also be reflected there.
 */
const MAX_BASE_LENGTH = 60;
const FALLBACK_BASE = "business";

export function generateSlug(name: string | null | undefined): string {
  const raw = (name ?? "").toLowerCase();
  const kebab = raw.replace(/[^a-z0-9]+/g, "-").replace(/(^-+)|(-+$)/g, "");
  const trimmed = kebab.slice(0, MAX_BASE_LENGTH);
  // 'deleted-' is a reserved namespace: the account-cleanup RPC rewrites a
  // tombstone's slug to 'deleted-<business-uuid>' under the UNIQUE index, and
  // a name-derived slug squatting that value would make the scrub transaction
  // fail forever (business ids are public via the widget embed snippet).
  // ensureUniqueSlug's collision suffix appends to the base, so guarding the
  // base is sufficient.
  if (trimmed.startsWith("deleted-")) {
    return `biz-${trimmed}`.slice(0, MAX_BASE_LENGTH);
  }
  return trimmed || FALLBACK_BASE;
}

/**
 * Predicate for the `pending-<short-id>` placeholder slugs seeded by
 * handle_new_user (migration 015). Used by:
 *   - Public pages (/c/[slug]/*) to return notFound() rather than render
 *     a placeholder business.
 *   - resolveLegalUrls() in Phase 3 helpers to refuse to construct URLs
 *     that would leak a placeholder slug to Telnyx.
 */
export function isPendingSlug(slug: string | null | undefined): boolean {
  return typeof slug === "string" && slug.startsWith("pending-");
}
