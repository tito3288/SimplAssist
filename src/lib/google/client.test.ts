import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuth2Client } from "google-auth-library";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

import {
  generateAuthUrl,
  getAuthenticatedClient,
  getCanonicalGoogleRedirectUri,
  isDefinitiveGoogleCredentialInvalid,
} from "./client";

const CANONICAL_ORIGIN = "https://app.simplassist.test";
const CALLBACK = `${CANONICAL_ORIGIN}/api/google/callback`;
const STATE = Buffer.alloc(32, 0x4a).toString("base64url");

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", CANONICAL_ORIGIN);
  vi.stubEnv("GOOGLE_REDIRECT_URI", CALLBACK);
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");

  const chain = {
    select: mocks.select,
    update: mocks.update,
    eq: mocks.eq,
    maybeSingle: mocks.maybeSingle,
  };
  mocks.from.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain);
  mocks.update.mockReturnValue(chain);
  mocks.eq.mockReturnValue(chain);
  mocks.rpc.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Google OAuth configuration", () => {
  it("accepts only the exact configured canonical callback", () => {
    expect(getCanonicalGoogleRedirectUri()).toBe(CALLBACK);
  });

  it.each([
    undefined,
    "https://app.partner.test/api/google/callback",
    `${CALLBACK}/extra`,
    `${CALLBACK}?next=/settings`,
    `${CALLBACK}#fragment`,
    "https://user:secret@app.simplassist.test/api/google/callback",
    ` ${CALLBACK}`,
  ])("rejects a noncanonical redirect URI: %s", (configured) => {
    vi.stubEnv("GOOGLE_REDIRECT_URI", configured);
    expect(() => getCanonicalGoogleRedirectUri()).toThrow();
  });

  it("generates an opaque-state authorization URL with the canonical redirect", () => {
    const authorization = new URL(generateAuthUrl(STATE));

    expect(authorization.searchParams.get("state")).toBe(STATE);
    expect(authorization.searchParams.get("redirect_uri")).toBe(CALLBACK);
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.searchParams.get("prompt")).toBe("consent");
    expect(Buffer.from(STATE, "base64url").toString("utf8")).not.toContain(
      "business",
    );
  });

  it("rejects malformed state before creating an authorization URL", () => {
    expect(() => generateAuthUrl("business-id")).toThrow(
      "Google OAuth state is invalid",
    );
  });
});

describe("bounded Google credential loading", () => {
  const token = (tokenExpiry: string) => ({
    business_id: "00000000-0000-4000-8000-000000000001",
    access_token: "stored-access-token",
    refresh_token: "stored-refresh-token",
    token_expiry: tokenExpiry,
    credential_version: "00000000-0000-4000-8000-000000000099",
  });

  it("sets the stored finite expiry so google-auth cannot implicitly replay a 401/403", async () => {
    const expiry = Date.now() + 60 * 60 * 1000;
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(expiry).toISOString()),
      error: null,
    });

    const client = await getAuthenticatedClient(
      "00000000-0000-4000-8000-000000000001",
    );

    expect(client?.credentials).toMatchObject({
      access_token: "stored-access-token",
      expiry_date: expiry,
    });
    expect(client?.credentials.refresh_token).toBeUndefined();
    expect(client?.eagerRefreshThresholdMillis).toBe(0);
    expect(client?.forceRefreshOnFailure).toBe(false);
  });

  it("accepts only a refreshed access token with a finite expiry and persists the same boundary", async () => {
    const storedExpiry = Date.now() + 60_000;
    const refreshedExpiry = Date.now() + 60 * 60 * 1000;
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(storedExpiry).toISOString()),
      error: null,
    });
    vi.spyOn(OAuth2Client.prototype, "refreshAccessToken").mockResolvedValue({
      credentials: {
        access_token: "refreshed-access-token",
        refresh_token: "stored-refresh-token",
        expiry_date: refreshedExpiry,
      },
      res: null,
    } as never);
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    const client = await getAuthenticatedClient(
      "00000000-0000-4000-8000-000000000001",
    );

    expect(client?.credentials).toMatchObject({
      access_token: "refreshed-access-token",
      expiry_date: refreshedExpiry,
    });
    expect(client?.credentials.refresh_token).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "persist_google_calendar_token_refresh_if_unchanged",
      {
        p_business_id: "00000000-0000-4000-8000-000000000001",
        p_expected_credential_version:
          "00000000-0000-4000-8000-000000000099",
        p_access_token: "refreshed-access-token",
        p_token_expiry: new Date(refreshedExpiry).toISOString(),
      },
    );
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([
    { access_token: "refreshed-without-expiry" },
    { expiry_date: Date.now() + 60 * 60 * 1000 },
    { access_token: "refreshed-with-bad-expiry", expiry_date: Number.NaN },
  ])("rejects malformed nominal refresh success without exposing an implicit replay path", async (credentials) => {
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(Date.now() + 60_000).toISOString()),
      error: null,
    });
    vi.spyOn(OAuth2Client.prototype, "refreshAccessToken").mockResolvedValue({
      credentials,
      res: null,
    } as never);

    await expect(
      getAuthenticatedClient("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow(
      "Google Calendar credential refresh returned unusable credentials",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("preserves the credential generation on transient refresh failure", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(Date.now() + 60_000).toISOString()),
      error: null,
    });
    vi.spyOn(OAuth2Client.prototype, "refreshAccessToken").mockRejectedValue({
      response: { status: 503, data: { error: "backendError" } },
    });

    await expect(
      getAuthenticatedClient("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Google Calendar credential refresh is unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("conditionally removes only the unchanged token on invalid_grant", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(Date.now() + 60_000).toISOString()),
      error: null,
    });
    vi.spyOn(OAuth2Client.prototype, "refreshAccessToken").mockRejectedValue({
      response: { status: 400, data: { error: "invalid_grant" } },
    });
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });

    await expect(
      getAuthenticatedClient("00000000-0000-4000-8000-000000000001"),
    ).resolves.toBeNull();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "disconnect_google_calendar_token_if_unchanged",
      {
        p_business_id: "00000000-0000-4000-8000-000000000001",
        p_expected_credential_version:
          "00000000-0000-4000-8000-000000000099",
      },
    );
  });

  it("discards stale refreshed credentials and reloads an OAuth replacement after CAS loss", async () => {
    const replacementExpiry = Date.now() + 60 * 60 * 1000;
    mocks.maybeSingle
      .mockResolvedValueOnce({
        data: token(new Date(Date.now() + 60_000).toISOString()),
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...token(new Date(replacementExpiry).toISOString()),
          access_token: "replacement-access-token",
          refresh_token: "replacement-refresh-token",
          credential_version: "00000000-0000-4000-8000-000000000100",
        },
        error: null,
      });
    vi.spyOn(OAuth2Client.prototype, "refreshAccessToken").mockResolvedValue({
      credentials: {
        access_token: "stale-refreshed-access-token",
        expiry_date: Date.now() + 60 * 60 * 1000,
      },
      res: null,
    } as never);
    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });

    const client = await getAuthenticatedClient(
      "00000000-0000-4000-8000-000000000001",
    );

    expect(client?.credentials.access_token).toBe("replacement-access-token");
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2);
  });

  it("does not auto-refresh a stored token just outside the explicit safety window", async () => {
    const expiry = Date.now() + 5 * 60 * 1000 + 1_000;
    mocks.maybeSingle.mockResolvedValue({
      data: token(new Date(expiry).toISOString()),
      error: null,
    });
    const refresh = vi.spyOn(
      OAuth2Client.prototype,
      "refreshAccessToken",
    );

    const client = await getAuthenticatedClient(
      "00000000-0000-4000-8000-000000000001",
    );
    const headers = await client?.getRequestHeaders();

    expect(headers?.get("authorization")).toBe(
      "Bearer stored-access-token",
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(client?.credentials.refresh_token).toBeUndefined();
  });

  it("fails closed on an invalid stored expiry before constructing provider work", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: token("not-a-timestamp"),
      error: null,
    });

    await expect(
      getAuthenticatedClient("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Stored Google Calendar credential state is invalid");
  });
});

describe("Google credential failure classification", () => {
  it("accepts only structured 400 invalid_grant as definitive", () => {
    expect(
      isDefinitiveGoogleCredentialInvalid({
        response: { status: 400, data: { error: "invalid_grant" } },
      }),
    ).toBe(true);
  });

  it.each([
    new Error("invalid_grant"),
    { response: { status: 429, data: { error: "invalid_grant" } } },
    { response: { status: 500, data: { error: "backendError" } } },
    { response: { status: 400, data: { error: "temporarily_unavailable" } } },
    { code: 400, message: "invalid_grant" },
  ])("keeps ambiguous/transient failures retryable: %j", (error) => {
    expect(isDefinitiveGoogleCredentialInvalid(error)).toBe(false);
  });
});
