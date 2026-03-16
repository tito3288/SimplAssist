import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

// Use service role client since webhooks don't have user auth
function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const businessId = session.metadata?.business_id;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (!businessId) break;

        // Retrieve subscription to get plan details and period
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = sub.items.data[0]?.price.id;

        // Determine plan from price ID
        const { STRIPE_PRICE_IDS } = await import("@/lib/stripe/config");
        let plan: string = "sms_only";
        for (const [key, value] of Object.entries(STRIPE_PRICE_IDS)) {
          if (value === priceId) {
            plan = key;
            break;
          }
        }

        await supabase.from("subscriptions").upsert(
          {
            business_id: businessId,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan,
            status: "active",
            current_period_start: new Date(
              sub.items.data[0].current_period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              sub.items.data[0].current_period_end * 1000
            ).toISOString(),
          },
          { onConflict: "business_id" }
        );
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        await supabase
          .from("subscriptions")
          .update({
            status: sub.status === "active" ? "active" : sub.status,
            current_period_start: new Date(
              sub.items.data[0].current_period_start * 1000
            ).toISOString(),
            current_period_end: new Date(
              sub.items.data[0].current_period_end * 1000
            ).toISOString(),
          })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        await supabase
          .from("subscriptions")
          .update({ status: "canceled" })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("stripe_customer_id", customerId);
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
