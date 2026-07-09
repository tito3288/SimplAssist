import { stripe } from "./client";
import { createClient } from "@/lib/supabase/server";
import type { SubscriptionPlan } from "@/types/database";

export async function createCheckoutSession(
  businessId: string,
  plan: SubscriptionPlan,
  planPriceId: string,
  setupFeePriceId: string,
  successUrl: string,
  cancelUrl: string,
  mode: "onboarding" | "billing" = "billing"
): Promise<string | null> {
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

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [
      { price: planPriceId, quantity: 1 },
      { price: setupFeePriceId, quantity: 1 },
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
    metadata: {
      business_id: businessId,
      plan,
      mode,
      setup_fee_price_id: setupFeePriceId,
    },
  });

  return session.url;
}

export async function createBillingPortalSession(
  stripeCustomerId: string,
  returnUrl: string
): Promise<string> {
  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl,
  });

  return session.url;
}
