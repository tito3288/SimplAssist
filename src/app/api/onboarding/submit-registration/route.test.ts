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
import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";

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

function queueBusiness(overrides: Record<string, unknown> = {}) {
  mocks.from.mockImplementation(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve({
      data: {
        id: BUSINESS_ID,
        compliance_info_completed_at: "2026-07-01T00:00:00.000Z",
        brand_status: null,
        campaign_status: null,
        ...overrides,
      },
      error: null,
    });
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({ ok: true, access: {} });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue(STATE);
  queueBusiness();
});

describe("POST /api/onboarding/submit-registration neutral errors", () => {
  it.each([
    ["campaign-only", { brand_status: "approved", campaign_status: "rejected" }],
    ["brand-only", { brand_status: "rejected", campaign_status: null }],
    ["dual", { brand_status: "rejected", campaign_status: "rejected" }],
  ])(
    "returns support-only state for a direct %s rejection without launching",
    async (_label, statuses) => {
      queueBusiness({ ...statuses, compliance_info_completed_at: null });

      const response = await POST();

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: REJECTION_SUPPORT_MESSAGE,
        code: "rejection_support_required",
        state: STATE,
      });
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
      expect(mocks.getOnboardingStateForBusinessId).toHaveBeenCalledWith(
        BUSINESS_ID,
      );
    },
  );

  it("maps a launch-time rejection race to the support-required conflict", async () => {
    mocks.attemptPaidLaunch.mockResolvedValue({
      status: "rejection_support_required",
      message: REJECTION_SUPPORT_MESSAGE,
    });

    const response = await POST();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: REJECTION_SUPPORT_MESSAGE,
      code: "rejection_support_required",
      state: STATE,
    });
  });

  it.each(NEUTRAL_LAUNCH_ERRORS)(
    "returns raw neutral %s launch copy without a product name",
    async (status, code, message) => {
      mocks.attemptPaidLaunch.mockResolvedValue({ status, message });

      const response = await POST();
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toEqual({ error: message, code, state: STATE });
      expect(text).not.toContain("SimplAssist");
      expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
        BUSINESS_ID,
        "onboarding_retry"
      );
    }
  );

  it("returns a number-unavailable submission to the phone-number step", async () => {
    mocks.attemptPaidLaunch.mockResolvedValue({
      status: "number_unavailable",
      message: "That number is no longer available. Choose another number.",
    });
    mocks.getOnboardingStateForBusinessId.mockResolvedValue({
      currentStep: "phone_number",
    });

    const response = await POST();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That number is no longer available. Choose another number.",
      code: "phone_number_unavailable",
      state: { currentStep: "phone_number" },
    });
  });
});
