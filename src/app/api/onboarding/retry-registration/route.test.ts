import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  attemptPaidLaunch: vi.fn(),
  getOnboardingStateForBusinessId: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));
vi.mock("@/lib/billing/launch", () => ({
  attemptPaidLaunch: mocks.attemptPaidLaunch,
}));
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingStateForBusinessId: mocks.getOnboardingStateForBusinessId,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST } from "./route";

const BUSINESS_ID = "0b7f6f3e-8b1a-4a6c-9a56-0d6d6f6a1c2e";
const STATE = { currentStep: "carrier_review" };
const NEUTRAL_LAUNCH_ERRORS = [
  [
    "submission_disabled",
    "registration_failed",
    "SMS registration is disabled for this account. Contact support if this looks wrong.",
  ],
  [
    "existing_brand_review_required",
    "existing_brand_review_required",
    "Your existing Telnyx brand link needs review before SMS registration can continue. Contact support.",
  ],
  [
    "linked_brand_needs_support",
    "linked_brand_needs_support",
    "Your linked Telnyx brand needs support before SMS registration can continue. Its existing Telnyx resources were not replaced.",
  ],
  [
    "failed",
    "registration_failed",
    "We could not recheck your existing Telnyx brand right now. No new Telnyx resources were created; please try again shortly.",
  ],
  [
    "missing_phone_number",
    "missing_phone_number",
    "Choose your business number before submitting SMS registration.",
  ],
] as const;

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: BUSINESS_ID,
    compliance_info_completed_at: "2026-07-01T00:00:00.000Z",
    brand_status: null,
    campaign_status: null,
    ...overrides,
  };
}

function queueResults(...results: unknown[]) {
  const queue = [...results];
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected database query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

function request(body: unknown = { businessId: BUSINESS_ID }) {
  return new NextRequest("http://localhost:8080/api/onboarding/retry-registration", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access: {} });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue(STATE);
});

describe("POST /api/onboarding/retry-registration rejection guard", () => {
  it("passes through workspace denial before auth, parsing, launch, or state reads", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: "workspace_access_unavailable", retryable: true },
        { status: 503 },
      ),
    });
    const nextRequest = request();
    const jsonSpy = vi.spyOn(nextRequest, "json");

    const response = await POST(nextRequest);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "workspace_access_unavailable",
      retryable: true,
    });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStateForBusinessId).not.toHaveBeenCalled();
  });

  it.each([
    ["campaign-only", { brand_status: "approved", campaign_status: "rejected" }],
    ["brand-only", { brand_status: "rejected", campaign_status: null }],
    ["dual", { brand_status: "rejected", campaign_status: "rejected" }],
  ])(
    "refuses a %s rejection without touching the launch pipeline",
    async (_label, statuses) => {
      queueResults({ data: business(statuses), error: null });

      const response = await POST(request());

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "rejection_support_required",
        error: expect.stringContaining("contact support"),
      });
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    }
  );

  it("lets a technical failure retry when nothing was carrier-rejected", async () => {
    queueResults({
      data: business({ brand_status: "pending", campaign_status: "pending" }),
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
      BUSINESS_ID,
      "onboarding_retry"
    );
  });

  it.each(NEUTRAL_LAUNCH_ERRORS)(
    "returns raw neutral %s launch copy without a product name",
    async (status, code, message) => {
      queueResults({ data: business(), error: null });
      mocks.attemptPaidLaunch.mockResolvedValue({ status, message });

      const response = await POST(request());
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toEqual({ error: message, code, state: STATE });
      expect(text).not.toContain("SimplAssist");
    }
  );

  it("returns a number-unavailable retry to the phone-number step", async () => {
    queueResults({ data: business(), error: null });
    mocks.attemptPaidLaunch.mockResolvedValue({
      status: "number_unavailable",
      message: "That number is no longer available. Choose another number.",
    });
    mocks.getOnboardingStateForBusinessId.mockResolvedValue({
      currentStep: "phone_number",
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That number is no longer available. Choose another number.",
      code: "phone_number_unavailable",
      state: { currentStep: "phone_number" },
    });
  });

  it("still requires completed brand verification info first", async () => {
    queueResults({
      data: business({ compliance_info_completed_at: null }),
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
