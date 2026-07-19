import type { SubscriptionPlan } from "@/types/database";

export const SUBSCRIPTION_PLAN_ORDER = [
  "sms_only",
  "sms_and_chat",
  "full",
] as const satisfies readonly SubscriptionPlan[];

/**
 * The single source of truth for product feature availability.
 *
 * Future Full features intentionally live in this matrix before their product
 * implementations exist. That keeps pricing language and later runtime gates
 * anchored to stable identifiers without exposing placeholder functionality.
 */
export const FEATURE_MINIMUM_PLAN = {
  missed_call_sms: "sms_only",
  manual_sms: "sms_only",
  contacts_inbox: "sms_only",
  ai_sms_conversations: "sms_and_chat",
  web_chat: "sms_and_chat",
  widget_branding: "sms_and_chat",
  ai_customization: "sms_and_chat",
  calendar: "sms_and_chat",
  direct_booking: "sms_and_chat",
  advanced_guardrails: "full",
  advanced_analytics: "full",
  conversion_reporting: "full",
  weekly_summary: "full",
  lead_alerts: "full",
  review_requests: "full",
  follow_up_automation: "full",
  priority_support: "full",
} as const satisfies Record<string, SubscriptionPlan>;

export type FeatureKey = keyof typeof FEATURE_MINIMUM_PLAN;

export const ALL_FEATURES = Object.freeze(
  Object.keys(FEATURE_MINIMUM_PLAN) as FeatureKey[]
);

const PLAN_RANK: Readonly<Record<SubscriptionPlan, number>> = {
  sms_only: 0,
  sms_and_chat: 1,
  full: 2,
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_PLAN_ORDER as readonly string[]).includes(value)
  );
}

export function requiredPlanForFeature(feature: FeatureKey): SubscriptionPlan {
  return FEATURE_MINIMUM_PLAN[feature];
}

export function planIncludesPlan(
  plan: SubscriptionPlan,
  requiredPlan: SubscriptionPlan
): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[requiredPlan];
}

export function canPlanUseFeature(
  plan: SubscriptionPlan,
  feature: FeatureKey
): boolean {
  return planIncludesPlan(plan, requiredPlanForFeature(feature));
}
