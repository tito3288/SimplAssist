import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  adminFrom: vi.fn(),
  tokenLookup: vi.fn(),
  tokenDeleteEq: vi.fn(),
  revokeToken: vi.fn(),
  requireAuthenticatedFeature: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));
vi.mock("@/lib/google/client", () => ({
  getGoogleOAuth2Client: vi.fn(() => ({
    revokeToken: mocks.revokeToken,
  })),
}));
vi.mock("@/lib/google/routeAccess", () => ({
  requireAuthenticatedFeature: mocks.requireAuthenticatedFeature,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.clearAllMocks();
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

  mocks.tokenLookup.mockResolvedValue({
    data: { access_token: "google-access-token" },
    error: null,
  });
  mocks.tokenDeleteEq.mockResolvedValue({ error: null });
  mocks.revokeToken.mockResolvedValue(undefined);

  mocks.adminFrom.mockImplementation(() => {
    const tokenChain: Record<string, ReturnType<typeof vi.fn>> = {};
    tokenChain.select = vi.fn(() => tokenChain);
    tokenChain.eq = vi.fn(() => tokenChain);
    tokenChain.maybeSingle = mocks.tokenLookup;
    tokenChain.delete = vi.fn(() => ({ eq: mocks.tokenDeleteEq }));
    return tokenChain;
  });
});

describe("Google Calendar disconnect", () => {
  it.each([401, 403, 503] as const)(
    "maps workspace %s before token lookup or Google revocation",
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

      const response = await POST();

      expect(response.status).toBe(status);
      expect(mocks.adminFrom).not.toHaveBeenCalled();
      expect(mocks.revokeToken).not.toHaveBeenCalled();
    }
  );

  it("remains available without entitlement and revokes then deletes the saved token", async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.revokeToken).toHaveBeenCalledWith("google-access-token");
    expect(mocks.tokenDeleteEq).toHaveBeenCalledWith(
      "business_id",
      BUSINESS_ID
    );
  });

  it("still deletes a saved token when Google says it is already invalid", async () => {
    mocks.revokeToken.mockRejectedValue(new Error("invalid token"));

    const response = await POST();

    expect(response.status).toBe(200);
    expect(mocks.tokenDeleteEq).toHaveBeenCalledWith(
      "business_id",
      BUSINESS_ID
    );
  });
});
