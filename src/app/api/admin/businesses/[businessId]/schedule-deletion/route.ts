import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  AccountDeletionServiceError,
  accountDeletionErrorBody,
  getAdminAccountDeletionPreview,
  scheduleAdminAccountDeletion,
} from "@/lib/account/deletion.server";
import { adminAccountDeletionRequestSchema } from "@/lib/account/adminDeletion.shared";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";

const businessIdSchema = z.string().uuid();

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

  const input = adminAccountDeletionRequestSchema.safeParse(body.value);
  if (!input.success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await scheduleAdminAccountDeletion({
      businessId: businessId.data,
      confirmationName: input.data.confirmationName,
      acknowledgeLiveResources: input.data.acknowledgeLiveResources,
      actorAdminUserId: authorization.admin.id,
    });
    return adminMutationJson(result);
  } catch (error) {
    if (
      error instanceof AccountDeletionServiceError &&
      error.code === "live_ack_required"
    ) {
      try {
        const preview = await getAdminAccountDeletionPreview(businessId.data);
        return adminMutationJson(
          { ...accountDeletionErrorBody(error), preview },
          { status: error.status },
        );
      } catch {
        console.error(
          `[admin:account-deletion] refreshed preview failed for business ${businessId.data}`,
        );
        return adminMutationJson(
          { error: "Failed to schedule account deletion" },
          { status: 500 },
        );
      }
    }

    if (error instanceof AccountDeletionServiceError) {
      if (error.code === "business_not_found") {
        return adminMutationJson({ error: "Not found" }, { status: 404 });
      }
      return adminMutationJson(accountDeletionErrorBody(error), {
        status: error.status,
      });
    }

    console.error(
      `[admin:account-deletion] request failed for business ${businessId.data}`,
    );
    return adminMutationJson(
      { error: "Failed to schedule account deletion" },
      { status: 500 },
    );
  }
}
