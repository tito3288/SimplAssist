import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  canUseFeature: vi.fn(),
  getWorkspaceAccess: vi.fn(),
  workspacePageRedirectTarget: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
  getDashboardEntitlements: mocks.getDashboardEntitlements,
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getSmsReadinessForBusiness: mocks.getSmsReadinessForBusiness,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("@/lib/customer/workspaceAccess.server", () => ({
  getWorkspaceAccess: mocks.getWorkspaceAccess,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  workspacePageRedirectTarget: mocks.workspacePageRedirectTarget,
}));
vi.mock("./_components/sidebar", () => ({
  default: () => null,
}));

import DashboardLayout from "./layout";

const BUSINESS = {
  id: "business-1",
  website_url: "https://example.com",
  deleted_at: null,
  operations_suspended_at: null,
  ai_replies_paused_at: null,
  texting_paused_at: null,
  bookings_paused_at: null,
};
const ENTITLEMENTS = {
  businessId: BUSINESS.id,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.getDashboardBusinessContext.mockResolvedValue({
    status: "resolved",
    supabase: {},
    user: { id: "user-1", email: "owner@example.com" },
    business: BUSINESS,
  });
  mocks.getSmsReadinessForBusiness.mockResolvedValue({ smsReady: true });
  mocks.getDashboardEntitlements.mockResolvedValue(ENTITLEMENTS);
  mocks.canUseFeature.mockReturnValue(true);
  mocks.getWorkspaceAccess.mockResolvedValue({
    status: "resolved",
    user: { id: "user-1", email: "owner@example.com" },
    business: { id: BUSINESS.id, partner_id: null },
    hostKind: "canonical",
  });
  mocks.workspacePageRedirectTarget.mockReturnValue(null);
});

describe("DashboardLayout access gate", () => {
  it("redirects an unauthenticated workspace before dashboard data reads", async () => {
    mocks.getWorkspaceAccess.mockResolvedValue({ status: "unauthenticated" });
    mocks.workspacePageRedirectTarget.mockReturnValue("/login");

    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).rejects.toThrow("redirect:/login");

    expect(mocks.getDashboardBusinessContext).not.toHaveBeenCalled();
    expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
  });

  it.each([
    "business_not_found",
    "mismatch",
    "unknown_host",
    "partner_unavailable",
    "lookup_failed",
  ])(
    "redirects %s workspace decisions to the blocked page before dashboard reads",
    async (status) => {
      mocks.getWorkspaceAccess.mockResolvedValue({ status });
      mocks.workspacePageRedirectTarget.mockReturnValue("/workspace-access");

      await expect(
        DashboardLayout({ children: <div>Dashboard child</div> })
      ).rejects.toThrow("redirect:/workspace-access");

      expect(mocks.getDashboardBusinessContext).not.toHaveBeenCalled();
      expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
    }
  );

  it("uses the narrow SMS readiness lookup before rendering the dashboard", async () => {
    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).resolves.toBeDefined();

    expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledOnce();
    expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledWith(BUSINESS.id);
    expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS.id);
  });

  it("starts readiness and entitlements together once the business is known", async () => {
    const readiness = deferred<{ smsReady: boolean }>();
    const entitlements = deferred<typeof ENTITLEMENTS>();
    mocks.getSmsReadinessForBusiness.mockReturnValue(readiness.promise);
    mocks.getDashboardEntitlements.mockReturnValue(entitlements.promise);

    const layout = DashboardLayout({
      children: <div>Dashboard child</div>,
    });

    await vi.waitFor(() => {
      expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledOnce();
      expect(mocks.getDashboardEntitlements).toHaveBeenCalledOnce();
    });

    readiness.resolve({ smsReady: true });
    entitlements.resolve(ENTITLEMENTS);
    await expect(layout).resolves.toBeDefined();
  });

  it("redirects when SMS is not ready after resolving the parallel access checks", async () => {
    mocks.getSmsReadinessForBusiness.mockResolvedValue({ smsReady: false });

    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).rejects.toThrow("redirect:/onboarding");
    expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS.id);
  });

  it("keeps a suspended, SMS-ready account on the dashboard and renders the notice before its children", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: {},
      user: { id: "user-1", email: "owner@example.com" },
      business: {
        ...BUSINESS,
        operations_suspended_at: "2026-08-04T12:00:00.000Z",
        texting_paused_at: "2026-08-04T12:01:00.000Z",
      },
    });

    const layout = await DashboardLayout({
      children: <div>Dashboard child</div>,
    });
    const html = renderToStaticMarkup(layout);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledWith(BUSINESS.id);
    expect(html).toContain("Account services are suspended");
    expect(html).toContain(
      "After reactivation, texting will remain paused",
    );
    expect(html.indexOf("Account services are suspended")).toBeLessThan(
      html.indexOf("Dashboard child"),
    );
  });

  it("renders independent pause state without changing the readiness decision", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: {},
      user: { id: "user-1", email: "owner@example.com" },
      business: {
        ...BUSINESS,
        ai_replies_paused_at: "2026-08-04T12:00:00.000Z",
      },
    });

    const layout = await DashboardLayout({
      children: <div>Dashboard child</div>,
    });
    const html = renderToStaticMarkup(layout);

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(html).toContain("Some account services are paused");
    expect(html).toContain("AI replies");
  });

  it("redirects deleted businesses before the readiness lookup", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: {},
      user: { id: "user-1", email: "owner@example.com" },
      business: { ...BUSINESS, deleted_at: "2026-07-28T00:00:00.000Z" },
    });

    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).rejects.toThrow("redirect:/account-deleted");
    expect(mocks.getSmsReadinessForBusiness).not.toHaveBeenCalled();
  });
});
