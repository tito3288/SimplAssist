import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  decodeGoogleOAuthState,
  getGoogleOAuth2Client,
  GOOGLE_OAUTH_NONCE_COOKIE,
} from "@/lib/google/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  requireFreshWorkspaceRouteAccess,
  requireWorkspaceRouteAccess,
} from "@/lib/customer/workspaceRouteResponse.server";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return clearNonce(workspace.response);
  if (workspace.access.hostKind === "partner") {
    return clearNonce(
      NextResponse.json(
        { error: "google_oauth_unavailable_on_partner_host" },
        { status: 403 }
      )
    );
  }

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

  if (state.businessId !== workspace.access.business.id) {
    return clearNonce(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
  }

  const businessId = workspace.access.business.id;

  const initialEntitlementFailure = await calendarEntitlementFailure(
    businessId
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
      businessId
    );
    if (writeEntitlementFailure) {
      return clearNonce(writeEntitlementFailure);
    }

    // The token exchange is also long enough for the signed-in account or an
    // administrator-managed partner assignment to change. Bypass the shared
    // request cache immediately before durable writes and require the exact
    // canonical workspace decision that authorized this callback.
    const freshWorkspace = await requireFreshWorkspaceRouteAccess();
    if (!freshWorkspace.ok) {
      return clearNonce(freshWorkspace.response);
    }
    if (
      freshWorkspace.access.hostKind !== "canonical" ||
      freshWorkspace.access.user.id !== workspace.access.user.id ||
      freshWorkspace.access.business.id !== businessId
    ) {
      return clearNonce(workspaceChangedResponse());
    }

    const { error: dbError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .upsert(
        {
          business_id: businessId,
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
      .eq("business_id", businessId);

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

function workspaceChangedResponse(): NextResponse {
  return NextResponse.json(
    { error: "workspace_access_denied" },
    { status: 403 }
  );
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
