import "server-only";

import type Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "./client";
import {
  planFromStripePriceId,
  stripeSetupFeePriceId,
} from "./config";
import type { SubscriptionPlan, SubscriptionStatus } from "@/types/database";

export type SyncedCheckout = {
  businessId: string;
  customerId: string;
  subscriptionId: string;
  plan: SubscriptionPlan;
};

export async function syncCheckoutSession(
  session: Stripe.Checkout.Session
): Promise<SyncedCheckout | null> {
  const businessId = session.metadata?.business_id;
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  if (!businessId || !customerId || !subscriptionId) {
    return null;
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const synced = await syncStripeSubscription(subscription, {
    businessId,
    checkoutSessionId: session.id,
    setupFeePaidAt:
      session.payment_status === "paid" || session.status === "complete"
        ? new Date().toISOString()
        : null,
    setupFeePriceId: session.metadata?.setup_fee_price_id ?? stripeSetupFeePriceId(),
  });

  return synced;
}

export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  options: {
    businessId?: string | null;
    checkoutSessionId?: string | null;
    setupFeePaidAt?: string | null;
    setupFeePriceId?: string | null;
  } = {}
): Promise<SyncedCheckout | null> {
  const businessId = options.businessId ?? subscription.metadata?.business_id;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : null;
  const subscriptionId = subscription.id;
  const primaryItem = subscription.items.data[0];
  const priceId = primaryItem?.price.id ?? null;
  const plan = planFromStripePriceId(priceId);
  // Normalize BEFORE the linkage early-return: an absent/unknown status
  // must throw unconditionally (the guarantee the old route-level guard
  // provided), never be silently acked because linkage also failed to
  // resolve. Valid-status events with unresolvable linkage keep their
  // deliberate null-ack below.
  const status = normalizeStripeSubscriptionStatus(subscription.status);

  if (!businessId || !customerId || !subscriptionId || !plan) {
    return null;
  }
  const periodStart = primaryItem?.current_period_start
    ? new Date(primaryItem.current_period_start * 1000).toISOString()
    : null;
  const periodEnd = primaryItem?.current_period_end
    ? new Date(primaryItem.current_period_end * 1000).toISOString()
    : null;
  const now = new Date().toISOString();

  const { data: synced, error } = await supabaseAdmin.rpc(
    "sync_stripe_subscription_if_business_active",
    {
      p_business_id: businessId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId,
      p_plan: plan,
      p_status: status,
      p_current_period_start: periodStart,
      p_current_period_end: periodEnd,
      p_stripe_price_id: priceId,
      p_stripe_setup_fee_price_id: options.setupFeePriceId ?? null,
      p_stripe_checkout_session_id: options.checkoutSessionId ?? null,
      p_setup_fee_paid_at: options.setupFeePaidAt ?? null,
      p_cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      p_updated_at: now,
    }
  );

  if (error) {
    throw new Error(
      `[stripe:sync] Failed to sync subscription ${subscriptionId} for business ${businessId}: ${error.message}`
    );
  }

  if (synced === false) {
    return null;
  }
  if (synced !== true) {
    throw new Error(
      `[stripe:sync] Guarded sync returned an invalid response for subscription ${subscriptionId} and business ${businessId}`
    );
  }

  return { businessId, customerId, subscriptionId, plan };
}

// Deliberate projection of Stripe's full documented status union onto the
// 4-status local model. Never-successfully-paying states map to 'canceled'
// so consumers route recovery through checkout (the plan cards) — the
// billing portal cannot complete an initial payment. Typed as a complete
// Record over the SDK union: a missing key fails the BUILD when an SDK
// upgrade widens the union, and an absent/unknown runtime status misses
// the lookup and throws below.
const STRIPE_STATUS_PROJECTION: Record<
  Stripe.Subscription.Status,
  SubscriptionStatus
> = {
  active: "active",
  trialing: "trialing",
  past_due: "past_due",
  canceled: "canceled",
  unpaid: "canceled", // dunning exhausted — dead subscription
  incomplete_expired: "canceled", // initial payment never completed
  incomplete: "canceled", // never paid — recovery is checkout, not the portal
  paused: "canceled", // never paid (trial ended without a payment method)
};

export function normalizeStripeSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  const mapped = STRIPE_STATUS_PROJECTION[status];
  if (mapped === undefined) {
    // Fail closed on anything outside Stripe's documented union — including
    // an absent status at runtime (types are compile-time only). Webhook
    // callers surface this as a recorded, re-claimable failure.
    throw new Error(
      `[stripe:sync] Unrecognized Stripe subscription status: ${String(status)}`
    );
  }
  return mapped;
}
