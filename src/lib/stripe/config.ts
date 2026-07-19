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
      "One local SimplAssist number",
      "Automatic missed-call text",
      "Manual SMS inbox and replies",
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
      "Full AI SMS conversations",
      "Website chat widget",
      "Custom widget branding",
      "Lead capture from web chat",
      "AI answer, tone, FAQ, and service customization",
      "Google Calendar connection",
      "AI appointment scheduling",
      "1,500 included SMS parts/month",
    ],
  },
  full: {
    name: "Pro / Full Suite",
    price: 65,
    includedSmsParts: 2500,
    features: [
      "Everything in SMS + Web Chat",
      "Advanced AI guardrails",
      "Advanced analytics dashboard",
      "Lead-to-appointment conversion reporting",
      "Weekly performance summary",
      "Real-time new-lead alerts",
      "Review-request workflow",
      "Automated follow-up and no-show workflows",
      "Priority support",
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
    sms_only: readPriceId(PLAN_PRICE_ENV.sms_only),
    sms_and_chat: readPriceId(PLAN_PRICE_ENV.sms_and_chat),
    full: readPriceId(PLAN_PRICE_ENV.full),
  };
}

export function stripeSetupFeePriceId(): string {
  return readPriceId("STRIPE_PRICE_SETUP_FEE");
}

export function stripeSmsOveragePriceId(): string {
  return readPriceId("STRIPE_PRICE_SMS_OVERAGE_PART");
}

export function planFromStripePriceId(priceId: string | null | undefined): SubscriptionPlan | null {
  if (!priceId) return null;
  const ids = stripePriceIds();
  const match = (Object.entries(ids) as [SubscriptionPlan, string][]).find(
    ([, id]) => id === priceId
  );
  return match?.[0] ?? null;
}

export function validateStripeEnv(): void {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) {
    throw new Error("STRIPE_SECRET_KEY is required");
  }
}

function readPriceId(envName: string): string {
  const value = process.env[envName];
  if (!value) {
    throw new Error(`${envName} is required`);
  }
  if (!value.startsWith("price_")) {
    throw new Error(`${envName} must be a Stripe Price ID`);
  }
  return value;
}
