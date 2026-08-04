import { OAuth2Client, type Credentials } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export { SCOPES };
export const GOOGLE_OAUTH_ORIGIN_COOKIE = "sa_google_calendar_oauth_origin";
export const GOOGLE_OAUTH_MAX_AGE_SECONDS = 10 * 60;

const OPAQUE_OAUTH_STATE = /^[A-Za-z0-9_-]{43}$/;

export function getCanonicalGoogleRedirectUri(): string {
  const expected = `${getCanonicalAppOrigin()}/api/google/callback`;
  const configured = process.env.GOOGLE_REDIRECT_URI;

  if (!configured || configured !== configured.trim()) {
    throw new Error("Google OAuth redirect URI is not configured");
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("Google OAuth redirect URI is invalid");
  }

  if (
    configured !== expected ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(
      "Google OAuth redirect URI must use the canonical callback",
    );
  }

  return expected;
}

export function getGoogleOAuth2Client(): OAuth2Client {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials are not configured");
  }

  return new OAuth2Client(
    clientId,
    clientSecret,
    getCanonicalGoogleRedirectUri(),
  );
}

export function generateAuthUrl(state: string): string {
  if (!OPAQUE_OAUTH_STATE.test(state)) {
    throw new Error("Google OAuth state is invalid");
  }

  const client = getGoogleOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function getAuthenticatedClient(
  businessId: string,
): Promise<OAuth2Client | null> {
  const { data: token, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (tokenError) {
    throw new Error(
      `Failed to load Google Calendar credentials: ${tokenError.message}`,
    );
  }

  if (!token) return null;

  const client = getGoogleOAuth2Client();
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
  });

  // Refresh if expiring within 5 minutes
  const expiresAt = new Date(token.token_expiry).getTime();
  const fiveMinutes = 5 * 60 * 1000;

  if (Date.now() > expiresAt - fiveMinutes) {
    let credentials: Credentials;
    try {
      ({ credentials } = await client.refreshAccessToken());
    } catch {
      // Refresh token revoked or invalid — clean up
      await supabaseAdmin
        .from("google_calendar_tokens")
        .delete()
        .eq("business_id", businessId);
      return null;
    }

    client.setCredentials(credentials);
    const { error: updateError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .update({
        access_token: credentials.access_token,
        token_expiry: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : token.token_expiry,
      })
      .eq("business_id", businessId);

    if (updateError) {
      throw new Error(
        `Failed to save refreshed Google Calendar credentials: ${updateError.message}`,
      );
    }
  }

  return client;
}

export function getCalendarService(client: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: client });
}
