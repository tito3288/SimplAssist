import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Resolve a unique slug for a business, given a base derived from its name.
 * On collision, append a 4-char nanoid-style suffix and retry up to 5 times.
 * Throws if 5 attempts all collide (vanishingly unlikely; surfaces a real bug
 * rather than masking it).
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
  throw new Error(
    `[slug] Failed to resolve unique slug for base "${base}" after 6 attempts`
  );
}

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomSuffix(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += SUFFIX_ALPHABET[Math.floor(Math.random() * SUFFIX_ALPHABET.length)];
  }
  return out;
}
