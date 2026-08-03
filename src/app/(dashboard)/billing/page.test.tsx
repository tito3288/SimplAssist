import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  from: vi.fn(),
  resolveAssignedPartnerName: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
}));
vi.mock("./billing-actions", () => ({
  BillingActions: () => <div>Stripe billing action</div>,
}));
vi.mock("@/lib/billing/partnerManagedBilling.server", () => ({
  resolveAssignedPartnerName: mocks.resolveAssignedPartnerName,
  partnerManagedBillingMessage: (partnerName: string | null) =>
    partnerName
      ? `Billing is handled by ${partnerName}.`
      : "Billing is managed externally.",
}));

import BillingPage from "./page";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function queryThenable(result: Promise<unknown>) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "single", "maybeSingle"]) {
    query[method] = vi.fn(() => query);
  }
  query.then = result.then.bind(result);
  query.catch = result.catch.bind(result);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveAssignedPartnerName.mockResolvedValue(null);
});

describe("BillingPage", () => {
  it("starts subscription and usage reads together", async () => {
    const subscription = deferred<{ data: null }>();
    const usage = deferred<{ data: null }>();
    mocks.from.mockImplementation((table: string) =>
      queryThenable(
        table === "subscriptions" ? subscription.promise : usage.promise
      )
    );
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1" },
      business: {
        id: "business-1",
        partner_id: null,
        billing_mode: "stripe",
      },
    });

    const page = BillingPage();

    await vi.waitFor(() => {
      expect(mocks.from).toHaveBeenCalledWith("subscriptions");
      expect(mocks.from).toHaveBeenCalledWith("billing_usage_periods");
    });

    subscription.resolve({ data: null });
    usage.resolve({ data: null });
    await expect(page).resolves.toBeDefined();
    expect(mocks.resolveAssignedPartnerName).not.toHaveBeenCalled();
  });

  it.each(["invoiced", "comped"] as const)(
    "skips Stripe data and controls for %s billing",
    async (billingMode) => {
      mocks.resolveAssignedPartnerName.mockResolvedValue("Alpha Dog Agency");
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: "partner-1",
          billing_mode: billingMode,
        },
      });

      const html = renderToStaticMarkup(await BillingPage());

      expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith("partner-1");
      expect(mocks.from).not.toHaveBeenCalled();
      expect(html).toContain("Billing is handled by Alpha Dog Agency.");
      expect(html).toContain("Partner-managed billing");
      expect(html).not.toContain("Stripe billing action");
      expect(html).not.toContain("Choose a plan");
      expect(html).not.toContain("Recommended");
      expect(html).not.toContain("Manage your subscription");
      expect(html).not.toContain("SMS usage");
    }
  );

  it.each([null, "missing-partner"])(
    "uses the exact orphan fallback for partner id %s without querying Stripe data",
    async (partnerId) => {
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: partnerId,
          billing_mode: "invoiced",
        },
      });

      const html = renderToStaticMarkup(await BillingPage());

      expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(partnerId);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(html).toContain("Billing is managed externally.");
      expect(html).not.toContain("Billing is handled by");
      expect(html).not.toContain("Stripe billing action");
    }
  );
});
