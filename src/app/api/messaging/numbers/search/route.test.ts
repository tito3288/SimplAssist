import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  searchAvailableNumbers: vi.fn(),
  isNanpTollFreeNumber: vi.fn(),
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
    access: {},
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
  });
});
