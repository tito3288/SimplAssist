import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  retrieve: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("./client", () => ({
  stripe: { subscriptions: { retrieve: mocks.retrieve } },
}));

import {
  normalizeStripeSubscriptionStatus,
  syncCheckoutSession,
  syncStripeSubscription,
} from "./subscriptionSync";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "cus_test_guard";
const SUBSCRIPTION_ID = "sub_test_guard";

function approvedChatOnlyPrice(
  overrides: Record<string, unknown> = {},
): Stripe.Price {
  return {
    id: "price_chat_only_test",
    active: true,
    type: "recurring",
    currency: "usd",
    unit_amount: 1_000,
    recurring: {
      interval: "month",
      interval_count: 1,
      usage_type: "licensed",
    },
    ...overrides,
  } as unknown as Stripe.Price;
}

function subscription(
  overrides: Record<string, unknown> = {},
): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    customer: CUSTOMER_ID,
    status: "active",
    cancel_at_period_end: false,
    metadata: { business_id: BUSINESS_ID },
    items: {
      data: [
        {
          price: { id: "price_sms_only_test" },
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
        },
      ],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function chatOnlySubscription(
  itemOverrides: Record<string, unknown> = {},
  extraItems: unknown[] = [],
): Stripe.Subscription {
  return subscription({
    items: {
      data: [
        {
          price: approvedChatOnlyPrice(),
          quantity: 1,
          current_period_start: 1_700_000_000,
          current_period_end: 1_702_592_000,
          ...itemOverrides,
        },
        ...extraItems,
      ],
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PRICE_SMS_ONLY", "price_sms_only_test");
  vi.stubEnv("STRIPE_PRICE_SMS_AND_CHAT", "price_sms_chat_test");
  vi.stubEnv("STRIPE_PRICE_FULL", "price_full_test");
  vi.stubEnv("STRIPE_PRICE_CHAT_ONLY", "price_chat_only_test");
  vi.stubEnv("STRIPE_PRICE_SETUP_FEE", "price_setup_test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("syncStripeSubscription", () => {
  it("atomically syncs an active business and returns the launch identity", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const result = await syncStripeSubscription(subscription(), {
      checkoutSessionId: "cs_test_guard",
      setupFeePaidAt: "2026-07-14T12:00:00.000Z",
      setupFeePriceId: "price_setup_test",
    });

    expect(result).toEqual({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({
        p_business_id: BUSINESS_ID,
        p_stripe_customer_id: CUSTOMER_ID,
        p_stripe_subscription_id: SUBSCRIPTION_ID,
        p_plan: "sms_only",
        p_status: "active",
        p_current_period_start: "2023-11-14T22:13:20.000Z",
        p_current_period_end: "2023-12-14T22:13:20.000Z",
        p_stripe_price_id: "price_sms_only_test",
        p_stripe_setup_fee_price_id: "price_setup_test",
        p_stripe_checkout_session_id: "cs_test_guard",
        p_setup_fee_paid_at: "2026-07-14T12:00:00.000Z",
        p_cancel_at_period_end: false,
      }),
    );
  });

  it("returns null when the guarded RPC skips a deleted or tombstoned business", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(syncStripeSubscription(subscription())).resolves.toBeNull();
  });

  it("throws on database failure so Stripe retries the webhook", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "serialization failure" },
    });

    await expect(syncStripeSubscription(subscription())).rejects.toThrow(
      "serialization failure",
    );
  });

  it.each([null, 1, "true", { synced: true }])(
    "rejects malformed guarded-RPC response %#",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      await expect(syncStripeSubscription(subscription())).rejects.toThrow(
        "Guarded sync returned an invalid response",
      );
    },
  );

  it("does not call persistence when required Stripe linkage is absent", async () => {
    const missingBusiness = subscription({ metadata: {} });

    await expect(syncStripeSubscription(missingBusiness)).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong currency", { currency: "cad" }],
    ["wrong amount", { unit_amount: 2_000 }],
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
    "rejects an %s Chat Only Price before persistence",
    async (_label, priceOverrides) => {
      await expect(
        syncStripeSubscription(
          chatOnlySubscription({
            price: approvedChatOnlyPrice(priceOverrides),
          }),
        ),
      ).rejects.toThrow("chat_only_stripe_price_invalid");
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("continues synchronizing an existing Chat subscription after its Price is archived", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    await expect(
      syncStripeSubscription(
        chatOnlySubscription({
          price: approvedChatOnlyPrice({ active: false }),
        }),
      ),
    ).resolves.toMatchObject({ plan: "chat_only" });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects Chat Only quantity other than one before persistence", async () => {
    await expect(
      syncStripeSubscription(chatOnlySubscription({ quantity: 2 })),
    ).rejects.toThrow("chat_only_stripe_price_invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a Chat Only subscription with extra items before persistence", async () => {
    await expect(
      syncStripeSubscription(
        chatOnlySubscription({}, [
          {
            price: { id: "price_unexpected_add_on" },
            quantity: 1,
          },
        ]),
      ),
    ).rejects.toThrow("chat_only_stripe_price_invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects Chat Only when Stripe reports additional paginated items", async () => {
    const chatSubscription = chatOnlySubscription();
    chatSubscription.items.has_more = true;

    await expect(syncStripeSubscription(chatSubscription)).rejects.toThrow(
      "chat_only_stripe_price_invalid",
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("normalizeStripeSubscriptionStatus", () => {
  it.each([
    ["active", "active"],
    ["trialing", "trialing"],
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["unpaid", "canceled"],
    ["incomplete_expired", "canceled"],
    ["incomplete", "canceled"],
    ["paused", "canceled"],
  ] as const)("maps documented status %s to %s", (stripeStatus, local) => {
    expect(normalizeStripeSubscriptionStatus(stripeStatus)).toBe(local);
  });

  it("throws on a status outside Stripe's documented union", () => {
    expect(() =>
      normalizeStripeSubscriptionStatus(
        "some_future_status" as Stripe.Subscription.Status,
      ),
    ).toThrow(/Unrecognized Stripe subscription status: some_future_status/);
  });

  it("throws on an absent status instead of guessing canceled", () => {
    expect(() =>
      normalizeStripeSubscriptionStatus(
        undefined as unknown as Stripe.Subscription.Status,
      ),
    ).toThrow(/Unrecognized Stripe subscription status: undefined/);
  });
});

describe("syncStripeSubscription status mapping", () => {
  it("rejects before persistence when the status is unrecognized", async () => {
    await expect(
      syncStripeSubscription(subscription({ status: "garbage_status" })),
    ).rejects.toThrow(/Unrecognized Stripe subscription status/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized status even when linkage is also unresolvable", async () => {
    // The normalizer runs BEFORE the linkage early-return: a bad status
    // must 500 (retryable), never be silently acked as a linkage skip.
    await expect(
      syncStripeSubscription(
        subscription({ status: "garbage_status", metadata: {} }),
      ),
    ).rejects.toThrow(/Unrecognized Stripe subscription status/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("syncCheckoutSession", () => {
  it("never stamps setup-fee fields for a completed Chat Only checkout", async () => {
    mocks.retrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            {
              price: approvedChatOnlyPrice(),
              quantity: 1,
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      }),
    );
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const session = {
      id: "cs_test_chat_only",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "paid",
      status: "complete",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "chat_only",
        // Defense in depth: even unexpected fee metadata cannot stamp a
        // no-fee plan after the subscription Price resolves Chat Only.
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).resolves.toMatchObject({
      plan: "chat_only",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({
        p_plan: "chat_only",
        p_stripe_setup_fee_price_id: null,
        p_setup_fee_paid_at: null,
      }),
    );
  });

  it("fails closed instead of inventing a setup-fee stamp when SMS checkout metadata is absent", async () => {
    mocks.retrieve.mockResolvedValue(subscription());
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const session = {
      id: "cs_test_sms_missing_fee_metadata",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "paid",
      status: "complete",
      metadata: { business_id: BUSINESS_ID, plan: "sms_only" },
    } as unknown as Stripe.Checkout.Session;

    await syncCheckoutSession(session);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({
        p_plan: "sms_only",
        p_stripe_setup_fee_price_id: null,
        p_setup_fee_paid_at: null,
      }),
    );
  });

  it("returns null when the database guard refuses a stale partner-mode Checkout sync", async () => {
    mocks.retrieve.mockResolvedValue(subscription());
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const session = {
      id: "cs_test_guard",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "paid",
      status: "complete",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "sms_only",
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).resolves.toBeNull();
    expect(mocks.retrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({ p_business_id: BUSINESS_ID }),
    );
  });

  it("returns null without a Stripe call when checkout linkage is incomplete", async () => {
    const session = {
      id: "cs_test_incomplete",
      customer: null,
      subscription: null,
      metadata: { business_id: BUSINESS_ID },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).resolves.toBeNull();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("stamps the setup fee for a 100%-off checkout (no_payment_required + complete)", async () => {
    // A fully-discounted promotion code produces a $0 first invoice: Stripe
    // sets payment_status to "no_payment_required", NOT "paid". Only the
    // `session.status === "complete"` half of the stamping condition covers
    // it — if that clause is ever removed, discounted checkouts leave
    // setup_fee_paid_at null and isBillingReady blocks launch forever.
    mocks.retrieve.mockResolvedValue(subscription());
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const session = {
      id: "cs_test_promo_zero",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "no_payment_required",
      status: "complete",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "sms_only",
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).resolves.toEqual({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({
        p_setup_fee_paid_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      }),
    );
  });

  it("does not stamp the setup fee for a session that never completed", async () => {
    // The boundary of the stamping condition: an abandoned/open session
    // (neither paid nor complete) must sync with a null setup-fee stamp.
    mocks.retrieve.mockResolvedValue(subscription());
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    const session = {
      id: "cs_test_open",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "unpaid",
      status: "open",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "sms_only",
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await syncCheckoutSession(session);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({ p_setup_fee_paid_at: null }),
    );
  });

  it.each([undefined, "", "starter", "CHAT_ONLY"])(
    "rejects missing or malformed signed Checkout plan metadata %j before Stripe or persistence",
    async (plan) => {
      const session = {
        id: "cs_test_invalid_plan_metadata",
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
        payment_status: "paid",
        status: "complete",
        metadata: { business_id: BUSINESS_ID, plan },
      } as unknown as Stripe.Checkout.Session;

      await expect(syncCheckoutSession(session)).rejects.toThrow(
        /missing or invalid plan metadata/,
      );
      expect(mocks.retrieve).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects signed Chat metadata when the subscription Price resolves to SMS", async () => {
    mocks.retrieve.mockResolvedValue(subscription());
    const session = {
      id: "cs_test_mismatched_plan",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "paid",
      status: "complete",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "chat_only",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).rejects.toThrow(
      /Checkout plan metadata chat_only does not match subscription Price plan sms_only/,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects signed SMS metadata when the subscription Price resolves to Chat", async () => {
    mocks.retrieve.mockResolvedValue(
      subscription({
        items: {
          data: [
            {
              price: approvedChatOnlyPrice(),
              quantity: 1,
              current_period_start: 1_700_000_000,
              current_period_end: 1_702_592_000,
            },
          ],
        },
      }),
    );
    const session = {
      id: "cs_test_mismatched_plan_inverse",
      customer: CUSTOMER_ID,
      subscription: SUBSCRIPTION_ID,
      payment_status: "paid",
      status: "complete",
      metadata: {
        business_id: BUSINESS_ID,
        plan: "sms_only",
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).rejects.toThrow(
      /Checkout plan metadata sms_only does not match subscription Price plan chat_only/,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
