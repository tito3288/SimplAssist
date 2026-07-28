import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDashboardBusinessContext: vi.fn(),
  getDashboardEntitlements: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardBusinessContext: mocks.getDashboardBusinessContext,
  getDashboardEntitlements: mocks.getDashboardEntitlements,
}));

import { EntitlementResolutionError } from "@/lib/billing/entitlements";
import { requireAuthenticatedFeature } from "./routeAccess";

const BUSINESS_ID = "business-1";
const SUPABASE = { from: vi.fn() };
const RESOLVED_CONTEXT = {
  status: "resolved",
  supabase: SUPABASE,
  user: { id: "user-1" },
  business: { id: BUSINESS_ID },
};
const STARTER_ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_only",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getDashboardBusinessContext.mockResolvedValue(RESOLVED_CONTEXT);
  mocks.getDashboardEntitlements.mockResolvedValue(STARTER_ENTITLEMENTS);
});

describe("requireAuthenticatedFeature", () => {
  it.each([
    ["unauthenticated", 401, "Unauthorized"],
    ["business_not_found", 404, "Business not found"],
  ] as const)("maps %s context to its existing API response", async (status, code, error) => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status,
      supabase: SUPABASE,
      user: status === "unauthenticated" ? null : { id: "user-1" },
    });

    const result = await requireAuthenticatedFeature("calendar");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected access denial");
    expect(result.response.status).toBe(code);
    await expect(result.response.json()).resolves.toMatchObject({ error });
    expect(mocks.getDashboardEntitlements).not.toHaveBeenCalled();
  });

  it("keeps business lookup failures retryable", async () => {
    mocks.getDashboardBusinessContext.mockResolvedValue({
      status: "business_lookup_failed",
      supabase: SUPABASE,
      user: { id: "user-1" },
      error: { message: "database unavailable" },
    });

    const result = await requireAuthenticatedFeature("calendar");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected access denial");
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      error: "service_unavailable",
      retryable: true,
    });
  });

  it("returns the memoized context when the feature is available", async () => {
    mocks.getDashboardEntitlements.mockResolvedValue({
      ...STARTER_ENTITLEMENTS,
      plan: "sms_and_chat",
    });

    const result = await requireAuthenticatedFeature("calendar");

    expect(result).toMatchObject({
      ok: true,
      businessId: BUSINESS_ID,
      supabase: SUPABASE,
    });
    expect(mocks.getDashboardEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("preserves plan denials", async () => {
    const result = await requireAuthenticatedFeature("calendar");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected access denial");
    expect(result.response.status).toBe(403);
    await expect(result.response.json()).resolves.toMatchObject({
      error: "feature_unavailable",
      feature: "calendar",
      requiredPlan: "sms_and_chat",
    });
  });

  it("fails retryably when entitlement state is indeterminate", async () => {
    mocks.getDashboardEntitlements.mockRejectedValue(
      new EntitlementResolutionError({
        code: "subscription_lookup_failed",
        businessId: BUSINESS_ID,
        message: "subscription lookup failed",
      })
    );

    const result = await requireAuthenticatedFeature("calendar");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected access denial");
    expect(result.response.status).toBe(503);
    await expect(result.response.json()).resolves.toEqual({
      error: "service_unavailable",
      retryable: true,
    });
  });
});
