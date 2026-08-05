import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  adminAccountServiceControlResponseSchema,
  type AdminAccountServiceControlRequest,
  type AdminAccountServiceControlResponse,
} from "./accountServiceControls.shared";

const operationalTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();
const canonicalBusinessIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

const rpcResultSchema = z
  .object({
    business_id: z.string().uuid(),
    changed: z.boolean(),
    admin_event_id: z.string().uuid().nullable(),
    operations_suspended_at: operationalTimestampSchema,
    ai_replies_paused_at: operationalTimestampSchema,
    texting_paused_at: operationalTimestampSchema,
    bookings_paused_at: operationalTimestampSchema,
  })
  .strict()
  .superRefine((result, context) => {
    if (result.changed !== (result.admin_event_id !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Operational-control audit result is inconsistent",
        path: ["admin_event_id"],
      });
    }
  });

export type AdminAccountServiceControlsErrorCode =
  | "business_not_found"
  | "account_deletion_in_progress"
  | "service_controls_failed";

export class AdminAccountServiceControlsError extends Error {
  constructor(
    readonly code: AdminAccountServiceControlsErrorCode,
    readonly status: 404 | 409 | 500,
  ) {
    super(code);
    this.name = "AdminAccountServiceControlsError";
  }
}

export async function setAdminAccountServiceControl({
  businessId,
  actorAdminUserId,
  input,
}: {
  businessId: string;
  actorAdminUserId: string;
  input: AdminAccountServiceControlRequest;
}): Promise<AdminAccountServiceControlResponse> {
  const parsedBusinessId = canonicalBusinessIdSchema.safeParse(businessId);
  if (!parsedBusinessId.success) {
    throw serviceControlsFailure(
      "invalid-business-id",
      "service_controls_failed",
      500,
    );
  }
  const canonicalBusinessId = parsedBusinessId.data;
  let result: { data: unknown; error: unknown };

  try {
    if (input.action === "suspend" || input.action === "reactivate") {
      result = await supabaseAdmin.rpc(
        "set_admin_business_operations_suspension",
        {
          p_business_id: canonicalBusinessId,
          p_suspended: input.action === "suspend",
          p_reason: input.reason,
          p_actor_admin_user_id: actorAdminUserId,
        },
      );
    } else {
      result = await supabaseAdmin.rpc("set_admin_business_service_pause", {
        p_business_id: canonicalBusinessId,
        p_service: input.service,
        p_paused: input.action === "pause",
        p_reason: input.reason ?? null,
        p_actor_admin_user_id: actorAdminUserId,
      });
    }
  } catch {
    throw serviceControlsFailure(
      canonicalBusinessId,
      "service_controls_failed",
      500,
    );
  }

  if (result.error) {
    throw mapServiceControlsRpcError(canonicalBusinessId, result.error);
  }

  const parsed = rpcResultSchema.safeParse(result.data);
  if (
    !parsed.success ||
    parsed.data.business_id !== canonicalBusinessId
  ) {
    throw serviceControlsFailure(
      canonicalBusinessId,
      "service_controls_failed",
      500,
    );
  }

  const response = adminAccountServiceControlResponseSchema.safeParse({
    changed: parsed.data.changed,
    adminEventId: parsed.data.admin_event_id,
    controls: {
      businessId: parsed.data.business_id,
      operationsSuspendedAt: parsed.data.operations_suspended_at,
      aiRepliesPausedAt: parsed.data.ai_replies_paused_at,
      textingPausedAt: parsed.data.texting_paused_at,
      bookingsPausedAt: parsed.data.bookings_paused_at,
    },
  });
  if (!response.success) {
    throw serviceControlsFailure(
      canonicalBusinessId,
      "service_controls_failed",
      500,
    );
  }

  return response.data;
}

function mapServiceControlsRpcError(
  businessId: string,
  error: unknown,
): AdminAccountServiceControlsError {
  const sqlState =
    isRecord(error) && typeof error.code === "string" ? error.code : "";
  const text = isRecord(error)
    ? [error.message, error.details, error.hint]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
    : "";

  if (sqlState === "P0002" && /\bbusiness_not_found\b/.test(text)) {
    return serviceControlsFailure(businessId, "business_not_found", 404);
  }
  if (
    sqlState === "55000" &&
    /\baccount_deletion_in_progress\b/.test(text)
  ) {
    return serviceControlsFailure(
      businessId,
      "account_deletion_in_progress",
      409,
    );
  }

  return serviceControlsFailure(businessId, "service_controls_failed", 500);
}

function serviceControlsFailure(
  businessId: string,
  code: AdminAccountServiceControlsErrorCode,
  status: 404 | 409 | 500,
): AdminAccountServiceControlsError {
  // RPC errors can include the durable admin reason in provider-controlled
  // detail fields. Log only stable identifiers and our own safe error code.
  console.error(
    `[admin:service-controls] mutation for business ${businessId}: ${code}`,
  );
  return new AdminAccountServiceControlsError(code, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
