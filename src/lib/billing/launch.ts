import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  attachOwnedNumberToCustomerProfile,
  findOwnedNumberId,
  NumberTakenError,
  PurchasedNumberSaveError,
  purchaseNumber,
} from "@/lib/messaging/numbers";
import { getActiveSmsNumberForBusiness } from "@/lib/messaging/phoneNumberLookup";
import {
  createMessagingProfile,
  createVoiceApplication,
  registerBrand,
  registerCampaign,
} from "@/lib/messaging/registration";
import {
  archiveAndClearRejectedBrand,
  LinkedExistingBrandSupportRequiredError,
} from "@/lib/messaging/registration/brand";
import {
  archiveAndClearRejectedCampaign,
  CampaignRegistrationError,
} from "@/lib/messaging/registration/campaign";
import {
  ExistingBrandLinkError,
  prepareExistingTelnyxBrandLinkForLaunch,
} from "@/lib/messaging/registration/existingBrand";
import {
  A2P_RISK_BLOCKED_MESSAGE,
  A2P_RISK_CUSTOMER_REVIEW_MESSAGE,
} from "@/lib/messaging/registration/riskCategories";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";
import { verifyPublishedCompliancePage } from "@/lib/messaging/registration/publicCompliancePage";
import {
  getA2pRiskClearanceForBusiness,
  screenA2pRiskForBusiness,
} from "@/lib/messaging/registration/riskScreening";
import {
  claimRegistrationAttempt,
  markRegistrationFailed,
  markRegistrationSubmitted,
} from "@/lib/onboarding/registrationAttempt";
import { getBusinessContentQuality } from "@/lib/onboarding/contentQuality.server";
import { shouldEnforceInitialContentQuality } from "@/lib/onboarding/contentQualityGate";
import type {
  Language,
  OnboardingRegistrationStatus,
  SubscriptionPlan,
} from "@/types/database";

const PAID_NUMBER_FAILED_MESSAGE =
  "That number was no longer available when we tried to activate it. Please choose another number; you will not be charged again.";

const NUMBER_SAVE_RETRY_MESSAGE =
  "Your number was reserved, but we couldn't finish saving it. Retry to complete setup — you will not be charged again.";

const BILLING_REQUIRED_MESSAGE =
  "Finish checkout before submitting SMS registration.";

const SUBMISSION_DISABLED_MESSAGE =
  "SMS registration is disabled for this account. Contact SimplAssist support if this looks wrong.";

const NO_EIN_HELD_MESSAGE =
  "Add your EIN before SMS registration can continue.";

const EXISTING_BRAND_REVIEW_REQUIRED_MESSAGE =
  "Your existing Telnyx brand link needs SimplAssist review before SMS registration can continue. Contact SimplAssist Support.";

const LINKED_BRAND_NEEDS_SUPPORT_MESSAGE =
  "Your linked Telnyx brand needs SimplAssist Support before SMS registration can continue. Its existing Telnyx resources were not replaced.";

const EXISTING_BRAND_RETRY_MESSAGE =
  "SimplAssist could not recheck your existing Telnyx brand right now. No new Telnyx resources were created; please try again shortly.";

export const SERVICES_FAQS_REQUIRED_MESSAGE =
  "Add at least 3 distinct services and 3 answered FAQs so your AI has enough accurate information to help customers.";

type LaunchSource = "stripe_finalize" | "stripe_webhook" | "onboarding_retry";

export type LaunchResult =
  | { status: "submitted" | "in_progress" | "already_submitted"; message?: string }
  | {
      status:
        | "billing_required"
        | "services_faqs_required"
        | "held_no_ein"
        | "risk_review_required"
        | "existing_brand_review_required"
        | "linked_brand_needs_support"
        | "submission_disabled"
        | "missing_phone_number"
        | "number_unavailable"
        | "failed";
      message: string;
    };

interface BusinessLaunchRow {
  id: string;
  slug: string;
  name: string;
  has_ein: boolean | null;
  pending_phone_number: string | null;
  telnyx_submission_disabled: boolean;
  telnyx_brand_id: string | null;
  telnyx_campaign_id: string | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
  billing_mode: unknown;
  partner_plan: unknown;
  onboarding_completed_at: string | null;
  onboarding_registration_status: OnboardingRegistrationStatus | null;
  brand_status: string | null;
  campaign_status: string | null;
  ai_settings: { language: Language } | null;
}

interface ActiveNumberRow {
  id: string;
  phone_number: string;
  telnyx_phone_number_id: string;
}

interface SubscriptionRow {
  status: string;
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

  if (shouldEnforceInitialContentQuality(business)) {
    const contentQuality = await getBusinessContentQuality(businessId);
    if (!contentQuality.ready) {
      return {
        status: "services_faqs_required",
        message: SERVICES_FAQS_REQUIRED_MESSAGE,
      };
    }
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

  let linkedExistingBrandConsumed = false;

  try {
    // Paid-launch order after checkout success:
    // risk -> attempt gate -> existing-brand revalidate/consume -> rejected
    // brand cleanup -> brand -> profile -> voice -> owned attach / purchase ->
    // active number + deployed compliance-page verification -> rejected
    // campaign cleanup -> campaign.
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

    // This is the final authorization boundary before any Telnyx mutation.
    // It is a no-op for normal onboarding. For an existing-brand request it
    // captures one private request tuple, revalidates that exact brand and
    // local identity, then consumes the same tuple atomically. Pending or
    // blocked requests stop here, before rejected-resource cleanup or create.
    const existingBrandPreparation =
      await prepareExistingTelnyxBrandLinkForLaunch(businessId);
    linkedExistingBrandConsumed =
      existingBrandPreparation.status === "consumed";

    // Carrier-rejected brand? Archive its history, cascade-archive the child
    // campaign (any status — it is bound to the dead brand at TCR), delete
    // the brand at Telnyx (best-effort), and clear the pointer so
    // registerBrand creates a replacement below. Runs AFTER the risk gate so
    // a risk hold releases the claim without having touched the brand.
    // No-op in every other state.
    await archiveAndClearRejectedBrand(businessId);
    await registerBrand(businessId);

    // A number order needs both routing resources. Each helper recovers an
    // exact business-scoped provider resource before creating, closing the
    // provider-success/local-save retry gap.
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

    // Use the same strict active-number source as /c/[slug] and campaign
    // generation (including duplicate-row and E.164 validation), then fetch
    // the deployed page's raw SSR HTML. No charged campaign submission is
    // reachable until the exact active number and disclosure markers render.
    const smsPhoneNumber = await getActiveSmsNumberForBusiness(businessId);
    if (!smsPhoneNumber) {
      throw new Error(
        `[billing:launch] Active SMS number disappeared before compliance-page verification for ${businessId}`
      );
    }
    await verifyPublishedCompliancePage({
      slug: business.slug,
      businessName: business.name,
      smsPhoneNumber,
      language: business.ai_settings?.language ?? "en",
    });

    // Carrier-rejected campaign? Archive its history, deactivate it at
    // Telnyx (best-effort), and clear the pointer so a replacement is
    // created below. After a brand re-file this is a no-op (the cascade
    // already archived the campaign). No-op in every other state.
    await archiveAndClearRejectedCampaign(businessId);
    await registerCampaign(businessId);

    await ensureCampaignAssignmentForBusiness(businessId, {
      force: true,
      reason: `paid_launch_${source}`,
    });
    await markRegistrationSubmitted(businessId);
    return { status: "submitted" };
  } catch (err) {
    if (err instanceof ExistingBrandLinkError) {
      const status =
        err.launchDisposition === "review_required"
          ? "existing_brand_review_required"
          : err.launchDisposition === "support_required"
            ? "linked_brand_needs_support"
            : "failed";
      const message =
        status === "existing_brand_review_required"
          ? EXISTING_BRAND_REVIEW_REQUIRED_MESSAGE
          : status === "linked_brand_needs_support"
            ? LINKED_BRAND_NEEDS_SUPPORT_MESSAGE
            : EXISTING_BRAND_RETRY_MESSAGE;
      console.error(
        `[billing:launch] Existing-brand launch stopped for ${businessId} (${err.code}, ${err.kind})`
      );
      await markRegistrationFailed(businessId, message);
      return { status, message };
    }

    if (err instanceof LinkedExistingBrandSupportRequiredError) {
      console.error(
        `[billing:launch] Linked brand needs support for ${businessId} (${err.code})`
      );
      await markRegistrationFailed(
        businessId,
        LINKED_BRAND_NEEDS_SUPPORT_MESSAGE
      );
      return {
        status: "linked_brand_needs_support",
        message: LINKED_BRAND_NEEDS_SUPPORT_MESSAGE,
      };
    }

    if (err instanceof CampaignRegistrationError) {
      const needsLinkedBrandSupport =
        linkedExistingBrandConsumed && err.kind === "permanent";
      const message = needsLinkedBrandSupport
        ? LINKED_BRAND_NEEDS_SUPPORT_MESSAGE
        : err.message;
      console.error(
        `[billing:launch] Campaign launch stopped for ${businessId} (${err.code}, ${err.kind})`
      );
      await markRegistrationFailed(businessId, message);
      return {
        status: needsLinkedBrandSupport
          ? "linked_brand_needs_support"
          : "failed",
        message,
      };
    }

    if (err instanceof PurchasedNumberSaveError) {
      // The number IS purchased and owned — never route to re-pick, never
      // claim "not charged" is a fresh start. pending_phone_number is
      // deliberately kept: Retry re-enters purchasePendingNumber, finds
      // the owned number via findOwnedNumberId, and completes the save
      // without a second charge. The copy is truthful for this path.
      console.error(
        `[billing:launch] Purchased-but-unsaved number for ${businessId}:`,
        err
      );
      await markRegistrationFailed(businessId, NUMBER_SAVE_RETRY_MESSAGE);
      return { status: "failed", message: NUMBER_SAVE_RETRY_MESSAGE };
    }

    if (err instanceof NumberTakenError) {
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
      "Couldn't submit your SMS registration right now. Please try again or contact support from the Support page."
    );
    return {
      status: "failed",
      message:
        "Couldn't submit your SMS registration right now. Please try again or contact support from the Support page.",
    };
  }
}

async function readLaunchBusiness(
  businessId: string
): Promise<BusinessLaunchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, slug, name, has_ein, pending_phone_number, telnyx_submission_disabled, telnyx_brand_id, telnyx_campaign_id, billing_pilot, billing_comped, billing_exempt, billing_mode, partner_plan, onboarding_completed_at, onboarding_registration_status, brand_status, campaign_status, ai_settings(language)"
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

  // Any synchronized subscription row remains authoritative, including for
  // an impossible split-authority row. Native partner billing is considered
  // only when no subscription exists, and never requires Stripe's setup fee.
  if (data?.status === "past_due") {
    return {
      ready: false,
      message: "Your subscription payment needs attention before SMS registration can continue.",
    };
  }
  if (data?.status === "canceled") {
    return {
      ready: false,
      message: "Choose an active plan before SMS registration can continue.",
    };
  }
  if (data && data.status !== "active" && data.status !== "trialing") {
    throw new Error(
      `[billing:launch] Subscription for ${business.id} has unknown status ${data.status}`
    );
  }
  if (data && !data.setup_fee_paid_at) {
    return { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }
  if (data) {
    return { ready: true };
  }

  if (
    business.billing_mode === "invoiced" ||
    business.billing_mode === "comped"
  ) {
    return isSubscriptionPlan(business.partner_plan)
      ? { ready: true }
      : { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }

  // Only the exact database modes are accepted at this trusted boundary.
  // Missing or malformed modes must not fall through to legacy overrides.
  if (business.billing_mode !== "stripe") {
    return { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }
  if (business.partner_plan !== null) {
    return { ready: false, message: BILLING_REQUIRED_MESSAGE };
  }

  // Legacy overrides retain their existing Stripe-mode behavior only when no
  // subscription row exists. Native partner accounts never inherit access
  // from these flags.
  if (
    business.billing_exempt ||
    business.billing_comped ||
    business.billing_pilot
  ) {
    return { ready: true };
  }

  return { ready: false, message: BILLING_REQUIRED_MESSAGE };
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return (
    value === "sms_only" || value === "sms_and_chat" || value === "full"
  );
}

// Three-step resolver for the purchase-save two-phase-commit gap. Telnyx
// ownership is the durable "purchase completed" marker the local schema
// lacks, so a retry after a failed save recovers the already-paid number
// instead of charging again or telling the customer to re-pick.
async function purchasePendingNumber(
  businessId: string,
  pendingPhoneNumber: string | null
): Promise<void> {
  if (!pendingPhoneNumber) {
    throw new Error(`[billing:launch] Missing pending_phone_number for ${businessId}`);
  }

  // Step 1: local row check — a prior attempt may have fully completed
  // (idempotent completion: re-assert routing too, since a crash between
  // insert and attach leaves a saved-but-unrouted number), or another
  // business may hold the number (typed → the re-pick path). limit(1)
  // guards the multi-row case: phone_numbers has NO unique constraint on
  // phone_number (verified against migrations — §5 backlog), so duplicates
  // are structurally possible and must not wedge this read.
  const { data: existingRow, error: rowError } = await supabaseAdmin
    .from("phone_numbers")
    .select("business_id, telnyx_phone_number_id")
    .eq("phone_number", pendingPhoneNumber)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle<{ business_id: string; telnyx_phone_number_id: string }>();

  if (rowError) {
    throw new Error(
      `[billing:launch] Failed to check existing row for ${pendingPhoneNumber}: ${rowError.message}`
    );
  }
  if (existingRow) {
    if (existingRow.business_id === businessId) {
      await attachOwnedNumberToCustomerProfile(
        businessId,
        existingRow.telnyx_phone_number_id
      );
      await clearPendingPhoneNumber(businessId);
      return;
    }
    throw new NumberTakenError(pendingPhoneNumber);
  }

  // Step 2: ownership recovery — a prior attempt by THIS business purchased
  // this number but the save failed (PurchasedNumberSaveError path); the
  // lookup is customer_reference-scoped so another business's purchase can
  // never be seized. Complete the save and re-assert routing; no second
  // charge. (A stale-empty list within Telnyx's read-after-write window
  // falls through to step 3, where re-ordering an owned number is rejected
  // by Telnyx — re-pick path, never a double charge; retries here are
  // human-speed, so the window is theoretical.)
  const ownedId = await findOwnedNumberId(pendingPhoneNumber, businessId);
  if (ownedId) {
    console.warn(
      `[billing:launch] Recovering purchased-but-unsaved number for ${businessId} (telnyx id=${ownedId})`
    );
    await savePurchasedNumber(businessId, pendingPhoneNumber, ownedId);
    await attachOwnedNumberToCustomerProfile(businessId, ownedId);
    return;
  }

  // Step 3: fresh purchase.
  let purchased: Awaited<ReturnType<typeof purchaseNumber>>;
  try {
    // This legacy provider-message classifier is intentionally limited to
    // the fresh Telnyx order call. Local reads/saves, owned-number recovery,
    // attachment, routing, and all later launch work remain generic or use
    // their own typed errors, so an already-owned number is never discarded.
    purchased = await purchaseNumber(pendingPhoneNumber, businessId);
  } catch (error) {
    if (isLikelyNumberUnavailable(error)) {
      throw new NumberTakenError(pendingPhoneNumber);
    }
    throw error;
  }
  await savePurchasedNumber(
    businessId,
    purchased.phoneNumber,
    purchased.phoneNumberId
  );
}

async function savePurchasedNumber(
  businessId: string,
  phoneNumber: string,
  telnyxPhoneNumberId: string
): Promise<void> {
  const { error: insertError } = await supabaseAdmin.from("phone_numbers").insert({
    business_id: businessId,
    phone_number: phoneNumber,
    telnyx_phone_number_id: telnyxPhoneNumberId,
    is_active: true,
  });

  if (insertError) {
    // Typed: the number is paid for and owned. Classification by
    // construction — the old message-sniffing regex matched the
    // phone_numbers relation name inside this very error and misrouted it
    // to "unavailable / you will not be charged again" (false).
    throw new PurchasedNumberSaveError({
      phoneNumber,
      telnyxPhoneNumberId,
      cause: insertError,
    });
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

  // NOTE: the former `phone_number` token is deliberately gone — it matched
  // the phone_numbers RELATION NAME inside any Postgres error on that
  // table, misclassifying save failures as "unavailable". Save failures
  // are now typed (PurchasedNumberSaveError) and never reach this sniffer.
  return /already|unavailable|not available|taken|number order failed/i.test(text);
}
