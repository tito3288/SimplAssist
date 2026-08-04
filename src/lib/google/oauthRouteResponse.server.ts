import "server-only";

import { NextResponse } from "next/server";
import {
  GOOGLE_OAUTH_MAX_AGE_SECONDS,
  GOOGLE_OAUTH_ORIGIN_COOKIE,
} from "@/lib/google/client";

export function secureGoogleOAuthResponse<T extends NextResponse>(
  response: T,
): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export function setGoogleOAuthOriginVerifier(
  response: NextResponse,
  verifier: string,
): NextResponse {
  response.cookies.set(GOOGLE_OAUTH_ORIGIN_COOKIE, verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google/complete",
    maxAge: GOOGLE_OAUTH_MAX_AGE_SECONDS,
  });
  return secureGoogleOAuthResponse(response);
}

export function clearGoogleOAuthOriginVerifier(
  response: NextResponse,
): NextResponse {
  response.cookies.set(GOOGLE_OAUTH_ORIGIN_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/google/complete",
    maxAge: 0,
  });
  return secureGoogleOAuthResponse(response);
}
