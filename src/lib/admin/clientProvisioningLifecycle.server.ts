import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  provisioningLifecycleResponseSchema,
  provisioningStatusSchema,
  type AdminProvisioningRecord,
  type ProvisioningLifecycleResponse,
} from "./clientProvisioning.shared";
import { parseAdminProvisioningRecord } from "./clientProvisioningReadModel";

const JOB_COLUMNS = [
  "id",
  "email",
  "requested_business_name",
  "partner_id",
  "billing_mode",
  "partner_plan",
  "auth_user_id",
  "business_id",
  "status",
  "last_error_code",
  "setup_email_sent_at",
  "invite_attempt_count",
  "dismissed_at",
  "operation_token",
  "operation_kind",
  "operation_started_at",
  "operation_expires_at",
  "created_at",
  "updated_at",
].join(",");

const PARTNER_COLUMNS = [
  "id",
  "name",
  "custom_domain",
  "status",
  "domain_status",
].join(",");

const OWNER_BUSINESS_COLUMNS = ["id", "owner_id"].join(",");

const rpcRowSchema = z
  .object({
    id: z.string().uuid(),
    status: provisioningStatusSchema,
  })
  .passthrough();

export type ProvisioningQueueView = "current" | "dismissed";

export type ProvisioningLifecycleErrorCode =
  | "job_not_found"
  | "provisioning_in_progress"
  | "provisioning_outcome_unknown"
  | "provisioning_has_resources"
  | "job_not_dismissible"
  | "provisioning_action_failed";

export class ProvisioningLifecycleError extends Error {
  constructor(
    readonly code: ProvisioningLifecycleErrorCode,
    readonly status: number,
  ) {
    super(code);
    this.name = "ProvisioningLifecycleError";
  }
}

export async function listAdminProvisioningRecords(
  view: ProvisioningQueueView,
): Promise<{ records: AdminProvisioningRecord[]; invalidRecordCount: number }> {
  let query = supabaseAdmin
    .from("partner_client_provisioning_jobs")
    .select(JOB_COLUMNS);
  query =
    view === "dismissed"
      ? query.eq("status", "dismissed")
      : query.neq("status", "dismissed");

  const jobsResult = await query
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });
  if (jobsResult.error) throw new Error("Could not load provisioning jobs");

  const jobs = Array.isArray(jobsResult.data) ? jobsResult.data : [];
  const partnerIds = Array.from(
    new Set(
      jobs.flatMap((job) =>
        isRecord(job) && typeof job.partner_id === "string"
          ? [job.partner_id]
          : [],
      ),
    ),
  );
  const partnersResult =
    partnerIds.length === 0
      ? { data: [], error: null }
      : await supabaseAdmin
          .from("partners")
          .select(PARTNER_COLUMNS)
          .in("id", partnerIds);
  if (partnersResult.error)
    throw new Error("Could not load provisioning partners");

  const ownerIds = Array.from(
    new Set(
      jobs.flatMap((job) =>
        isRecord(job) &&
        job.business_id === null &&
        typeof job.auth_user_id === "string"
          ? [job.auth_user_id]
          : [],
      ),
    ),
  );
  const ownerBusinesses = await loadOwnerBusinesses(ownerIds);

  const partnerById = new Map<string, unknown>();
  for (const partner of partnersResult.data ?? []) {
    if (isRecord(partner) && typeof partner.id === "string") {
      partnerById.set(partner.id, partner);
    }
  }

  const businessesByOwner = groupBusinessesByOwner(ownerBusinesses);

  const now = new Date();
  const records: AdminProvisioningRecord[] = [];
  let invalidRecordCount = 0;
  for (const job of jobs) {
    const partnerId = isRecord(job) ? job.partner_id : null;
    const ownerId = isRecord(job) ? job.auth_user_id : null;
    const ownerBusinessRows =
      typeof ownerId === "string" ? businessesByOwner.get(ownerId) : undefined;
    const ownerBusiness =
      ownerBusinessRows?.length === 1 ? ownerBusinessRows[0] : null;
    const record =
      typeof partnerId === "string"
        ? parseAdminProvisioningRecord(
            job,
            partnerById.get(partnerId),
            now,
            ownerBusiness,
          )
        : null;
    if (record) records.push(record);
    else invalidRecordCount += 1;
  }

  return { records, invalidRecordCount };
}

export async function loadAdminProvisioningRecord(
  provisioningId: string,
): Promise<AdminProvisioningRecord | null> {
  const jobResult = await supabaseAdmin
    .from("partner_client_provisioning_jobs")
    .select(JOB_COLUMNS)
    .eq("id", provisioningId)
    .maybeSingle();
  if (jobResult.error) throw new Error("Could not load the provisioning job");
  if (
    !isRecord(jobResult.data) ||
    typeof jobResult.data.partner_id !== "string"
  ) {
    return null;
  }

  const partnerResult = await supabaseAdmin
    .from("partners")
    .select(PARTNER_COLUMNS)
    .eq("id", jobResult.data.partner_id)
    .maybeSingle();
  if (partnerResult.error) {
    throw new Error("Could not load the provisioning partner");
  }

  const ownerBusinesses =
    jobResult.data.business_id === null &&
    typeof jobResult.data.auth_user_id === "string"
      ? await loadOwnerBusinesses([jobResult.data.auth_user_id])
      : [];
  const ownerBusiness =
    ownerBusinesses.length === 1 ? ownerBusinesses[0] : null;
  return parseAdminProvisioningRecord(
    jobResult.data,
    partnerResult.data,
    new Date(),
    ownerBusiness,
  );
}

export async function dismissAdminProvisioningJob(
  provisioningId: string,
  adminId: string,
): Promise<ProvisioningLifecycleResponse> {
  const result = await supabaseAdmin.rpc(
    "dismiss_partner_client_provisioning_job",
    {
      p_job_id: provisioningId,
      p_admin_user_id: adminId,
    },
  );
  if (result.error) {
    throw mapLifecycleRpcError("dismiss", provisioningId, result.error);
  }
  return parseLifecycleResult("dismiss", provisioningId, result.data);
}

export async function restoreAdminProvisioningJob(
  provisioningId: string,
  adminId: string,
): Promise<ProvisioningLifecycleResponse> {
  const result = await supabaseAdmin.rpc(
    "restore_partner_client_provisioning_job",
    {
      p_job_id: provisioningId,
      p_admin_user_id: adminId,
    },
  );
  if (result.error) {
    throw mapLifecycleRpcError("restore", provisioningId, result.error);
  }
  return parseLifecycleResult("restore", provisioningId, result.data);
}

function parseLifecycleResult(
  action: "dismiss" | "restore",
  provisioningId: string,
  value: unknown,
): ProvisioningLifecycleResponse {
  const row = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value;
  const parsed = rpcRowSchema.safeParse(row);
  const expectedStatus = action === "dismiss" ? "dismissed" : "needs_attention";
  if (
    !parsed.success ||
    parsed.data.id !== provisioningId ||
    parsed.data.status !== expectedStatus
  ) {
    logLifecycleFailure(action, provisioningId, "invalid_result");
    throw new ProvisioningLifecycleError("provisioning_action_failed", 500);
  }
  return provisioningLifecycleResponseSchema.parse({
    provisioningId,
    status: parsed.data.status,
  });
}

function mapLifecycleRpcError(
  action: "dismiss" | "restore",
  provisioningId: string,
  error: unknown,
): ProvisioningLifecycleError {
  const sqlState =
    isRecord(error) && typeof error.code === "string" ? error.code : "";
  const text = isRecord(error)
    ? [error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";

  if (sqlState === "P0002" && /\bprovisioning_job_not_found\b/.test(text)) {
    logLifecycleFailure(action, provisioningId, "job_not_found");
    return new ProvisioningLifecycleError("job_not_found", 404);
  }
  if (sqlState === "55000") {
    for (const code of [
      "provisioning_in_progress",
      "provisioning_outcome_unknown",
      "provisioning_has_resources",
      "job_not_dismissible",
    ] as const) {
      if (new RegExp(`\\b${code}\\b`).test(text)) {
        logLifecycleFailure(action, provisioningId, code);
        return new ProvisioningLifecycleError(code, 409);
      }
    }
  }

  logLifecycleFailure(action, provisioningId, "provisioning_action_failed");
  return new ProvisioningLifecycleError("provisioning_action_failed", 500);
}

function logLifecycleFailure(
  action: string,
  provisioningId: string,
  code: string,
): void {
  console.error(
    `[admin:client-lifecycle] ${action} for provisioning ${provisioningId}: ${code}`,
  );
}

async function loadOwnerBusinesses(ownerIds: string[]): Promise<unknown[]> {
  if (ownerIds.length === 0) return [];

  const result = await supabaseAdmin
    .from("businesses")
    .select(OWNER_BUSINESS_COLUMNS)
    .in("owner_id", ownerIds);
  if (result.error) throw new Error("Could not load provisioning businesses");
  return Array.isArray(result.data) ? result.data : [];
}

function groupBusinessesByOwner(businesses: unknown[]): Map<string, unknown[]> {
  const result = new Map<string, unknown[]>();
  for (const business of businesses) {
    if (!isRecord(business) || typeof business.owner_id !== "string") continue;
    const rows = result.get(business.owner_id) ?? [];
    rows.push(business);
    result.set(business.owner_id, rows);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
