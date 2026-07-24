import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  attemptPaidLaunch: vi.fn(),
  getOnboardingStateForBusinessId: vi.fn(),
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

import { POST } from "./route";

const BUSINESS_ID = "0b7f6f3e-8b1a-4a6c-9a56-0d6d6f6a1c2e";

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
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue({
    currentStep: "carrier_review",
  });
});

describe("POST /api/onboarding/retry-registration rejection guard", () => {
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
