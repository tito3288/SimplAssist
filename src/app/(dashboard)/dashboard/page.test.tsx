import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
  getSmsReadinessForBusiness: vi.fn(),
  canUseFeature: vi.fn(),
  getFirstNameFromAuthMetadata: vi.fn(),
  shouldShowCallForwardingNudge: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: () => null }));
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
vi.mock("@/lib/utils", () => ({
  getFirstNameFromAuthMetadata: mocks.getFirstNameFromAuthMetadata,
}));
vi.mock("@/components/dashboard/callForwardingNudgeEligibility", () => ({
  shouldShowCallForwardingNudge: mocks.shouldShowCallForwardingNudge,
}));
vi.mock("@/components/dashboard/DashboardOverview", () => ({
  default: () => null,
}));
vi.mock("@/components/entitlements/FeatureStatusBanners", () => ({
  FeatureStatusBanners: () => null,
}));

import DashboardPage from "./page";

const BUSINESS_ID = "business-1";
const ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function queryThenable(result: Promise<unknown>) {
  const query: Record<string, unknown> = {};
  for (const method of [
    "select",
    "eq",
    "gte",
    "order",
    "limit",
    "single",
    "maybeSingle",
  ]) {
    query[method] = vi.fn(() => query);
  }
  query.then = result.then.bind(result);
  query.catch = result.catch.bind(result);
  return query;
}

describe("DashboardPage query scheduling", () => {
  it("starts entitlements, readiness, and page data once the business is known", async () => {
    const entitlements = deferred<typeof ENTITLEMENTS>();
    const preview = deferred<{ data: { content: string }[] }>();
    const tableCalls = new Map<string, number>();

    mocks.from.mockImplementation((table: string) => {
      const call = (tableCalls.get(table) ?? 0) + 1;
      tableCalls.set(table, call);

      let result: Promise<unknown>;
      if (table === "conversations" && call === 1) {
        result = Promise.resolve({ count: 4 });
      } else if (table === "conversations" && call === 2) {
        result = Promise.resolve({ count: 2 });
      } else if (table === "conversations") {
        result = Promise.resolve({
          data: [{ id: "conversation-1", contact: null }],
        });
      } else if (table === "contacts" && call === 1) {
        result = Promise.resolve({ count: 3 });
      } else if (table === "contacts") {
        result = Promise.resolve({ data: [] });
      } else if (table === "messages" && call === 1) {
        result = Promise.resolve({ count: 8 });
      } else if (table === "messages") {
        result = preview.promise;
      } else if (table === "phone_numbers") {
        result = Promise.resolve({
          data: { phone_number: "+13175550123", is_active: true },
        });
      } else {
        result = Promise.resolve({ data: null });
      }

      return queryThenable(result);
    });

    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "resolved",
      supabase: { from: mocks.from },
      user: { id: "user-1", user_metadata: {} },
      business: {
        id: BUSINESS_ID,
        call_forwarding_enabled: false,
        call_forwarding_nudge_resolved_at: null,
      },
    });
    mocks.getDashboardEntitlements.mockReturnValue(entitlements.promise);
    mocks.getSmsReadinessForBusiness.mockResolvedValue({
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
      phoneNumber: "+13175550123",
    });
    mocks.canUseFeature.mockReturnValue(true);
    mocks.getFirstNameFromAuthMetadata.mockReturnValue("Owner");
    mocks.shouldShowCallForwardingNudge.mockReturnValue(false);

    const page = DashboardPage();

    await vi.waitFor(() => {
      expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
      expect(mocks.getSmsReadinessForBusiness).toHaveBeenCalledWith(BUSINESS_ID);
      expect(mocks.from).toHaveBeenCalledTimes(10);
    });

    entitlements.resolve(ENTITLEMENTS);
    await vi.waitFor(() => {
      expect(mocks.from).toHaveBeenCalledTimes(11);
    });

    preview.resolve({ data: [{ content: "Latest message" }] });
    await expect(page).resolves.toBeDefined();
  });
});
