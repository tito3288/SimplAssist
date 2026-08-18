import "server-only";

import { attemptPaidLaunch, type LaunchResult } from "@/lib/billing/launch";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SyncedCheckout } from "@/lib/stripe/subscriptionSync";

export type PaidCheckoutFinalizeSource = "stripe_finalize" | "stripe_webhook";

export type PaidCheckoutFinalizeResult = LaunchResult | { status: "completed" };

const CHAT_ONLY_BILLING_REQUIRED_MESSAGE =
  "An active Chat Only subscription is required to complete setup.";

/**
 * Dispatch post-checkout work from the plan Stripe actually synchronized.
 *
 * SMS plans retain the established Telnyx launch path. Chat Only completes
 * core onboarding through a local, guarded, idempotent write and never enters
 * that provider path. Rollout flags are acquisition controls and deliberately
 * are not consulted after a paid subscription exists.
 */
export async function finalizePaidCheckout(
  synced: SyncedCheckout,
  source: PaidCheckoutFinalizeSource,
): Promise<PaidCheckoutFinalizeResult> {
  if (synced.plan !== "chat_only") {
    return attemptPaidLaunch(synced.businessId, source);
  }

  return completeChatOnlyOnboarding(synced);
}

async function completeChatOnlyOnboarding(
  synced: SyncedCheckout,
): Promise<PaidCheckoutFinalizeResult> {
  // The RPC locks the business and re-resolves the exact active/trialing
  // synchronized subscription in the same transaction as completion. Neither
  // Checkout metadata nor owner-writable onboarding intent confers authority.
  const { data: completed, error } = await supabaseAdmin.rpc(
    "finalize_chat_only_onboarding_if_paid",
    {
      p_business_id: synced.businessId,
      p_stripe_customer_id: synced.customerId,
      p_stripe_subscription_id: synced.subscriptionId,
    },
  );

  if (error) {
    throw new Error(
      `[billing:finalize] Failed to complete Chat Only onboarding for ${synced.businessId}: ${error.message}`,
    );
  }

  if (completed === true) {
    return { status: "completed" };
  }
  if (completed !== false) {
    throw new Error(
      `[billing:finalize] Chat Only completion returned an invalid response for ${synced.businessId}`,
    );
  }

  return {
    status: "billing_required",
    message: CHAT_ONLY_BILLING_REQUIRED_MESSAGE,
  };
}
