import {
  publicProvisioningJobSchema,
  type PublicProvisioningJob,
} from "@/lib/admin/clientProvisioning.shared";
import { normalizeHostHeader } from "@/lib/branding/hostname";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseProvisioningDetailRows(
  jobRow: unknown,
  partnerRow: unknown,
): PublicProvisioningJob | null {
  if (!isRecord(jobRow) || !isRecord(partnerRow)) return null;

  const partnerDomain = partnerRow.custom_domain;
  if (
    typeof partnerRow.id !== "string" ||
    partnerRow.id !== jobRow.partner_id ||
    typeof partnerRow.name !== "string" ||
    !partnerRow.name.trim() ||
    partnerRow.name !== partnerRow.name.trim() ||
    partnerRow.status !== "active" ||
    partnerRow.domain_status !== "connected" ||
    typeof partnerDomain !== "string" ||
    normalizeHostHeader(partnerDomain) !== partnerDomain ||
    !isTimestamp(jobRow.created_at) ||
    !isTimestamp(jobRow.updated_at) ||
    (jobRow.setup_email_sent_at !== null &&
      !isTimestamp(jobRow.setup_email_sent_at))
  ) {
    return null;
  }

  const candidate = {
    id: jobRow.id,
    email: jobRow.email,
    businessName: jobRow.requested_business_name,
    partnerId: jobRow.partner_id,
    partnerName: partnerRow.name,
    billingMode: jobRow.billing_mode,
    partnerPlan: jobRow.partner_plan,
    status: jobRow.status,
    lastErrorCode: jobRow.last_error_code,
    authUserId: jobRow.auth_user_id,
    businessId: jobRow.business_id,
    setupEmailSentAt: jobRow.setup_email_sent_at,
    inviteAttemptCount: jobRow.invite_attempt_count,
    createdAt: jobRow.created_at,
    updatedAt: jobRow.updated_at,
  };
  const parsed = publicProvisioningJobSchema.safeParse(candidate);
  if (!parsed.success) return null;

  // The shared schema normalizes email/name inputs for API writes. Database
  // reads must already be canonical rather than becoming valid by transform.
  if (
    parsed.data.email !== jobRow.email ||
    parsed.data.businessName !== jobRow.requested_business_name ||
    parsed.data.partnerName !== partnerRow.name
  ) {
    return null;
  }

  return parsed.data;
}
