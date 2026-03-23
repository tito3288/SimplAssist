import { OAuth2Client } from "google-auth-library";
import { google, calendar_v3 } from "googleapis";
import { supabaseAdmin } from "@/lib/supabase/admin";

const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
];

export { SCOPES };

export function getGoogleOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!
  );
}

export function generateAuthUrl(businessId: string): string {
  const client = getGoogleOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state: Buffer.from(businessId).toString("base64"),
  });
}

export async function getAuthenticatedClient(
  businessId: string
): Promise<OAuth2Client | null> {
  const { data: token } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("business_id", businessId)
    .single();

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
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);

      await supabaseAdmin
        .from("google_calendar_tokens")
        .update({
          access_token: credentials.access_token,
          token_expiry: credentials.expiry_date
            ? new Date(credentials.expiry_date).toISOString()
            : token.token_expiry,
        })
        .eq("business_id", businessId);
    } catch {
      // Refresh token revoked or invalid — clean up
      await supabaseAdmin
        .from("google_calendar_tokens")
        .delete()
        .eq("business_id", businessId);
      return null;
    }
  }

  return client;
}

export function getCalendarService(
  client: OAuth2Client
): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: client });
}
