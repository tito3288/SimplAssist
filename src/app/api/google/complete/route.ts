import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Credentials } from "google-auth-library";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import {
  requireFreshWorkspaceRouteAccess,
  requireWorkspaceRouteAccess,
} from "@/lib/customer/workspaceRouteResponse.server";
import {
  getGoogleOAuth2Client,
  GOOGLE_OAUTH_ORIGIN_COOKIE,
} from "@/lib/google/client";
import {
  claimGoogleCalendarOAuthHandoff,
  completeGoogleCalendarOAuthConnection,
  GoogleOAuthAttemptError,
  parseGoogleOAuthOpaqueToken,
  resolveGoogleOAuthWorkspaceIdentity,
  requireGoogleCalendarSettings,
  type GoogleOAuthWorkspaceIdentity,
} from "@/lib/google/oauthAttempt.server";
import {
  clearGoogleOAuthOriginVerifier,
  secureGoogleOAuthResponse,
} from "@/lib/google/oauthRouteResponse.server";
import { requireAuthenticatedFeature } from "@/lib/google/routeAccess";

const googleEmailSchema = z.string().email().max(254);

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return finish(workspace.response);

  const handoffs = request.nextUrl.searchParams.getAll("handoff");
  const verifierCookies = request.cookies.getAll(GOOGLE_OAUTH_ORIGIN_COOKIE);
  const handoff =
    handoffs.length === 1 ? parseGoogleOAuthOpaqueToken(handoffs[0]) : null;
  const originVerifier =
    verifierCookies.length === 1
      ? parseGoogleOAuthOpaqueToken(verifierCookies[0].value)
      : null;
  if (!handoff || !originVerifier) {
    return finish(
      NextResponse.json({ error: "oauth_handoff_invalid" }, { status: 400 }),
    );
  }

  let identity: GoogleOAuthWorkspaceIdentity;
  try {
    identity = await resolveGoogleOAuthWorkspaceIdentity(
      workspace.access,
      request.headers.get("host"),
    );
  } catch (error) {
    return finish(attemptErrorResponse(error));
  }

  const initialAccess = await requireAuthenticatedFeature("calendar");
  if (!initialAccess.ok) return finish(initialAccess.response);
  if (initialAccess.businessId !== identity.businessId) {
    return finish(workspaceChangedResponse());
  }

  try {
    await requireGoogleCalendarSettings(identity.businessId);
  } catch (error) {
    return finish(attemptErrorResponse(error));
  }

  let claim: Awaited<ReturnType<typeof claimGoogleCalendarOAuthHandoff>>;
  try {
    claim = await claimGoogleCalendarOAuthHandoff({
      identity,
      handoff,
      originVerifier,
    });
  } catch (error) {
    return finish(attemptErrorResponse(error));
  }

  if (claim.sanitizedResult !== null) {
    return finish(
      settingsRedirect(
        identity,
        claim.sanitizedResult === "access_denied" ? "denied" : "failed",
      ),
    );
  }
  if (!claim.authorizationCode) {
    return finish(settingsRedirect(identity, "failed"));
  }

  let tokens: Credentials;
  let googleEmail: string | null = null;
  try {
    const client = getGoogleOAuth2Client();
    ({ tokens } = await client.getToken(claim.authorizationCode));
    if (tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID!,
        });
        const parsedEmail = googleEmailSchema.safeParse(
          ticket.getPayload()?.email,
        );
        googleEmail = parsedEmail.success ? parsedEmail.data : null;
      } catch {
        googleEmail = null;
      }
    }
  } catch {
    return finish(settingsRedirect(identity, "failed"));
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return finish(settingsRedirect(identity, "failed"));
  }
  const tokenExpiryMs = tokens.expiry_date ?? Date.now() + 60 * 60 * 1000;
  if (!Number.isFinite(tokenExpiryMs) || tokenExpiryMs <= Date.now()) {
    return finish(settingsRedirect(identity, "failed"));
  }
  const tokenExpiry = new Date(tokenExpiryMs).toISOString();

  const entitlementFailure = await calendarEntitlementFailure(
    identity.businessId,
  );
  if (entitlementFailure) return finish(entitlementFailure);

  const freshWorkspace = await requireFreshWorkspaceRouteAccess();
  if (!freshWorkspace.ok) return finish(freshWorkspace.response);

  let freshIdentity: GoogleOAuthWorkspaceIdentity;
  try {
    freshIdentity = await resolveGoogleOAuthWorkspaceIdentity(
      freshWorkspace.access,
      request.headers.get("host"),
    );
  } catch (error) {
    return finish(attemptErrorResponse(error));
  }
  if (!sameIdentity(identity, freshIdentity)) {
    return finish(workspaceChangedResponse());
  }

  try {
    // The completion RPC updates an existing settings row. Re-prove it after
    // the provider hop so a concurrent teardown cannot leave connected
    // credentials without enabling the matching workspace configuration.
    await requireGoogleCalendarSettings(freshIdentity.businessId);
    await completeGoogleCalendarOAuthConnection({
      attemptId: claim.attemptId,
      identity: freshIdentity,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry,
      googleEmail,
    });
  } catch {
    return finish(settingsRedirect(freshIdentity, "failed"));
  }

  return finish(settingsRedirect(freshIdentity, "connected"));
}

function settingsRedirect(
  identity: GoogleOAuthWorkspaceIdentity,
  result: "connected" | "denied" | "failed",
): NextResponse {
  const destination = new URL("/settings", identity.origin);
  destination.searchParams.set("calendar", result);
  return NextResponse.redirect(destination);
}

function sameIdentity(
  first: GoogleOAuthWorkspaceIdentity,
  second: GoogleOAuthWorkspaceIdentity,
): boolean {
  return (
    first.businessId === second.businessId &&
    first.ownerUserId === second.ownerUserId &&
    first.partnerId === second.partnerId &&
    first.hostname === second.hostname &&
    first.origin === second.origin &&
    first.hostKind === second.hostKind
  );
}

async function calendarEntitlementFailure(
  businessId: string,
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
      { status: 403 },
    );
  } catch (error) {
    if (error instanceof EntitlementResolutionError) {
      return NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 },
    );
  }
}

function attemptErrorResponse(error: unknown): NextResponse {
  if (error instanceof GoogleOAuthAttemptError) {
    if (error.code === "workspace_changed") return workspaceChangedResponse();
    if (error.status === 400) {
      return NextResponse.json(
        { error: "oauth_handoff_invalid" },
        { status: 400 },
      );
    }
  }
  return NextResponse.json(
    { error: "service_unavailable", retryable: true },
    { status: 503 },
  );
}

function workspaceChangedResponse(): NextResponse {
  return NextResponse.json(
    { error: "workspace_access_denied" },
    { status: 403 },
  );
}

function finish(response: NextResponse): NextResponse {
  return clearGoogleOAuthOriginVerifier(secureGoogleOAuthResponse(response));
}
