import "server-only";

import { stripe } from "./client";
import { createClient } from "@/lib/supabase/server";
import { claimCheckoutPlanFamily } from "@/lib/billing/planFamilyLock.server";
import type { SubscriptionPlan } from "@/types/database";
import {
  assertApprovedChatOnlyStripePrice,
  ChatOnlyStripePriceConfigurationError,
} from "./chatOnlyPrice";

export { ChatOnlyStripePriceConfigurationError } from "./chatOnlyPrice";

const BILLING_PORTAL_CONFIGURATION_ENV =
  "STRIPE_BILLING_PORTAL_CONFIGURATION_ID";
const BILLING_PORTAL_CONFIGURATION_ID_PATTERN = /^bpc_[A-Za-z0-9]+$/;

function billingPortalConfigurationId(): string {
  const configurationId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID;

  if (!configurationId) {
    throw new Error(`${BILLING_PORTAL_CONFIGURATION_ENV} is required`);
  }

  if (!BILLING_PORTAL_CONFIGURATION_ID_PATTERN.test(configurationId)) {
    throw new Error(
      `${BILLING_PORTAL_CONFIGURATION_ENV} must be a Stripe Billing Portal configuration ID (bpc_...)`,
    );
  }

  return configurationId;
}

export async function createCheckoutSession(
  businessId: string,
  plan: SubscriptionPlan,
  planPriceId: string,
  setupFeePriceId: string | null,
  successUrl: string,
  cancelUrl: string,
  mode: "onboarding" | "billing" = "billing",
  requireOnboardingIntent = false,
): Promise<string | null> {
  if (plan === "chat_only") {
    if (setupFeePriceId !== null) {
      throw new ChatOnlyStripePriceConfigurationError();
    }
    await assertChatOnlyStripePrice(planPriceId);
  }

  // The claim is deliberately made before reading/creating a Stripe customer
  // or Checkout Session. It is a durable family boundary: once Checkout has
  // started, a canceled session remains locked to that family until a future
  // reviewed lifecycle flow can prove that switching is safe.
  await claimCheckoutPlanFamily(businessId, plan, requireOnboardingIntent);

  const supabase = await createClient();

  // Check if business already has a Stripe customer
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("business_id", businessId)
    .single();

  let customerId = subscription?.stripe_customer_id;

  if (!customerId) {
    // Look up business info for the customer record
    const { data: business } = await supabase
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single();

    const customer = await stripe.customers.create({
      metadata: { business_id: businessId },
      name: business?.name ?? undefined,
    });
    customerId = customer.id;
  }

  const sessionMetadata: Record<string, string> = {
    business_id: businessId,
    plan,
    mode,
  };
  if (setupFeePriceId) {
    sessionMetadata.setup_fee_price_id = setupFeePriceId;
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    // Shows the optional "Add promotion code" field at checkout. The codes
    // themselves (friends/colleagues incentives) are created and managed
    // entirely in the Stripe dashboard. A 100%-off redemption produces a $0
    // first invoice with payment_status "no_payment_required" — the setup-fee
    // stamp in subscriptionSync relies on `session.status === "complete"` for
    // that case (pinned by a regression test).
    allow_promotion_codes: true,
    line_items: [
      { price: planPriceId, quantity: 1 },
      ...(setupFeePriceId ? [{ price: setupFeePriceId, quantity: 1 }] : []),
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      metadata: {
        business_id: businessId,
        plan,
        mode,
      },
    },
    metadata: sessionMetadata,
  });

  return session.url;
}

async function assertChatOnlyStripePrice(priceId: string): Promise<void> {
  const price = await stripe.prices.retrieve(priceId);
  assertApprovedChatOnlyStripePrice(price, {
    expectedPriceId: priceId,
    requireActive: true,
  });
}

export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string,
): Promise<string> {
  const configurationId = billingPortalConfigurationId();
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
    configuration: configurationId,
  });

  return session.url;
}
