import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createCustomer: vi.fn(),
  createCheckoutSession: vi.fn(),
  createBillingPortalSession: vi.fn(),
  retrievePrice: vi.fn(),
  claimCheckoutPlanFamily: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: mocks.from })),
}));
vi.mock("@/lib/billing/planFamilyLock.server", () => ({
  claimCheckoutPlanFamily: mocks.claimCheckoutPlanFamily,
}));
vi.mock("./client", () => ({
  stripe: {
    prices: { retrieve: mocks.retrievePrice },
    customers: { create: mocks.createCustomer },
    checkout: { sessions: { create: mocks.createCheckoutSession } },
    billingPortal: {
      sessions: { create: mocks.createBillingPortalSession },
    },
  },
}));

import { createBillingPortalSession, createCheckoutSession } from "./checkout";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const SUCCESS_URL =
  "https://simplassist.com/onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}";
const CANCEL_URL = "https://simplassist.com/onboarding?checkout=canceled";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation((table: string) => {
    const result =
      table === "subscriptions"
        ? { data: { stripe_customer_id: "cus_existing" }, error: null }
        : { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.single = vi.fn(async () => result);
    return chain;
  });
  mocks.createCheckoutSession.mockResolvedValue({
    url: "https://checkout.stripe.test/session",
  });
  mocks.retrievePrice.mockResolvedValue({
    id: "price_chat_only",
    active: true,
    type: "recurring",
    currency: "usd",
    unit_amount: 1_000,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
  });
  mocks.claimCheckoutPlanFamily.mockResolvedValue(undefined);
  mocks.createBillingPortalSession.mockResolvedValue({
    url: "https://billing.stripe.test/session",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createCheckoutSession existing SMS-plan contract", () => {
  it.each([
    ["sms_only", "price_starter"],
    ["sms_and_chat", "price_growth"],
    ["full", "price_full"],
  ] as const)(
    "keeps the recurring %s Price and one-time setup Price as exact line items",
    async (plan, planPriceId) => {
      await expect(
        createCheckoutSession(
          BUSINESS_ID,
          plan,
          planPriceId,
          "price_setup",
          SUCCESS_URL,
          CANCEL_URL,
          "onboarding",
          true,
        ),
      ).resolves.toBe("https://checkout.stripe.test/session");

      expect(mocks.createCustomer).not.toHaveBeenCalled();
      expect(mocks.retrievePrice).not.toHaveBeenCalled();
      expect(mocks.claimCheckoutPlanFamily).toHaveBeenCalledWith(
        BUSINESS_ID,
        plan,
        true,
      );
      expect(mocks.createCheckoutSession).toHaveBeenCalledOnce();
      expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
        customer: "cus_existing",
        mode: "subscription",
        allow_promotion_codes: true,
        line_items: [
          { price: planPriceId, quantity: 1 },
          { price: "price_setup", quantity: 1 },
        ],
        success_url: SUCCESS_URL,
        cancel_url: CANCEL_URL,
        subscription_data: {
          metadata: {
            business_id: BUSINESS_ID,
            plan,
            mode: "onboarding",
          },
        },
        metadata: {
          business_id: BUSINESS_ID,
          plan,
          mode: "onboarding",
          setup_fee_price_id: "price_setup",
        },
      });
    },
  );

  it("creates Chat Only with exactly one recurring line and no setup-fee metadata", async () => {
    await expect(
      createCheckoutSession(
        BUSINESS_ID,
        "chat_only",
        "price_chat_only",
        null,
        SUCCESS_URL,
        CANCEL_URL,
        "onboarding",
        true,
      ),
    ).resolves.toBe("https://checkout.stripe.test/session");

    expect(mocks.retrievePrice).toHaveBeenCalledWith("price_chat_only");
    expect(mocks.claimCheckoutPlanFamily).toHaveBeenCalledWith(
      BUSINESS_ID,
      "chat_only",
      true,
    );
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      customer: "cus_existing",
      mode: "subscription",
      allow_promotion_codes: true,
      line_items: [{ price: "price_chat_only", quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      subscription_data: {
        metadata: {
          business_id: BUSINESS_ID,
          plan: "chat_only",
          mode: "onboarding",
        },
      },
      metadata: {
        business_id: BUSINESS_ID,
        plan: "chat_only",
        mode: "onboarding",
      },
    });
  });

  it.each([
    ["inactive", { active: false }],
    ["wrong currency", { currency: "eur" }],
    ["wrong amount", { unit_amount: 999 }],
    ["one-time", { type: "one_time", recurring: null }],
    [
      "annual",
      {
        recurring: {
          interval: "year",
          interval_count: 1,
          usage_type: "licensed",
        },
      },
    ],
    [
      "multi-month",
      {
        recurring: {
          interval: "month",
          interval_count: 2,
          usage_type: "licensed",
        },
      },
    ],
    [
      "metered",
      {
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "metered",
        },
      },
    ],
  ])(
    "fails closed before the family claim, database, customer, or session for an %s Chat Price",
    async (_label, override) => {
      mocks.retrievePrice.mockResolvedValue({
        id: "price_chat_only",
        active: true,
        type: "recurring",
        currency: "usd",
        unit_amount: 1_000,
        recurring: {
          interval: "month",
          interval_count: 1,
          usage_type: "licensed",
        },
        ...override,
      });

      await expect(
        createCheckoutSession(
          BUSINESS_ID,
          "chat_only",
          "price_chat_only",
          null,
          SUCCESS_URL,
          CANCEL_URL,
          "onboarding",
        ),
      ).rejects.toThrow("chat_only_stripe_price_invalid");

      expect(mocks.claimCheckoutPlanFamily).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.createCustomer).not.toHaveBeenCalled();
      expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
    },
  );

  it("fails before any database/customer/session work when the family claim is rejected", async () => {
    mocks.claimCheckoutPlanFamily.mockRejectedValue(
      new Error("plan_family_transition_not_supported"),
    );

    await expect(
      createCheckoutSession(
        BUSINESS_ID,
        "chat_only",
        "price_chat_only",
        null,
        SUCCESS_URL,
        CANCEL_URL,
        "onboarding",
        true,
      ),
    ).rejects.toThrow("plan_family_transition_not_supported");

    expect(mocks.retrievePrice).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.createCustomer).not.toHaveBeenCalled();
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects setup-fee metadata for Chat Only before Stripe or the family claim", async () => {
    await expect(
      createCheckoutSession(
        BUSINESS_ID,
        "chat_only",
        "price_chat_only",
        "price_setup",
        SUCCESS_URL,
        CANCEL_URL,
        "onboarding",
      ),
    ).rejects.toThrow("chat_only_stripe_price_invalid");

    expect(mocks.retrievePrice).not.toHaveBeenCalled();
    expect(mocks.claimCheckoutPlanFamily).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("createBillingPortalSession configuration pin", () => {
  it("pins every session to the reviewed Billing Portal configuration", async () => {
    vi.stubEnv(
      "STRIPE_BILLING_PORTAL_CONFIGURATION_ID",
      "bpc_1UnitPortalConfiguration",
    );

    await expect(
      createBillingPortalSession(
        "cus_portal_unit",
        "https://simplassist.com/billing",
      ),
    ).resolves.toBe("https://billing.stripe.test/session");

    expect(mocks.createBillingPortalSession).toHaveBeenCalledOnce();
    expect(mocks.createBillingPortalSession).toHaveBeenCalledWith({
      customer: "cus_portal_unit",
      return_url: "https://simplassist.com/billing",
      configuration: "bpc_1UnitPortalConfiguration",
    });
  });

  it("fails closed before Stripe when the configuration pin is missing", async () => {
    vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", "");

    await expect(
      createBillingPortalSession(
        "cus_portal_unit",
        "https://simplassist.com/billing",
      ),
    ).rejects.toThrow("STRIPE_BILLING_PORTAL_CONFIGURATION_ID is required");
    expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
  });

  it.each([
    "bpc_",
    "pc_wrong_prefix",
    "bpc_contains-hyphen",
    " bpc_1LeadingWhitespace",
  ])(
    "fails closed before Stripe for invalid configuration value %s",
    async (configurationId) => {
      vi.stubEnv("STRIPE_BILLING_PORTAL_CONFIGURATION_ID", configurationId);

      await expect(
        createBillingPortalSession(
          "cus_portal_unit",
          "https://simplassist.com/billing",
        ),
      ).rejects.toThrow(
        "STRIPE_BILLING_PORTAL_CONFIGURATION_ID must be a Stripe Billing Portal configuration ID (bpc_...)",
      );
      expect(mocks.createBillingPortalSession).not.toHaveBeenCalled();
    },
  );
});
