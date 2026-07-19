import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  decodeGoogleOAuthState,
  getGoogleOAuth2Client,
  GOOGLE_OAUTH_NONCE_COOKIE,
} from "@/lib/google/client";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateValue = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const appUrl = getAppUrl(request);

  if (oauthError || !code || !stateValue) {
    return clearNonce(
      NextResponse.redirect(`${appUrl}/settings`)
    );
  }

  const state = decodeGoogleOAuthState(stateValue);
  const cookieNonce = request.cookies.get(GOOGLE_OAUTH_NONCE_COOKIE)?.value;
  if (!state || !cookieNonce || !noncesMatch(state.nonce, cookieNonce)) {
    return clearNonce(
      NextResponse.json({ error: "Invalid OAuth state" }, { status: 400 })
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return clearNonce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", state.businessId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    console.error("[google-callback] Owner lookup failed:", businessError);
    return clearNonce(
      NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      )
    );
  }

  if (!business) {
    return clearNonce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
  }

  const initialEntitlementFailure = await calendarEntitlementFailure(
    business.id
  );
  if (initialEntitlementFailure) {
    return clearNonce(initialEntitlementFailure);
  }

  try {
    const client = getGoogleOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error("[google-callback] Missing tokens");
      return clearNonce(
        NextResponse.redirect(`${appUrl}/settings`)
      );
    }

    // Try to extract email from the ID token (if present).
    let googleEmail: string | null = null;
    if (tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID!,
        });
        const payload = ticket.getPayload();
        googleEmail = payload?.email || null;
      } catch {
        // ID token parsing failed — continue without email.
      }
    }

    const tokenExpiry = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    // Token exchange is a network hop. Re-resolve immediately before the
    // durable write so a downgrade while Google was responding cannot connect
    // Calendar after access was removed.
    const writeEntitlementFailure = await calendarEntitlementFailure(
      business.id
    );
    if (writeEntitlementFailure) {
      return clearNonce(writeEntitlementFailure);
    }

    const { error: dbError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .upsert(
        {
          business_id: business.id,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          token_expiry: tokenExpiry,
          google_email: googleEmail,
          calendar_id: "primary",
        },
        { onConflict: "business_id" }
      );

    if (dbError) {
      console.error("[google-callback] Token save failed:", dbError);
      return clearNonce(
        NextResponse.json(
          { error: "service_unavailable", retryable: true },
          { status: 503 }
        )
      );
    }

    // Connecting Calendar opts the business into direct scheduling.
    const { error: settingsError } = await supabaseAdmin
      .from("ai_settings")
      .update({ booking_enabled: true, booking_mode: "schedule_direct" })
      .eq("business_id", business.id);

    if (settingsError) {
      console.error("[google-callback] Booking settings update failed:", settingsError);
    }

    return clearNonce(
      NextResponse.redirect(`${appUrl}/settings`)
    );
  } catch (error) {
    console.error("[google-callback] Google OAuth exchange failed:", error);
    return clearNonce(
      NextResponse.redirect(`${appUrl}/settings`)
    );
  }
}

function noncesMatch(stateNonce: string, cookieNonce: string): boolean {
  const stateBuffer = Buffer.from(stateNonce);
  const cookieBuffer = Buffer.from(cookieNonce);
  return (
    stateBuffer.length === cookieBuffer.length &&
    timingSafeEqual(stateBuffer, cookieBuffer)
  );
}

async function calendarEntitlementFailure(
  businessId: string
): Promise<NextResponse | null> {
  try {
    const entitlements = await resolveBusinessEntitlements(businessId);
    if (canUseFeature(entitlements, "calendar")) return null;

    return NextResponse.json(
      {
        error: "feature_unavailable",
        feature: "calendar",
        requiredPlan: requiredPlanForFeature("calendar"),
      },
      { status: 403 }
    );
  } catch (error) {
    if (error instanceof EntitlementResolutionError) {
      return NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      );
    }
    throw error;
  }
}

function clearNonce(response: NextResponse): NextResponse {
  response.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google/callback",
    maxAge: 0,
  });
  return response;
}

function getAppUrl(request: NextRequest): string {
  const origin = request.nextUrl.origin;
  return origin.includes("localhost:3000")
    ? origin
    : process.env.NEXT_PUBLIC_APP_URL || origin;
}
