import Stripe from "stripe";
import { validateStripeEnv } from "./config";

let stripeInstance: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    validateStripeEnv();
    stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-02-25.clover",
      typescript: true,
      maxNetworkRetries: 2,
    });
  }
  return stripeInstance;
}

validateStripeEnv();
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-02-25.clover",
  typescript: true,
  maxNetworkRetries: 2,
});
