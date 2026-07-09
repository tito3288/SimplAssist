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
  const { data: existing } = await supabaseAdmin
    .from("subscriptions")
    .select("stripe_setup_fee_price_id, stripe_checkout_session_id, setup_fee_paid_at")
    .eq("business_id", businessId)
    .maybeSingle<{
      stripe_setup_fee_price_id: string | null;
      stripe_checkout_session_id: string | null;
      setup_fee_paid_at: string | null;
    }>();

  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      business_id: businessId,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      stripe_price_id: priceId,
      stripe_setup_fee_price_id:
        options.setupFeePriceId ?? existing?.stripe_setup_fee_price_id ?? null,
      stripe_checkout_session_id:
        options.checkoutSessionId ?? existing?.stripe_checkout_session_id ?? null,
      setup_fee_paid_at:
        options.setupFeePaidAt ?? existing?.setup_fee_paid_at ?? null,
      plan,
      status,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(subscription.cancel_at_period_end),
      pending_plan: null,
      updated_at: now,
    },
    { onConflict: "business_id" }
  );

  if (error) {
    throw new Error(
      `[stripe:sync] Failed to sync subscription ${subscriptionId} for business ${businessId}: ${error.message}`
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
