import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
    });
  }
  return stripeInstance;
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
  typescript: true,
});
