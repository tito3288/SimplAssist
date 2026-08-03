import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  from: vi.fn(),
  createBillingPortalSession: vi.fn(),
  resolveAssignedPartnerName: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  })),
}));

vi.mock("@/lib/stripe/checkout", () => ({
  createBillingPortalSession: mocks.createBillingPortalSession,
}));
vi.mock("@/lib/billing/partnerManagedBilling.server", () => ({
  resolveAssignedPartnerName: mocks.resolveAssignedPartnerName,
  partnerManagedBillingMessage: (partnerName: string | null) =>
    partnerName
      ? `Billing is handled by ${partnerName}.`
      : "Billing is managed externally.",
}));

import { POST } from "./route";

const BUSINESS = {
  id: "business-1",
  partner_id: null,
  billing_mode: "stripe",
};

function queueResults(...results: unknown[]) {
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

function request() {
  return new NextRequest("http://localhost:8080/api/billing/portal", {
    method: "POST",
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
  mocks.createBillingPortalSession.mockResolvedValue(
    "https://billing.stripe.test/session"
  );
  mocks.resolveAssignedPartnerName.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/portal redirect URL", () => {
  it.each([
    ["partner-1", "Alpha Dog Agency"],
    ["partner-2", "Second Partner"],
  ])(
    "rejects partner-managed portal access with the assigned %s name before any Stripe work",
    async (partnerId, partnerName) => {
      queueResults({
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
      expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
      expect(mocks.from).toHaveBeenCalledTimes(1);
    },
  );

  it("uses the exact external-billing fallback before Stripe for an orphaned comped business", async () => {
    queueResults({
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
    expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("uses the configured public origin instead of Railway's localhost origin", async () => {
    queueResults(
      { data: BUSINESS, error: null },
      { data: { stripe_customer_id: "cus_test_1" }, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createBillingPortalSession).toHaveBeenCalledWith(
      "cus_test_1",
      "https://simplassist.com/billing"
    );
    expect(await response.json()).toEqual({
      url: "https://billing.stripe.test/session",
    });
  });

  it("fails before creating a portal session when production has no public URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    queueResults(
      { data: BUSINESS, error: null },
      { data: { stripe_customer_id: "cus_test_1" }, error: null }
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
  });
});
