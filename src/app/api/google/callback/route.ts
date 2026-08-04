import { NextRequest, NextResponse } from "next/server";
import {
  GoogleOAuthAttemptError,
  isExactCanonicalGoogleCallbackHost,
  parseGoogleOAuthOpaqueToken,
  stageGoogleCalendarOAuthHandoff,
  type GoogleOAuthSanitizedResult,
} from "@/lib/google/oauthAttempt.server";
import { secureGoogleOAuthResponse } from "@/lib/google/oauthRouteResponse.server";

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

export async function GET(request: NextRequest) {
  if (!isExactCanonicalGoogleCallbackHost(request.headers.get("host"))) {
    return neutralError(404);
  }

  const parsed = parseCallback(request.nextUrl.searchParams);
  if (!parsed) return neutralError(400);

  try {
    const staged = await stageGoogleCalendarOAuthHandoff(parsed);
    const destination = new URL("/api/google/complete", staged.returnOrigin);
    destination.searchParams.set("handoff", staged.handoff);
    return secureGoogleOAuthResponse(NextResponse.redirect(destination));
  } catch (error) {
    if (
      error instanceof GoogleOAuthAttemptError &&
      error.code === "service_unavailable"
    ) {
      return secureGoogleOAuthResponse(
        NextResponse.json(
          { error: "service_unavailable", retryable: true },
          { status: 503 },
        ),
      );
    }

    return neutralError(400);
  }
}

function parseCallback(searchParams: URLSearchParams): {
  state: string;
  authorizationCode: string | null;
  sanitizedResult: GoogleOAuthSanitizedResult | null;
} | null {
  const states = searchParams.getAll("state");
  const codes = searchParams.getAll("code");
  const errors = searchParams.getAll("error");
  if (
    states.length !== 1 ||
    parseGoogleOAuthOpaqueToken(states[0]) === null ||
    (codes.length === 1) === (errors.length === 1) ||
    codes.length > 1 ||
    errors.length > 1
  ) {
    return null;
  }

  if (codes.length === 1) {
    const authorizationCode = codes[0];
    if (
      authorizationCode.length === 0 ||
      authorizationCode.length > 4096 ||
      CONTROL_CHARACTER.test(authorizationCode)
    ) {
      return null;
    }
    return {
      state: states[0],
      authorizationCode,
      sanitizedResult: null,
    };
  }

  const providerError = errors[0];
  if (
    providerError.length === 0 ||
    providerError.length > 256 ||
    CONTROL_CHARACTER.test(providerError)
  ) {
    return null;
  }
  return {
    state: states[0],
    authorizationCode: null,
    sanitizedResult:
      providerError === "access_denied" ? "access_denied" : "provider_error",
  };
}

function neutralError(status: 400 | 404): NextResponse {
  return secureGoogleOAuthResponse(
    NextResponse.json({ error: "oauth_request_invalid" }, { status }),
  );
}
