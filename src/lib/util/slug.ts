import { supabaseAdmin } from "@/lib/supabase/admin";

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
  return trimmed || FALLBACK_BASE;
}

/**
 * Resolve a unique slug for a business, given a base derived from its name.
 * On collision, append a 4-char nanoid-style suffix and retry up to 5 times.
 * Throws if 5 attempts all collide (vanishingly unlikely; surfaces a real bug
 * rather than masking it).
 *
 * Server-only — uses supabaseAdmin to bypass RLS for the existence check.
 */
export async function ensureUniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle();

    if (error) {
      throw new Error(`[slug] Uniqueness check failed: ${error.message}`);
    }
    if (!data) return candidate;
    candidate = `${base}-${randomSuffix(4)}`;
  }
  throw new Error(`[slug] Failed to resolve unique slug for base "${base}" after 6 attempts`);
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

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}
