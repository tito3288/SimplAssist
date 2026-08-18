import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  searchAvailableNumbers: vi.fn(),
  isNanpTollFreeNumber: vi.fn(),
  resolveSmsProvisioningAccess: vi.fn(),
}));

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/messaging/numbers", () => ({
  searchAvailableNumbers: mocks.searchAvailableNumbers,
  isNanpTollFreeNumber: mocks.isNanpTollFreeNumber,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveSmsProvisioningAccess: mocks.resolveSmsProvisioningAccess,
}));

import { GET } from "./route";

function request(areaCode?: string) {
  const search = areaCode === undefined ? "" : `?areaCode=${areaCode}`;
  return new NextRequest(
    `http://localhost/api/messaging/numbers/search${search}`
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: { business: { id: "business-1" } },
  });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: mocks.getUser },
  });
  mocks.isNanpTollFreeNumber.mockImplementation((value: string) =>
    /^\+1(?:800|833|844|855|866|877|888)\d{7}$/.test(value)
  );
  mocks.resolveSmsProvisioningAccess.mockResolvedValue({
    allowed: true,
    source: "direct_precheckout",
    plan: null,
  });
});

describe("GET /api/messaging/numbers/search", () => {
  it("passes through workspace denial before authentication or provider search", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_unavailable" },
        { status: 503 }
      ),
    });

    const response = await GET(request("574"));

    expect(response.status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated local search before calling Telnyx", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await GET(request("574"));

    expect(response.status).toBe(401);
    expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
  });

  it.each(["subscription", "partner_billing", "direct_precheckout"] as const)(
    "blocks a %s chat-only account before calling Telnyx",
    async (source) => {
      mocks.resolveSmsProvisioningAccess.mockResolvedValue({
        allowed: false,
        reason: "plan_not_entitled",
        source,
        plan: "chat_only",
      });

      const response = await GET(request("574"));

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "SMS provisioning is not available on the current plan",
      });
      expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
    },
  );

  it("fails retryably on uncertain billing state before calling Telnyx", async () => {
    mocks.resolveSmsProvisioningAccess.mockResolvedValue({
      allowed: false,
      reason: "billing_state_unavailable",
    });

    const response = await GET(request("574"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Unable to verify plan access",
      retryable: true,
    });
    expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
  });

  it.each(["800", "833", "844", "855", "866", "877", "888"])(
    "rejects toll-free NPA %s before the redundant user lookup or a provider search",
    async (areaCode) => {
      const response = await GET(request(areaCode));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Toll-free area codes are not supported for 10DLC registration. Enter a local area code.",
        code: "toll_free_not_supported",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, "", "5", "57", "5745", "57a"])(
    "rejects malformed area code %s without a provider search",
    async (areaCode) => {
      const response = await GET(request(areaCode));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Area code must be 3 digits",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.searchAvailableNumbers).not.toHaveBeenCalled();
    }
  );

  it("preserves an authenticated local-number search", async () => {
    const numbers = [
      { phoneNumber: "+15745550123", friendlyName: "+1 (574) 555-0123" },
    ];
    mocks.searchAvailableNumbers.mockResolvedValue(numbers);

    const response = await GET(request("574"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ numbers });
    expect(mocks.searchAvailableNumbers).toHaveBeenCalledOnce();
    expect(mocks.searchAvailableNumbers).toHaveBeenCalledWith("574");
    expect(mocks.resolveSmsProvisioningAccess).toHaveBeenCalledWith(
      "business-1",
      { allowDirectPrecheckout: true },
    );
  });
});
