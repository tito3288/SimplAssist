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
});
