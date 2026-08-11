import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class GoogleOAuthAttemptError extends Error {
    constructor(
      readonly code: string,
      readonly status: number,
    ) {
      super(code);
      this.name = "GoogleOAuthAttemptError";
    }
  }

  class EntitlementResolutionError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = "EntitlementResolutionError";
    }
  }

  return {
    GoogleOAuthAttemptError,
    EntitlementResolutionError,
    requireWorkspaceRouteAccess: vi.fn(),
    requireFreshWorkspaceRouteAccess: vi.fn(),
    requireAuthenticatedFeature: vi.fn(),
    resolveBusinessEntitlements: vi.fn(),
    canUseFeature: vi.fn(),
    requiredPlanForFeature: vi.fn(),
    getCanonicalGoogleRedirectUri: vi.fn(),
    generateAuthUrl: vi.fn(),
    getGoogleOAuth2Client: vi.fn(),
    getToken: vi.fn(),
    verifyIdToken: vi.fn(),
    createGoogleOAuthOpaqueToken: vi.fn(),
    parseGoogleOAuthOpaqueToken: vi.fn(),
    isExactCanonicalGoogleCallbackHost: vi.fn(),
    resolveGoogleOAuthWorkspaceIdentity: vi.fn(),
    requireGoogleCalendarSettings: vi.fn(),
    createGoogleCalendarOAuthAttempt: vi.fn(),
    stageGoogleCalendarOAuthHandoff: vi.fn(),
    claimGoogleCalendarOAuthHandoff: vi.fn(),
    completeGoogleCalendarOAuthConnection: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
  requireFreshWorkspaceRouteAccess: mocks.requireFreshWorkspaceRouteAccess,
}));
vi.mock("@/lib/google/routeAccess", () => ({
  requireAuthenticatedFeature: mocks.requireAuthenticatedFeature,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  EntitlementResolutionError: mocks.EntitlementResolutionError,
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
  requiredPlanForFeature: mocks.requiredPlanForFeature,
}));
vi.mock("@/lib/google/client", () => ({
  GOOGLE_OAUTH_ORIGIN_COOKIE: "sa_google_calendar_oauth_origin",
  GOOGLE_OAUTH_MAX_AGE_SECONDS: 600,
  getCanonicalGoogleRedirectUri: mocks.getCanonicalGoogleRedirectUri,
  generateAuthUrl: mocks.generateAuthUrl,
  getGoogleOAuth2Client: mocks.getGoogleOAuth2Client,
}));
vi.mock("@/lib/google/oauthAttempt.server", () => ({
  GoogleOAuthAttemptError: mocks.GoogleOAuthAttemptError,
  createGoogleOAuthOpaqueToken: mocks.createGoogleOAuthOpaqueToken,
  parseGoogleOAuthOpaqueToken: mocks.parseGoogleOAuthOpaqueToken,
  isExactCanonicalGoogleCallbackHost: mocks.isExactCanonicalGoogleCallbackHost,
  resolveGoogleOAuthWorkspaceIdentity:
    mocks.resolveGoogleOAuthWorkspaceIdentity,
  requireGoogleCalendarSettings: mocks.requireGoogleCalendarSettings,
  createGoogleCalendarOAuthAttempt: mocks.createGoogleCalendarOAuthAttempt,
  stageGoogleCalendarOAuthHandoff: mocks.stageGoogleCalendarOAuthHandoff,
  claimGoogleCalendarOAuthHandoff: mocks.claimGoogleCalendarOAuthHandoff,
  completeGoogleCalendarOAuthConnection:
    mocks.completeGoogleCalendarOAuthConnection,
}));

import { GOOGLE_OAUTH_ORIGIN_COOKIE } from "@/lib/google/client";
import { GET as beginOAuth } from "./auth/route";
import { GET as stageOAuth } from "./callback/route";
import { GET as completeOAuth } from "./complete/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";
const PARTNER_ID = "00000000-0000-4000-8000-000000000003";
const ATTEMPT_ID = "00000000-0000-4000-8000-000000000004";
const CANONICAL_ORIGIN = "https://app.example.test";
const PARTNER_ORIGIN = "https://partner.example.test";
const STATE = "A".repeat(43);
const ORIGIN_VERIFIER = "B".repeat(43);
const HANDOFF = "C".repeat(43);
const OTHER_TOKEN = "D".repeat(43);
type PrimaryGoal = "book" | "signup" | "quote" | "callback" | null;

const CANONICAL_ACCESS = {
  status: "resolved" as const,
  user: { id: USER_ID },
  business: { id: BUSINESS_ID, partner_id: null, primary_goal: null },
  hostKind: "canonical" as const,
};

const PARTNER_ACCESS = {
  status: "resolved" as const,
  user: { id: USER_ID },
  business: {
    id: BUSINESS_ID,
    partner_id: PARTNER_ID,
    primary_goal: null,
  },
  hostKind: "partner" as const,
};

function accessWithGoal<Access extends typeof CANONICAL_ACCESS | typeof PARTNER_ACCESS>(
  access: Access,
  primaryGoal: PrimaryGoal,
): Access {
  return {
    ...access,
    business: { ...access.business, primary_goal: primaryGoal },
  } as Access;
}

const CANONICAL_IDENTITY = {
  businessId: BUSINESS_ID,
  ownerUserId: USER_ID,
  partnerId: null,
  hostname: "app.example.test",
  origin: CANONICAL_ORIGIN,
  hostKind: "canonical" as const,
};

const PARTNER_IDENTITY = {
  businessId: BUSINESS_ID,
  ownerUserId: USER_ID,
  partnerId: PARTNER_ID,
  hostname: "partner.example.test",
  origin: PARTNER_ORIGIN,
  hostKind: "partner" as const,
};

const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

function requestFor(path: string, origin = CANONICAL_ORIGIN): NextRequest {
  return new NextRequest(`${origin}${path}`, {
    headers: { host: new URL(origin).host },
  });
}

function callbackRequest(
  query = `state=${STATE}&code=oauth-code`,
  host = "app.example.test",
): NextRequest {
  return new NextRequest(`${CANONICAL_ORIGIN}/api/google/callback?${query}`, {
    headers: { host },
  });
}

function completeRequest(
  query = `handoff=${HANDOFF}`,
  verifier = ORIGIN_VERIFIER,
  origin = CANONICAL_ORIGIN,
): NextRequest {
  return new NextRequest(`${origin}/api/google/complete?${query}`, {
    headers: {
      host: new URL(origin).host,
      cookie: `${GOOGLE_OAUTH_ORIGIN_COOKIE}=${verifier}`,
    },
  });
}

function expectSecureResponse(response: Response): void {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

function expectVerifierCookie(
  response: Response,
  value: string,
  maxAge: number,
): void {
  const cookie = response.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`${GOOGLE_OAUTH_ORIGIN_COOKIE}=${value}`);
  expect(cookie).toContain("Path=/api/google/complete");
  expect(cookie).toContain(`Max-Age=${maxAge}`);
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).not.toMatch(/(?:^|;\s*)Domain=/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");

  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: CANONICAL_ACCESS,
  });
  mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: CANONICAL_ACCESS,
  });
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
    entitlements: ENTITLEMENTS,
    supabase: {},
  });
  mocks.resolveBusinessEntitlements.mockResolvedValue(ENTITLEMENTS);
  mocks.canUseFeature.mockReturnValue(true);
  mocks.requiredPlanForFeature.mockReturnValue("sms_and_chat");

  mocks.getCanonicalGoogleRedirectUri.mockReturnValue(
    `${CANONICAL_ORIGIN}/api/google/callback`,
  );
  mocks.generateAuthUrl.mockReturnValue(
    "https://accounts.google.test/o/oauth2/auth",
  );
  mocks.createGoogleOAuthOpaqueToken
    .mockReturnValueOnce(STATE)
    .mockReturnValueOnce(ORIGIN_VERIFIER);
  mocks.parseGoogleOAuthOpaqueToken.mockImplementation((value: unknown) =>
    [STATE, ORIGIN_VERIFIER, HANDOFF, OTHER_TOKEN].includes(String(value))
      ? String(value)
      : null,
  );
  mocks.isExactCanonicalGoogleCallbackHost.mockImplementation(
    (host: string | null) => host === "app.example.test",
  );
  mocks.resolveGoogleOAuthWorkspaceIdentity.mockResolvedValue(
    CANONICAL_IDENTITY,
  );
  mocks.requireGoogleCalendarSettings.mockResolvedValue(undefined);
  mocks.createGoogleCalendarOAuthAttempt.mockResolvedValue(ATTEMPT_ID);
  mocks.stageGoogleCalendarOAuthHandoff.mockResolvedValue({
    handoff: HANDOFF,
    returnOrigin: CANONICAL_ORIGIN,
  });
  mocks.claimGoogleCalendarOAuthHandoff.mockResolvedValue({
    attemptId: ATTEMPT_ID,
    authorizationCode: "oauth-code",
    sanitizedResult: null,
  });
  mocks.completeGoogleCalendarOAuthConnection.mockResolvedValue(undefined);

  mocks.getToken.mockResolvedValue({
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expiry_date: Date.now() + 60 * 60 * 1000,
    },
  });
  mocks.verifyIdToken.mockResolvedValue({
    getPayload: () => ({ email: "owner@example.test" }),
  });
  mocks.getGoogleOAuth2Client.mockReturnValue({
    getToken: mocks.getToken,
    verifyIdToken: mocks.verifyIdToken,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Google Calendar OAuth start", () => {
  it.each([
    ["canonical", CANONICAL_ORIGIN, CANONICAL_ACCESS, CANONICAL_IDENTITY],
    ["partner", PARTNER_ORIGIN, PARTNER_ACCESS, PARTNER_IDENTITY],
  ] as const)(
    "starts on the resolved %s workspace with independent opaque state and verifier",
    async (_kind, origin, access, identity) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access });
      mocks.resolveGoogleOAuthWorkspaceIdentity.mockResolvedValue(identity);

      const response = await beginOAuth(requestFor("/api/google/auth", origin));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://accounts.google.test/o/oauth2/auth",
      );
      expect(mocks.requireWorkspaceRouteAccess).toHaveBeenCalledOnce();
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith(
        "calendar",
      );
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).toHaveBeenCalledWith(
        access,
        new URL(origin).host,
      );
      expect(mocks.createGoogleOAuthOpaqueToken).toHaveBeenCalledTimes(2);
      expect(STATE).not.toBe(ORIGIN_VERIFIER);
      expect(STATE).not.toContain(BUSINESS_ID);
      expect(STATE).not.toContain(new URL(origin).host);
      expect(mocks.generateAuthUrl).toHaveBeenCalledWith(STATE);
      expect(mocks.createGoogleCalendarOAuthAttempt).toHaveBeenCalledWith({
        identity,
        state: STATE,
        originVerifier: ORIGIN_VERIFIER,
      });
      expectVerifierCookie(response, ORIGIN_VERIFIER, 600);
      expectSecureResponse(response);
    },
  );

  it.each([null, "book", "quote", "callback"] as const)(
    "keeps the existing provider redirect and attempt contract for primary_goal=%s",
    async (primaryGoal) => {
      const access = accessWithGoal(CANONICAL_ACCESS, primaryGoal);
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access });

      const response = await beginOAuth(requestFor("/api/google/auth"));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        "https://accounts.google.test/o/oauth2/auth",
      );
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith(
        "calendar",
      );
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).toHaveBeenCalledWith(
        access,
        "app.example.test",
      );
      expect(mocks.generateAuthUrl).toHaveBeenCalledWith(STATE);
      expect(mocks.createGoogleCalendarOAuthAttempt).toHaveBeenCalledWith({
        identity: CANONICAL_IDENTITY,
        state: STATE,
        originVerifier: ORIGIN_VERIFIER,
      });
      expectVerifierCookie(response, ORIGIN_VERIFIER, 600);
      expectSecureResponse(response);
    },
  );

  it.each([
    ["canonical", CANONICAL_ORIGIN, CANONICAL_ACCESS],
    ["partner", PARTNER_ORIGIN, PARTNER_ACCESS],
  ] as const)(
    "rejects a signup-goal %s workspace before entitlement, attempt, or Google work",
    async (_kind, origin, baseAccess) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: true,
        access: accessWithGoal(baseAccess, "signup"),
      });

      const response = await beginOAuth(
        requestFor("/api/google/auth", origin),
      );

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "goal_unavailable",
        feature: "calendar",
      });
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.getCanonicalGoogleRedirectUri).not.toHaveBeenCalled();
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
      expect(mocks.requireGoogleCalendarSettings).not.toHaveBeenCalled();
      expect(mocks.createGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
      expect(mocks.createGoogleCalendarOAuthAttempt).not.toHaveBeenCalled();
      expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
      expectSecureResponse(response);
    },
  );

  it.each([401, 403, 503] as const)(
    "returns workspace %s before feature, attempt, token, or Google URL work",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(
          { error: status === 401 ? "Unauthorized" : "workspace_error" },
          { status },
        ),
      });

      const response = await beginOAuth(requestFor("/api/google/auth"));

      expect(response.status).toBe(status);
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
      expect(mocks.createGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
      expect(mocks.createGoogleCalendarOAuthAttempt).not.toHaveBeenCalled();
      expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
      expectSecureResponse(response);
    },
  );

  it("stops on an entitlement failure before identity, attempt, token, or Google URL work", async () => {
    mocks.requireAuthenticatedFeature.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "feature_unavailable" },
        { status: 403 },
      ),
    });

    const response = await beginOAuth(requestFor("/api/google/auth"));

    expect(response.status).toBe(403);
    expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
    expect(mocks.createGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
    expect(mocks.createGoogleCalendarOAuthAttempt).not.toHaveBeenCalled();
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
    expectSecureResponse(response);
  });

  it.each([
    ["redirect configuration", "redirect"],
    ["workspace identity", "identity"],
    ["Calendar settings", "settings"],
  ] as const)(
    "fails closed when %s validation fails before attempt or Google URL creation",
    async (_label, failure) => {
      if (failure === "redirect") {
        mocks.getCanonicalGoogleRedirectUri.mockImplementation(() => {
          throw new Error("bad redirect");
        });
      } else if (failure === "identity") {
        mocks.resolveGoogleOAuthWorkspaceIdentity.mockRejectedValue(
          new mocks.GoogleOAuthAttemptError("workspace_changed", 403),
        );
      } else {
        mocks.requireGoogleCalendarSettings.mockRejectedValue(
          new mocks.GoogleOAuthAttemptError("service_unavailable", 503),
        );
      }

      const response = await beginOAuth(requestFor("/api/google/auth"));

      expect(response.status).toBe(failure === "identity" ? 403 : 503);
      expect(mocks.createGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
      expect(mocks.createGoogleCalendarOAuthAttempt).not.toHaveBeenCalled();
      expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toBeNull();
      expectSecureResponse(response);
    },
  );

  it("does not set the verifier cookie when durable attempt creation fails", async () => {
    mocks.createGoogleCalendarOAuthAttempt.mockRejectedValue(
      new mocks.GoogleOAuthAttemptError("service_unavailable", 503),
    );

    const response = await beginOAuth(requestFor("/api/google/auth"));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expectSecureResponse(response);
  });
});

describe("Google Calendar OAuth canonical callback", () => {
  it("rejects a noncanonical Host before parsing, staging, session, or provider work", async () => {
    const response = await stageOAuth(
      callbackRequest(undefined, "partner.example.test"),
    );

    expect(response.status).toBe(404);
    expect(mocks.isExactCanonicalGoogleCallbackHost).toHaveBeenCalledWith(
      "partner.example.test",
    );
    expect(mocks.parseGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
    expect(mocks.stageGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
    expect(mocks.requireWorkspaceRouteAccess).not.toHaveBeenCalled();
    expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "oauth_request_invalid" });
    expectSecureResponse(response);
  });

  it("stages a sessionless code callback and redirects only to the trusted stored origin", async () => {
    mocks.stageGoogleCalendarOAuthHandoff.mockResolvedValue({
      handoff: HANDOFF,
      returnOrigin: PARTNER_ORIGIN,
    });

    const response = await stageOAuth(callbackRequest());

    expect(response.status).toBe(307);
    expect(mocks.requireWorkspaceRouteAccess).not.toHaveBeenCalled();
    expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
    expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(mocks.stageGoogleCalendarOAuthHandoff).toHaveBeenCalledWith({
      state: STATE,
      authorizationCode: "oauth-code",
      sanitizedResult: null,
    });
    expect(response.headers.get("location")).toBe(
      `${PARTNER_ORIGIN}/api/google/complete?handoff=${HANDOFF}`,
    );
    expectSecureResponse(response);
  });

  it.each([
    ["access_denied", "access_denied"],
    ["temporarily_unavailable", "provider_error"],
  ] as const)(
    "stores only the sanitized %s provider result",
    async (providerError, sanitizedResult) => {
      const response = await stageOAuth(
        callbackRequest(
          `state=${STATE}&error=${providerError}&error_description=do-not-store-me`,
        ),
      );

      expect(response.status).toBe(307);
      expect(mocks.stageGoogleCalendarOAuthHandoff).toHaveBeenCalledWith({
        state: STATE,
        authorizationCode: null,
        sanitizedResult,
      });
      expect(
        JSON.stringify(mocks.stageGoogleCalendarOAuthHandoff.mock.calls),
      ).not.toContain("do-not-store-me");
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expectSecureResponse(response);
    },
  );

  it.each([
    ["missing state", "code=oauth-code"],
    ["duplicate state", `state=${STATE}&state=${OTHER_TOKEN}&code=oauth-code`],
    ["missing result", `state=${STATE}`],
    ["code and error", `state=${STATE}&code=oauth-code&error=access_denied`],
    ["duplicate code", `state=${STATE}&code=one&code=two`],
    ["duplicate error", `state=${STATE}&error=one&error=two`],
    ["malformed state", "state=not-opaque&code=oauth-code"],
    ["empty code", `state=${STATE}&code=`],
    ["empty error", `state=${STATE}&error=`],
    ["control character in code", `state=${STATE}&code=bad%0Acode`],
  ] as const)("rejects %s before staging", async (_label, query) => {
    const response = await stageOAuth(callbackRequest(query));

    expect(response.status).toBe(400);
    expect(mocks.stageGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
    expect(mocks.requireWorkspaceRouteAccess).not.toHaveBeenCalled();
    expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ error: "oauth_request_invalid" });
    expectSecureResponse(response);
  });

  it.each([
    [
      new mocks.GoogleOAuthAttemptError("attempt_invalid_or_expired", 400),
      400,
      { error: "oauth_request_invalid" },
    ],
    [
      new mocks.GoogleOAuthAttemptError("service_unavailable", 503),
      503,
      { error: "service_unavailable", retryable: true },
    ],
  ] as const)(
    "maps staging failures without exposing provider or database details",
    async (error, status, body) => {
      mocks.stageGoogleCalendarOAuthHandoff.mockRejectedValue(error);

      const response = await stageOAuth(callbackRequest());

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual(body);
      expectSecureResponse(response);
    },
  );
});

describe("Google Calendar OAuth original-host completion", () => {
  it.each([401, 403, 503] as const)(
    "checks workspace first and returns %s before parsing, claim, or provider work",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json({ error: "workspace_error" }, { status }),
      });

      const response = await completeOAuth(completeRequest("handoff=bad"));

      expect(response.status).toBe(status);
      expect(mocks.parseGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
      expect(mocks.claimGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );

  it.each([
    ["canonical", CANONICAL_ORIGIN, CANONICAL_ACCESS, CANONICAL_IDENTITY, ""],
    [
      "canonical",
      CANONICAL_ORIGIN,
      CANONICAL_ACCESS,
      CANONICAL_IDENTITY,
      "handoff=bad",
    ],
    ["partner", PARTNER_ORIGIN, PARTNER_ACCESS, PARTNER_IDENTITY, ""],
    [
      "partner",
      PARTNER_ORIGIN,
      PARTNER_ACCESS,
      PARTNER_IDENTITY,
      "handoff=bad",
    ],
  ] as const)(
    "redirects a signup-goal %s completion with missing or malformed handoff to the trusted unavailable state",
    async (_kind, origin, baseAccess, identity, query) => {
      const access = accessWithGoal(baseAccess, "signup");
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access });
      mocks.resolveGoogleOAuthWorkspaceIdentity.mockResolvedValue(identity);

      const response = await completeOAuth(
        completeRequest(query, ORIGIN_VERIFIER, origin),
      );

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${origin}/settings?calendar=unavailable`,
      );
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).toHaveBeenCalledWith(
        access,
        new URL(origin).host,
      );
      expect(mocks.parseGoogleOAuthOpaqueToken).not.toHaveBeenCalled();
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.requireGoogleCalendarSettings).not.toHaveBeenCalled();
      expect(mocks.claimGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.requireFreshWorkspaceRouteAccess).not.toHaveBeenCalled();
      expect(
        mocks.completeGoogleCalendarOAuthConnection,
      ).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );

  it.each([
    ["missing handoff", "", ORIGIN_VERIFIER],
    [
      "duplicate handoff",
      `handoff=${HANDOFF}&handoff=${OTHER_TOKEN}`,
      ORIGIN_VERIFIER,
    ],
    ["malformed handoff", "handoff=bad", ORIGIN_VERIFIER],
    ["malformed verifier", `handoff=${HANDOFF}`, "bad"],
  ] as const)(
    "rejects %s before identity, entitlement, claim, or provider work",
    async (_label, query, verifier) => {
      const response = await completeOAuth(completeRequest(query, verifier));

      expect(response.status).toBe(400);
      expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.claimGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );

  it("rejects duplicate verifier cookies before identity or claim", async () => {
    const request = completeRequest();
    vi.spyOn(request.cookies, "getAll").mockReturnValue([
      { name: GOOGLE_OAUTH_ORIGIN_COOKIE, value: ORIGIN_VERIFIER },
      { name: GOOGLE_OAUTH_ORIGIN_COOKIE, value: OTHER_TOKEN },
    ]);

    const response = await completeOAuth(request);

    expect(response.status).toBe(400);
    expect(mocks.resolveGoogleOAuthWorkspaceIdentity).not.toHaveBeenCalled();
    expect(mocks.claimGoogleCalendarOAuthHandoff).not.toHaveBeenCalled();
    expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
  });

  it("claims the handoff before constructing a Google client", async () => {
    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(307);
    expect(mocks.claimGoogleCalendarOAuthHandoff).toHaveBeenCalledWith({
      identity: CANONICAL_IDENTITY,
      handoff: HANDOFF,
      originVerifier: ORIGIN_VERIFIER,
    });
    expect(
      mocks.claimGoogleCalendarOAuthHandoff.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.getGoogleOAuth2Client.mock.invocationCallOrder[0]);
  });

  it.each([
    ["access_denied", "denied"],
    ["provider_error", "failed"],
  ] as const)(
    "returns a fixed %s redirect without constructing a provider client",
    async (sanitizedResult, redirectResult) => {
      mocks.claimGoogleCalendarOAuthHandoff.mockResolvedValue({
        attemptId: ATTEMPT_ID,
        authorizationCode: null,
        sanitizedResult,
      });

      const response = await completeOAuth(completeRequest());

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${CANONICAL_ORIGIN}/settings?calendar=${redirectResult}`,
      );
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.requireFreshWorkspaceRouteAccess).not.toHaveBeenCalled();
      expect(
        mocks.completeGoogleCalendarOAuthConnection,
      ).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );

  it("exchanges once, rechecks entitlement and workspace, then atomically completes", async () => {
    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${CANONICAL_ORIGIN}/settings?calendar=connected`,
    );
    expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: "id-token",
      audience: "google-client-id",
    });
    expect(mocks.resolveBusinessEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.requireFreshWorkspaceRouteAccess).toHaveBeenCalledOnce();
    expect(mocks.resolveGoogleOAuthWorkspaceIdentity).toHaveBeenCalledTimes(2);
    expect(mocks.completeGoogleCalendarOAuthConnection).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      identity: CANONICAL_IDENTITY,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      tokenExpiry: expect.any(String),
      googleEmail: "owner@example.test",
    });

    const order = {
      claim: mocks.claimGoogleCalendarOAuthHandoff.mock.invocationCallOrder[0],
      exchange: mocks.getToken.mock.invocationCallOrder[0],
      entitlement:
        mocks.resolveBusinessEntitlements.mock.invocationCallOrder[0],
      freshWorkspace:
        mocks.requireFreshWorkspaceRouteAccess.mock.invocationCallOrder[0],
      complete:
        mocks.completeGoogleCalendarOAuthConnection.mock.invocationCallOrder[0],
    };
    expect(order.claim).toBeLessThan(order.exchange);
    expect(order.exchange).toBeLessThan(order.entitlement);
    expect(order.entitlement).toBeLessThan(order.freshWorkspace);
    expect(order.freshWorkspace).toBeLessThan(order.complete);
    expectVerifierCookie(response, "", 0);
    expectSecureResponse(response);
  });

  it.each([null, "book", "quote", "callback"] as const)(
    "keeps the existing connected completion contract for primary_goal=%s",
    async (primaryGoal) => {
      const access = accessWithGoal(CANONICAL_ACCESS, primaryGoal);
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access });
      mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
        ok: true,
        access,
      });

      const response = await completeOAuth(completeRequest());

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${CANONICAL_ORIGIN}/settings?calendar=connected`,
      );
      expect(mocks.claimGoogleCalendarOAuthHandoff).toHaveBeenCalledWith({
        identity: CANONICAL_IDENTITY,
        handoff: HANDOFF,
        originVerifier: ORIGIN_VERIFIER,
      });
      expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
      expect(mocks.requireFreshWorkspaceRouteAccess).toHaveBeenCalledOnce();
      expect(mocks.completeGoogleCalendarOAuthConnection).toHaveBeenCalledWith({
        attemptId: ATTEMPT_ID,
        identity: CANONICAL_IDENTITY,
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenExpiry: expect.any(String),
        googleEmail: "owner@example.test",
      });
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );

  it("uses the exact partner origin for a partner completion redirect", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: PARTNER_ACCESS,
    });
    mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: PARTNER_ACCESS,
    });
    mocks.resolveGoogleOAuthWorkspaceIdentity.mockResolvedValue(
      PARTNER_IDENTITY,
    );

    const response = await completeOAuth(
      completeRequest(undefined, ORIGIN_VERIFIER, PARTNER_ORIGIN),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${PARTNER_ORIGIN}/settings?calendar=connected`,
    );
    expect(mocks.completeGoogleCalendarOAuthConnection).toHaveBeenCalledWith(
      expect.objectContaining({ identity: PARTNER_IDENTITY }),
    );
    expectVerifierCookie(response, "", 0);
  });

  it.each([
    [
      "claim rejection",
      () =>
        mocks.claimGoogleCalendarOAuthHandoff.mockRejectedValue(
          new mocks.GoogleOAuthAttemptError("handoff_invalid_or_expired", 400),
        ),
      400,
      "oauth_handoff_invalid",
    ],
    [
      "initial entitlement loss",
      () =>
        mocks.requireAuthenticatedFeature.mockResolvedValue({
          ok: false,
          response: NextResponse.json(
            { error: "feature_unavailable" },
            { status: 403 },
          ),
        }),
      403,
      "feature_unavailable",
    ],
  ] as const)(
    "stops on %s before provider exchange",
    async (_label, arrange, status, errorCode) => {
      arrange();

      const response = await completeOAuth(completeRequest());

      expect(response.status).toBe(status);
      expect((await response.json()).error).toBe(errorCode);
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expect(
        mocks.completeGoogleCalendarOAuthConnection,
      ).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
    },
  );

  it("blocks a post-exchange entitlement loss before fresh workspace or completion", async () => {
    mocks.canUseFeature.mockReturnValue(false);

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "feature_unavailable",
      feature: "calendar",
      requiredPlan: "sms_and_chat",
    });
    expect(mocks.getToken).toHaveBeenCalledOnce();
    expect(mocks.requireFreshWorkspaceRouteAccess).not.toHaveBeenCalled();
    expect(mocks.completeGoogleCalendarOAuthConnection).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
  });

  it("maps post-exchange entitlement resolution failure to retryable 503", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new mocks.EntitlementResolutionError("subscription_lookup_failed"),
    );

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_unavailable",
      retryable: true,
    });
    expect(mocks.requireFreshWorkspaceRouteAccess).not.toHaveBeenCalled();
    expect(mocks.completeGoogleCalendarOAuthConnection).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
  });

  it.each([403, 503] as const)(
    "stops on fresh workspace status %s before durable completion",
    async (status) => {
      mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json({ error: "workspace_error" }, { status }),
      });

      const response = await completeOAuth(completeRequest());

      expect(response.status).toBe(status);
      expect(mocks.getToken).toHaveBeenCalledOnce();
      expect(
        mocks.completeGoogleCalendarOAuthConnection,
      ).not.toHaveBeenCalled();
      expectVerifierCookie(response, "", 0);
    },
  );

  it("redirects a stale book-started handoff when the fresh workspace goal is signup", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: accessWithGoal(CANONICAL_ACCESS, "book"),
    });
    mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: accessWithGoal(CANONICAL_ACCESS, "signup"),
    });

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${CANONICAL_ORIGIN}/settings?calendar=unavailable`,
    );
    expect(mocks.claimGoogleCalendarOAuthHandoff).toHaveBeenCalledOnce();
    expect(mocks.getToken).toHaveBeenCalledOnce();
    expect(mocks.requireFreshWorkspaceRouteAccess).toHaveBeenCalledOnce();
    expect(mocks.requireGoogleCalendarSettings).toHaveBeenCalledOnce();
    expect(
      mocks.completeGoogleCalendarOAuthConnection,
    ).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
    expectSecureResponse(response);
  });

  it("rejects an identity change after token exchange", async () => {
    mocks.resolveGoogleOAuthWorkspaceIdentity
      .mockResolvedValueOnce(CANONICAL_IDENTITY)
      .mockResolvedValueOnce({
        ...CANONICAL_IDENTITY,
        ownerUserId: "00000000-0000-4000-8000-000000000099",
      });

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "workspace_access_denied",
    });
    expect(mocks.completeGoogleCalendarOAuthConnection).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
  });

  it("rechecks the settings row after token exchange before durable completion", async () => {
    mocks.requireGoogleCalendarSettings
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new mocks.GoogleOAuthAttemptError("service_unavailable", 503),
      );

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${CANONICAL_ORIGIN}/settings?calendar=failed`,
    );
    expect(mocks.requireGoogleCalendarSettings).toHaveBeenCalledTimes(2);
    expect(mocks.completeGoogleCalendarOAuthConnection).not.toHaveBeenCalled();
    expectVerifierCookie(response, "", 0);
  });

  it("translates the database goal guard into the friendly unavailable state", async () => {
    mocks.completeGoogleCalendarOAuthConnection.mockRejectedValue(
      new mocks.GoogleOAuthAttemptError("goal_unavailable", 403),
    );

    const response = await completeOAuth(completeRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `${CANONICAL_ORIGIN}/settings?calendar=unavailable`,
    );
    expect(mocks.completeGoogleCalendarOAuthConnection).toHaveBeenCalledOnce();
    expectVerifierCookie(response, "", 0);
    expectSecureResponse(response);
  });

  it.each([
    ["token exchange", "exchange"],
    ["missing refresh token", "credentials"],
    ["atomic completion", "completion"],
  ] as const)(
    "uses the fixed failed redirect when %s fails",
    async (_label, failure) => {
      if (failure === "exchange") {
        mocks.getToken.mockRejectedValue(new Error("provider secret"));
      } else if (failure === "credentials") {
        mocks.getToken.mockResolvedValue({
          tokens: {
            access_token: "access-token",
            expiry_date: Date.now() + 60 * 60 * 1000,
          },
        });
      } else {
        mocks.completeGoogleCalendarOAuthConnection.mockRejectedValue(
          new Error("database secret"),
        );
      }

      const response = await completeOAuth(completeRequest());

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(
        `${CANONICAL_ORIGIN}/settings?calendar=failed`,
      );
      expectVerifierCookie(response, "", 0);
      expectSecureResponse(response);
    },
  );
});
