import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthUrl,
  GOOGLE_OAUTH_NONCE_COOKIE,
  GOOGLE_OAUTH_NONCE_MAX_AGE_SECONDS,
} from "@/lib/google/client";
import { requireAuthenticatedFeature } from "@/lib/google/routeAccess";

export async function GET(request: NextRequest) {
  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return access.response;

  const nonce = randomBytes(32).toString("base64url");
  const url = generateAuthUrl(access.businessId, nonce);
  const response = NextResponse.redirect(url);

  response.cookies.set(GOOGLE_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure:
      request.nextUrl.protocol === "https:" ||
      process.env.NODE_ENV === "production",
    path: "/api/google/callback",
    maxAge: GOOGLE_OAUTH_NONCE_MAX_AGE_SECONDS,
  });

  return response;
}
