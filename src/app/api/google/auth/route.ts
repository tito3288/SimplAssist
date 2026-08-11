import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthUrl,
  getCanonicalGoogleRedirectUri,
} from "@/lib/google/client";
import { requireAuthenticatedFeature } from "@/lib/google/routeAccess";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import {
  createGoogleCalendarOAuthAttempt,
  createGoogleOAuthOpaqueToken,
  GoogleOAuthAttemptError,
  resolveGoogleOAuthWorkspaceIdentity,
  requireGoogleCalendarSettings,
} from "@/lib/google/oauthAttempt.server";
import {
  secureGoogleOAuthResponse,
  setGoogleOAuthOriginVerifier,
} from "@/lib/google/oauthRouteResponse.server";

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return secureGoogleOAuthResponse(workspace.response);
  if (workspace.access.business.primary_goal === "signup") {
    return secureGoogleOAuthResponse(
      NextResponse.json(
        { error: "goal_unavailable", feature: "calendar" },
        { status: 403 },
      ),
    );
  }

  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return secureGoogleOAuthResponse(access.response);
  if (access.businessId !== workspace.access.business.id) {
    return secureGoogleOAuthResponse(
      NextResponse.json(
        { error: "workspace_access_unavailable", retryable: true },
        { status: 503 },
      ),
    );
  }

  try {
    getCanonicalGoogleRedirectUri();
    const identity = await resolveGoogleOAuthWorkspaceIdentity(
      workspace.access,
      request.headers.get("host"),
    );
    await requireGoogleCalendarSettings(identity.businessId);

    const state = createGoogleOAuthOpaqueToken();
    const originVerifier = createGoogleOAuthOpaqueToken();
    const url = generateAuthUrl(state);

    await createGoogleCalendarOAuthAttempt({
      identity,
      state,
      originVerifier,
    });

    return setGoogleOAuthOriginVerifier(
      NextResponse.redirect(url),
      originVerifier,
    );
  } catch (error) {
    if (error instanceof GoogleOAuthAttemptError) {
      return secureGoogleOAuthResponse(
        NextResponse.json(
          {
            error:
              error.status === 403
                ? "workspace_access_denied"
                : "service_unavailable",
            ...(error.status === 503 ? { retryable: true } : {}),
          },
          { status: error.status },
        ),
      );
    }

    return secureGoogleOAuthResponse(
      NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 },
      ),
    );
  }
}
