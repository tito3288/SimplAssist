import { getAdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";
import { canPlanUseFeature } from "@/lib/billing/features";
import { ONBOARDING_STEP_LABELS } from "@/lib/onboarding/types";
import type {
  A2pRiskReviewStatus,
  BillingMode,
  BookingMode,
  CampaignAssignmentStatus,
  OnboardingRegistrationStatus,
  OnboardingStep,
  RegistrationStatus,
  SmsBlockReason,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/types/database";

const STALE_LEASE_MS = 15 * 60 * 1000;

export type AdminHealthTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "neutral";

export type AdminEntitlementStatus =
  | SubscriptionStatus
  | "partner_billing"
  | "billing_override";

export interface AdminEntitlementSnapshot {
  plan: SubscriptionPlan;
  status: AdminEntitlementStatus;
  source: "subscription" | "partner_billing" | "billing_override";
  active: boolean;
  cancelAtPeriodEnd: boolean;
}

/**
 * Structural subset of SmsReadiness. The service loader can pass the output of
 * reduceSmsReadinessSnapshot without importing a server-only resolver here.
 */
export interface AdminSmsReadinessSnapshot {
  smsReady: boolean;
  blockReason: SmsBlockReason | null;
  campaignStatus: RegistrationStatus | null;
  assignmentStatus: CampaignAssignmentStatus | null;
  assignmentFailureReason: string | null;
}

export interface AdminProvisioningHealthSummary {
  needsAttention: boolean;
  inviteFailed: boolean;
  expiredLease: boolean;
}

export interface AdminAccountHealthInput {
  businessId: string;
  now: Date | string;
  deletedAt: string | null;
  deletionScheduledFor: string | null;
  operationsSuspendedAt: string | null;
  aiRepliesPausedAt: string | null;
  textingPausedAt: string | null;
  bookingsPausedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingStep: OnboardingStep;
  billingMode: BillingMode;
  entitlements: AdminEntitlementSnapshot | null;
  activePhoneCount: number;
  anyActivePhoneAssignmentFailed: boolean;
  smsReadiness: AdminSmsReadinessSnapshot | null;
  onboardingRegistrationStatus: OnboardingRegistrationStatus | null;
  onboardingRegistrationStartedAt: string | null;
  riskReviewStatus: A2pRiskReviewStatus | null;
  brandStatus: RegistrationStatus | null;
  campaignStatus: RegistrationStatus | null;
  pendingPhoneFailed: boolean;
  provisioning: AdminProvisioningHealthSummary;
  calendarConnected: boolean;
  aiConfigured: boolean;
  aiBookingEnabled: boolean;
  aiBookingMode: BookingMode | null;
  webChatEnabled: boolean;
  lastActivityAt: string | null;
}

export type AdminAccountLifecycleHealth =
  | "live"
  | "onboarding"
  | "pending_deletion"
  | "terminal";

export type AdminFailedSetupReasonCode =
  | "registration_failed"
  | "registration_submission_stale"
  | "risk_review_blocked"
  | "brand_rejected"
  | "campaign_rejected"
  | "phone_assignment_failed"
  | "pending_phone_failed"
  | "provisioning_needs_attention"
  | "provisioning_invite_failed"
  | "provisioning_lease_expired";

export interface AdminFailedSetupReason {
  code: AdminFailedSetupReasonCode;
  label: string;
}

export interface AdminAccountHealth {
  businessId: string;
  operations: {
    state: "active" | "suspended";
    suspendedAt: string | null;
    services: {
      aiReplies: AdminServiceOperationHealth;
      texting: AdminServiceOperationHealth;
      bookings: AdminServiceOperationHealth;
    };
  };
  lifecycle: {
    state: AdminAccountLifecycleHealth;
    onboardingCompleted: boolean;
    onboardingStep: OnboardingStep;
    onboardingStepLabel: string;
    deletionScheduledFor: string | null;
  };
  billing: {
    mode: BillingMode;
    plan: SubscriptionPlan | null;
    status: AdminEntitlementStatus | null;
    source: AdminEntitlementSnapshot["source"] | null;
    state: "active" | "past_due" | "inactive" | "unknown";
    pastDue: boolean;
    cancelAtPeriodEnd: boolean;
  };
  phone: {
    state: "ready" | "blocked" | "missing" | "ambiguous";
    activeCount: number;
    smsReady: boolean;
    blockReason: SmsBlockReason | null;
    assignmentStatus: CampaignAssignmentStatus | null;
  };
  registration: {
    state:
      | "approved"
      | "pending"
      | "failed"
      | "blocked"
      | "rejected"
      | "not_started";
    onboardingStatus: OnboardingRegistrationStatus;
    riskReviewStatus: A2pRiskReviewStatus;
    brandStatus: RegistrationStatus | null;
    campaignStatus: RegistrationStatus | null;
  };
  calendar: {
    connected: boolean;
  };
  ai: {
    state: "active" | "plan_limited" | "setup_pending" | "not_configured";
    configured: boolean;
    sms: "operational" | "setup_pending" | "plan_limited" | "not_configured";
    webChat:
      | "operational"
      | "disabled"
      | "plan_limited"
      | "not_configured";
    operationalChannels: Array<"sms" | "web_chat">;
    planLimitedChannels: Array<"sms" | "web_chat">;
  };
  booking: {
    mode: BookingMode | null;
    state:
      | "operational"
      | "calendar_required"
      | "plan_limited"
      | "disabled"
      | "not_configured";
  };
  failedSetup: {
    failed: boolean;
    reasons: AdminFailedSetupReason[];
  };
  lastActivityAt: string | null;
}

export interface AdminServiceOperationHealth {
  state: "active" | "paused";
  pausedAt: string | null;
}

const FAILED_SETUP_LABELS = {
  registration_failed: "Registration failed",
  registration_submission_stale: "Registration submission stalled",
  risk_review_blocked: "Risk review blocked",
  brand_rejected: "Brand rejected",
  campaign_rejected: "Campaign rejected",
  phone_assignment_failed: "Phone assignment failed",
  pending_phone_failed: "Pending number provisioning failed",
  provisioning_needs_attention: "Partner provisioning needs attention",
  provisioning_invite_failed: "Setup invite failed",
  provisioning_lease_expired: "Provisioning outcome unresolved",
} as const satisfies Record<AdminFailedSetupReasonCode, string>;

export function normalizeAdminAccountHealth(
  input: AdminAccountHealthInput,
): AdminAccountHealth {
  const now = timestamp(input.now);
  const activePhoneCount = normalizeCount(input.activePhoneCount);
  const entitlements = input.entitlements;
  const pastDue = entitlements?.status === "past_due";
  const canUseAiSms = canUse(entitlements, "ai_sms_conversations");
  const canUseWebChat = canUse(entitlements, "web_chat");
  const canUseDirectBooking = canUse(entitlements, "direct_booking");

  const smsState: AdminAccountHealth["ai"]["sms"] = !input.aiConfigured
    ? "not_configured"
    : !canUseAiSms
      ? "plan_limited"
      : input.smsReadiness?.smsReady
        ? "operational"
        : "setup_pending";
  const webChatState: AdminAccountHealth["ai"]["webChat"] =
    !input.aiConfigured
      ? "not_configured"
      : !input.webChatEnabled
        ? "disabled"
        : !canUseWebChat
          ? "plan_limited"
          : "operational";
  const operationalChannels: AdminAccountHealth["ai"]["operationalChannels"] =
    [];
  const planLimitedChannels: AdminAccountHealth["ai"]["planLimitedChannels"] =
    [];
  if (smsState === "operational") operationalChannels.push("sms");
  if (webChatState === "operational") operationalChannels.push("web_chat");
  if (smsState === "plan_limited") planLimitedChannels.push("sms");
  if (webChatState === "plan_limited") planLimitedChannels.push("web_chat");

  const lifecycle = lifecycleFromFacts(input);
  const reasons = failedSetupReasons(input, activePhoneCount, now);
  const registrationState = registrationStateFromFacts(input, reasons);
  const operationsSuspendedAt = validTimestampOrNull(
    input.operationsSuspendedAt,
  );
  const operationsSuspended = operationsSuspendedAt !== null;

  return {
    businessId: input.businessId,
    operations: {
      state: operationsSuspended ? "suspended" : "active",
      suspendedAt: operationsSuspendedAt,
      services: {
        aiReplies: serviceOperationHealth(
          operationsSuspended,
          input.aiRepliesPausedAt,
        ),
        texting: serviceOperationHealth(
          operationsSuspended,
          input.textingPausedAt,
        ),
        bookings: serviceOperationHealth(
          operationsSuspended,
          input.bookingsPausedAt,
        ),
      },
    },
    lifecycle: {
      state: lifecycle,
      onboardingCompleted: input.onboardingCompletedAt !== null,
      onboardingStep: input.onboardingStep,
      onboardingStepLabel: ONBOARDING_STEP_LABELS[input.onboardingStep],
      deletionScheduledFor:
        lifecycle === "pending_deletion"
          ? validTimestampOrNull(input.deletionScheduledFor)
          : null,
    },
    billing: {
      mode: input.billingMode,
      plan: entitlements?.plan ?? null,
      status: entitlements?.status ?? null,
      source: entitlements?.source ?? null,
      state: !entitlements
        ? "unknown"
        : pastDue
          ? "past_due"
          : entitlements.active
            ? "active"
            : "inactive",
      pastDue,
      cancelAtPeriodEnd: entitlements?.cancelAtPeriodEnd ?? false,
    },
    phone: {
      state:
        activePhoneCount > 1
          ? "ambiguous"
          : activePhoneCount === 0
            ? "missing"
            : input.smsReadiness?.smsReady
              ? "ready"
              : "blocked",
      activeCount: activePhoneCount,
      smsReady:
        activePhoneCount === 1 && Boolean(input.smsReadiness?.smsReady),
      blockReason:
        activePhoneCount === 1 ? (input.smsReadiness?.blockReason ?? null) : null,
      assignmentStatus:
        activePhoneCount === 1
          ? (input.smsReadiness?.assignmentStatus ?? null)
          : null,
    },
    registration: {
      state: registrationState,
      onboardingStatus: input.onboardingRegistrationStatus ?? "not_started",
      riskReviewStatus: input.riskReviewStatus ?? "not_started",
      brandStatus: input.brandStatus,
      campaignStatus: input.campaignStatus,
    },
    calendar: { connected: input.calendarConnected },
    ai: {
      state: !input.aiConfigured
        ? "not_configured"
        : operationalChannels.length > 0
          ? "active"
          : planLimitedChannels.length > 0
            ? "plan_limited"
            : "setup_pending",
      configured: input.aiConfigured,
      sms: smsState,
      webChat: webChatState,
      operationalChannels,
      planLimitedChannels,
    },
    booking: {
      mode: input.aiBookingEnabled ? input.aiBookingMode : null,
      state: !input.aiConfigured
        ? "not_configured"
        : !input.aiBookingEnabled
          ? "disabled"
          : input.aiBookingMode === "collect_info"
            ? "operational"
            : input.aiBookingMode !== "schedule_direct"
              ? "disabled"
              : !canUseDirectBooking
                ? "plan_limited"
                : !input.calendarConnected
                  ? "calendar_required"
                  : "operational",
    },
    failedSetup: {
      failed: reasons.length > 0,
      reasons,
    },
    lastActivityAt: validTimestampOrNull(input.lastActivityAt),
  };
}

function serviceOperationHealth(
  operationsSuspended: boolean,
  storedPausedAt: string | null,
): AdminServiceOperationHealth {
  const pausedAt = validTimestampOrNull(storedPausedAt);
  return {
    state: operationsSuspended || pausedAt !== null ? "paused" : "active",
    pausedAt,
  };
}

/** Apply the fresher deletion preview after a detail snapshot was loaded. */
export function applyDeletionPreviewLifecycle(
  health: AdminAccountHealth,
  preview: {
    lifecycleStage: "onboarding" | "launched" | "suspended";
    deletionScheduledFor: string | null;
  },
): AdminAccountHealth {
  const state: AdminAccountLifecycleHealth =
    preview.lifecycleStage === "suspended"
      ? "pending_deletion"
      : preview.lifecycleStage === "launched"
        ? "live"
        : "onboarding";
  return {
    ...health,
    lifecycle: {
      state,
      onboardingCompleted:
        state === "pending_deletion"
          ? health.lifecycle.onboardingCompleted
          : state === "live",
      onboardingStep: health.lifecycle.onboardingStep,
      onboardingStepLabel: health.lifecycle.onboardingStepLabel,
      deletionScheduledFor:
        state === "pending_deletion"
          ? validTimestampOrNull(preview.deletionScheduledFor)
          : null,
    },
  };
}

function lifecycleFromFacts(
  input: AdminAccountHealthInput,
): AdminAccountLifecycleHealth {
  const lifecycle = getAdminBusinessLifecycle({
    deletedAt: input.deletedAt,
    deletionScheduledFor: input.deletionScheduledFor,
  });
  if (lifecycle === "terminal") return "terminal";
  if (lifecycle === "scheduled") return "pending_deletion";
  return input.onboardingCompletedAt ? "live" : "onboarding";
}

function failedSetupReasons(
  input: AdminAccountHealthInput,
  activePhoneCount: number,
  now: number | null,
): AdminFailedSetupReason[] {
  const codes: AdminFailedSetupReasonCode[] = [];
  const add = (code: AdminFailedSetupReasonCode) => {
    if (!codes.includes(code)) codes.push(code);
  };
  const registrationStartedAt = timestamp(
    input.onboardingRegistrationStartedAt,
  );

  if (input.onboardingRegistrationStatus === "failed") {
    add("registration_failed");
  }
  if (
    input.onboardingRegistrationStatus === "submitting" &&
    now !== null &&
    (registrationStartedAt === null ||
      registrationStartedAt <= now - STALE_LEASE_MS)
  ) {
    add("registration_submission_stale");
  }
  if (input.riskReviewStatus === "blocked") add("risk_review_blocked");
  if (input.brandStatus === "rejected") add("brand_rejected");
  if (input.campaignStatus === "rejected") add("campaign_rejected");
  if (
    activePhoneCount > 0 &&
    (input.anyActivePhoneAssignmentFailed ||
      input.smsReadiness?.assignmentStatus === "failed")
  ) {
    add("phone_assignment_failed");
  }
  if (input.pendingPhoneFailed) add("pending_phone_failed");

  if (input.provisioning.needsAttention) {
    add("provisioning_needs_attention");
  }
  if (input.provisioning.inviteFailed) {
    add("provisioning_invite_failed");
  }
  if (input.provisioning.expiredLease) {
    add("provisioning_lease_expired");
  }

  return codes.map((code) => ({ code, label: FAILED_SETUP_LABELS[code] }));
}

function registrationStateFromFacts(
  input: AdminAccountHealthInput,
  failedReasons: readonly AdminFailedSetupReason[],
): AdminAccountHealth["registration"]["state"] {
  if (input.riskReviewStatus === "blocked") return "blocked";
  if (
    input.brandStatus === "rejected" ||
    input.campaignStatus === "rejected"
  ) {
    return "rejected";
  }
  if (
    failedReasons.some((reason) =>
      ["registration_failed", "registration_submission_stale"].includes(
        reason.code,
      ),
    )
  ) {
    return "failed";
  }
  if (input.campaignStatus === "approved") return "approved";
  if (
    input.onboardingRegistrationStatus === "submitting" ||
    input.onboardingRegistrationStatus === "submitted" ||
    input.riskReviewStatus === "pending_review" ||
    input.riskReviewStatus === "passed" ||
    input.riskReviewStatus === "admin_approved" ||
    input.brandStatus === "pending" ||
    input.brandStatus === "approved" ||
    input.campaignStatus === "pending"
  ) {
    return "pending";
  }
  return "not_started";
}

function canUse(
  entitlements: AdminEntitlementSnapshot | null,
  feature: "ai_sms_conversations" | "web_chat" | "direct_booking",
): boolean {
  return Boolean(
    entitlements?.active && canPlanUseFeature(entitlements.plan, feature),
  );
}

function timestamp(value: Date | string | null): number | null {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimestampOrNull(value: string | null): string | null {
  return timestamp(value) === null ? null : value;
}

function normalizeCount(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}
