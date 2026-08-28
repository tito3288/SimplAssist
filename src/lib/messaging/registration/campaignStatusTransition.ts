import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  OnboardingRegistrationStatus,
  RegistrationStatus,
} from "@/types/database";
import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";

const DEFAULT_CAMPAIGN_REJECTION_ERROR =
  REJECTION_SUPPORT_MESSAGE;
const ASSIGNABLE_RESOURCE_STATES = new Set(["provisioning", "active"]);
const ASSIGNMENT_INTENT_LEASE_MS = 60_000;

export interface CampaignStatusSnapshot {
  id: string;
  owner_id: string;
  updated_at: string;
  deleted_at: string | null;
  telnyx_unique_claims_released_at: string | null;
  active_telnyx_release_run_id: string | null;
  telnyx_resource_state: string;
  telnyx_submission_disabled: boolean;
  telnyx_brand_id: string | null;
  telnyx_campaign_id: string | null;
  telnyx_messaging_profile_id: string | null;
  brand_status: RegistrationStatus | null;
  campaign_status: RegistrationStatus | null;
  campaign_status_updated_at: string | null;
  campaign_rejection_reason: string | null;
  onboarding_registration_status: OnboardingRegistrationStatus | null;
  onboarding_registration_submitted_at: string | null;
  onboarding_registration_error: string | null;
  telnyx_campaign_assignment_claim_token?: string | null;
  telnyx_campaign_assignment_claimed_at?: string | null;
}

export type CampaignTransitionOutcome =
  | {
      outcome: "applied";
      statusChanged: boolean;
      repairedRejectedOnboarding: boolean;
    }
  | {
      outcome: "unchanged" | "stale" | "conflict";
      statusChanged: false;
      repairedRejectedOnboarding: false;
    };

export type CampaignAssignmentSafetyBlock =
  | "deleted"
  | "claims_released"
  | "release_in_progress"
  | "resource_state_blocked"
  | "submission_disabled"
  | "submission_in_progress"
  | "assignment_in_progress"
  | "brand_not_approved"
  | "missing_campaign_id"
  | "missing_brand_id"
  | "missing_messaging_profile_id";

export function getCampaignAssignmentSafetyBlock(
  snapshot: CampaignStatusSnapshot
): CampaignAssignmentSafetyBlock | null {
  if (snapshot.deleted_at) return "deleted";
  if (snapshot.telnyx_unique_claims_released_at) return "claims_released";
  if (snapshot.active_telnyx_release_run_id) return "release_in_progress";
  if (!ASSIGNABLE_RESOURCE_STATES.has(snapshot.telnyx_resource_state)) {
    return "resource_state_blocked";
  }
  if (snapshot.telnyx_submission_disabled) return "submission_disabled";
  // A live worker lease blocks refresh. An expired lease may proceed through
  // the exact conditional write below; the assignment worker then reclaims it.
  if (hasFreshAssignmentClaim(snapshot)) {
    return "assignment_in_progress";
  }
  if (snapshot.onboarding_registration_status === "submitting") {
    return "submission_in_progress";
  }
  if (snapshot.brand_status !== "approved") return "brand_not_approved";
  if (!hasNonBlankValue(snapshot.telnyx_campaign_id)) {
    return "missing_campaign_id";
  }
  if (!hasNonBlankValue(snapshot.telnyx_brand_id)) return "missing_brand_id";
  if (!hasNonBlankValue(snapshot.telnyx_messaging_profile_id)) {
    return "missing_messaging_profile_id";
  }
  return null;
}

export async function applyObservedCampaignStatus(args: {
  snapshot: CampaignStatusSnapshot;
  newStatus: RegistrationStatus;
  rejectionReason: string | null;
  observedAt: string;
  enforceAssignmentSafety?: boolean;
  touchIfUnchanged?: boolean;
}): Promise<CampaignTransitionOutcome> {
  const { snapshot, newStatus, rejectionReason, observedAt } = args;

  const observedTime = Date.parse(observedAt);
  if (!Number.isFinite(observedTime)) {
    throw new Error("[registration:campaignStatus] Invalid observation timestamp");
  }

  if (args.enforceAssignmentSafety) {
    const safetyBlock = getCampaignAssignmentSafetyBlock(snapshot);
    if (safetyBlock) {
      throw new Error(
        `[registration:campaignStatus] Unsafe reconciliation precondition: ${safetyBlock}`
      );
    }
  } else if (
    !hasNonBlankValue(snapshot.telnyx_campaign_id) ||
    !hasNonBlankValue(snapshot.telnyx_brand_id)
  ) {
    throw new Error(
      `[registration:campaignStatus] Business ${snapshot.id} is missing provider identity`
    );
  }

  const repairedRejectedOnboarding =
    newStatus === "approved" && isRejectedCampaignFailure(snapshot);
  const statusChanged = snapshot.campaign_status !== newStatus;
  const rejectionChanged =
    snapshot.campaign_rejection_reason !== rejectionReason;

  const currentStatusTime = snapshot.campaign_status_updated_at
    ? Date.parse(snapshot.campaign_status_updated_at)
    : Number.NaN;
  if (Number.isFinite(currentStatusTime) && observedTime <= currentStatusTime) {
    return statusChanged || rejectionChanged || repairedRejectedOnboarding
      ? {
          outcome: "stale",
          statusChanged: false,
          repairedRejectedOnboarding: false,
        }
      : {
          outcome: "unchanged",
          statusChanged: false,
          repairedRejectedOnboarding: false,
        };
  }

  if (
    !statusChanged &&
    !rejectionChanged &&
    !repairedRejectedOnboarding &&
    !args.touchIfUnchanged
  ) {
    return {
      outcome: "unchanged",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    };
  }

  const update: Record<string, unknown> = {
    campaign_status: newStatus,
    campaign_status_updated_at: observedAt,
    campaign_rejection_reason: rejectionReason,
  };

  if (newStatus === "rejected") {
    update.onboarding_registration_status = "failed";
    update.onboarding_registration_submitted_at = null;
    update.onboarding_registration_error =
      rejectionReason ?? DEFAULT_CAMPAIGN_REJECTION_ERROR;
  } else if (repairedRejectedOnboarding) {
    update.onboarding_registration_status = "submitted";
    update.onboarding_registration_submitted_at =
      snapshot.onboarding_registration_submitted_at ?? observedAt;
    update.onboarding_registration_error = null;
    update.onboarding_step = "carrier_review";
  }

  let query = supabaseAdmin
    .from("businesses")
    .update(update)
    .eq("id", snapshot.id)
    .eq("owner_id", snapshot.owner_id)
    .eq("updated_at", snapshot.updated_at)
    .eq("telnyx_campaign_id", snapshot.telnyx_campaign_id)
    .eq("telnyx_brand_id", snapshot.telnyx_brand_id)
    .is("deleted_at", null)
    .is("telnyx_unique_claims_released_at", null);

  query =
    snapshot.campaign_status === null
      ? query.is("campaign_status", null)
      : query.eq("campaign_status", snapshot.campaign_status);

  if (args.enforceAssignmentSafety) {
    const staleAssignmentClaimBefore = new Date(
      Date.now() - ASSIGNMENT_INTENT_LEASE_MS
    ).toISOString();
    query = query
      .eq("brand_status", "approved")
      .eq("telnyx_submission_disabled", false)
      .is("active_telnyx_release_run_id", null)
      .or(
        `telnyx_campaign_assignment_claim_token.is.null,telnyx_campaign_assignment_claimed_at.lt.${staleAssignmentClaimBefore}`
      )
      .eq("telnyx_resource_state", snapshot.telnyx_resource_state)
      .eq(
        "telnyx_messaging_profile_id",
        snapshot.telnyx_messaging_profile_id!
      );

    query =
      snapshot.onboarding_registration_status === null
        ? query.is("onboarding_registration_status", null)
        : query.eq(
            "onboarding_registration_status",
            snapshot.onboarding_registration_status
          );
  }

  const { data, error } = await query.select("id").maybeSingle<{ id: string }>();
  if (error) {
    throw new Error(
      `[registration:campaignStatus] Conditional update failed for business ${snapshot.id}: ${error.message}`
    );
  }
  if (!data) {
    return {
      outcome: "conflict",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    };
  }

  return {
    outcome: "applied",
    statusChanged,
    repairedRejectedOnboarding,
  };
}

function isRejectedCampaignFailure(
  snapshot: CampaignStatusSnapshot
): boolean {
  if (
    (snapshot.campaign_status !== "rejected" &&
      snapshot.campaign_status !== "approved") ||
    snapshot.onboarding_registration_status !== "failed"
  ) {
    return false;
  }

  if (snapshot.campaign_rejection_reason) {
    return (
      snapshot.onboarding_registration_error ===
        snapshot.campaign_rejection_reason ||
      snapshot.onboarding_registration_error ===
        DEFAULT_CAMPAIGN_REJECTION_ERROR
    );
  }

  return (
    snapshot.onboarding_registration_error ===
    DEFAULT_CAMPAIGN_REJECTION_ERROR
  );
}

function hasNonBlankValue(value: string | null): value is string {
  return Boolean(value?.trim());
}

function hasFreshAssignmentClaim(
  snapshot: CampaignStatusSnapshot
): boolean {
  if (!snapshot.telnyx_campaign_assignment_claim_token) return false;
  if (!snapshot.telnyx_campaign_assignment_claimed_at) return true;
  const claimedAt = Date.parse(snapshot.telnyx_campaign_assignment_claimed_at);
  if (!Number.isFinite(claimedAt)) return true;
  return Date.now() - claimedAt < ASSIGNMENT_INTENT_LEASE_MS;
}
