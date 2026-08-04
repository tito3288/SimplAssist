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
  resolveBusinessEntitlementsFromSnapshot,
  type BusinessEntitlementSnapshot,
} from "./entitlements";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000031";
const BUSINESS = {
  id: BUSINESS_ID,
  billing_mode: "stripe",
  partner_plan: null,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: false,
};
const SUBSCRIPTION = {
  plan: "sms_and_chat",
  status: "active",
  cancel_at_period_end: false,
};

function entitlementSnapshot(
  overrides: Partial<BusinessEntitlementSnapshot> = {}
): BusinessEntitlementSnapshot {
  return {
    business: BUSINESS,
    subscription: SUBSCRIPTION,
    ...overrides,
  };
}

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
    "preserves Stripe legacy Full access when no subscription exists and %s is protected",
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

  it.each([
    ["invoiced", "sms_only"],
    ["invoiced", "sms_and_chat"],
    ["invoiced", "full"],
    ["comped", "sms_only"],
    ["comped", "sms_and_chat"],
    ["comped", "full"],
  ] as const)(
    "resolves %s partner billing natively at the %s plan",
    async (billingMode, partnerPlan) => {
      mocks.results.set("businesses", {
        data: {
          ...BUSINESS,
          billing_mode: billingMode,
          partner_plan: partnerPlan,
        },
        error: null,
      });
      mocks.results.set("subscriptions", { data: null, error: null });

      await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toEqual({
        businessId: BUSINESS_ID,
        plan: partnerPlan,
        status: "partner_billing",
        source: "partner_billing",
        active: true,
        cancelAtPeriodEnd: false,
      });
    }
  );

  it("does not let legacy flags upgrade a partner-managed plan", async () => {
    mocks.results.set("businesses", {
      data: {
        ...BUSINESS,
        billing_mode: "invoiced",
        partner_plan: "sms_only",
        billing_pilot: true,
        billing_comped: true,
        billing_exempt: true,
      },
      error: null,
    });
    mocks.results.set("subscriptions", { data: null, error: null });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toMatchObject(
      {
        source: "partner_billing",
        status: "partner_billing",
        plan: "sms_only",
        active: true,
      }
    );
  });

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

  it("lets any valid subscription row win over malformed partner state", async () => {
    mocks.results.set("businesses", {
      data: {
        ...BUSINESS,
        billing_mode: "unknown",
        partner_plan: "not_a_plan",
        billing_pilot: null,
      },
      error: null,
    });
    mocks.results.set("subscriptions", {
      data: { ...SUBSCRIPTION, plan: "full", status: "canceled" },
      error: null,
    });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).resolves.toEqual({
      businessId: BUSINESS_ID,
      plan: "full",
      status: "canceled",
      source: "subscription",
      active: false,
      cancelAtPeriodEnd: false,
    });
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

  it("preserves business identity error precedence over a parallel subscription error", async () => {
    mocks.results.set("businesses", { data: null, error: null });
    mocks.results.set("subscriptions", {
      data: null,
      error: { message: "subscription DB down" },
    });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "business_not_found",
      retryable: true,
    });

    mocks.results.set("businesses", {
      data: { ...BUSINESS, id: "unexpected-business" },
      error: null,
    });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "malformed_business",
      retryable: true,
    });
  });

  it("keeps subscription_missing for Stripe mode with no subscription or legacy flags", async () => {
    mocks.results.set("subscriptions", { data: null, error: null });

    await expect(resolveBusinessEntitlements(BUSINESS_ID)).rejects.toMatchObject({
      code: "subscription_missing",
      retryable: true,
      message: `Business ${BUSINESS_ID} has no synchronized subscription or billing override.`,
    });
  });

  it.each([
    { billing_mode: "manual", partner_plan: null },
    { billing_mode: "stripe", partner_plan: "sms_only" },
    { billing_mode: "invoiced", partner_plan: null },
    { billing_mode: "comped", partner_plan: "starter" },
  ] as const)(
    "rejects malformed business billing state: %s",
    async (state) => {
      mocks.results.set("businesses", {
        data: { ...BUSINESS, ...state },
        error: null,
      });
      mocks.results.set("subscriptions", { data: null, error: null });

      await expect(
        resolveBusinessEntitlements(BUSINESS_ID)
      ).rejects.toMatchObject({
        code: "malformed_business",
        retryable: true,
      });
    }
  );

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

describe("resolveBusinessEntitlementsFromSnapshot", () => {
  it.each(["active", "trialing", "past_due"] as const)(
    "keeps %s subscriptions feature-active without a database read",
    (status) => {
      expect(
        resolveBusinessEntitlementsFromSnapshot(
          BUSINESS_ID,
          entitlementSnapshot({
            subscription: {
              ...SUBSCRIPTION,
              status,
              cancel_at_period_end: true,
            },
          })
        )
      ).toEqual({
        businessId: BUSINESS_ID,
        plan: "sms_and_chat",
        status,
        source: "subscription",
        active: true,
        cancelAtPeriodEnd: true,
      });
    }
  );

  it("preserves subscription precedence over malformed business billing fields", () => {
    expect(
      resolveBusinessEntitlementsFromSnapshot(
        BUSINESS_ID,
        entitlementSnapshot({
          business: {
            ...BUSINESS,
            billing_mode: "invalid",
            partner_plan: "invalid",
            billing_pilot: null,
          },
          subscription: {
            ...SUBSCRIPTION,
            plan: "full",
            status: "canceled",
          },
        })
      )
    ).toMatchObject({
      plan: "full",
      status: "canceled",
      source: "subscription",
      active: false,
    });
  });

  it("resolves partner billing and protected legacy overrides from snapshots", () => {
    expect(
      resolveBusinessEntitlementsFromSnapshot(
        BUSINESS_ID,
        entitlementSnapshot({
          business: {
            ...BUSINESS,
            billing_mode: "invoiced",
            partner_plan: "sms_only",
          },
          subscription: null,
        })
      )
    ).toMatchObject({
      plan: "sms_only",
      status: "partner_billing",
      source: "partner_billing",
      active: true,
    });

    expect(
      resolveBusinessEntitlementsFromSnapshot(
        BUSINESS_ID,
        entitlementSnapshot({
          business: { ...BUSINESS, billing_exempt: true },
          subscription: null,
        })
      )
    ).toMatchObject({
      plan: "full",
      status: "billing_override",
      source: "billing_override",
      active: true,
    });
  });

  it.each([
    [
      "business_not_found",
      entitlementSnapshot({ business: null }),
    ],
    [
      "malformed_business",
      entitlementSnapshot({
        business: { ...BUSINESS, id: "unexpected-business" },
      }),
    ],
    [
      "malformed_subscription",
      entitlementSnapshot({
        subscription: { ...SUBSCRIPTION, status: "unknown" },
      }),
    ],
    [
      "subscription_missing",
      entitlementSnapshot({ subscription: null }),
    ],
  ] as const)("fails closed with %s", (code, snapshot) => {
    expect(() =>
      resolveBusinessEntitlementsFromSnapshot(BUSINESS_ID, snapshot)
    ).toThrowError(EntitlementResolutionError);

    try {
      resolveBusinessEntitlementsFromSnapshot(BUSINESS_ID, snapshot);
    } catch (error) {
      expect(error).toMatchObject({ code, retryable: true });
    }
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

  it.each([
    ["sms_only", true, false, false],
    ["sms_and_chat", true, true, false],
    ["full", true, true, true],
  ] as const)(
    "applies the existing feature walls to partner plan %s",
    async (partnerPlan, manualSms, webChat, advancedAnalytics) => {
      mocks.results.set("businesses", {
        data: {
          ...BUSINESS,
          billing_mode: "comped",
          partner_plan: partnerPlan,
        },
        error: null,
      });
      mocks.results.set("subscriptions", { data: null, error: null });

      const entitlements = await resolveBusinessEntitlements(BUSINESS_ID);

      expect(canUseFeature(entitlements, "manual_sms")).toBe(manualSms);
      expect(canUseFeature(entitlements, "web_chat")).toBe(webChat);
      expect(canUseFeature(entitlements, "advanced_analytics")).toBe(
        advancedAnalytics
      );
    }
  );
});
