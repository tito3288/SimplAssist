import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SubscriptionPlan } from "@/types/database";

export type BusinessPlanFamily = "sms" | "chat_only";

export class PlanFamilyTransitionNotSupportedError extends Error {
  constructor() {
    super("plan_family_transition_not_supported");
    this.name = "PlanFamilyTransitionNotSupportedError";
  }
}

export class DirectCheckoutPlanClaimUnavailableError extends Error {
  constructor() {
    super("direct_checkout_plan_claim_unavailable");
    this.name = "DirectCheckoutPlanClaimUnavailableError";
  }
}

export function businessPlanFamily(plan: SubscriptionPlan): BusinessPlanFamily {
  return plan === "chat_only" ? "chat_only" : "sms";
}

export async function claimCheckoutPlanFamily(
  businessId: string,
  plan: SubscriptionPlan,
  requireOnboardingIntent = false,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "claim_direct_checkout_plan",
    {
      p_business_id: businessId,
      p_plan: plan,
      p_require_intent: requireOnboardingIntent,
    },
  );

  if (error) {
    const text = [error.message, error.details, error.hint]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (/\bplan_family_transition_not_supported\b/.test(text)) {
      throw new PlanFamilyTransitionNotSupportedError();
    }
    throw new Error(
      `[billing:family] Failed to claim ${plan} for ${businessId}: ${error.message}`,
    );
  }

  if (data !== true) {
    throw new DirectCheckoutPlanClaimUnavailableError();
  }
}
