import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  resolveAuthCallbackOrigin,
  resolveConnectedPartnerAuthCallbackOrigin,
} from "@/lib/auth/callbackOrigin.server";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const flowValues = searchParams.getAll("flow");
  const rawHost = request.headers.get("host");

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
