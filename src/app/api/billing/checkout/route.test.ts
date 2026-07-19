import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  attemptPaidLaunch: vi.fn(),
  getOnboardingStateForBusinessId: vi.fn(),
  createCheckoutSession: vi.fn(),
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
vi.mock("@/lib/stripe/checkout", () => ({
  createCheckoutSession: mocks.createCheckoutSession,
}));
vi.mock("@/lib/stripe/config", () => ({
  stripePriceIds: () => ({
    sms_only: "price_starter",
    sms_and_chat: "price_growth",
    full: "price_full",
  }),
  stripeSetupFeePriceId: () => "price_setup",
}));

import { POST } from "./route";

const BUSINESS = {
  id: "business-1",
  has_ein: true,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: true,
};

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

function request() {
  return new NextRequest("http://localhost/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: "sms_and_chat", mode: "onboarding" }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue({ step: "complete" });
  mocks.createCheckoutSession.mockResolvedValue("https://checkout.test/session");
});

describe("POST /api/billing/checkout onboarding precedence", () => {
  it.each(["past_due", "canceled"])(
    "does not let a protected override bypass an existing %s subscription",
    async (status) => {
      queueResults(
        { data: BUSINESS, error: null },
        {
          data: {
            status,
            setup_fee_paid_at: "2026-07-01T00:00:00.000Z",
          },
          error: null,
        }
      );

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
      expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
        BUSINESS.id,
        "sms_and_chat",
        "price_growth",
        "price_setup",
        expect.stringContaining("/onboarding?checkout=success"),
        expect.stringContaining("/onboarding?checkout=canceled"),
        "onboarding"
      );
      expect(await response.json()).toEqual({
        url: "https://checkout.test/session",
      });
    }
  );

  it("uses a protected override only when no subscription row exists", async () => {
    queueResults(
      { data: BUSINESS, error: null },
      { data: null, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
      BUSINESS.id,
      "onboarding_retry"
    );
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ success: true });
  });
});
