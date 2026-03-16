import type { SubscriptionPlan } from "@/types/database";

export const SUBSCRIPTION_PLANS: Record<
  SubscriptionPlan,
  { name: string; price: number; features: string[] }
> = {
  sms_only: {
    name: "SMS Only",
    price: 25,
    features: [
      "AI missed-call texting",
      "Unlimited conversations",
      "Contact management",
      "Conversation inbox",
    ],
  },
  sms_and_chat: {
    name: "SMS + Web Chat",
    price: 45,
    features: [
      "Everything in SMS Only",
      "Website chat widget",
      "Custom widget branding",
      "Lead capture from web chat",
    ],
  },
  full: {
    name: "Full Suite",
    price: 65,
    features: [
      "Everything in SMS + Web Chat",
      "Review requests",
      "Appointment booking",
      "Analytics dashboard",
      "Weekly email summary",
    ],
  },
};

export const STRIPE_PRICE_IDS: Record<SubscriptionPlan, string> = {
  sms_only: "price_xxx",
  sms_and_chat: "price_xxx",
  full: "price_xxx",
};
