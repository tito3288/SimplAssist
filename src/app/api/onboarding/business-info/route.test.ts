import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireWorkspaceRouteAccess: vi.fn(),
  adminFrom: vi.fn(),
  stateSelect: vi.fn(),
  stateEq: vi.fn(),
  stateMaybeSingle: vi.fn(),
  businessUpdate: vi.fn(),
  updateEq: vi.fn(),
  updateIs: vi.fn(),
  updateSelect: vi.fn(),
  updateMaybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: (business: {
    telnyx_brand_id: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    onboarding_registration_status: string | null;
  }) =>
    Boolean(
      business.telnyx_brand_id ||
        business.brand_status ||
        business.campaign_status ||
        business.onboarding_registration_status === "submitted",
    ),
}));

import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";
import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";

const pristineRegistrationState = {
  id: BUSINESS_ID,
  owner_id: USER_ID,
  deleted_at: null,
  telnyx_brand_id: null,
  brand_status: null,
  campaign_status: null,
  onboarding_registration_status: "not_started",
};

const validBody = {
  name: " Example Service LLC ",
  business_type: "hvac",
  business_type_other: "",
  website: " https://example.test ",
  phone: " (317) 555-0100 ",
  email: " owner@example.test ",
  address: " 123 Main Street ",
  city: " Indianapolis ",
  state: " Indiana ",
  zip: " 46204 ",
  timezone: "America/Indiana/Indianapolis",
};

const stateChain = {
  eq: mocks.stateEq,
  maybeSingle: mocks.stateMaybeSingle,
};

const updateChain = {
  eq: mocks.updateEq,
  is: mocks.updateIs,
  select: mocks.updateSelect,
  maybeSingle: mocks.updateMaybeSingle,
};

const businessTable = {
  select: mocks.stateSelect,
  update: mocks.businessUpdate,
};

function makeRequest(body: unknown = validBody) {
  return new NextRequest("http://localhost/api/onboarding/business-info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      user: { id: USER_ID },
      business: { id: BUSINESS_ID },
    },
  });
  mocks.adminFrom.mockReturnValue(businessTable);
  mocks.stateSelect.mockReturnValue(stateChain);
  mocks.stateEq.mockReturnValue(stateChain);
  mocks.stateMaybeSingle.mockResolvedValue({
    data: pristineRegistrationState,
    error: null,
  });
  mocks.businessUpdate.mockReturnValue(updateChain);
  mocks.updateEq.mockReturnValue(updateChain);
  mocks.updateIs.mockReturnValue(updateChain);
  mocks.updateSelect.mockReturnValue(updateChain);
  mocks.updateMaybeSingle.mockResolvedValue({
    data: { id: BUSINESS_ID },
    error: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/onboarding/business-info", () => {
  it("passes through a workspace denial before parsing or database access", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_denied" },
        { status: 403 },
      ),
    });
    const request = makeRequest();
    const jsonSpy = vi.spyOn(request, "json");

    const response = await POST(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "workspace_access_denied",
    });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("derives the business from the workspace and rejects client-supplied ids", async () => {
    const response = await POST(
      makeRequest({ ...validBody, businessId: BUSINESS_ID }),
    );

    expect(response.status).toBe(400);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it.each([
    ["brand-only", { brand_status: "rejected", campaign_status: null }],
    [
      "campaign-only",
      { brand_status: "approved", campaign_status: "rejected" },
    ],
    [
      "dual",
      { brand_status: "rejected", campaign_status: "rejected" },
    ],
  ])(
    "rejects a direct already-rejected %s save without issuing an update",
    async (_label, statuses) => {
      mocks.stateMaybeSingle.mockResolvedValue({
        data: {
          ...pristineRegistrationState,
          ...statuses,
          telnyx_brand_id: "brand-1",
          onboarding_registration_status: "failed",
        },
        error: null,
      });

      const response = await POST(makeRequest());

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: REJECTION_SUPPORT_MESSAGE,
        code: "rejection_support_required",
      });
      expect(mocks.businessUpdate).not.toHaveBeenCalled();
    },
  );

  it("keeps a non-rejection technical failure editable", async () => {
    mocks.stateMaybeSingle.mockResolvedValue({
      data: {
        ...pristineRegistrationState,
        telnyx_brand_id: "brand-1",
        brand_status: "approved",
        campaign_status: "pending",
        onboarding_registration_status: "failed",
      },
      error: null,
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.businessUpdate).toHaveBeenCalledOnce();
    expect(mocks.updateEq).toHaveBeenCalledWith(
      "onboarding_registration_status",
      "failed",
    );
  });

  it("locks a registration that is still in carrier review", async () => {
    mocks.stateMaybeSingle.mockResolvedValue({
      data: {
        ...pristineRegistrationState,
        telnyx_brand_id: "brand-1",
        brand_status: "pending",
        onboarding_registration_status: "submitted",
      },
      error: null,
    });

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "registration_locked",
    });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("normalizes and saves with an exact registration-state CAS", async () => {
    const response = await POST(makeRequest());

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledExactlyOnceWith({
      name: "Example Service LLC",
      business_type: "hvac",
      business_type_other: null,
      website_url: "https://example.test",
      phone_number: "(317) 555-0100",
      email: "owner@example.test",
      address: "123 Main Street",
      city: "Indianapolis",
      state: "IN",
      zip: "46204",
      timezone: "America/Indiana/Indianapolis",
      onboarding_step: "business_hours",
      onboarding_last_saved_at: expect.any(String),
    });
    expect(mocks.updateEq.mock.calls).toEqual([
      ["id", BUSINESS_ID],
      ["owner_id", USER_ID],
      ["onboarding_registration_status", "not_started"],
    ]);
    expect(mocks.updateIs.mock.calls).toEqual([
      ["deleted_at", null],
      ["telnyx_brand_id", null],
      ["brand_status", null],
      ["campaign_status", null],
    ]);
  });

  it("does not mutate when rejection lands between the read and final write", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.stateMaybeSingle
      .mockResolvedValueOnce({
        data: pristineRegistrationState,
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...pristineRegistrationState,
          telnyx_brand_id: "brand-1",
          brand_status: "rejected",
          onboarding_registration_status: "failed",
        },
        error: null,
      });

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: REJECTION_SUPPORT_MESSAGE,
      code: "rejection_support_required",
    });
    expect(mocks.businessUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.updateMaybeSingle).toHaveBeenCalledTimes(1);
    expect(mocks.stateMaybeSingle).toHaveBeenCalledTimes(2);
  });

  it("returns state-changed rather than retrying an otherwise editable CAS miss", async () => {
    mocks.updateMaybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.stateMaybeSingle
      .mockResolvedValueOnce({
        data: pristineRegistrationState,
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...pristineRegistrationState,
          onboarding_registration_status: "failed",
        },
        error: null,
      });

    const response = await POST(makeRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "registration_state_changed",
    });
    expect(mocks.businessUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "changed ownership",
      { ...pristineRegistrationState, owner_id: "other-user" },
    ],
    [
      "soft deletion",
      {
        ...pristineRegistrationState,
        deleted_at: "2026-08-28T12:00:00.000Z",
      },
    ],
  ])("rejects %s from the fresh row", async (_label, row) => {
    mocks.stateMaybeSingle.mockResolvedValue({ data: row, error: null });

    const response = await POST(makeRequest());

    expect(response.status).toBe(403);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });
});
