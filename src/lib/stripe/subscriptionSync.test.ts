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

function subscription(
  overrides: Record<string, unknown> = {}
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_PRICE_SMS_ONLY", "price_sms_only_test");
  vi.stubEnv("STRIPE_PRICE_SMS_AND_CHAT", "price_sms_chat_test");
  vi.stubEnv("STRIPE_PRICE_FULL", "price_full_test");
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
      })
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
      "serialization failure"
    );
  });

  it.each([null, 1, "true", { synced: true }])(
    "rejects malformed guarded-RPC response %#",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      await expect(syncStripeSubscription(subscription())).rejects.toThrow(
        "Guarded sync returned an invalid response"
      );
    }
  );

  it("does not call persistence when required Stripe linkage is absent", async () => {
    const missingBusiness = subscription({ metadata: {} });

    await expect(syncStripeSubscription(missingBusiness)).resolves.toBeNull();
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
        "some_future_status" as Stripe.Subscription.Status
      )
    ).toThrow(/Unrecognized Stripe subscription status: some_future_status/);
  });

  it("throws on an absent status instead of guessing canceled", () => {
    expect(() =>
      normalizeStripeSubscriptionStatus(
        undefined as unknown as Stripe.Subscription.Status
      )
    ).toThrow(/Unrecognized Stripe subscription status: undefined/);
  });
});

describe("syncStripeSubscription status mapping", () => {
  it("rejects before persistence when the status is unrecognized", async () => {
    await expect(
      syncStripeSubscription(subscription({ status: "garbage_status" }))
    ).rejects.toThrow(/Unrecognized Stripe subscription status/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized status even when linkage is also unresolvable", async () => {
    // The normalizer runs BEFORE the linkage early-return: a bad status
    // must 500 (retryable), never be silently acked as a linkage skip.
    await expect(
      syncStripeSubscription(
        subscription({ status: "garbage_status", metadata: {} })
      )
    ).rejects.toThrow(/Unrecognized Stripe subscription status/);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("syncCheckoutSession", () => {
  it("propagates a guarded skip as null after retrieving the subscription", async () => {
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
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await expect(syncCheckoutSession(session)).resolves.toBeNull();
    expect(mocks.retrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
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
      })
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
        setup_fee_price_id: "price_setup_test",
      },
    } as unknown as Stripe.Checkout.Session;

    await syncCheckoutSession(session);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "sync_stripe_subscription_if_business_active",
      expect.objectContaining({ p_setup_fee_paid_at: null })
    );
  });
});
