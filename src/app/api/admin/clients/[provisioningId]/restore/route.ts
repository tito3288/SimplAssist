import type { NextRequest } from "next/server";
import { provisioningIdSchema } from "@/lib/admin/clientProvisioning.shared";
import { restoreAdminProvisioningJob } from "@/lib/admin/clientProvisioningLifecycle.server";
import {
  emptyProvisioningLifecycleBodySchema,
  provisioningLifecycleFailure,
} from "@/lib/admin/clientProvisioningLifecycleRoute.server";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";

export async function POST(
  request: NextRequest,
  { params }: { params: { provisioningId: string } },
) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const provisioningId = provisioningIdSchema.safeParse(params.provisioningId);
  if (!provisioningId.success) {
    return adminMutationJson({ error: "job_not_found" }, { status: 404 });
  }

  const body = await readAdminMutationJson(request);
  if (!body.ok) return body.response;
  if (!emptyProvisioningLifecycleBodySchema.safeParse(body.value).success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    return adminMutationJson(
      await restoreAdminProvisioningJob(
        provisioningId.data,
        authorization.admin.id,
      ),
    );
  } catch (error) {
    return provisioningLifecycleFailure(error);
  }
}
