import { OAuth2Client, type Credentials } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export { SCOPES };
export const GOOGLE_OAUTH_NONCE_COOKIE = "sa_google_calendar_oauth_nonce";
export const GOOGLE_OAUTH_NONCE_MAX_AGE_SECONDS = 10 * 60;

export interface GoogleOAuthState {
  businessId: string;
  nonce: string;
}

export function getGoogleOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

export function encodeGoogleOAuthState(state: GoogleOAuthState): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      businessId: state.businessId,
      nonce: state.nonce,
    })
  ).toString("base64url");
}

export function decodeGoogleOAuthState(value: string): GoogleOAuthState | null {
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf-8"));
    if (
      decoded?.version !== 1 ||
      typeof decoded.businessId !== "string" ||
      decoded.businessId.length === 0 ||
      typeof decoded.nonce !== "string" ||
      decoded.nonce.length < 32
    ) {
      return null;
    }
    return { businessId: decoded.businessId, nonce: decoded.nonce };
  } catch {
    return null;
  }
}

export function generateAuthUrl(businessId: string, nonce: string): string {
  const client = getGoogleOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: encodeGoogleOAuthState({ businessId, nonce }),
  });
}

export async function getAuthenticatedClient(
  businessId: string
): Promise<OAuth2Client | null> {
  const { data: token, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (tokenError) {
    throw new Error(
      `Failed to load Google Calendar credentials: ${tokenError.message}`
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
        `Failed to save refreshed Google Calendar credentials: ${updateError.message}`
      );
    }
  }

  return client;
}

export function getCalendarService(
  client: OAuth2Client
): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: client });
}
