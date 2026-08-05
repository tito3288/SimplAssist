import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  retrieveCheckoutSession: vi.fn(),
  syncCheckoutSession: vi.fn(),
  attemptPaidLaunch: vi.fn(),
  getOnboardingStateForBusinessId: vi.fn(),
  resolveAssignedPartnerName: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));
vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    checkout: { sessions: { retrieve: mocks.retrieveCheckoutSession } },
  },
}));
vi.mock("@/lib/stripe/subscriptionSync", () => ({
  syncCheckoutSession: mocks.syncCheckoutSession,
}));
vi.mock("@/lib/billing/launch", () => ({
  attemptPaidLaunch: mocks.attemptPaidLaunch,
}));
vi.mock("@/lib/onboarding/state", () => ({
  getOnboardingStateForBusinessId: mocks.getOnboardingStateForBusinessId,
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
};

const SESSION = {
  id: "cs_finalize_1",
  metadata: { business_id: BUSINESS.id },
};

const NEUTRAL_LAUNCH_ERRORS = [
  [
    "submission_disabled",
    "SMS registration is disabled for this account. Contact support if this looks wrong.",
  ],
  [
    "existing_brand_review_required",
    "Your existing Telnyx brand link needs review before SMS registration can continue. Contact support.",
  ],
  [
    "linked_brand_needs_support",
    "Your linked Telnyx brand needs support before SMS registration can continue. Its existing Telnyx resources were not replaced.",
  ],
  [
    "failed",
    "We could not recheck your existing Telnyx brand right now. No new Telnyx resources were created; please try again shortly.",
  ],
  [
    "missing_phone_number",
    "Choose your business number before submitting SMS registration.",
  ],
] as const;

function queueBusinessResults(...results: unknown[]) {
  const queue = [...results];
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected database query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });
}

function request(sessionId = SESSION.id) {
  return new NextRequest("http://localhost:8080/api/billing/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "owner-1" } },
    error: null,
  });
  mocks.retrieveCheckoutSession.mockResolvedValue(SESSION);
  mocks.syncCheckoutSession.mockResolvedValue({
    businessId: BUSINESS.id,
    customerId: "cus_finalize_1",
    subscriptionId: "sub_finalize_1",
    plan: "sms_and_chat",
  });
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.getOnboardingStateForBusinessId.mockResolvedValue({
    currentStep: "carrier_review",
  });
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

describe("POST /api/billing/finalize billing authority", () => {
  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])("returns workspace %i before parsing or Stripe work", async (status, body) => {
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
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it.each([
    ["partner-1", "Alpha Dog Agency"],
    ["partner-2", "Second Partner"],
  ])(
    "rejects a partner-managed business with the assigned %s name before Stripe",
    async (partnerId, partnerName) => {
      queueBusinessResults({
        data: {
          ...BUSINESS,
          partner_id: partnerId,
          billing_mode: "invoiced",
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
      expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
      expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
      expect(mocks.getOnboardingStateForBusinessId).not.toHaveBeenCalled();
    }
  );

  it("uses the exact external-billing fallback for an orphaned comped business", async () => {
    queueBusinessResults({
      data: { ...BUSINESS, billing_mode: "comped" },
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "billing_managed_by_partner",
      message: "Billing is managed externally.",
    });
    expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(null);
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it("rejects a stale Checkout after partner assignment and before local synchronization or launch", async () => {
    queueBusinessResults(
      { data: BUSINESS, error: null },
      {
        data: {
          ...BUSINESS,
          partner_id: "partner-1",
          billing_mode: "invoiced",
        },
        error: null,
      }
    );
    mocks.resolveAssignedPartnerName.mockResolvedValue("Alpha Dog Agency");

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "billing_managed_by_partner",
      message: "Billing is handled by Alpha Dog Agency.",
    });
    expect(mocks.retrieveCheckoutSession).toHaveBeenCalledWith(SESSION.id);
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStateForBusinessId).not.toHaveBeenCalled();
  });

  it("preserves Stripe finalization and launch after both authority checks", async () => {
    queueBusinessResults(
      { data: BUSINESS, error: null },
      { data: BUSINESS, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      state: { currentStep: "carrier_review" },
    });
    expect(mocks.from.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.retrieveCheckoutSession.mock.invocationCallOrder[0]
    );
    expect(mocks.syncCheckoutSession).toHaveBeenCalledWith(SESSION);
    expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
      BUSINESS.id,
      "stripe_finalize"
    );
    expect(mocks.getOnboardingStateForBusinessId).toHaveBeenCalledWith(
      BUSINESS.id
    );
  });

  it.each(NEUTRAL_LAUNCH_ERRORS)(
    "returns raw neutral %s launch copy without a product name",
    async (status, message) => {
      queueBusinessResults(
        { data: BUSINESS, error: null },
        { data: BUSINESS, error: null }
      );
      mocks.attemptPaidLaunch.mockResolvedValue({ status, message });

      const response = await POST(request());
      const text = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(text)).toEqual({
        error: message,
        code: status,
        state: { currentStep: "carrier_review" },
      });
      expect(text).not.toContain("SimplAssist");
    }
  );

  it("does not launch when the guarded database sync rejects a final assignment race", async () => {
    queueBusinessResults(
      { data: BUSINESS, error: null },
      { data: BUSINESS, error: null }
    );
    mocks.syncCheckoutSession.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Checkout session could not be finalized",
    });
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.getOnboardingStateForBusinessId).not.toHaveBeenCalled();
  });

  it("rejects Checkout metadata for another business before synchronization", async () => {
    queueBusinessResults({ data: BUSINESS, error: null });
    mocks.retrieveCheckoutSession.mockResolvedValue({
      ...SESSION,
      metadata: { business_id: "business-2" },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it("rejects malformed session ids after authority resolution but before Stripe work", async () => {
    queueBusinessResults({ data: BUSINESS, error: null });

    const response = await POST(request("not-a-checkout"));

    expect(response.status).toBe(400);
    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it("preserves the unauthenticated response before all billing work", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.syncCheckoutSession).not.toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });
});
