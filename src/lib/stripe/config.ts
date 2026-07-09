import type { SubscriptionPlan } from "@/types/database";

export const SETUP_FEE_CENTS = 2500;
export const SMS_OVERAGE_CENTS = 3;

export const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlan,
  { name: string; price: number; includedSmsParts: number; features: string[] }
> = {
  sms_only: {
    name: "Starter / SMS Only",
    price: 25,
    includedSmsParts: 500,
    features: [
      "AI missed-call texting",
      "500 included SMS parts/month",
      "Contact management",
      "Conversation inbox",
    ],
  },
  sms_and_chat: {
    name: "Growth / SMS + Web Chat",
    price: 45,
    includedSmsParts: 1500,
    features: [
      "Everything in SMS Only",
      "Website chat widget",
      "Custom widget branding",
      "Lead capture from web chat",
      "1,500 included SMS parts/month",
    ],
  },
  full: {
    name: "Pro / Full Suite",
    price: 65,
    includedSmsParts: 2500,
    features: [
      "Everything in SMS + Web Chat",
      "Review requests",
      "Appointment booking",
      "Analytics dashboard",
      "Weekly email summary",
      "2,500 included SMS parts/month",
    ],
  },
};

const PLAN_PRICE_ENV: Record<SubscriptionPlan, string> = {
  sms_only: "STRIPE_PRICE_SMS_ONLY",
  sms_and_chat: "STRIPE_PRICE_SMS_AND_CHAT",
  full: "STRIPE_PRICE_FULL",
};

export function stripePriceIds(): Record<SubscriptionPlan, string> {
  return {
    sms_only: readTestPriceId(PLAN_PRICE_ENV.sms_only),
    sms_and_chat: readTestPriceId(PLAN_PRICE_ENV.sms_and_chat),
    full: readTestPriceId(PLAN_PRICE_ENV.full),
  };
}

export function stripeSetupFeePriceId(): string {
  return readTestPriceId("STRIPE_PRICE_SETUP_FEE");
}

export function stripeSmsOveragePriceId(): string {
  return readTestPriceId("STRIPE_PRICE_SMS_OVERAGE_PART");
}

export function planFromStripePriceId(priceId: string | null | undefined): SubscriptionPlan | null {
  if (!priceId) return null;
  const ids = stripePriceIds();
  const match = (Object.entries(ids) as [SubscriptionPlan, string][]).find(
    ([, id]) => id === priceId
  );
  return match?.[0] ?? null;
}

export function validateStripeTestModeEnv(): void {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
  if (!secret.startsWith("sk_test_")) {
    throw new Error(
      "Stripe live-mode keys are disabled for Phase 9. Use STRIPE_SECRET_KEY=sk_test_... until live mode is explicitly enabled."
    );
  }
}

function readTestPriceId(envName: string): string {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`${envName} is required`);
  }
  if (!value.startsWith("price_")) {
    throw new Error(`${envName} must be a Stripe Price ID`);
  }
  return value;
}
