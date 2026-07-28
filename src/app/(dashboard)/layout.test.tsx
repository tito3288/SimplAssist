import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  canUseFeature: vi.fn(),
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
vi.mock("./_components/sidebar", () => ({
  default: () => null,
}));

import DashboardLayout from "./layout";

const BUSINESS = {
  id: "business-1",
  website_url: "https://example.com",
  deleted_at: null,
};
const ENTITLEMENTS = {
  businessId: BUSINESS.id,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
};

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
});

describe("DashboardLayout access gate", () => {
  it("uses the narrow SMS readiness lookup before rendering the dashboard", async () => {
    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).resolves.toBeDefined();

    expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledOnce();
    expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledWith(BUSINESS.id);
    expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS.id);
  });

  it("redirects when SMS is not ready without resolving entitlements", async () => {
    mocks.getSmsReadinessForBusiness.mockResolvedValue({ smsReady: false });

    await expect(
      DashboardLayout({ children: <div>Dashboard child</div> })
    ).rejects.toThrow("redirect:/onboarding");
    expect(mocks.getDashboardEntitlements).not.toHaveBeenCalled();
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
