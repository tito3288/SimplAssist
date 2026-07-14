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

  if (!businessId || !customerId || !subscriptionId || !plan) {
    return null;
  }

  const status = normalizeStripeSubscriptionStatus(subscription.status);
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

export function normalizeStripeSubscriptionStatus(
  status: Stripe.Subscription.Status
): SubscriptionStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due") return "past_due";
  return "canceled";
}
