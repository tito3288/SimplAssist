import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";
import {
  adminPhoneAssignmentRecheckAuditResultSchema,
  adminPhoneAssignmentRecheckRequestSchema,
  adminPhoneAssignmentRecheckResponseSchema,
} from "@/lib/admin/phoneAssignmentRecheck.shared";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";
import { supabaseAdmin } from "@/lib/supabase/admin";

const businessIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

const RPC_NAME = "request_admin_phone_assignment_recheck";

export async function POST(
  request: NextRequest,
  { params }: { params: { businessId: string } },
) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const businessId = businessIdSchema.safeParse(params.businessId);
  if (!businessId.success) {
    return adminMutationJson({ error: "Not found" }, { status: 404 });
  }

  const body = await readAdminMutationJson(request);
  if (!body.ok) return body.response;

  const input = adminPhoneAssignmentRecheckRequestSchema.safeParse(body.value);
  if (!input.success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  let rpcResult: { data: unknown; error: unknown };
  try {
    rpcResult = await supabaseAdmin.rpc(RPC_NAME, {
      p_business_id: businessId.data,
      p_actor_admin_user_id: authorization.admin.id,
    });
  } catch {
    return assignmentRecheckFailure(businessId.data, "rpc_failed");
  }

  if (rpcResult.error) {
    const mapped = mapAssignmentRecheckRpcError(rpcResult.error);
    if (mapped) return mapped;
    return assignmentRecheckFailure(businessId.data, "rpc_failed");
  }

  const auditResult =
    adminPhoneAssignmentRecheckAuditResultSchema.safeParse(rpcResult.data);
  if (
    !auditResult.success ||
    auditResult.data.business_id !== businessId.data
  ) {
    return assignmentRecheckFailure(businessId.data, "invalid_rpc_result");
  }

  try {
    await ensureCampaignAssignmentForBusiness(businessId.data, {
      force: true,
      reason: "admin_recheck",
    });
  } catch {
    return assignmentRecheckFailure(businessId.data, "helper_failed");
  }

  return adminMutationJson(
    adminPhoneAssignmentRecheckResponseSchema.parse({ requested: true }),
  );
}

function mapAssignmentRecheckRpcError(error: unknown) {
  const sqlState =
    isRecord(error) && typeof error.code === "string" ? error.code : "";
  const text = isRecord(error)
    ? [error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";

  if (sqlState === "P0002" && /\bbusiness_not_found\b/.test(text)) {
    return adminMutationJson({ error: "Not found" }, { status: 404 });
  }

  if (sqlState !== "55000") return null;

  if (/\baccount_operations_suspended\b/.test(text)) {
    return adminMutationJson(
      { error: "account_operations_suspended" },
      { status: 409 },
    );
  }

  if (/\bphone_assignment_recheck_in_progress\b/.test(text)) {
    return adminMutationJson(
      { error: "phone_assignment_recheck_in_progress" },
      { status: 409 },
    );
  }

  if (
    /\baccount_deletion_in_progress\b/.test(text) ||
    /\bphone_assignment_recheck_unavailable\b/.test(text) ||
    /\bphone_assignment_recheck_not_needed\b/.test(text)
  ) {
    return adminMutationJson(
      { error: "phone_assignment_recheck_unavailable" },
      { status: 409 },
    );
  }

  return null;
}

function assignmentRecheckFailure(
  businessId: string,
  failure: "rpc_failed" | "invalid_rpc_result" | "helper_failed",
) {
  // RPC and provider errors can contain customer and Telnyx details. Keep
  // diagnostics limited to our stable marker and the already-authorized ID.
  console.error(
    `[admin:assignment-recheck] ${failure} for business ${businessId}`,
  );
  return adminMutationJson(
    { error: "assignment_recheck_failed" },
    { status: 500 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
