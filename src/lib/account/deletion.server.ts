import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BillingMode, SubscriptionStatus } from "@/types/database";

const DELETION_GRACE_PERIOD_MS = 60 * 24 * 60 * 60 * 1000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ScheduledStripeAction = {
  generation: number;
  status: "pending" | "applied" | "blocked";
  appliedAction: "pause" | "resume" | "cancel" | null;
};

export type AccountDeletionStripeReconcileResult =
  | {
      outcome: "applied";
      businessId: string;
      generation: number;
      appliedAction: "pause" | "resume" | "cancel";
    }
  | {
      outcome: "pending" | "blocked";
      businessId: string;
      generation: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "not_claimed" | "stale";
      businessId: string;
      generation: number;
    };

export type ScheduledAccountDeletion = {
  businessId: string;
  deletedAt: string;
  deletionScheduledFor: string;
  stripeAction: ScheduledStripeAction | null;
};

export type AccountDeletionPreview = {
  businessId: string;
  businessName: string;
  billingMode: BillingMode;
  partnerId: string | null;
  partnerSlug: string | null;
  lifecycleStage: "onboarding" | "launched" | "suspended";
  deletionScheduledFor: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  campaignStatus: "pending" | "approved" | "rejected" | null;
  assignedPhoneCount: number;
  hasPendingPhoneNumber: boolean;
  provisioningJobCount: number;
  provisioningOperationState: "idle" | "active" | "unknown";
  requiresLiveAcknowledgement: boolean;
};

export type AdminAccountDeletionRun = {
  scheduled: ScheduledAccountDeletion;
  preview: AccountDeletionPreview;
  adminEventCreated: boolean;
  previouslyScheduledByAdmin: boolean;
};

export type AccountDeletionServiceErrorCode =
  | "provisioning_in_progress"
  | "provisioning_outcome_unknown"
  | "partner_subscription_conflict"
  | "stripe_action_in_progress"
  | "stripe_action_outcome_unknown"
  | "business_not_found"
  | "confirmation_mismatch"
  | "live_ack_required"
  | "account_permanently_deleted"
  | "stripe_resume_retryable"
  | "stripe_resume_blocked"
  | "account_deletion_failed"
  | "account_reactivation_failed";

type StripeActionReconciler = (input: {
  businessId: string;
  generation: number;
}) => Promise<AccountDeletionStripeReconcileResult>;

export type AccountDeletionServiceDependencies = {
  reconcileStripeAction?: StripeActionReconciler;
};

export class AccountDeletionServiceError extends Error {
  constructor(
    readonly code: AccountDeletionServiceErrorCode,
    readonly status: number,
    readonly publicMessage: string,
  ) {
    super(code);
    this.name = "AccountDeletionServiceError";
  }
}

export async function scheduleCustomerAccountDeletion({
  businessId,
  ownerId,
  billingMode,
  now = new Date(),
  dependencies,
}: {
  businessId: string;
  ownerId: string;
  billingMode: BillingMode;
  now?: Date;
  dependencies?: AccountDeletionServiceDependencies;
}): Promise<ScheduledAccountDeletion> {
  const deletionDate = new Date(now.getTime() + DELETION_GRACE_PERIOD_MS);

  const { data, error } = await supabaseAdmin.rpc("schedule_account_deletion", {
    p_business_id: businessId,
    p_owner_id: ownerId,
    p_deleted_at: now.toISOString(),
    p_deletion_scheduled_for: deletionDate.toISOString(),
  });

  if (error) {
    const mapped = mapAccountDeletionRpcError(error, "account_deletion_failed");
    logFailure("schedule", businessId, mapped.code);
    throw mapped;
  }

  const deletion = parseScheduledAccountDeletion(data, businessId);
  if (!deletion) {
    const mapped = serviceError("account_deletion_failed");
    logFailure("schedule_payload", businessId, mapped.code);
    throw mapped;
  }

  await processScheduledAccountDeletion({
    deletion,
    billingMode,
    dependencies,
  });

  return deletion;
}

export async function getAdminAccountDeletionPreview(
  businessId: string,
): Promise<AccountDeletionPreview> {
  const { data, error } = await supabaseAdmin.rpc(
    "get_account_deletion_preview",
    { p_business_id: businessId },
  );

  if (error) {
    const mapped = mapAccountDeletionRpcError(error, "account_deletion_failed");
    logFailure("admin_preview", businessId, mapped.code);
    throw mapped;
  }

  const preview = parseAccountDeletionPreview(data, businessId);
  if (!preview) {
    const mapped = serviceError("account_deletion_failed");
    logFailure("admin_preview_payload", businessId, mapped.code);
    throw mapped;
  }

  return preview;
}

export async function scheduleAdminAccountDeletion({
  businessId,
  confirmationName,
  acknowledgeLiveResources,
  actorAdminUserId,
  dependencies,
}: {
  businessId: string;
  confirmationName: string;
  acknowledgeLiveResources: boolean;
  actorAdminUserId: string;
  dependencies?: AccountDeletionServiceDependencies;
}): Promise<AdminAccountDeletionRun> {
  const { data, error } = await supabaseAdmin.rpc(
    "schedule_admin_account_deletion",
    {
      p_business_id: businessId,
      p_confirmation_name: confirmationName,
      p_acknowledge_live_resources: acknowledgeLiveResources,
      p_actor_admin_user_id: actorAdminUserId,
    },
  );

  if (error) {
    const mapped = mapAccountDeletionRpcError(error, "account_deletion_failed");
    logFailure("admin_schedule", businessId, mapped.code);
    throw mapped;
  }

  const run = parseAdminAccountDeletionRun(data, businessId);
  if (!run) {
    const mapped = serviceError("account_deletion_failed");
    logFailure("admin_schedule_payload", businessId, mapped.code);
    throw mapped;
  }

  await processScheduledAccountDeletion({
    deletion: run.scheduled,
    billingMode: run.preview.billingMode,
    dependencies,
  });

  return run;
}

export async function processScheduledAccountDeletion({
  deletion,
  billingMode,
  dependencies,
}: {
  deletion: ScheduledAccountDeletion;
  billingMode: BillingMode;
  dependencies?: AccountDeletionServiceDependencies;
}): Promise<void> {
  if (billingMode !== "stripe" && deletion.stripeAction !== null) {
    const mapped = serviceError("account_deletion_failed");
    logFailure("partner_stripe_action", deletion.businessId, mapped.code);
    throw mapped;
  }

  const stripeAction = deletion.stripeAction;
  if (!stripeAction) return;

  if (stripeAction.status === "blocked") {
    logFailure(
      "stripe_pause",
      deletion.businessId,
      `blocked_generation_${stripeAction.generation}`,
    );
    return;
  }
  if (stripeAction.status !== "pending") return;

  const reconcile =
    dependencies?.reconcileStripeAction ??
    reconcileAccountDeletionStripeActionLazily;
  try {
    const result = await reconcile({
      businessId: deletion.businessId,
      generation: stripeAction.generation,
    });
    if (result.outcome !== "applied") {
      logFailure(
        "stripe_pause",
        deletion.businessId,
        `${result.outcome}_generation_${stripeAction.generation}`,
      );
    }
  } catch {
    logFailure(
      "stripe_pause",
      deletion.businessId,
      `failed_generation_${stripeAction.generation}`,
    );
  }
}

export async function reactivateCustomerAccount({
  businessId,
  ownerId,
  billingMode,
  dependencies,
}: {
  businessId: string;
  ownerId: string;
  billingMode: BillingMode;
  dependencies?: AccountDeletionServiceDependencies;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "prepare_account_reactivation",
    {
      p_business_id: businessId,
      p_owner_id: ownerId,
    },
  );

  if (error) {
    const mapped = mapReactivationRpcError(error);
    logFailure("reactivation_prepare", businessId, mapped.code);
    throw mapped;
  }

  const prepared = parsePreparedReactivation(data, businessId);
  if (!prepared) {
    const mapped = serviceError("account_reactivation_failed");
    logFailure("reactivation_payload", businessId, mapped.code);
    throw mapped;
  }

  if (billingMode !== "stripe" && prepared.stripeAction !== null) {
    const mapped = serviceError("account_reactivation_failed");
    logFailure("partner_resume_action", businessId, mapped.code);
    throw mapped;
  }

  if (prepared.alreadyActive) return;

  const stripeAction = prepared.stripeAction;
  if (stripeAction?.status === "blocked") {
    const mapped = serviceError("stripe_resume_blocked");
    logFailure("stripe_resume", businessId, mapped.code);
    throw mapped;
  }

  if (stripeAction?.status === "pending") {
    const reconcile =
      dependencies?.reconcileStripeAction ??
      reconcileAccountDeletionStripeActionLazily;
    let result: AccountDeletionStripeReconcileResult;
    try {
      result = await reconcile({
        businessId,
        generation: stripeAction.generation,
      });
    } catch {
      const mapped = serviceError("stripe_resume_retryable");
      logFailure("stripe_resume", businessId, mapped.code);
      throw mapped;
    }

    if (result.outcome === "blocked") {
      const mapped = serviceError("stripe_resume_blocked");
      logFailure("stripe_resume", businessId, mapped.code);
      throw mapped;
    }
    if (
      result.outcome !== "applied" ||
      (result.appliedAction !== "resume" && result.appliedAction !== "cancel")
    ) {
      const mapped = serviceError("stripe_resume_retryable");
      logFailure("stripe_resume", businessId, mapped.code);
      throw mapped;
    }
  }

  const { data: completed, error: completionError } = await supabaseAdmin.rpc(
    "complete_account_reactivation",
    {
      p_business_id: businessId,
      p_owner_id: ownerId,
      p_generation: stripeAction?.generation ?? null,
      p_reactivation_reservation_token: prepared.reservationToken,
    },
  );

  if (completionError || completed !== true) {
    const mapped = serviceError("account_reactivation_failed");
    logFailure("reactivation_complete", businessId, mapped.code);
    throw mapped;
  }
}

export async function reconcileAccountDeletionStripeActionLazily(input: {
  businessId: string;
  generation: number;
}): Promise<AccountDeletionStripeReconcileResult> {
  const { reconcileAccountDeletionStripeAction } =
    await import("@/lib/stripe/accountDeletionReconciler");
  return reconcileAccountDeletionStripeAction(input);
}

export function parseScheduledAccountDeletion(
  value: unknown,
  expectedBusinessId: string,
): ScheduledAccountDeletion | null {
  if (
    !isRecord(value) ||
    value.business_id !== expectedBusinessId ||
    !isTimestamp(value.deleted_at) ||
    !isTimestamp(value.deletion_scheduled_for)
  ) {
    return null;
  }

  if (value.stripe_action === null) {
    return {
      businessId: expectedBusinessId,
      deletedAt: value.deleted_at,
      deletionScheduledFor: value.deletion_scheduled_for,
      stripeAction: null,
    };
  }

  const stripeAction = value.stripe_action;
  if (
    !isRecord(stripeAction) ||
    stripeAction.business_id !== expectedBusinessId ||
    stripeAction.desired_action !== "pause" ||
    !isPositiveSafeInteger(stripeAction.generation) ||
    !isStripeActionStatus(stripeAction.status) ||
    !isNullableStripeAction(stripeAction.applied_action)
  ) {
    return null;
  }

  if (
    stripeAction.status === "applied" &&
    stripeAction.applied_action !== "pause" &&
    stripeAction.applied_action !== "cancel"
  ) {
    return null;
  }

  return {
    businessId: expectedBusinessId,
    deletedAt: value.deleted_at,
    deletionScheduledFor: value.deletion_scheduled_for,
    stripeAction: {
      generation: stripeAction.generation,
      status: stripeAction.status,
      appliedAction: stripeAction.applied_action,
    },
  };
}

export function parseAccountDeletionPreview(
  value: unknown,
  expectedBusinessId: string,
): AccountDeletionPreview | null {
  if (!isRecord(value) || value.business_id !== expectedBusinessId) {
    return null;
  }

  const billingMode = value.billing_mode;
  const partnerId = value.partner_id;
  const partnerSlug = value.partner_slug;
  const lifecycleStage = value.lifecycle_stage;
  const deletionScheduledFor = value.deletion_scheduled_for;
  const subscriptionStatus = value.subscription_status;
  const campaignStatus = value.campaign_status;
  const operationState = value.provisioning_operation_state;

  if (
    typeof value.business_name !== "string" ||
    !isBillingMode(billingMode) ||
    (partnerId !== null && !isUuid(partnerId)) ||
    (partnerSlug !== null && !isPartnerSlug(partnerSlug)) ||
    (partnerId === null) !== (partnerSlug === null) ||
    !isLifecycleStage(lifecycleStage) ||
    (deletionScheduledFor !== null && !isTimestamp(deletionScheduledFor)) ||
    (lifecycleStage === "suspended") !== (deletionScheduledFor !== null) ||
    !isNullableSubscriptionStatus(subscriptionStatus) ||
    !isNullableCampaignStatus(campaignStatus) ||
    !isNonnegativeSafeInteger(value.assigned_phone_count) ||
    typeof value.has_pending_phone_number !== "boolean" ||
    !isNonnegativeSafeInteger(value.provisioning_job_count) ||
    !isProvisioningOperationState(operationState) ||
    (value.requires_live_acknowledgement !== null &&
      typeof value.requires_live_acknowledgement !== "boolean")
  ) {
    return null;
  }

  const requiresLiveAcknowledgement =
    subscriptionStatus === "active" ||
    subscriptionStatus === "trialing" ||
    subscriptionStatus === "past_due" ||
    campaignStatus === "pending" ||
    campaignStatus === "approved" ||
    value.assigned_phone_count > 0 ||
    value.has_pending_phone_number;

  if (
    value.requires_live_acknowledgement !== requiresLiveAcknowledgement &&
    !(
      value.requires_live_acknowledgement === null &&
      !requiresLiveAcknowledgement
    )
  ) {
    return null;
  }

  return {
    businessId: expectedBusinessId,
    businessName: value.business_name,
    billingMode,
    partnerId,
    partnerSlug,
    lifecycleStage,
    deletionScheduledFor,
    subscriptionStatus,
    campaignStatus,
    assignedPhoneCount: value.assigned_phone_count,
    hasPendingPhoneNumber: value.has_pending_phone_number,
    provisioningJobCount: value.provisioning_job_count,
    provisioningOperationState: operationState,
    requiresLiveAcknowledgement,
  };
}

export function parseAdminAccountDeletionRun(
  value: unknown,
  expectedBusinessId: string,
): AdminAccountDeletionRun | null {
  if (!isRecord(value)) return null;
  const scheduled = parseScheduledAccountDeletion(
    value.scheduled,
    expectedBusinessId,
  );
  const preview = parseAccountDeletionPreview(
    value.preview,
    expectedBusinessId,
  );
  if (
    !scheduled ||
    !preview ||
    typeof value.admin_event_created !== "boolean" ||
    typeof value.previously_scheduled_by_admin !== "boolean" ||
    (value.admin_event_created && value.previously_scheduled_by_admin) ||
    preview.lifecycleStage !== "suspended" ||
    scheduled.deletionScheduledFor !== preview.deletionScheduledFor
  ) {
    return null;
  }

  return {
    scheduled,
    preview,
    adminEventCreated: value.admin_event_created,
    previouslyScheduledByAdmin: value.previously_scheduled_by_admin,
  };
}

export function mapAccountDeletionRpcError(
  error: unknown,
  fallback: "account_deletion_failed" | "account_reactivation_failed",
): AccountDeletionServiceError {
  const text = rpcErrorText(error);
  const known = [
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "partner_subscription_conflict",
    "stripe_action_in_progress",
    "stripe_action_outcome_unknown",
    "business_not_found",
    "confirmation_mismatch",
    "live_ack_required",
  ] as const;
  const code = known.find((candidate) =>
    new RegExp(`\\b${candidate}\\b`).test(text),
  );
  return serviceError(code ?? fallback);
}

export function accountDeletionErrorBody(error: AccountDeletionServiceError): {
  error: string;
  code?: string;
  message?: string;
} {
  if (isStableConflict(error.code)) {
    return {
      error: error.code,
      code: error.code,
      message: error.publicMessage,
    };
  }
  if (
    error.code === "stripe_resume_retryable" ||
    error.code === "stripe_resume_blocked"
  ) {
    return { error: error.publicMessage, code: error.code };
  }
  return { error: error.publicMessage };
}

function parsePreparedReactivation(
  value: unknown,
  expectedBusinessId: string,
): {
  alreadyActive: boolean;
  stripeAction: ScheduledStripeAction | null;
  reservationToken: string | null;
} | null {
  if (
    !isRecord(value) ||
    value.business_id !== expectedBusinessId ||
    typeof value.already_active !== "boolean"
  ) {
    return null;
  }

  if (value.already_active) {
    return value.stripe_action === null
      ? {
          alreadyActive: true,
          stripeAction: null,
          reservationToken: null,
        }
      : null;
  }

  if (
    !isTimestamp(value.deletion_scheduled_for) ||
    !isUuid(value.reactivation_reservation_token) ||
    !isTimestamp(value.reactivation_reservation_expires_at)
  ) {
    return null;
  }

  if (value.stripe_action === null) {
    return {
      alreadyActive: false,
      stripeAction: null,
      reservationToken: value.reactivation_reservation_token,
    };
  }

  const stripeAction = value.stripe_action;
  if (
    !isRecord(stripeAction) ||
    stripeAction.business_id !== expectedBusinessId ||
    stripeAction.desired_action !== "resume" ||
    !isPositiveSafeInteger(stripeAction.generation) ||
    !isStripeActionStatus(stripeAction.status) ||
    !isNullableStripeAction(stripeAction.applied_action)
  ) {
    return null;
  }
  if (
    stripeAction.status === "applied" &&
    stripeAction.applied_action !== "resume" &&
    stripeAction.applied_action !== "cancel"
  ) {
    return null;
  }

  return {
    alreadyActive: false,
    stripeAction: {
      generation: stripeAction.generation,
      status: stripeAction.status,
      appliedAction: stripeAction.applied_action,
    },
    reservationToken: value.reactivation_reservation_token,
  };
}

function mapReactivationRpcError(error: unknown): AccountDeletionServiceError {
  const mapped = mapAccountDeletionRpcError(
    error,
    "account_reactivation_failed",
  );
  if (mapped.code !== "account_reactivation_failed") return mapped;

  const text = rpcErrorText(error);
  if (
    /\b(outside (?:the reactivation )?grace period|no longer reactivatable|Telnyx resources can no longer be automatically reactivated)\b/i.test(
      text,
    )
  ) {
    return serviceError("account_permanently_deleted");
  }
  return mapped;
}

function serviceError(
  code: AccountDeletionServiceErrorCode,
): AccountDeletionServiceError {
  switch (code) {
    case "provisioning_in_progress":
      return new AccountDeletionServiceError(
        code,
        409,
        "Account provisioning is still in progress. Try again shortly.",
      );
    case "provisioning_outcome_unknown":
      return new AccountDeletionServiceError(
        code,
        409,
        "Account provisioning must be reconciled before deletion.",
      );
    case "partner_subscription_conflict":
    case "stripe_action_in_progress":
    case "stripe_action_outcome_unknown":
      return new AccountDeletionServiceError(
        code,
        409,
        "Account billing state must be reconciled before deletion.",
      );
    case "business_not_found":
      return new AccountDeletionServiceError(code, 404, "Not found");
    case "confirmation_mismatch":
      return new AccountDeletionServiceError(
        code,
        409,
        "The business name changed. Refresh and try again.",
      );
    case "live_ack_required":
      return new AccountDeletionServiceError(
        code,
        409,
        "Live resources require explicit acknowledgement.",
      );
    case "account_permanently_deleted":
      return new AccountDeletionServiceError(
        code,
        410,
        "Account has been permanently deleted and cannot be reactivated",
      );
    case "stripe_resume_retryable":
      return new AccountDeletionServiceError(
        code,
        503,
        "We couldn't resume billing right now. Your account remains scheduled for deletion. Please try again.",
      );
    case "stripe_resume_blocked":
      return new AccountDeletionServiceError(
        code,
        503,
        "We couldn't resume billing automatically. Your account remains scheduled for deletion. Please contact support.",
      );
    case "account_reactivation_failed":
      return new AccountDeletionServiceError(
        code,
        500,
        "Failed to reactivate account",
      );
    default:
      return new AccountDeletionServiceError(
        "account_deletion_failed",
        500,
        "Failed to delete account",
      );
  }
}

function isStableConflict(code: AccountDeletionServiceErrorCode): boolean {
  return (
    code === "provisioning_in_progress" ||
    code === "provisioning_outcome_unknown" ||
    code === "partner_subscription_conflict" ||
    code === "stripe_action_in_progress" ||
    code === "stripe_action_outcome_unknown" ||
    code === "confirmation_mismatch" ||
    code === "live_ack_required"
  );
}

function logFailure(
  operation: string,
  businessId: string,
  status: string,
): void {
  console.error(
    `[account-deletion] ${operation} for business ${businessId}: ${status}`,
  );
}

function rpcErrorText(error: unknown): string {
  if (!isRecord(error)) return "";
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isBillingMode(value: unknown): value is BillingMode {
  return value === "stripe" || value === "invoiced" || value === "comped";
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isStripeActionStatus(
  value: unknown,
): value is ScheduledStripeAction["status"] {
  return value === "pending" || value === "applied" || value === "blocked";
}

function isNullableStripeAction(
  value: unknown,
): value is ScheduledStripeAction["appliedAction"] {
  return (
    value === null ||
    value === "pause" ||
    value === "resume" ||
    value === "cancel"
  );
}

function isLifecycleStage(
  value: unknown,
): value is AccountDeletionPreview["lifecycleStage"] {
  return (
    value === "onboarding" || value === "launched" || value === "suspended"
  );
}

function isNullableSubscriptionStatus(
  value: unknown,
): value is SubscriptionStatus | null {
  return (
    value === null ||
    value === "active" ||
    value === "past_due" ||
    value === "canceled" ||
    value === "trialing"
  );
}

function isNullableCampaignStatus(
  value: unknown,
): value is AccountDeletionPreview["campaignStatus"] {
  return (
    value === null ||
    value === "pending" ||
    value === "approved" ||
    value === "rejected"
  );
}

function isProvisioningOperationState(
  value: unknown,
): value is AccountDeletionPreview["provisioningOperationState"] {
  return value === "idle" || value === "active" || value === "unknown";
}

function isPartnerSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 63 &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}
