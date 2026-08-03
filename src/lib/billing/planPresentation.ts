import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import { replaceDefaultBrandName } from "@/lib/branding/presentation";
import type { SubscriptionPlan } from "@/types/database";

export type PlanPresentation = (typeof SUBSCRIPTION_PLANS)[SubscriptionPlan];

/**
 * Returns display-only plan copy for the current request brand. Pricing,
 * allowances, feature ordering, and the immutable Stripe config stay shared.
 */
export function getPlanPresentation(
  planKey: SubscriptionPlan,
  brandName: string,
): PlanPresentation {
  const plan = SUBSCRIPTION_PLANS[planKey];

  return {
    ...plan,
    features: plan.features.map((feature) =>
      replaceDefaultBrandName(feature, brandName),
    ),
  };
}
