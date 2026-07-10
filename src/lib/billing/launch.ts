import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  attachOwnedNumberToCustomerProfile,
  purchaseNumber,
} from "@/lib/messaging/numbers";
import {
  createMessagingProfile,
  createVoiceApplication,
  registerBrand,
  registerCampaign,
} from "@/lib/messaging/registration";
import { archiveAndClearRejectedCampaign } from "@/lib/messaging/registration/campaign";
import {
  A2P_RISK_BLOCKED_MESSAGE,
  A2P_RISK_CUSTOMER_REVIEW_MESSAGE,
} from "@/lib/messaging/registration/riskCategories";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";
import {
  getA2pRiskClearanceForBusiness,
  screenA2pRiskForBusiness,
} from "@/lib/messaging/registration/riskScreening";
import {
  claimRegistrationAttempt,
  markRegistrationFailed,
  markRegistrationSubmitted,
} from "@/lib/onboarding/registrationAttempt";
import type { SubscriptionStatus } from "@/types/database";

const PAID_NUMBER_FAILED_MESSAGE =
  "That number was no longer available when we tried to activate it. Please choose another number; you will not be charged again.";

const BILLING_REQUIRED_MESSAGE =
  "Finish checkout before submitting SMS registration.";

const SUBMISSION_DISABLED_MESSAGE =
  "SMS registration is disabled for this account. Contact SimplAssist support if this looks wrong.";

const NO_EIN_HELD_MESSAGE =
  "Add your EIN before SMS registration can continue.";

type LaunchSource = "stripe_finalize" | "stripe_webhook" | "onboarding_retry";

type LaunchResult =
  | { status: "submitted" | "in_progress" | "already_submitted"; message?: string }
  | {
      status:
        | "billing_required"
        | "held_no_ein"
        | "risk_review_required"
        | "submission_disabled"
        | "missing_phone_number"
        | "number_unavailable"
        | "failed";
      message: string;
    };

interface BusinessLaunchRow {
  id: string;
  has_ein: boolean | null;
  pending_phone_number: string | null;
  telnyx_submission_disabled: boolean;
  telnyx_brand_id: string | null;
  telnyx_campaign_id: string | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
}

interface ActiveNumberRow {
  id: string;
  phone_number: string;
  telnyx_phone_number_id: string;
}

interface SubscriptionRow {
  status: SubscriptionStatus;
  setup_fee_paid_at: string | null;
}

export async function attemptPaidLaunch(
  businessId: string,
  source: LaunchSource
): Promise<LaunchResult> {
  const business = await readLaunchBusiness(businessId);
  if (!business) {
    return { status: "failed", message: "Business not found." };
  }

  if (business.has_ein !== true) {
    return { status: "held_no_ein", message: NO_EIN_HELD_MESSAGE };
  }

  if (business.telnyx_submission_disabled) {
    await markRegistrationFailed(businessId, SUBMISSION_DISABLED_MESSAGE);
    return { status: "submission_disabled", message: SUBMISSION_DISABLED_MESSAGE };
  }

  const billingReady = await isBillingReady(business);
  if (!billingReady.ready) {
    return { status: "billing_required", message: billingReady.message };
  }

  const riskClearance = await getA2pRiskClearanceForBusiness(businessId);
  if (!riskClearance.cleared) {
    await persistRiskReviewRequired(businessId, riskClearance.message);
    return {
      status: "risk_review_required",
      message: riskClearance.message,
    };
  }

  const activeNumber = await readActiveNumber(businessId);
  if (!activeNumber && !business.pending_phone_number) {
    return {
      status: "missing_phone_number",
      message: "Choose your SimplAssist number before submitting SMS registration.",
    };
  }

  const claim = await claimRegistrationAttempt(businessId);
  if (!claim.claimed) {
    if (claim.reason === "already_submitted") {
      return { status: "already_submitted" };
    }
    if (claim.reason === "already_submitting") {
      return { status: "in_progress" };
    }
    return {
      status: "failed",
      message: "SMS registration is already being processed. Please refresh in a moment.",
    };
  }

  try {
    // Exact Phase 9 order after checkout success:
    // risk -> attempt gate -> brand -> campaign -> profile -> voice -> owned attach / purchase.
    // The retry-only risk gate lives INSIDE the try so a transient failure
    // here funnels into the catch's markRegistrationFailed (immediately
    // retryable) instead of stranding the claimed row in 'submitting'.
    if (claim.claimedFrom === "failed" || claim.claimedFrom === "stale_submitting") {
      // Run AFTER the claim so it keys on the atomic claim origin rather
      // than a pre-claim snapshot (a rejection webhook landing mid-request
      // cannot slip an unscreened resubmission through). Origin
      // 'not_started' (first registration) never enters this branch.
      const retryClearance = await getA2pRiskClearanceForBusiness(businessId);
      let holdMessage: string | null = null;

      if (!retryClearance.hashMatches) {
        // Content changed since the stored decision, so re-run the Phase 8
        // screen before resubmission; flagged content routes to manual
        // review instead of auto-clearing. (registerCampaign restamps the
        // hash after its opt_in_description rewrite, so machine-induced
        // drift does not reach this branch — only real edits do.)
        const rescreen = await screenA2pRiskForBusiness(businessId, {}, { force: true });
        if (rescreen.status !== "passed" && rescreen.status !== "admin_approved") {
          holdMessage = rescreen.message;
        }
      } else if (
        retryClearance.status === "blocked" ||
        retryClearance.status === "pending_review"
      ) {
        // Identical content with a standing negative decision must keep
        // holding: a second Retry click is not a substitute for the manual
        // review (approveA2pRiskReview stamps admin_approved with the
        // current hash, which unlocks this gate).
        holdMessage =
          retryClearance.status === "blocked"
            ? A2P_RISK_BLOCKED_MESSAGE
            : A2P_RISK_CUSTOMER_REVIEW_MESSAGE;
      }

      if (holdMessage) {
        await releaseClaimToRiskReview(businessId, claim.startedAt, holdMessage);
        return { status: "risk_review_required", message: holdMessage };
      }
    }

    await registerBrand(businessId);
    // Carrier-rejected campaign? Archive its history, deactivate it at
    // Telnyx (best-effort), and clear the pointer so a replacement is
    // created below. No-op in every other state.
    await archiveAndClearRejectedCampaign(businessId);
    await registerCampaign(businessId);
    await createMessagingProfile(businessId);
    await createVoiceApplication(businessId);

    const latestNumber = await readActiveNumber(businessId);
    if (latestNumber) {
      await attachOwnedNumberToCustomerProfile(
        businessId,
        latestNumber.telnyx_phone_number_id
      );
      await clearPendingPhoneNumber(businessId);
    } else {
      await purchasePendingNumber(businessId, business.pending_phone_number);
    }

    await ensureCampaignAssignmentForBusiness(businessId, {
      force: true,
      reason: `paid_launch_${source}`,
    });
    await markRegistrationSubmitted(businessId);
    return { status: "submitted" };
  } catch (err) {
    if (isLikelyNumberUnavailable(err)) {
      await persistNumberFailure(businessId, PAID_NUMBER_FAILED_MESSAGE);
      await markRegistrationFailed(businessId, PAID_NUMBER_FAILED_MESSAGE);
      return {
        status: "number_unavailable",
        message: PAID_NUMBER_FAILED_MESSAGE,
      };
    }

    console.error(`[billing:launch] Paid launch failed for ${businessId}:`, err);
    await markRegistrationFailed(
      businessId,
      "Couldn't submit your SMS registration right now. Please try again or contact support."
    );
    return {
      status: "failed",
      message:
        "Couldn't submit your SMS registration right now. Please try again or contact support.",
    };
  }
}

async function readLaunchBusiness(
  businessId: string
): Promise<BusinessLaunchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, has_ein, pending_phone_number, telnyx_submission_disabled, telnyx_brand_id, telnyx_campaign_id, billing_pilot, billing_comped, billing_exempt"
    )
    .eq("id", businessId)
    .maybeSingle<BusinessLaunchRow>();

  if (error) {
    throw new Error(
      `[billing:launch] Failed to read business ${businessId}: ${error.message}`
    );
  }
  return data ?? null;
}

async function readActiveNumber(
  businessId: string
): Promise<ActiveNumberRow | null> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("id, phone_number, telnyx_phone_number_id")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ActiveNumberRow>();

  if (error) {
    throw new Error(
      `[billing:launch] Failed to read active number for ${businessId}: ${error.message}`
    );
  }
  return data ?? null;
}

async function isBillingReady(
  business: BusinessLaunchRow
): Promise<{ ready: true } | { ready: false; message: string }> {
  if (business.billing_exempt || business.billing_comped || business.billing_pilot) {
    return { ready: true };
  }

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("status, setup_fee_paid_at")
    .eq("business_id", business.id)
    .maybeSingle<SubscriptionRow>();

  if (error) {
    throw new Error(
      `[billing:launch] Failed to read subscription for ${business.id}: ${error.message}`
    );
  }

  if (!data) {
    return { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }
  if (data.status === "past_due") {
    return {
      ready: false,
      message: "Your subscription payment needs attention before SMS registration can continue.",
    };
  }
  if (data.status === "canceled") {
    return {
      ready: false,
      message: "Choose an active plan before SMS registration can continue.",
    };
  }
  if (!data.setup_fee_paid_at) {
    return { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }
  return { ready: true };
}

async function purchasePendingNumber(
  businessId: string,
  pendingPhoneNumber: string | null
): Promise<void> {
  if (!pendingPhoneNumber) {
    throw new Error(`[billing:launch] Missing pending_phone_number for ${businessId}`);
  }

  const purchased = await purchaseNumber(pendingPhoneNumber, businessId);
  const { error: insertError } = await supabaseAdmin.from("phone_numbers").insert({
    business_id: businessId,
    phone_number: purchased.phoneNumber,
    telnyx_phone_number_id: purchased.phoneNumberId,
    is_active: true,
  });

  if (insertError) {
    throw new Error(
      `[billing:launch] Number ${purchased.phoneNumber} purchased but failed to save: ${insertError.message}`
    );
  }

  await clearPendingPhoneNumber(businessId);
}

async function clearPendingPhoneNumber(businessId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      pending_phone_number: null,
      pending_phone_number_area_code: null,
      pending_phone_number_selected_at: null,
      pending_phone_number_failure_reason: null,
    })
    .eq("id", businessId);

  if (error) {
    throw new Error(
      `[billing:launch] Failed to clear pending phone number for ${businessId}: ${error.message}`
    );
  }
}

async function persistNumberFailure(
  businessId: string,
  message: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      pending_phone_number_failure_reason: message,
      onboarding_step: "phone_number",
      onboarding_last_saved_at: new Date().toISOString(),
    })
    .eq("id", businessId);

  if (error) {
    console.error(
      `[billing:launch] Failed to persist number failure for ${businessId}:`,
      error
    );
  }
}

async function persistRiskReviewRequired(
  businessId: string,
  message: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      onboarding_registration_status: "failed",
      onboarding_registration_error: message,
      onboarding_step: "sms_use_case",
      onboarding_last_saved_at: new Date().toISOString(),
    })
    .eq("id", businessId)
    // Never demote a concurrently claimed/completed attempt: only
    // pre-registration (not_started/null) and already-failed rows may be
    // moved into the risk-review hold by this pre-claim path.
    .or(
      "onboarding_registration_status.is.null,onboarding_registration_status.in.(not_started,failed)"
    );

  if (error) {
    console.error(
      `[billing:launch] Failed to persist risk review hold for ${businessId}:`,
      error
    );
  }
}

/**
 * Release OUR claimed attempt into the risk-review hold. Guarded on both
 * status='submitting' and the exact startedAt we wrote at claim time, so a
 * concurrent attempt's claim (or a completed submission) is never clobbered.
 */
async function releaseClaimToRiskReview(
  businessId: string,
  startedAt: string,
  message: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      onboarding_registration_status: "failed",
      onboarding_registration_error: message,
      onboarding_step: "sms_use_case",
      onboarding_last_saved_at: new Date().toISOString(),
    })
    .eq("id", businessId)
    .eq("onboarding_registration_status", "submitting")
    .eq("onboarding_registration_started_at", startedAt);

  if (error) {
    // Throw so the caller's catch runs markRegistrationFailed — a swallowed
    // failure here would strand our claimed row in 'submitting' for the
    // stale window while the caller reports risk_review_required.
    throw new Error(
      `[billing:launch] Failed to release claim to risk review for ${businessId}: ${error.message}`
    );
  }
}

function isLikelyNumberUnavailable(err: unknown): boolean {
  const text =
    err instanceof Error
      ? `${err.message} ${JSON.stringify((err as Error & { cause?: unknown }).cause ?? "")}`
      : JSON.stringify(err);

  return /already|unavailable|not available|taken|number order failed|phone_number/i.test(text);
}
