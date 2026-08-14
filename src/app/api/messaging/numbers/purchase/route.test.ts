import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  createClient: vi.fn(),
  getUser: vi.fn(),
  from: vi.fn(),
  getA2pRiskClearanceForBusiness: vi.fn(),
  isNanpTollFreeNumber: vi.fn(),
}));

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  getA2pRiskClearanceForBusiness: mocks.getA2pRiskClearanceForBusiness,
}));
vi.mock("@/lib/messaging/numbers", () => ({
  isNanpTollFreeNumber: mocks.isNanpTollFreeNumber,
}));

import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000574";
const LOCAL_NUMBER = "+15745550123";

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/messaging/numbers/purchase",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function setDatabase(options: {
  activeNumber?: Record<string, unknown> | null;
} = {}) {
  const updatePayloads: Array<Record<string, unknown>> = [];
  const activeNumber = options.activeNumber ?? null;

  const businessRead = {
    eq: vi.fn(),
    single: vi.fn(async () => ({
      data: {
        id: BUSINESS_ID,
        compliance_info_completed_at: "2026-08-14T12:00:00.000Z",
      },
      error: null,
    })),
  };
  businessRead.eq.mockReturnValue(businessRead);

  const businessUpdate = {
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(async () => ({
      data: { pending_phone_number: LOCAL_NUMBER },
      error: null,
    })),
  };
  businessUpdate.eq.mockReturnValue(businessUpdate);
  businessUpdate.select.mockReturnValue(businessUpdate);

  const businessTable = {
    select: vi.fn(() => businessRead),
    update: vi.fn((payload: Record<string, unknown>) => {
      updatePayloads.push(payload);
      return businessUpdate;
    }),
  };

  const phoneRead = {
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: activeNumber,
      error: null,
    })),
  };
  phoneRead.eq.mockReturnValue(phoneRead);
  phoneRead.limit.mockReturnValue(phoneRead);

  const phoneTable = {
    select: vi.fn(() => phoneRead),
  };

  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") return businessTable;
    if (table === "phone_numbers") return phoneTable;
    throw new Error(`Unexpected table ${table}`);
  });

  return { businessTable, updatePayloads };
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
    from: mocks.from,
  });
  mocks.getA2pRiskClearanceForBusiness.mockResolvedValue({
    cleared: true,
  });
  mocks.isNanpTollFreeNumber.mockImplementation((value: string) =>
    /^\+1(?:800|833|844|855|866|877|888)\d{7}$/.test(value)
  );
});

describe("POST /api/messaging/numbers/purchase", () => {
  it("passes through workspace denial before authentication or database access", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_unavailable" },
        { status: 503 }
      ),
    });

    const response = await POST(request({ phoneNumber: LOCAL_NUMBER }));

    expect(response.status).toBe(503);
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated local selection before database access", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(request({ phoneNumber: LOCAL_NUMBER }));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getA2pRiskClearanceForBusiness).not.toHaveBeenCalled();
  });

  it.each(["800", "833", "844", "855", "866", "877", "888"])(
    "rejects toll-free NPA %s before any database read or write",
    async (areaCode) => {
      const response = await POST(
        request({ phoneNumber: `+1${areaCode}5550123` })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error:
          "Toll-free numbers are not supported for 10DLC registration. Choose a local U.S. number.",
        code: "toll_free_not_supported",
      });
      expect(mocks.from).not.toHaveBeenCalled();
      expect(
        mocks.getA2pRiskClearanceForBusiness
      ).not.toHaveBeenCalled();
    }
  );

  it.each([
    {},
    { phoneNumber: "" },
    { phoneNumber: 15745550123 },
    { phoneNumber: "15745550123" },
    { phoneNumber: "+1574555012" },
    { phoneNumber: "+157455501234" },
    { phoneNumber: "+1 5745550123" },
    { phoneNumber: " +15745550123" },
    { phoneNumber: "+445745550123" },
  ])("rejects a non-canonical selection %# without a database write", async (body) => {
    const response = await POST(request(body));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_phone_number");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getA2pRiskClearanceForBusiness).not.toHaveBeenCalled();
  });

  it("saves an ordinary canonical local selection unchanged", async () => {
    const { businessTable, updatePayloads } = setDatabase();

    const response = await POST(request({ phoneNumber: LOCAL_NUMBER }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      number: { phone_number: LOCAL_NUMBER, pending: true },
    });
    expect(businessTable.update).toHaveBeenCalledOnce();
    expect(updatePayloads[0]).toMatchObject({
      pending_phone_number: LOCAL_NUMBER,
      pending_phone_number_area_code: "574",
      pending_phone_number_failure_reason: null,
      onboarding_step: "review_submit",
    });
  });

  it("preserves the existing-active-number short circuit without saving the requested replacement", async () => {
    const activeNumber = {
      id: "phone-row-1",
      business_id: BUSINESS_ID,
      phone_number: "+15745550999",
      is_active: true,
    };
    const { businessTable, updatePayloads } = setDatabase({ activeNumber });

    const response = await POST(request({ phoneNumber: LOCAL_NUMBER }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ number: activeNumber });
    expect(businessTable.update).toHaveBeenCalledOnce();
    expect(updatePayloads[0]).toMatchObject({
      pending_phone_number: null,
      pending_phone_number_area_code: null,
      pending_phone_number_failure_reason: null,
      onboarding_step: "review_submit",
    });
    expect(updatePayloads[0]?.pending_phone_number).not.toBe(LOCAL_NUMBER);
  });
});
