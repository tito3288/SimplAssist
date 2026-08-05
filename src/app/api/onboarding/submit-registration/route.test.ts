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

function queueBusiness() {
  mocks.from.mockImplementation(() => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve({
      data: {
        id: BUSINESS_ID,
        compliance_info_completed_at: "2026-07-01T00:00:00.000Z",
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
});
