import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * POST /api/settings/compliance — Phase 6 compliance-mode update endpoint.
 *
 * Customers choose how their privacy/terms URLs reach Telnyx:
 *   - hosted        — SimplAssist serves /c/[slug]/privacy and /terms. Both
 *                     override URLs MUST be omitted (or null).
 *   - self_hosted   — Customer hosts on their own domain. Both override URLs
 *                     are required, must be HTTPS, and must be reachable.
 *   - existing      — Customer has a pre-existing SMS-compliant policy. Same
 *                     validation as self_hosted; the modes differ only in
 *                     dashboard UX (generated copy vs. self-check checklist).
 *
 * Validation order is deliberate: cheap checks first, expensive checks last.
 *   1. Auth
 *   2. JSON parse + zod schema
 *   3. Mode-specific shape (override URLs present/absent as appropriate)
 *   4. URL format (HTTPS + parseable) — fail fast on garbage
 *   5. URL reachability (HEAD then GET) — the network round-trip step
 *   6. DB update (only if every prior step passed)
 */

const ComplianceUpdateSchema = z.object({
  mode: z.enum(["hosted", "self_hosted", "existing"]),
  privacyUrlOverride: z.string().nullable().optional(),
  termsUrlOverride: z.string().nullable().optional(),
});

const REACHABILITY_TIMEOUT_MS = 5000;
const USER_AGENT = "SimplAssist-URLCheck/1.0 (+https://simplassist.com)";

function parseHttpsUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    if (!parsed.hostname) return null;
    return parsed;
  } catch {
    return null;
  }
}

type ReachabilityResult = { ok: true } | { ok: false; reason: string };

/**
 * HEAD then GET on 405. The HEAD→GET fallback is intentional and MUST NOT be
 * simplified back to HEAD-only.
 *
 * Some popular hosts return 405 Method Not Allowed for HEAD requests even
 * though GET works fine — notably Squarespace and several Cloudflare
 * configurations. HEAD-only would false-reject those customers on save, with
 * no actionable error (their page is reachable, our check just didn't recognize
 * it). The fallback adds ~one extra network round-trip in the worst case for
 * a meaningful correctness gain.
 *
 * Network errors (DNS failure, connection refused, abort) and any non-2xx
 * status after the fallback are surfaced as reachability failures with the
 * underlying reason so the customer sees actionable text in the UI.
 */
async function checkReachable(url: string): Promise<ReachabilityResult> {
  const tryFetch = async (
    method: "HEAD" | "GET"
  ): Promise<{ status: number } | { error: string }> => {
    try {
      const res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
      });
      return { status: res.status };
    } catch (err) {
      if (err instanceof Error) {
        if (err.name === "TimeoutError" || err.name === "AbortError") {
          return {
            error: `request timed out after ${REACHABILITY_TIMEOUT_MS / 1000}s`,
          };
        }
        return { error: err.message };
      }
      return { error: "network error" };
    }
  };

  const head = await tryFetch("HEAD");
  if ("error" in head) return { ok: false, reason: head.error };

  if (head.status === 405) {
    // HEAD→GET fallback for Squarespace / Cloudflare-style 405-on-HEAD hosts.
    const get = await tryFetch("GET");
    if ("error" in get) return { ok: false, reason: get.error };
    if (get.status >= 200 && get.status < 300) return { ok: true };
    return { ok: false, reason: `returned HTTP ${get.status}` };
  }

  if (head.status >= 200 && head.status < 300) return { ok: true };
  return { ok: false, reason: `returned HTTP ${head.status}` };
}

export async function POST(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate body shape
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ComplianceUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { mode, privacyUrlOverride, termsUrlOverride } = parsed.data;

  const trimmedPrivacy = privacyUrlOverride?.trim() ?? "";
  const trimmedTerms = termsUrlOverride?.trim() ?? "";

  // 3. Mode-specific shape validation
  if (mode === "hosted") {
    if (trimmedPrivacy.length > 0 || trimmedTerms.length > 0) {
      return NextResponse.json(
        {
          error:
            "Override URLs must be omitted when mode is 'hosted' — SimplAssist serves the pages",
        },
        { status: 400 }
      );
    }
  } else {
    // self_hosted or existing
    if (!trimmedPrivacy || !trimmedTerms) {
      return NextResponse.json(
        {
          error: `Both privacy and terms URLs are required when mode is '${mode}'`,
        },
        { status: 400 }
      );
    }

    // 4. URL format — fail fast on obvious garbage before any network call
    if (!parseHttpsUrl(trimmedPrivacy)) {
      return NextResponse.json(
        {
          error: "Privacy URL must be a valid HTTPS URL",
          field: "privacyUrlOverride",
          url: trimmedPrivacy,
        },
        { status: 400 }
      );
    }
    if (!parseHttpsUrl(trimmedTerms)) {
      return NextResponse.json(
        {
          error: "Terms URL must be a valid HTTPS URL",
          field: "termsUrlOverride",
          url: trimmedTerms,
        },
        { status: 400 }
      );
    }

    // 5. Reachability — HEAD then GET on 405. See checkReachable() docstring.
    const privacyCheck = await checkReachable(trimmedPrivacy);
    if (!privacyCheck.ok) {
      return NextResponse.json(
        {
          error: `Privacy URL could not be reached (${privacyCheck.reason})`,
          field: "privacyUrlOverride",
          url: trimmedPrivacy,
        },
        { status: 400 }
      );
    }
    const termsCheck = await checkReachable(trimmedTerms);
    if (!termsCheck.ok) {
      return NextResponse.json(
        {
          error: `Terms URL could not be reached (${termsCheck.reason})`,
          field: "termsUrlOverride",
          url: trimmedTerms,
        },
        { status: 400 }
      );
    }
  }

  // 6. DB update — owner_id filter is the ownership check; supabaseAdmin
  //    bypasses RLS but the .eq("owner_id", user.id) limits the write to the
  //    requesting user's own row. Matches the brand-verification route
  //    pattern (user-context client for auth, admin client for write).
  const updateData =
    mode === "hosted"
      ? {
          privacy_terms_mode: mode,
          privacy_url_override: null,
          terms_url_override: null,
        }
      : {
          privacy_terms_mode: mode,
          privacy_url_override: trimmedPrivacy,
          terms_url_override: trimmedTerms,
        };

  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update(updateData)
    .eq("owner_id", user.id);

  if (updateError) {
    console.error(
      `[settings:compliance] Failed to update for user ${user.id}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save compliance settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
