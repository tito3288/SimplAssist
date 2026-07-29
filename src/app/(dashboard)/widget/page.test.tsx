import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardEntitledContext: vi.fn(),
  canUseFeature: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardEntitledContext: mocks.getDashboardEntitledContext,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("./WidgetPageClient", () => ({ default: () => null }));
vi.mock("@/components/entitlements/LockedFeatureCard", () => ({
  LockedFeatureCard: () => null,
}));

import WidgetPage from "./page";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canUseFeature.mockReturnValue(true);
  mocks.getDashboardEntitledContext.mockResolvedValue({
    status: "resolved",
    supabase: { from: mocks.from },
    business: { id: BUSINESS_ID, name: "Acme" },
    entitlements: {
      businessId: BUSINESS_ID,
      plan: "sms_and_chat",
      status: "active",
      source: "subscription",
      active: true,
      cancelAtPeriodEnd: false,
    },
  });
});

describe("WidgetPage defaults", () => {
  it("creates only new widget configs as active", async () => {
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: null }),
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);

    const insertQuery = {
      insert: mocks.insert,
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { business_id: BUSINESS_ID, is_active: true },
      }),
    };
    mocks.insert.mockReturnValue(insertQuery);
    insertQuery.select.mockReturnValue(insertQuery);
    mocks.from
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery);

    await expect(WidgetPage()).resolves.toBeDefined();

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BUSINESS_ID,
        is_active: true,
      })
    );
  });
});
