import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAuthCallbackOrigin,
  resolveConnectedPartnerAuthCallbackOrigin,
  resolveStrictAuthCallbackOrigin,
} from "@/lib/auth/callbackOrigin.server";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import {
  createPasswordResetIntent,
  PASSWORD_RESET_INTENT_COOKIE,
  passwordResetUserMatchesOrigin,
  verifyPasswordResetState,
} from "@/lib/auth/recovery.server";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const flowValues = searchParams.getAll("flow");
  const rawHost = request.headers.get("host");

  if (
    flowValues.includes("reset") ||
    (searchParams.has("state") &&
      searchParams.getAll("type").includes("recovery"))
  ) {
    return handlePasswordResetCallback(searchParams, rawHost);
  }

  // Concierge recovery is a reserved, exact callback shape. Malformed,
  // expired, and replayed setup links never fall through to the ordinary OTP
  // path or gain a caller-controlled redirect target.
  if (flowValues.length > 0) {
    if (!isExactConciergeRecovery(searchParams)) {
      const appOrigin = await resolveAuthCallbackOrigin(rawHost);
      return conciergeRedirect(appOrigin, "/login");
    }

    // Concierge accounts are assigned to connected partners before their
    // recovery token is generated. Fail before verification when Host is not
    // that kind of allow-listed partner; canonical fallback here would consume
    // the one-time token on the wrong domain.
    const partnerOrigin =
      await resolveConnectedPartnerAuthCallbackOrigin(rawHost);
    if (!partnerOrigin) {
      return conciergeRedirect(getCanonicalAppOrigin(), "/login");
    }

    try {
      const supabase = await createClient();
      const result = await supabase.auth.verifyOtp({
        type: "recovery",
        token_hash: searchParams.get("token_hash")!,
      });

      if (result.error || !result.data.user || !result.data.session) {
        return conciergeRedirect(partnerOrigin, "/login");
      }
    } catch {
      return conciergeRedirect(partnerOrigin, "/login");
    }

    return conciergeRedirect(partnerOrigin, "/set-password");
  }

  // Recovery tokens in this application are issued only by the concierge and
  // signed reset flows above. Never let removal of their flow parameters turn
  // them into an ordinary, domain-unlocked OTP callback.
  if (searchParams.getAll("type").includes("recovery")) {
    const resolved = await resolveStrictAuthCallbackOrigin(rawHost);
    return resetRedirect(
      resolved?.origin ?? getCanonicalAppOrigin(),
      true,
    );
  }

  const appOrigin = await resolveAuthCallbackOrigin(rawHost);

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  } else if (token_hash && type) {
    const supabase = await createClient();
    await supabase.auth.verifyOtp({ type, token_hash });
  }

  // Dashboard guards route new, incomplete, deleted, and ready accounts.
  return NextResponse.redirect(`${appOrigin}/dashboard`);
}

async function handlePasswordResetCallback(
  searchParams: URLSearchParams,
  rawHost: string | null,
) {
  const resolved = await resolveStrictAuthCallbackOrigin(rawHost);
  if (!resolved) {
    return resetRedirect(getCanonicalAppOrigin(), true);
  }

  if (!isExactPasswordResetRecovery(searchParams)) {
    return resetRedirect(resolved.origin, true);
  }

  const tokenHash = searchParams.get("token_hash")!;
  const state = searchParams.get("state")!;
  let validState = false;
  try {
    validState = verifyPasswordResetState(resolved.origin, tokenHash, state);
  } catch {
    validState = false;
  }
  if (!validState) {
    return resetRedirect(resolved.origin, true);
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return resetRedirect(resolved.origin, true);
  }
  let userId: string | null = null;
  try {
    const result = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: tokenHash,
    });
    if (
      result.error ||
      !result.data.user ||
      !result.data.session ||
      typeof result.data.user.id !== "string" ||
      result.data.user.id.length === 0
    ) {
      return invalidResetAfterVerification(supabase, resolved.origin);
    }
    userId = result.data.user.id;
  } catch {
    return invalidResetAfterVerification(supabase, resolved.origin);
  }

  let matchesOrigin = false;
  try {
    matchesOrigin = await passwordResetUserMatchesOrigin(userId, resolved);
  } catch {
    matchesOrigin = false;
  }
  if (!matchesOrigin) {
    return invalidResetAfterVerification(supabase, resolved.origin);
  }

  let resetIntent: string;
  try {
    resetIntent = createPasswordResetIntent(userId, resolved.origin);
  } catch {
    return invalidResetAfterVerification(supabase, resolved.origin);
  }

  const response = resetRedirect(resolved.origin, false);
  response.cookies.set({
    name: PASSWORD_RESET_INTENT_COOKIE,
    value: resetIntent,
    httpOnly: true,
    secure: new URL(resolved.origin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 15 * 60,
  });
  return response;
}

function conciergeRedirect(
  origin: string,
  pathname: "/login" | "/set-password",
) {
  const response = NextResponse.redirect(`${origin}${pathname}`);
  response.headers.set("Cache-Control", "private, no-store");
  // The inbound recovery token is a bearer secret in this request URL.
  // Prevent the redirect target (and anything it loads) from receiving that
  // URL through the Referer header.
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

function resetRedirect(origin: string, invalid: boolean) {
  const response = sensitiveRedirect(
    origin,
    invalid
      ? "/set-password?mode=reset&status=invalid-link"
      : "/set-password?mode=reset",
  );
  if (invalid) expireResetIntentCookie(response, origin);
  return response;
}

function sensitiveRedirect(origin: string, pathname: string) {
  const response = NextResponse.redirect(`${origin}${pathname}`);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function clearResetSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
) {
  try {
    const result = await supabase.auth.signOut({ scope: "local" });
    if (result.error) throw result.error;
  } catch {
    // Response-cookie expiry below remains the fail-closed cleanup path.
  }
}

async function invalidResetAfterVerification(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origin: string,
) {
  await clearResetSession(supabase);
  const response = resetRedirect(origin, true);
  expireSupabaseAuthCookies(response, origin);
  return response;
}

function expireResetIntentCookie(response: NextResponse, origin: string): void {
  response.cookies.set({
    name: PASSWORD_RESET_INTENT_COOKIE,
    value: "",
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

function expireSupabaseAuthCookies(
  response: NextResponse,
  origin: string,
): void {
  const names = new Set<string>();
  const baseName = supabaseAuthCookieBaseName();
  if (baseName) {
    names.add(baseName);
    for (let index = 0; index < 8; index += 1) {
      names.add(`${baseName}.${index}`);
    }
  }

  try {
    for (const cookie of cookies().getAll()) {
      if (baseName && (cookie.name === baseName || cookie.name.startsWith(`${baseName}.`))) {
        names.add(cookie.name);
      }
    }
  } catch {
    // Derived names still cover the ordinary and chunked Auth cookie forms.
  }

  const secure = new URL(origin).protocol === "https:";
  for (const name of Array.from(names)) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }
}

function supabaseAuthCookieBaseName(): string | null {
  try {
    const projectRef = new URL(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
    ).hostname.split(".")[0];
    return projectRef && /^[a-z0-9-]+$/.test(projectRef)
      ? `sb-${projectRef}-auth-token`
      : null;
  } catch {
    return null;
  }
}

function isExactPasswordResetRecovery(
  searchParams: URLSearchParams,
): boolean {
  const allowedKeys = new Set(["flow", "type", "token_hash", "state"]);
  if (Array.from(searchParams.keys()).some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const flows = searchParams.getAll("flow");
  const types = searchParams.getAll("type");
  const tokenHashes = searchParams.getAll("token_hash");
  const states = searchParams.getAll("state");

  return (
    flows.length === 1 &&
    flows[0] === "reset" &&
    types.length === 1 &&
    types[0] === "recovery" &&
    tokenHashes.length === 1 &&
    tokenHashes[0].length > 0 &&
    tokenHashes[0] === tokenHashes[0].trim() &&
    states.length === 1 &&
    states[0].length > 0 &&
    states[0] === states[0].trim()
  );
}

function isExactConciergeRecovery(searchParams: URLSearchParams): boolean {
  const flows = searchParams.getAll("flow");
  const types = searchParams.getAll("type");
  const tokenHashes = searchParams.getAll("token_hash");

  return (
    flows.length === 1 &&
    flows[0] === "concierge" &&
    types.length === 1 &&
    types[0] === "recovery" &&
    tokenHashes.length === 1 &&
    tokenHashes[0].length > 0 &&
    tokenHashes[0] === tokenHashes[0].trim() &&
    searchParams.getAll("code").length === 0
  );
}
