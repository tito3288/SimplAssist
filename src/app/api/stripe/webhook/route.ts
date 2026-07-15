import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  syncCheckoutSession,
  syncStripeSubscription,
} from "@/lib/stripe/subscriptionSync";
import { attemptPaidLaunch } from "@/lib/billing/launch";

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
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const claimed = await claimStripeEvent(event);
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    await processStripeEvent(event);
    await markStripeEventProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    await markStripeEventFailed(event.id, errorMessage(error));
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}

async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.id.startsWith("cs_test_")) {
        throw new Error("Live-mode Checkout Sessions are disabled for Phase 9");
      }
      const synced = await syncCheckoutSession(session);
      if (synced) {
        await attemptPaidLaunch(synced.businessId, "stripe_webhook");
      }
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      await syncStripeSubscription(event.data.object as Stripe.Subscription);
      return;
    }

    case "customer.subscription.deleted": {
      await syncStripeSubscription(event.data.object as Stripe.Subscription);
      return;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId = resolveInvoiceSubscriptionId(invoice);
      if (!subscriptionId) return;
      // The invoice payload carries no subscription status, so recovery reads
      // the real status from Stripe and passes it through unchanged. An
      // absent status throws instead of syncing: the normalizer maps unknown
      // statuses to 'canceled', and writing that guess would strand a
      // recovered payer behind the subscription gate. (Failed events
      // dead-letter in stripe_webhook_events — same-id retries dedup to
      // 200; CAS re-claim support is a queued follow-up.)
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (!subscription.status) {
        throw new Error(
          `[stripe:webhook] Retrieved subscription ${subscriptionId} has no status; refusing to sync a guessed status`
        );
      }
      await syncStripeSubscription(subscription);
      return;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
      if (!customerId) return;

      const { data: updated, error } = await supabaseAdmin.rpc(
        "mark_stripe_subscription_past_due_if_business_active",
        {
          p_stripe_customer_id: customerId,
          p_updated_at: new Date().toISOString(),
        }
      );

      if (error) {
        throw new Error(
          `[stripe:webhook] Failed to mark customer ${customerId} past_due: ${error.message}`
        );
      }

      if (updated === false) {
        return;
      }
      if (updated !== true) {
        throw new Error(
          `[stripe:webhook] Guarded past-due update returned an invalid response for customer ${customerId}`
        );
      }

      return;
    }

    default:
      return;
  }
}

async function claimStripeEvent(event: Stripe.Event): Promise<boolean> {
  const { error } = await supabaseAdmin.from("stripe_webhook_events").insert({
    id: event.id,
    event_type: event.type,
  });

  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(
    `[stripe:webhook] Failed to claim event ${event.id}: ${error.message}`
  );
}

async function markStripeEventProcessed(eventId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ processed_at: new Date().toISOString(), processing_error: null })
    .eq("id", eventId);

  if (error) {
    console.error(
      `[stripe:webhook] Failed to mark event ${eventId} processed:`,
      error
    );
  }
}

async function markStripeEventFailed(
  eventId: string,
  message: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("stripe_webhook_events")
    .update({ processing_error: message })
    .eq("id", eventId);

  if (error) {
    console.error(`[stripe:webhook] Failed to mark event ${eventId} failed:`, error);
  }
}

function resolveInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const legacySubscription = (invoice as Stripe.Invoice & { subscription?: unknown })
    .subscription;
  const id =
    typeof legacySubscription === "string"
      ? legacySubscription
      : typeof invoice.parent?.subscription_details?.subscription === "string"
        ? invoice.parent.subscription_details.subscription
        : null;
  return id;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
