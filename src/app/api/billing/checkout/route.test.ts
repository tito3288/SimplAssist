import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  attemptPaidLaunch: vi.fn(),
  getBusinessContentQuality: vi.fn(),
  getOnboardingStateForBusinessId: vi.fn(),
  createCheckoutSession: vi.fn(),
  getExistingTelnyxBrandLinkState: vi.fn(),
  resolveAssignedPartnerName: vi.fn(),
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
  SERVICES_FAQS_REQUIRED_MESSAGE:
    "Add at least 3 distinct services and 3 answered FAQs so your AI has enough accurate information to help customers.",
}));
vi.mock("@/lib/onboarding/contentQuality.server", () => ({
  getBusinessContentQuality: mocks.getBusinessContentQuality,
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
vi.mock("@/lib/messaging/registration/existingBrand", () => ({
  getExistingTelnyxBrandLinkState: mocks.getExistingTelnyxBrandLinkState,
}));
vi.mock("@/lib/billing/partnerManagedBilling.server", () => ({
  resolveAssignedPartnerName: mocks.resolveAssignedPartnerName,
  partnerManagedBillingMessage: (partnerName: string | null) =>
    partnerName
      ? `Billing is handled by ${partnerName}.`
      : "Billing is managed externally.",
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { POST } from "./route";

const BUSINESS = {
  id: "business-1",
  partner_id: null,
  billing_mode: "stripe",
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

function request(
  mode: "onboarding" | "billing" = "onboarding",
  plan: "sms_only" | "sms_and_chat" | "full" = "sms_and_chat"
) {
  return new NextRequest("http://localhost:8080/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan, mode }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com/");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.getBusinessContentQuality.mockResolvedValue({ ready: true });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue({ step: "complete" });
  mocks.createCheckoutSession.mockResolvedValue("https://checkout.test/session");
  mocks.getExistingTelnyxBrandLinkState.mockResolvedValue(null);
  mocks.resolveAssignedPartnerName.mockResolvedValue(null);
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "owner-1" },
      business: { id: BUSINESS.id, partner_id: null },
      hostKind: "canonical",
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/checkout onboarding precedence", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before parsing or billing work", async (status, body) => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json(body, { status }),
    });
    const guardedRequest = request();
    const json = vi.spyOn(guardedRequest, "json");

    const response = await POST(guardedRequest);

    expect(response.status).toBe(status);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["partner-1", "Alpha Dog Agency"],
    ["partner-2", "Second Partner"],
  ])(
    "rejects partner-managed checkout with the assigned %s name before any Stripe or onboarding work",
    async (partnerId, partnerName) => {
      queueResults({
        data: {
          ...BUSINESS,
          partner_id: partnerId,
          billing_mode: "invoiced",
          has_ein: false,
        },
        error: null,
      });
      mocks.resolveAssignedPartnerName.mockResolvedValue(partnerName);

      const response = await POST(request());

      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error: "billing_managed_by_partner",
        message: `Billing is handled by ${partnerName}.`,
      });
      expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(partnerId);
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
      expect(mocks.getBusinessContentQuality).not.toHaveBeenCalled();
      expect(mocks.getOnboardingStateForBusinessId).not.toHaveBeenCalled();
      expect(mocks.getExistingTelnyxBrandLinkState).not.toHaveBeenCalled();
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
      expect(mocks.from).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the exact external-billing fallback for an orphaned comped business", async () => {
    queueResults({
      data: {
        ...BUSINESS,
        partner_id: null,
        billing_mode: "comped",
        has_ein: false,
      },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "billing_managed_by_partner",
      message: "Billing is managed externally.",
    });
    expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(null);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.getBusinessContentQuality).not.toHaveBeenCalled();
    expect(mocks.getExistingTelnyxBrandLinkState).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("blocks a new crafted Full Suite checkout before Stripe", async () => {
    queueResults({
      data: {
        ...BUSINESS,
        billing_exempt: false,
        onboarding_completed_at: "2026-07-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(request("billing", "full"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Full Suite is coming soon. Join the waitlist to be notified when it launches.",
      code: "full_suite_coming_soon",
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("preserves an already-paid Full Suite onboarding retry", async () => {
    queueResults(
      { data: { ...BUSINESS, billing_exempt: false }, error: null },
      {
        data: {
          status: "active",
          setup_fee_paid_at: "2026-07-01T00:00:00.000Z",
        },
        error: null,
      }
    );

    const response = await POST(request("onboarding", "full"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
      BUSINESS.id,
      "onboarding_retry"
    );
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("returns the 3+3 quality gate before creating a Stripe session", async () => {
    queueResults({ data: BUSINESS, error: null });
    mocks.getBusinessContentQuality.mockResolvedValue({
      ready: false,
      validServiceCount: 2,
      validFaqCount: 3,
    });
    mocks.getOnboardingStateForBusinessId.mockResolvedValue({
      currentStep: "services_faqs",
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "services_faqs_required",
      state: { currentStep: "services_faqs" },
    });
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.getExistingTelnyxBrandLinkState).not.toHaveBeenCalled();
  });

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
        "https://simplassist.com/onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}",
        "https://simplassist.com/onboarding?checkout=canceled",
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

  it.each(["pending_admin", "blocked"])(
    "blocks checkout while an existing-brand link is %s",
    async (status) => {
      queueResults({ data: BUSINESS, error: null });
      mocks.getExistingTelnyxBrandLinkState.mockResolvedValue({
        status,
        tcrBrandId: "BL69PDP",
      });

      const response = await POST(request());

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "existing_brand_review_required",
        error: expect.stringContaining("before checkout can continue"),
      });
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
      expect(mocks.from).toHaveBeenCalledTimes(1);
    }
  );

  it("allows an approved existing-brand link to continue to checkout", async () => {
    queueResults(
      { data: { ...BUSINESS, billing_exempt: false }, error: null },
      { data: null, error: null }
    );
    mocks.getExistingTelnyxBrandLinkState.mockResolvedValue({
      status: "approved",
      tcrBrandId: "BL69PDP",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/billing/checkout redirect URLs", () => {
  it("uses the configured public origin instead of Railway's localhost origin", async () => {
    queueResults(
      { data: { ...BUSINESS, billing_exempt: false }, error: null },
      { data: null, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      BUSINESS.id,
      "sms_and_chat",
      "price_growth",
      "price_setup",
      "https://simplassist.com/onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      "https://simplassist.com/onboarding?checkout=canceled",
      "onboarding"
    );
  });

  it("uses the configured public origin for billing success and cancel URLs", async () => {
    queueResults({
      data: {
        ...BUSINESS,
        onboarding_completed_at: "2026-07-01T00:00:00.000Z",
      },
      error: null,
    });

    const response = await POST(request("billing"));

    expect(response.status).toBe(200);
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith(
      BUSINESS.id,
      "sms_and_chat",
      "price_growth",
      "price_setup",
      "https://simplassist.com/billing?success=true&session_id={CHECKOUT_SESSION_ID}",
      "https://simplassist.com/billing?canceled=true",
      "billing"
    );
    expect(mocks.getBusinessContentQuality).not.toHaveBeenCalled();
  });

  it("fails before creating a Stripe session when production has no public URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    queueResults({ data: BUSINESS, error: null });

    const response = await POST(request("billing"));

    expect(response.status).toBe(500);
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });
});
