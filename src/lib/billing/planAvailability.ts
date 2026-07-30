import type {
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/types/database";

export type PlanSalesStatus = "available" | "coming_soon";

/**
 * The single sales switch for new subscriptions. Existing subscriptions keep
 * their plan, entitlements, Stripe mappings, and webhook synchronization even
 * while a plan is unavailable for new purchases.
 */
export const PLAN_SALES_STATUS = {
  sms_only: "available",
  sms_and_chat: "available",
  full: "coming_soon",
} as const satisfies Record<SubscriptionPlan, PlanSalesStatus>;

export function getPlanSalesStatus(
  plan: SubscriptionPlan
): PlanSalesStatus {
  return PLAN_SALES_STATUS[plan];
}

export function isPlanAvailable(plan: SubscriptionPlan): boolean {
  return getPlanSalesStatus(plan) === "available";
}

export function availablePlanOrFallback(
  plan: SubscriptionPlan | null | undefined,
  fallback: SubscriptionPlan
): SubscriptionPlan {
  if (!isPlanAvailable(fallback)) {
    throw new Error("The fallback subscription plan must be available");
  }
  return plan && isPlanAvailable(plan) ? plan : fallback;
}

/**
 * Paid onboarding retries are not new sales, so an existing Full account must
 * still be allowed to finish provisioning. Canceled and unpaid subscriptions
 * return null and therefore fall back to the user's available selection.
 */
export function paidPlanForOnboardingRetry(
  plan: SubscriptionPlan | null | undefined,
  status: SubscriptionStatus | null | undefined
): SubscriptionPlan | null {
  return plan && (status === "active" || status === "trialing")
    ? plan
    : null;
}
