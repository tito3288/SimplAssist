import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  adminFrom: vi.fn(),
  precheck: vi.fn(),
  commitUpdate: vi.fn(),
  registrationHasStartedForRisk: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));

vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: mocks.registrationHasStartedForRisk,
}));

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST as saveBrandVerification } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000020";
const OTHER_BUSINESS_ID = "00000000-0000-4000-8000-000000000030";
const TEST_EIN = "12-3456789";

type QueryChain = Record<string, ReturnType<typeof vi.fn>>;
const adminChains: QueryChain[] = [];

function makeAdminChain() {
  let operation: "select" | "update" | null = null;
  const chain: QueryChain = {};

  chain.select = vi.fn(() => {
    if (operation === null) {
      operation = "select";
    }
    return chain;
  });
  chain.update = vi.fn(() => {
    operation = "update";
    return chain;
  });
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() =>
    operation === "update" ? mocks.commitUpdate() : mocks.precheck()
  );

  adminChains.push(chain);
  return chain;
}

function ownedBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: BUSINESS_ID,
    owner_id: USER_ID,
    deleted_at: null,
    no_ein_hold_status: "none",
    telnyx_brand_id: null,
    brand_status: null,
    campaign_status: null,
    onboarding_registration_status: "not_started",
    ...overrides,
  };
}

function userClient({
  user = { id: USER_ID },
  business = ownedBusiness(),
  ownershipError = null,
}: {
  user?: { id: string } | null;
  business?: Record<string, unknown> | null;
  ownershipError?: Record<string, unknown> | null;
} = {}) {
  const ownershipChain: QueryChain = {};
  ownershipChain.select = vi.fn(() => ownershipChain);
  ownershipChain.eq = vi.fn(() => ownershipChain);
  ownershipChain.single = vi.fn().mockResolvedValue({
    data: business,
    error: ownershipError,
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn(() => ownershipChain),
  };
}

function request(body: Record<string, unknown>) {
  return new NextRequest(
    "http://localhost/api/onboarding/brand-verification",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
}

function einBody(overrides: Record<string, unknown> = {}) {
  return {
    businessId: BUSINESS_ID,
    has_ein: true,
    legal_business_name: "Example Service LLC",
    business_entity_type: "llc",
    business_registration_state: "Indiana",
    ein: TEST_EIN,
    authorized_rep_name: "Taylor Example",
    authorized_rep_title: "Owner",
    authorized_rep_email: "taylor@example.test",
    authorized_rep_phone: "+13175550100",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access: {} });
  adminChains.length = 0;
  mocks.createClient.mockResolvedValue(userClient());
  mocks.adminFrom.mockImplementation(makeAdminChain);
  mocks.precheck.mockResolvedValue({ data: null, error: null });
  mocks.commitUpdate.mockResolvedValue({
    data: { id: BUSINESS_ID },
    error: null,
  });
  mocks.registrationHasStartedForRisk.mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/onboarding/brand-verification", () => {
  it("passes through workspace denial before auth, parsing, risk, or database work", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_denied" },
        { status: 403 },
      ),
    });
    const nextRequest = request(einBody());
    const jsonSpy = vi.spyOn(nextRequest, "json");

    const response = await saveBrandVerification(nextRequest);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "workspace_access_denied" });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.registrationHasStartedForRisk).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("requires authentication before reading or writing a business", async () => {
    const client = userClient({ user: null, business: null });
    mocks.createClient.mockResolvedValue(client);

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(401);
    expect(client.from).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("requires ownership before checking EIN availability", async () => {
    mocks.createClient.mockResolvedValue(
      userClient({ business: null, ownershipError: { code: "PGRST116" } })
    );

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(403);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted business before any service-role query", async () => {
    mocks.createClient.mockResolvedValue(
      userClient({
        business: ownedBusiness({ deleted_at: "2026-07-20T12:00:00.000Z" }),
      })
    );

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(403);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("returns the safe conflict response without updating when another business has the EIN", async () => {
    mocks.precheck.mockResolvedValue({
      data: { id: OTHER_BUSINESS_ID },
      error: null,
    });

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error:
        "This EIN is already connected to a SimplAssist account. Sign in to the original account or contact SimplAssist Support for help.",
      code: "ein_already_connected",
    });
    expect(mocks.commitUpdate).not.toHaveBeenCalled();
    expect(adminChains[0].eq).toHaveBeenCalledWith("ein", TEST_EIN);
    expect(adminChains[0].neq).toHaveBeenCalledWith("id", BUSINESS_ID);
  });

  it("allows the same business to resave its canonical EIN", async () => {
    mocks.precheck.mockResolvedValue({ data: null, error: null });

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.commitUpdate).toHaveBeenCalledTimes(1);
    expect(adminChains[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ ein: TEST_EIN })
    );
    expect(adminChains[1].eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(adminChains[1].eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(adminChains[1].is).toHaveBeenCalledWith("deleted_at", null);
    expect(adminChains[1].select).toHaveBeenCalledWith("id");
  });

  it("maps a uniqueness race to the same safe 409 response", async () => {
    mocks.commitUpdate.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message: `duplicate key contains ${TEST_EIN}`,
        details: `conflicts with ${OTHER_BUSINESS_ID}`,
      },
    });

    const response = await saveBrandVerification(request(einBody()));
    const responseBody = await response.json();

    expect(response.status).toBe(409);
    expect(responseBody).toEqual({
      error:
        "This EIN is already connected to a SimplAssist account. Sign in to the original account or contact SimplAssist Support for help.",
      code: "ein_already_connected",
    });
    expect(console.error).not.toHaveBeenCalled();
    expect(JSON.stringify(responseBody)).not.toContain(TEST_EIN);
    expect(JSON.stringify(responseBody)).not.toContain(OTHER_BUSINESS_ID);
  });

  it("fails closed when the EIN write loses ownership or is deleted after the ownership read", async () => {
    mocks.commitUpdate.mockResolvedValue({ data: null, error: null });

    const response = await saveBrandVerification(request(einBody()));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to save business verification info",
    });
    expect(adminChains[1].eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(adminChains[1].is).toHaveBeenCalledWith("deleted_at", null);
  });

  it("fails closed without updating or leaking a precheck database error", async () => {
    const secretDetail = `lookup failed for ${TEST_EIN} owned by ${OTHER_BUSINESS_ID}`;
    mocks.precheck.mockResolvedValue({
      data: null,
      error: { code: "XX000", message: secretDetail },
    });

    const response = await saveBrandVerification(request(einBody()));
    const responseBody = await response.json();
    const loggedText = JSON.stringify(vi.mocked(console.error).mock.calls);

    expect(response.status).toBe(500);
    expect(responseBody).toEqual({
      error: "Failed to verify EIN availability",
    });
    expect(mocks.commitUpdate).not.toHaveBeenCalled();
    expect(loggedText).not.toContain(TEST_EIN);
    expect(loggedText).not.toContain(OTHER_BUSINESS_ID);
    expect(loggedText).not.toContain(secretDetail);
  });

  it("preserves the No-EIN hold path without running the EIN precheck", async () => {
    const response = await saveBrandVerification(
      request({ businessId: BUSINESS_ID, has_ein: false, join_waitlist: true })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      held: true,
      code: "held_no_ein",
    });
    expect(mocks.precheck).not.toHaveBeenCalled();
    expect(adminChains[0].update).toHaveBeenCalledWith(
      expect.objectContaining({ has_ein: false, no_ein_hold_status: "waitlisted" })
    );
    expect(adminChains[0].eq).toHaveBeenCalledWith("id", BUSINESS_ID);
    expect(adminChains[0].eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(adminChains[0].is).toHaveBeenCalledWith("deleted_at", null);
    expect(adminChains[0].select).toHaveBeenCalledWith("id");
  });

  it("fails closed when the No-EIN write loses ownership or is deleted after the ownership read", async () => {
    mocks.commitUpdate.mockResolvedValue({ data: null, error: null });

    const response = await saveBrandVerification(
      request({ businessId: BUSINESS_ID, has_ein: false })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to save EIN status",
    });
    expect(adminChains[0].eq).toHaveBeenCalledWith("owner_id", USER_ID);
    expect(adminChains[0].is).toHaveBeenCalledWith("deleted_at", null);
  });
});
