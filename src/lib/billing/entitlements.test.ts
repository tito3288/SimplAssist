import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  results: new Map<string, { data: unknown; error: unknown }>(),
  rejectedTables: new Map<string, Error>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  canUseFeature,
  decideFeatureAccess,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "./entitlements";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000031";
const BUSINESS = {
  id: BUSINESS_ID,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: false,
};
const SUBSCRIPTION = {
  plan: "sms_and_chat",
  status: "active",
  cancel_at_period_end: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.clear();
  mocks.rejectedTables.clear();
  mocks.results.set("businesses", { data: BUSINESS, error: null });
  mocks.results.set("subscriptions", { data: SUBSCRIPTION, error: null });
  mocks.from.mockImplementation((table: string) => {
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockImplementation(async () => {
      const rejection = mocks.rejectedTables.get(table);
      if (rejection) throw rejection;
      return mocks.results.get(table);
    });
    return chain;
  });
});

describe("resolveBusinessEntitlements", () => {
  it.each(["active", "trialing", "past_due"] as const)(
    "keeps the synchronized plan active while status is %s",
    async (status) => {
      mocks.results.set("subscriptions", {
        data: { ...SUBSCRIPTION, status, cancel_at_period_end: true },
        error: null,
      });

      await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toEqual({
        businessId: BUSINESS_ID,
        plan: "sms_and_chat",
        status,
        source: "subscription",
        active: true,
        cancelAtPeriodEnd: true,
      });
    }
  );

  it("resolves canceled as a known inactive subscription", async () => {
    mocks.results.set("subscriptions", {
      data: { ...SUBSCRIPTION, plan: "full", status: "canceled" },
      error: null,
    });

    const entitlements = await resolveBusinessEntitlements(BUSINESS_ID);

    expect(entitlements).toMatchObject({
      plan: "full",
      status: "canceled",
      active: false,
      source: "subscription",
    });
    expect(decideFeatureAccess(entitlements, "manual_sms")).toMatchObject({
      outcome: "not_entitled",
      allowed: false,
      reason: "inactive_subscription",
    });
  });

  it.each(["billing_pilot", "billing_comped", "billing_exempt"] as const)(
    "grants Full when a subscription is absent and %s is protected",
    async (flag) => {
      mocks.results.set("businesses", {
        data: { ...BUSINESS, [flag]: true },
        error: null,
      });
      mocks.results.set("subscriptions", { data: null, error: null });

      await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toEqual({
        businessId: BUSINESS_ID,
        plan: "full",
        status: "billing_override",
        source: "billing_override",
        active: true,
        cancelAtPeriodEnd: false,
      });
    }
  );

  it("lets a valid subscription win over protected override flags", async () => {
    mocks.results.set("businesses", {
      data: { ...BUSINESS, billing_exempt: true },
      error: null,
    });
    mocks.results.set("subscriptions", {
      data: { ...SUBSCRIPTION, plan: "sms_only", status: "canceled" },
      error: null,
    });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toMatchObject(
      {
        source: "subscription",
        plan: "sms_only",
        status: "canceled",
        active: false,
      }
    );
  });

  it.each([
    ["business_lookup_failed", "businesses", { message: "business DB down" }],
    [
      "subscription_lookup_failed",
      "subscriptions",
      { message: "subscription DB down" },
    ],
  ] as const)("throws %s for a query failure", async (code, table, error) => {
    mocks.results.set(table, { data: null, error });

    const promise = resolveBusinessEntitlements(BUSINESS_ID);
    await expect(promise).rejects.toBeInstanceOf(EntitlementResolutionError);
    await expect(promise).rejects.toMatchObject({ code, retryable: true });
  });

  it("wraps an unexpected rejected database promise as indeterminate", async () => {
    mocks.rejectedTables.set(
      "subscriptions",
      new Error("transport connection closed")
    );

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "subscription_lookup_failed",
      retryable: true,
      message: expect.stringContaining("transport connection closed"),
    });
  });

  it("throws when the business does not exist", async () => {
    mocks.results.set("businesses", { data: null, error: null });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "business_not_found",
      retryable: true,
    });
  });

  it("throws when a provisioned business lacks a subscription and override", async () => {
    mocks.results.set("subscriptions", { data: null, error: null });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "subscription_missing",
      retryable: true,
    });
  });

  it.each([
    { ...SUBSCRIPTION, plan: "starter" },
    { ...SUBSCRIPTION, status: "unpaid" },
    { ...SUBSCRIPTION, cancel_at_period_end: null },
  ])("rejects malformed subscription row %#", async (data) => {
    mocks.results.set("subscriptions", { data, error: null });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "malformed_subscription",
      retryable: true,
    });
  });

  it("does not mask malformed subscription state with an override", async () => {
    mocks.results.set("businesses", {
      data: { ...BUSINESS, billing_pilot: true },
      error: null,
    });
    mocks.results.set("subscriptions", {
      data: { ...SUBSCRIPTION, status: "unknown" },
      error: null,
    });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "malformed_subscription",
    });
  });

  it("rejects an absent business ID before querying", async () => {
    await expect(resolveBusinessEntitlements(" ")).rejects.toMatchObject({
      code: "invalid_business_id",
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("feature decisions", () => {
  it("allows inherited Growth features", async () => {
    const entitlements = await resolveBusinessEntitlements(BUSINESS_ID);

    expect(canUseFeature(entitlements, "manual_sms")).toBe(true);
    expect(canUseFeature(entitlements, "web_chat")).toBe(true);
    expect(decideFeatureAccess(entitlements, "web_chat")).toEqual({
      outcome: "resolved",
      allowed: true,
      feature: "web_chat",
      requiredPlan: "sms_and_chat",
      currentPlan: "sms_and_chat",
      status: "active",
    });
  });

  it("returns a typed known denial when the plan is too low", async () => {
    mocks.results.set("subscriptions", {
      data: { ...SUBSCRIPTION, plan: "sms_only" },
      error: null,
    });
    const entitlements = await resolveBusinessEntitlements(BUSINESS_ID);

    expect(canUseFeature(entitlements, "ai_sms_conversations")).toBe(false);
    expect(decideFeatureAccess(entitlements, "ai_sms_conversations")).toEqual({
      outcome: "not_entitled",
      allowed: false,
      reason: "plan",
      feature: "ai_sms_conversations",
      requiredPlan: "sms_and_chat",
      currentPlan: "sms_only",
      status: "active",
    });
  });
});
