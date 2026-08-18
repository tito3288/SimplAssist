import "server-only";

import { z } from "zod";
import { subscriptionPlanSchema } from "@/lib/billing/planSchema";
import { getCanonicalAppHostname } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import {
  adminProvisioningRecordSchema,
  publicProvisioningJobSchema,
  type AdminProvisioningRecord,
} from "./clientProvisioning.shared";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const storedJobSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string(),
    requested_business_name: z.string(),
    partner_id: z.string().uuid(),
    billing_mode: z.enum(["invoiced", "comped"]),
    partner_plan: subscriptionPlanSchema,
    auth_user_id: z.string().uuid().nullable(),
    business_id: z.string().uuid().nullable(),
    status: z.enum([
      "pending",
      "auth_created",
      "business_prepared",
      "assigned",
      "admin_setup",
      "invite_pending",
      "setup_email_sent",
      "needs_attention",
      "dismissed",
    ]),
    last_error_code: z.string().nullable(),
    setup_email_sent_at: z.string().nullable(),
    invite_attempt_count: z.number().int().nonnegative(),
    dismissed_at: z.string().nullable(),
    operation_token: z.string().uuid().nullable(),
    operation_kind: z.enum(["provision", "retry", "send_setup"]).nullable(),
    operation_started_at: z.string().nullable(),
    operation_expires_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .strict();

const storedPartnerSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    custom_domain: z.string().nullable(),
    status: z.enum(["active", "inactive"]),
    domain_status: z.enum(["pending", "connected"]),
  })
  .strict();

const storedOwnerBusinessSchema = z
  .object({
    id: z.string().uuid(),
    owner_id: z.string().uuid(),
  })
  .strict();

const PUBLIC_ERROR_CODES = new Set([
  "job_not_found",
  "job_dismissed",
  "provisioning_in_progress",
  "provisioning_outcome_unknown",
  "partner_inactive",
  "provisioning_conflict",
  "email_in_use",
  "auth_creation_failed",
  "auth_identity_mismatch",
  "setup_already_completed",
  "business_missing",
  "business_ambiguous",
  "business_identity_mismatch",
  "business_update_failed",
  "business_not_found",
  "subscription_exists",
  "partner_required",
  "assignment_failed",
  "link_generation_failed",
  "setup_email_failed",
  "provisioning_failed",
]);

export function parseAdminProvisioningRecord(
  rawJob: unknown,
  rawPartner: unknown,
  now = new Date(),
  rawOwnerBusiness: unknown = null,
): AdminProvisioningRecord | null {
  const jobResult = storedJobSchema.safeParse(rawJob);
  const partnerResult = storedPartnerSchema.safeParse(rawPartner);
  if (!jobResult.success || !partnerResult.success) return null;

  const job = jobResult.data;
  const partner = partnerResult.data;
  if (
    job.partner_id !== partner.id ||
    !isTimestamp(job.created_at) ||
    !isTimestamp(job.updated_at) ||
    (job.setup_email_sent_at !== null &&
      !isTimestamp(job.setup_email_sent_at)) ||
    (job.dismissed_at !== null && !isTimestamp(job.dismissed_at)) ||
    !partner.name.trim() ||
    partner.name !== partner.name.trim() ||
    /[\u0000-\u001f\u007f]/.test(partner.name)
  ) {
    return null;
  }

  const updatedAt = Date.parse(job.updated_at);
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  const operationState = parseOperationState(job, updatedAt, nowTime);
  if (!operationState) return null;

  const dismissed = job.status === "dismissed";
  const hasResources =
    job.auth_user_id !== null ||
    job.business_id !== null ||
    job.setup_email_sent_at !== null;
  if (
    dismissed !== (job.dismissed_at !== null) ||
    (dismissed && (hasResources || operationState !== "idle"))
  ) {
    return null;
  }

  const publicJob = publicProvisioningJobSchema.safeParse({
    id: job.id,
    email: job.email,
    businessName: job.requested_business_name,
    partnerId: job.partner_id,
    partnerName: partner.name,
    billingMode: job.billing_mode,
    partnerPlan: job.partner_plan,
    status: job.status,
    lastErrorCode: safeErrorCode(job.last_error_code),
    authUserId: job.auth_user_id,
    businessId: job.business_id,
    setupEmailSentAt: job.setup_email_sent_at,
    inviteAttemptCount: job.invite_attempt_count,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  });
  if (
    !publicJob.success ||
    publicJob.data.email !== job.email ||
    publicJob.data.businessName !== job.requested_business_name ||
    publicJob.data.partnerName !== partner.name
  ) {
    return null;
  }

  let accountBusinessId = job.business_id;
  if (job.business_id === null && rawOwnerBusiness !== null) {
    const ownerBusiness = storedOwnerBusinessSchema.safeParse(rawOwnerBusiness);
    if (
      !ownerBusiness.success ||
      job.auth_user_id === null ||
      ownerBusiness.data.owner_id !== job.auth_user_id
    ) {
      return null;
    }
    accountBusinessId = ownerBusiness.data.id;
  }

  const domain = partner.custom_domain;
  const validConnectedDomain =
    partner.domain_status === "connected" &&
    typeof domain === "string" &&
    domain.includes(".") &&
    normalizeHostHeader(domain) === domain &&
    domain !== getCanonicalAppHostname();
  const partnerAvailability =
    partner.status === "inactive"
      ? ("inactive" as const)
      : partner.domain_status === "pending"
        ? ("domain_pending" as const)
        : validConnectedDomain
          ? ("active_connected" as const)
          : ("unavailable" as const);

  const agedPending =
    job.status === "pending" && updatedAt <= nowTime - FIFTEEN_MINUTES_MS;
  const dismissalState = dismissed
    ? ("restore" as const)
    : operationState === "active"
      ? ("in_progress" as const)
      : operationState === "unknown"
        ? ("outcome_unknown" as const)
        : hasResources
          ? ("has_resources" as const)
          : job.status === "needs_attention" || agedPending
            ? ("dismissible" as const)
            : ("not_dismissible" as const);

  const record = adminProvisioningRecordSchema.safeParse({
    provisioning: publicJob.data,
    accountBusinessId,
    partnerAvailability,
    partnerOrigin:
      partnerAvailability === "active_connected" && domain
        ? `https://${domain}`
        : null,
    operationState,
    dismissalState,
    dismissedAt: job.dismissed_at,
  });
  return record.success ? record.data : null;
}

function parseOperationState(
  job: z.infer<typeof storedJobSchema>,
  updatedAt: number,
  nowTime: number,
): "idle" | "active" | "unknown" | null {
  const allNull =
    job.operation_token === null &&
    job.operation_kind === null &&
    job.operation_started_at === null &&
    job.operation_expires_at === null;
  if (allNull) return "idle";

  if (
    job.operation_token === null ||
    job.operation_kind === null ||
    !isTimestamp(job.operation_started_at) ||
    !isTimestamp(job.operation_expires_at)
  ) {
    return null;
  }
  const startedAt = Date.parse(job.operation_started_at);
  const expiresAt = Date.parse(job.operation_expires_at);
  if (
    expiresAt <= startedAt ||
    startedAt > updatedAt ||
    expiresAt > updatedAt + FIFTEEN_MINUTES_MS
  ) {
    return null;
  }
  return expiresAt > nowTime ? "active" : "unknown";
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null;
  return PUBLIC_ERROR_CODES.has(value) ? value : "unknown_error";
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}
