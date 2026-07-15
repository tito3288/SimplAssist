import { NextRequest } from "next/server";
import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  retrieve: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  rpc: vi.fn(),
  syncCheckoutSession: vi.fn(),
  syncStripeSubscription: vi.fn(),
  attemptPaidLaunch: vi.fn(),
}));

vi.mock("@/lib/stripe/client", () => ({
  stripe: {
    webhooks: { constructEvent: mocks.constructEvent },
    subscriptions: { retrieve: mocks.retrieve },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock("@/lib/stripe/subscriptionSync", () => ({
  syncCheckoutSession: mocks.syncCheckoutSession,
  syncStripeSubscription: mocks.syncStripeSubscription,
}));
vi.mock("@/lib/billing/launch", () => ({
  attemptPaidLaunch: mocks.attemptPaidLaunch,
}));

import { POST as stripeWebhook } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CUSTOMER_ID = "cus_test_webhook";
const SUBSCRIPTION_ID = "sub_test_webhook";

function event(
  type: Stripe.Event.Type,
  object: Record<string, unknown>,
  id = `evt_test_${type.replaceAll(".", "_")}`
): Stripe.Event {
  return {
    id,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

function request(withSignature = true) {
  const headers = new Headers();
  if (withSignature) headers.set("stripe-signature", "test-signature");
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers,
    body: "{}",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test_only");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.insert.mockResolvedValue({ error: null });
  mocks.eq.mockResolvedValue({ error: null });
  mocks.update.mockImplementation(() => ({ eq: mocks.eq }));
  mocks.from.mockReturnValue({
    insert: mocks.insert,
    update: mocks.update,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/stripe/webhook", () => {
  it("requires a Stripe signature before claiming an event", async () => {
    const response = await stripeWebhook(request(false));

    expect(response.status).toBe(400);
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("acknowledges a deleted-business checkout skip without attempting paid launch", async () => {
    const checkoutEvent = event("checkout.session.completed", {
      id: "cs_test_deleted_business",
    });
    mocks.constructEvent.mockReturnValue(checkoutEvent);
    mocks.syncCheckoutSession.mockResolvedValue(null);

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.syncCheckoutSession).toHaveBeenCalled();
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        processed_at: expect.any(String),
        processing_error: null,
      })
    );
  });

  it("attempts paid launch only when checkout synchronization returns an active business", async () => {
    const checkoutEvent = event("checkout.session.completed", {
      id: "cs_test_active_business",
    });
    mocks.constructEvent.mockReturnValue(checkoutEvent);
    mocks.syncCheckoutSession.mockResolvedValue({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
      BUSINESS_ID,
      "stripe_webhook"
    );
  });

  it("acknowledges a guarded invoice-failure skip for a deleted business", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_failed", { customer: CUSTOMER_ID })
    );
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mark_stripe_subscription_past_due_if_business_active",
      expect.objectContaining({ p_stripe_customer_id: CUSTOMER_ID })
    );
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) })
    );
  });

  it("returns 500 and records failure when guarded invoice persistence errors", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_failed", { customer: CUSTOMER_ID })
    );
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "serialization failure" },
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.update).toHaveBeenCalledWith({
      processing_error: expect.stringContaining("serialization failure"),
    });
  });

  it.each([null, 1, "true", { updated: true }])(
    "returns 500 for malformed invoice guard response %#",
    async (data) => {
      mocks.constructEvent.mockReturnValue(
        event("invoice.payment_failed", { customer: CUSTOMER_ID })
      );
      mocks.rpc.mockResolvedValue({ data, error: null });

      const response = await stripeWebhook(request());

      expect(response.status).toBe(500);
      expect(mocks.update).toHaveBeenCalledWith({
        processing_error: expect.stringContaining(
          "Guarded past-due update returned an invalid response"
        ),
      });
    }
  );

  it("acknowledges subscription sync null so post-scrub events do not retry forever", async () => {
    const subscription = { id: SUBSCRIPTION_ID };
    mocks.constructEvent.mockReturnValue(
      event("customer.subscription.updated", subscription)
    );
    mocks.syncStripeSubscription.mockResolvedValue(null);

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(subscription);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) })
    );
  });

  it("acknowledges duplicate event claims without running business logic", async () => {
    const subscriptionEvent = event("customer.subscription.updated", {
      id: SUBSCRIPTION_ID,
    });
    mocks.constructEvent.mockReturnValue(subscriptionEvent);
    mocks.insert.mockResolvedValue({
      error: { code: "23505", message: "duplicate key" },
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      received: true,
      duplicate: true,
    });
    expect(mocks.syncStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("ignores invoice failures without a string customer id", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_failed", { customer: null })
    );

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ignores payment successes without a resolvable subscription id", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_succeeded", { customer: CUSTOMER_ID })
    );

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.syncStripeSubscription).not.toHaveBeenCalled();
  });

  it("recovers payment success by retrieving the subscription and writing its real status", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_succeeded", {
        customer: CUSTOMER_ID,
        // Legacy invoice shape: subscription id on the invoice root.
        subscription: SUBSCRIPTION_ID,
      })
    );
    // Payment success alone never fabricates a status — whatever Stripe
    // reports (here still past_due) is what gets written.
    const retrieved = { id: SUBSCRIPTION_ID, status: "past_due" };
    mocks.retrieve.mockResolvedValue(retrieved);
    mocks.syncStripeSubscription.mockResolvedValue({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(retrieved);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) })
    );
  });

  it("writes active when the retrieved subscription is active (modern invoice shape)", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_succeeded", {
        customer: CUSTOMER_ID,
        parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
      })
    );
    const retrieved = { id: SUBSCRIPTION_ID, status: "active" };
    mocks.retrieve.mockResolvedValue(retrieved);
    mocks.syncStripeSubscription.mockResolvedValue({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.retrieve).toHaveBeenCalledWith(SUBSCRIPTION_ID);
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" })
    );
  });

  it("returns 500 when the recovery retrieve fails so Stripe retries", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_succeeded", {
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
      })
    );
    mocks.retrieve.mockRejectedValue(new Error("stripe unreachable"));

    const response = await stripeWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.syncStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      processing_error: expect.stringContaining("stripe unreachable"),
    });
  });

  it("returns 500 instead of guessing when the retrieved subscription has no status", async () => {
    mocks.constructEvent.mockReturnValue(
      event("invoice.payment_succeeded", {
        customer: CUSTOMER_ID,
        subscription: SUBSCRIPTION_ID,
      })
    );
    mocks.retrieve.mockResolvedValue({ id: SUBSCRIPTION_ID });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.syncStripeSubscription).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith({
      processing_error: expect.stringContaining("has no status"),
    });
  });

  it("restores active after the past_due then paid production sequence", async () => {
    // 1. invoice.payment_failed marks the business past_due via the guard.
    mocks.constructEvent.mockReturnValueOnce(
      event("invoice.payment_failed", { customer: CUSTOMER_ID })
    );
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const failed = await stripeWebhook(request());

    expect(failed.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "mark_stripe_subscription_past_due_if_business_active",
      expect.objectContaining({ p_stripe_customer_id: CUSTOMER_ID })
    );

    // 2. The customer fixes their card; invoice.payment_succeeded restores
    //    the real Stripe status (active) through the guarded sync.
    mocks.constructEvent.mockReturnValueOnce(
      event("invoice.payment_succeeded", {
        customer: CUSTOMER_ID,
        parent: { subscription_details: { subscription: SUBSCRIPTION_ID } },
      })
    );
    const retrieved = { id: SUBSCRIPTION_ID, status: "active" };
    mocks.retrieve.mockResolvedValue(retrieved);
    mocks.syncStripeSubscription.mockResolvedValue({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });

    const paid = await stripeWebhook(request());

    expect(paid.status).toBe(200);
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" })
    );
  });

  it("passes a lapsed subscription through the guarded sync for an active business", async () => {
    const subscription = { id: SUBSCRIPTION_ID, status: "canceled" };
    mocks.constructEvent.mockReturnValue(
      event("customer.subscription.deleted", subscription)
    );
    mocks.syncStripeSubscription.mockResolvedValue({
      businessId: BUSINESS_ID,
      customerId: CUSTOMER_ID,
      subscriptionId: SUBSCRIPTION_ID,
      plan: "sms_only",
    });

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(subscription);
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ processed_at: expect.any(String) })
    );
  });

  it("acknowledges a deleted-business lapse skip so the deletion flow keeps terminal ownership", async () => {
    const subscription = { id: SUBSCRIPTION_ID, status: "canceled" };
    mocks.constructEvent.mockReturnValue(
      event("customer.subscription.deleted", subscription)
    );
    mocks.syncStripeSubscription.mockResolvedValue(null);

    const response = await stripeWebhook(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ received: true });
    expect(mocks.syncStripeSubscription).toHaveBeenCalledWith(subscription);
  });
});
