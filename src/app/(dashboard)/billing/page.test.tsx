import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const BILLING_ROUTE_CTA_SOURCES = [
  [
    "paused-feature Manage plan",
    "../../../components/entitlements/FeatureStatusBanners.tsx",
  ],
  [
    "locked-feature Manage plan",
    "../../../components/entitlements/LockedFeatureCard.tsx",
  ],
  [
    "conversation plan and billing notices",
    "../../../components/conversations/MessageThread.tsx",
  ],
  [
    "inactive-subscription Billing notice",
    "../../../components/settings/AISettingsForm.tsx",
  ],
] as const;

const BILLING_URL_STATES = [
  ["plain deep link or dashboard CTA", undefined],
  [
    "successful Stripe Checkout callback",
    { success: "true", session_id: "cs_stale" },
  ],
  ["canceled Stripe Checkout callback", { canceled: "true" }],
  [
    "stale checkout tab-state parameter",
    { checkout: "success", session_id: "cs_stale" },
  ],
] as const;

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  requireWorkspacePageAccess: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  from: vi.fn(),
  resolveAssignedPartnerName: vi.fn(),
  getRequestBrand: vi.fn(),
  isPlanAvailable: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspacePageAccess: mocks.requireWorkspacePageAccess,
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
}));
vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));
vi.mock("@/lib/billing/planAvailability", () => ({
  isPlanAvailable: mocks.isPlanAvailable,
}));
vi.mock("./billing-actions", () => ({
  BillingActions: ({ mode }: { mode: string }) => (
    <div>Stripe billing action: {mode}</div>
  ),
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
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.requireWorkspacePageAccess.mockResolvedValue(undefined);
  mocks.resolveAssignedPartnerName.mockResolvedValue(null);
  mocks.getRequestBrand.mockResolvedValue({
    source: "default",
    isPreview: false,
    brand: { name: "SimplAssist" },
  });
  mocks.isPlanAvailable.mockImplementation(
    (plan: string) => plan !== "full"
  );
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
        operations_suspended_at: null,
      },
    });

    const page = BillingPage({});

    await vi.waitFor(() => {
      expect(mocks.from).toHaveBeenCalledWith("subscriptions");
      expect(mocks.from).toHaveBeenCalledWith("billing_usage_periods");
    });

    subscription.resolve({ data: null });
    usage.resolve({ data: null });
    await expect(page).resolves.toBeDefined();
    expect(mocks.resolveAssignedPartnerName).not.toHaveBeenCalled();
  });

  it("uses request-brand plan copy without changing Stripe plan behavior", async () => {
    mocks.from.mockImplementation(() =>
      queryThenable(Promise.resolve({ data: null }))
    );
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1" },
      business: {
        id: "business-1",
        partner_id: null,
        billing_mode: "stripe",
        operations_suspended_at: null,
      },
    });
    mocks.getRequestBrand.mockResolvedValue({
      source: "admin_preview",
      isPreview: true,
      brand: { name: "Alpha Dog Agency" },
    });

    const html = renderToStaticMarkup(await BillingPage({}));

    expect(html).toContain("One local Alpha Dog Agency number");
    expect(html).not.toContain("One local SimplAssist number");
    expect(html).toContain("$25");
    expect(html).toContain("Stripe billing action");
    expect(html).not.toContain("Billing during suspension");
    expect(html).not.toContain("billing continues");
  });

  it.each(BILLING_URL_STATES)(
    "keeps the direct missing-subscription checkout paywall unchanged for a %s",
    async (_urlState, searchParams) => {
      mocks.from.mockImplementation(() =>
        queryThenable(Promise.resolve({ data: null }))
      );
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: null,
          billing_mode: "stripe",
          operations_suspended_at: null,
        },
      });

      const html = renderToStaticMarkup(
        await BillingPage({ searchParams })
      );

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(html).toContain("Billing");
      expect(html).toContain("Choose a plan to get started");
      expect(html).toContain("Starter / SMS Only");
      expect(html).toContain("Growth / SMS + Web Chat");
      expect(html).not.toContain("Pro / Full Suite");
      expect(html).not.toContain("Notify Me When It Launches");
      expect(html.match(/Stripe billing action: checkout/g)).toHaveLength(2);
      expect(mocks.isPlanAvailable).toHaveBeenCalledWith("full");
    }
  );

  it("restores the Full choice and checkout when Full becomes available", async () => {
    mocks.isPlanAvailable.mockReturnValue(true);
    mocks.from.mockImplementation(() =>
      queryThenable(Promise.resolve({ data: null }))
    );
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1" },
      business: {
        id: "business-1",
        partner_id: null,
        billing_mode: "stripe",
        operations_suspended_at: null,
      },
    });

    const html = renderToStaticMarkup(await BillingPage({}));

    expect(html).toContain("Pro / Full Suite");
    expect(html).toContain("$65");
    expect(html).not.toContain("Coming Soon");
    expect(html).not.toContain("Notify Me When It Launches");
    expect(html.match(/Stripe billing action: checkout/g)).toHaveLength(3);
  });

  it("keeps an existing active Full subscription and portal visible while Full is unavailable", async () => {
    mocks.from.mockImplementation((table: string) =>
      queryThenable(
        Promise.resolve(
          table === "subscriptions"
            ? {
                data: {
                  plan: "full",
                  status: "active",
                  current_period_end: "2026-09-01T12:00:00.000Z",
                },
              }
            : {
                data: {
                  inbound_sms_parts: 20,
                  outbound_sms_parts: 30,
                  included_sms_parts: 2_500,
                },
              }
        )
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
        operations_suspended_at: null,
      },
    });

    const html = renderToStaticMarkup(await BillingPage({}));

    expect(html).toContain("Pro / Full Suite");
    expect(html).toContain("Stripe billing action: portal");
    expect(html).toContain("50 / 2,500 parts");
    expect(html).not.toContain("Stripe billing action: checkout");
    expect(html).not.toContain("Choose a plan to get started");
    expect(mocks.isPlanAvailable).not.toHaveBeenCalled();
  });

  it("shows Stripe billing truth during suspension without hiding subscription details or portal access", async () => {
    mocks.from.mockImplementation((table: string) =>
      queryThenable(
        Promise.resolve(
          table === "subscriptions"
            ? {
                data: {
                  plan: "sms_and_chat",
                  status: "active",
                  current_period_end: "2026-09-01T12:00:00.000Z",
                },
              }
            : {
                data: {
                  inbound_sms_parts: 12,
                  outbound_sms_parts: 18,
                  included_sms_parts: 1_500,
                },
              }
        )
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
        operations_suspended_at: "2026-08-04T12:00:00.000Z",
      },
    });

    const html = renderToStaticMarkup(await BillingPage({}));

    expect(html).toContain("Billing during suspension");
    expect(html).toContain(
      "Suspension does not pause your Stripe subscription; billing continues."
    );
    expect(html).toContain("Growth / SMS + Web Chat");
    expect(html).toContain(">active<");
    expect(html).toContain("Next billing date:");
    expect(html).toContain("Stripe billing action: portal");
    expect(html).toContain("SMS usage");
    expect(html).toContain("30 / 1,500 parts");
    expect(html).not.toContain(
      "Billing remains managed by your partner; this suspension has not changed it."
    );
    expect(mocks.resolveAssignedPartnerName).not.toHaveBeenCalled();
  });

  it.each(BILLING_URL_STATES)(
    "redirects partner-owned Stripe billing for a %s before billing reads",
    async (_urlState, searchParams) => {
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: "partner-1",
          billing_mode: "stripe",
          operations_suspended_at: null,
        },
      });

      await expect(BillingPage({ searchParams })).rejects.toThrow(
        "redirect:/dashboard"
      );

      expect(mocks.redirect).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.getRequestBrand).not.toHaveBeenCalled();
      expect(mocks.resolveAssignedPartnerName).not.toHaveBeenCalled();
      expect(mocks.isPlanAvailable).not.toHaveBeenCalled();
    }
  );

  it.each(["invoiced", "comped"] as const)(
    "redirects partner-owned %s billing before billing reads",
    async (billingMode) => {
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: "partner-1",
          billing_mode: billingMode,
          operations_suspended_at: null,
        },
      });

      await expect(BillingPage({})).rejects.toThrow("redirect:/dashboard");

      expect(mocks.redirect).toHaveBeenCalledOnce();
      expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.getRequestBrand).not.toHaveBeenCalled();
      expect(mocks.resolveAssignedPartnerName).not.toHaveBeenCalled();
      expect(mocks.isPlanAvailable).not.toHaveBeenCalled();
    }
  );

  it.each(BILLING_ROUTE_CTA_SOURCES)(
    "%s continues to target the centrally guarded Billing route",
    (_entryPoint, relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

      expect(source).toContain('href="/billing"');
    }
  );

  it.each(["invoiced", "comped"] as const)(
    "keeps the direct %s external-billing page unchanged",
    async (billingMode) => {
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: null,
          billing_mode: billingMode,
          operations_suspended_at: null,
        },
      });

      const html = renderToStaticMarkup(await BillingPage({}));

      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(null);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(html).toContain("Billing is managed externally.");
      expect(html).not.toContain("Billing is handled by");
      expect(html).toContain("Partner-managed billing");
      expect(html).not.toContain("Stripe billing action");
      expect(html).not.toContain("Choose a plan");
      expect(html).not.toContain("Recommended");
      expect(html).not.toContain("Manage your subscription");
      expect(html).not.toContain("SMS usage");
      expect(html).not.toContain("Billing during suspension");
      expect(html).not.toContain("Pro / Full Suite");
      expect(html).not.toContain("Notify Me When It Launches");
      expect(mocks.getRequestBrand).not.toHaveBeenCalled();
      expect(mocks.isPlanAvailable).not.toHaveBeenCalled();
    }
  );

  it.each(["invoiced", "comped"] as const)(
    "keeps the direct %s suspension edge on its generic external page",
    async (billingMode) => {
      mocks.getDashboardBusinessContext.mockResolvedValue({
        status: "resolved",
        supabase: { from: mocks.from },
        user: { id: "user-1" },
        business: {
          id: "business-1",
          partner_id: null,
          billing_mode: billingMode,
          operations_suspended_at: "2026-08-04T12:00:00.000Z",
        },
      });

      const html = renderToStaticMarkup(await BillingPage({}));

      expect(html).toContain("Billing during suspension");
      expect(html).toContain(
        "Billing remains managed by your partner; this suspension has not changed it."
      );
      expect(html).toContain("Partner-managed billing");
      expect(html).toContain("Billing is managed externally.");
      expect(html).not.toContain("Billing is handled by");
      expect(mocks.redirect).not.toHaveBeenCalled();
      expect(mocks.resolveAssignedPartnerName).toHaveBeenCalledWith(null);
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.getRequestBrand).not.toHaveBeenCalled();
      expect(html).not.toContain("Stripe billing action");
      expect(html).not.toContain("Manage your subscription");
      expect(html).not.toContain("SMS usage");
      expect(html).not.toContain("billing continues");
      expect(html).not.toContain("SimplAssist");
    }
  );
});
