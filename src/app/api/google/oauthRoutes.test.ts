import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  serverFrom: vi.fn(),
  adminFrom: vi.fn(),
  requireAuthenticatedFeature: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  generateAuthUrl: vi.fn(),
  getGoogleOAuth2Client: vi.fn(),
  getToken: vi.fn(),
  verifyIdToken: vi.fn(),
  upsertToken: vi.fn(),
  updateSettingsEq: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.serverFrom,
  })),
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));
vi.mock("@/lib/google/routeAccess", () => ({
  requireAuthenticatedFeature: mocks.requireAuthenticatedFeature,
}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/entitlements")>();
  return {
    ...actual,
    resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
    canUseFeature: mocks.canUseFeature,
  };
});
vi.mock("@/lib/google/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/client")>();
  return {
    ...actual,
    generateAuthUrl: mocks.generateAuthUrl,
    getGoogleOAuth2Client: mocks.getGoogleOAuth2Client,
  };
});

import {
  encodeGoogleOAuthState,
  GOOGLE_OAUTH_NONCE_COOKIE,
} from "@/lib/google/client";
import { GET as beginOAuth } from "./auth/route";
import { GET as finishOAuth } from "./callback/route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";
const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

function ownerLookup(data: { id: string } | null, error: unknown = null) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "maybeSingle"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.maybeSingle.mockResolvedValue({ data, error });
  mocks.serverFrom.mockReturnValue(chain);
}

function callbackRequest(nonce: string, stateNonce = nonce) {
  const state = encodeGoogleOAuthState({
    businessId: BUSINESS_ID,
    nonce: stateNonce,
  });
  return new NextRequest(
    `http://localhost:3000/api/google/callback?code=oauth-code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: `${GOOGLE_OAUTH_NONCE_COOKIE}=${nonce}` } }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  ownerLookup({ id: BUSINESS_ID });
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
    entitlements: ENTITLEMENTS,
    supabase: {},
  });
  mocks.resolveBusinessEntitlements.mockResolvedValue(ENTITLEMENTS);
  mocks.canUseFeature.mockReturnValue(true);
  mocks.generateAuthUrl.mockReturnValue(
    "https://accounts.google.test/o/oauth2/auth"
  );
  mocks.getToken.mockResolvedValue({
    tokens: {
      access_token: "access-token",
      refresh_token: "refresh-token",
      expiry_date: Date.now() + 60 * 60 * 1000,
    },
  });
  mocks.getGoogleOAuth2Client.mockReturnValue({
    getToken: mocks.getToken,
    verifyIdToken: mocks.verifyIdToken,
  });
  mocks.upsertToken.mockResolvedValue({ error: null });
  mocks.updateSettingsEq.mockResolvedValue({ error: null });
  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "google_calendar_tokens") {
      return { upsert: mocks.upsertToken };
    }
    if (table === "ai_settings") {
      return {
        update: vi.fn(() => ({ eq: mocks.updateSettingsEq })),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("Google Calendar OAuth", () => {
  it("starts OAuth with an HttpOnly SameSite nonce bound into state", async () => {
    const response = await beginOAuth(
      new NextRequest("https://app.example.test/api/google/auth")
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.test/o/oauth2/auth"
    );
    const nonce = mocks.generateAuthUrl.mock.calls[0]?.[1] as string;
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    const cookie = response.headers.get("set-cookie") || "";
    expect(cookie).toContain(`${GOOGLE_OAUTH_NONCE_COOKIE}=${nonce}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).toContain("Secure");
  });

  it("rejects a tampered nonce before owner, entitlement, or Google calls", async () => {
    const response = await finishOAuth(
      callbackRequest("a".repeat(43), "b".repeat(43))
    );

    expect(response.status).toBe(400);
    expect(mocks.serverFrom).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("rejects state for a business the current user does not own", async () => {
    ownerLookup(null);

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("rechecks entitlement when the callback begins and blocks a prior downgrade", async () => {
    mocks.canUseFeature.mockReturnValue(false);

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(mocks.resolveBusinessEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.upsertToken).not.toHaveBeenCalled();
  });

  it("rechecks after token exchange and blocks a downgrade before token write", async () => {
    mocks.canUseFeature
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
    expect(mocks.resolveBusinessEntitlements).toHaveBeenCalledTimes(2);
    expect(mocks.upsertToken).not.toHaveBeenCalled();
  });

  it("writes tokens only after nonce, owner, and entitlement checks pass", async () => {
    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(307);
    expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
    expect(mocks.upsertToken).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BUSINESS_ID,
        access_token: "access-token",
        refresh_token: "refresh-token",
      }),
      { onConflict: "business_id" }
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
