import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFreshWorkspaceRouteAccess: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
  randomBytes: vi.fn(),
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
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomBytes: mocks.randomBytes };
});
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireFreshWorkspaceRouteAccess: mocks.requireFreshWorkspaceRouteAccess,
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
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

function callbackRequest(
  nonce: string,
  stateNonce = nonce,
  businessId = BUSINESS_ID
) {
  const state = encodeGoogleOAuthState({
    businessId,
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
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: USER_ID },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
  mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: USER_ID },
      business: { id: BUSINESS_ID, partner_id: null },
      hostKind: "canonical",
    },
  });
  mocks.randomBytes.mockReturnValue(Buffer.alloc(32, 7));
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
  it.each([401, 403, 503] as const)(
    "start maps workspace %s before entitlement, nonce, or OAuth URL creation",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(
          status === 401
            ? { error: "Unauthorized" }
            : status === 403
              ? { error: "workspace_access_denied" }
              : { error: "workspace_access_unavailable", retryable: true },
          { status }
        ),
      });

      const response = await beginOAuth(
        new NextRequest("https://app.example.test/api/google/auth")
      );

      expect(response.status).toBe(status);
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.randomBytes).not.toHaveBeenCalled();
      expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
    }
  );

  it.each([401, 403, 503] as const)(
    "callback maps workspace %s before state, entitlements, Google, or database access",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(
          status === 401
            ? { error: "Unauthorized" }
            : status === 403
              ? { error: "workspace_access_denied" }
              : { error: "workspace_access_unavailable", retryable: true },
          { status }
        ),
      });

      const response = await finishOAuth(callbackRequest("a".repeat(43)));

      expect(response.status).toBe(status);
      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
      expect(mocks.getToken).not.toHaveBeenCalled();
      expect(mocks.adminFrom).not.toHaveBeenCalled();
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    }
  );

  it("blocks partner-host OAuth initiation before feature, nonce, or provider work", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: USER_ID },
        business: {
          id: BUSINESS_ID,
          partner_id: "00000000-0000-4000-8000-000000000003",
        },
        hostKind: "partner",
      },
    });

    const response = await beginOAuth(
      new NextRequest("https://partner.example/api/google/auth")
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "google_oauth_unavailable_on_partner_host",
    });
    expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
    expect(mocks.randomBytes).not.toHaveBeenCalled();
    expect(mocks.generateAuthUrl).not.toHaveBeenCalled();
  });

  it("blocks partner-host OAuth callback before token exchange or database writes", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: USER_ID },
        business: {
          id: BUSINESS_ID,
          partner_id: "00000000-0000-4000-8000-000000000003",
        },
        hostKind: "partner",
      },
    });

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "google_oauth_unavailable_on_partner_host",
    });
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

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
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("rejects state for a business the current user does not own", async () => {
    const response = await finishOAuth(
      callbackRequest(
        "a".repeat(43),
        "a".repeat(43),
        "00000000-0000-4000-8000-000000000099"
      )
    );

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

  it("blocks an assignment change during token exchange before durable writes", async () => {
    mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "workspace_access_denied" },
        { status: 403 }
      ),
    });

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "workspace_access_denied",
    });
    expect(mocks.getToken).toHaveBeenCalledWith("oauth-code");
    expect(mocks.resolveBusinessEntitlements).toHaveBeenCalledTimes(2);
    expect(mocks.requireFreshWorkspaceRouteAccess).toHaveBeenCalledOnce();
    expect(mocks.upsertToken).not.toHaveBeenCalled();
    expect(mocks.updateSettingsEq).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("returns retryable 503 when fresh assignment revalidation fails", async () => {
    mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(
        { error: "workspace_access_unavailable", retryable: true },
        { status: 503 }
      ),
    });

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "workspace_access_unavailable",
      retryable: true,
    });
    expect(mocks.upsertToken).not.toHaveBeenCalled();
    expect(mocks.updateSettingsEq).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it.each([
    ["user", { user: { id: "different-user" } }],
    ["business", { business: { id: "different-business", partner_id: null } }],
    ["host", { hostKind: "partner" as const }],
  ])("rejects a fresh resolved %s mismatch before token persistence", async (_label, override) => {
    mocks.requireFreshWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: USER_ID },
        business: { id: BUSINESS_ID, partner_id: null },
        hostKind: "canonical",
        ...override,
      },
    });

    const response = await finishOAuth(callbackRequest("a".repeat(43)));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "workspace_access_denied",
    });
    expect(mocks.upsertToken).not.toHaveBeenCalled();
    expect(mocks.updateSettingsEq).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
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
    expect(
      mocks.resolveBusinessEntitlements.mock.invocationCallOrder[1]
    ).toBeLessThan(
      mocks.requireFreshWorkspaceRouteAccess.mock.invocationCallOrder[0]
    );
    expect(
      mocks.requireFreshWorkspaceRouteAccess.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.upsertToken.mock.invocationCallOrder[0]);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
