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
const GOOGLE_AUTH_REFRESH_TIMEOUT_MS = 10_000;
const GOOGLE_AUTH_SAFETY_WINDOW_MS = 5 * 60 * 1000;
const MAX_CREDENTIAL_CAS_RELOADS = 1;

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
  credentialCasReloads = 0,
): Promise<OAuth2Client | null> {
  const { data: token, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("*")
    .eq("business_id", businessId)
    .maybeSingle();

  if (tokenError) {
    throw new Error("Failed to load Google Calendar credentials");
  }

  if (!token) return null;

  const expiresAt = new Date(token.token_expiry).getTime();
  if (
    !Number.isFinite(expiresAt) ||
    typeof token.access_token !== "string" ||
    token.access_token.length === 0 ||
    typeof token.refresh_token !== "string" ||
    token.refresh_token.length === 0 ||
    typeof token.credential_version !== "string" ||
    token.credential_version.length === 0
  ) {
    throw new Error("Stored Google Calendar credential state is invalid");
  }

  const client = getGoogleOAuth2Client();
  // Provider calls must never invoke google-auth's own eager refresh or
  // 401/403 replay. Refresh is performed explicitly below, within our bounded
  // durable workflow, and refresh capability is stripped before returning.
  client.eagerRefreshThresholdMillis = 0;
  client.forceRefreshOnFailure = false;
  client.setCredentials({
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    // Suppress google-auth's implicit 401/403 refresh-and-replay path. Any
    // refresh happens explicitly and within the durable caller boundary.
    expiry_date: expiresAt,
  });

  // Refresh if expiring within 5 minutes
  let usableAccessToken = token.access_token;
  let usableExpiresAt = expiresAt;

  if (expiresAt - Date.now() <= GOOGLE_AUTH_SAFETY_WINDOW_MS) {
    let credentials: Credentials;
    try {
      ({ credentials } = await withGoogleAuthDeadline(
        client.refreshAccessToken(),
        GOOGLE_AUTH_REFRESH_TIMEOUT_MS
      ));
    } catch (cause) {
      if (!isDefinitiveGoogleCredentialInvalid(cause)) {
        // Timeout, transport failure, throttling, provider 5xx, and unknown
        // errors cannot prove the refresh token invalid. Preserve the exact
        // credential generation so a later bounded retry can recover.
        throw new Error("Google Calendar credential refresh is unavailable");
      }

      const { data: disconnected, error: disconnectError } =
        await supabaseAdmin.rpc(
          "disconnect_google_calendar_token_if_unchanged",
          {
            p_business_id: businessId,
            p_expected_credential_version: token.credential_version,
          },
        );
      if (disconnectError) {
        if (disconnectError.code === "55P03") return null;
        throw new Error(
          "Failed to fence an invalid Google Calendar credential",
        );
      }
      if (disconnected === true) return null;
      if (credentialCasReloads >= MAX_CREDENTIAL_CAS_RELOADS) {
        throw new Error("Google Calendar credential changed during refresh");
      }
      return getAuthenticatedClient(businessId, credentialCasReloads + 1);
    }

    const refreshedAccessToken = credentials.access_token;
    const refreshedExpiresAt = credentials.expiry_date;
    if (
      typeof refreshedAccessToken !== "string" ||
      refreshedAccessToken.length === 0 ||
      typeof refreshedExpiresAt !== "number" ||
      !Number.isFinite(refreshedExpiresAt) ||
      refreshedExpiresAt - Date.now() <= GOOGLE_AUTH_SAFETY_WINDOW_MS
    ) {
      // A nominally successful refresh without both pieces of bounded replay
      // state is not safe to use: google-auth would otherwise be allowed to
      // perform an implicit 401/403 refresh and replay later provider calls.
      throw new Error(
        "Google Calendar credential refresh returned unusable credentials",
      );
    }

    const { data: persisted, error: updateError } = await supabaseAdmin.rpc(
      "persist_google_calendar_token_refresh_if_unchanged",
      {
        p_business_id: businessId,
        p_expected_credential_version: token.credential_version,
        p_access_token: refreshedAccessToken,
        p_token_expiry: new Date(refreshedExpiresAt).toISOString(),
      },
    );
    if (updateError) {
      throw new Error(
        "Failed to save refreshed Google Calendar credentials",
      );
    }
    if (persisted !== true) {
      if (credentialCasReloads >= MAX_CREDENTIAL_CAS_RELOADS) {
        throw new Error("Google Calendar credential changed during refresh");
      }
      return getAuthenticatedClient(businessId, credentialCasReloads + 1);
    }

    usableAccessToken = refreshedAccessToken;
    usableExpiresAt = refreshedExpiresAt;
  }

  client.setCredentials({
    access_token: usableAccessToken,
    expiry_date: usableExpiresAt,
    token_type: "Bearer",
  });

  return client;
}

/** Only Google's structured 400/invalid_grant proves this refresh token bad. */
export function isDefinitiveGoogleCredentialInvalid(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const response = (error as { response?: unknown }).response;
  if (!response || typeof response !== "object") return false;
  const status = (response as { status?: unknown }).status;
  const data = (response as { data?: unknown }).data;
  if (status !== 400 || !data || typeof data !== "object") return false;
  return (data as { error?: unknown }).error === "invalid_grant";
}

export function getCalendarService(client: OAuth2Client): calendar_v3.Calendar {
  return google.calendar({ version: "v3", auth: client });
}

export async function withGoogleAuthDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  promise.catch(() => undefined);
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Google authentication timed out")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
