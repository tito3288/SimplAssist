import type { NextRequest } from "next/server";
import { provisioningIdSchema } from "@/lib/admin/clientProvisioning.shared";
import { sendPartnerClientSetupEmail } from "@/lib/admin/clientProvisioning.server";
import {
  authorizeAdminMutation,
  provisioningFailure,
  provisioningJson,
  readProvisioningJson,
} from "@/lib/admin/clientProvisioningRoute.server";

export async function POST(
  request: NextRequest,
  { params }: { params: { provisioningId: string } },
) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const id = provisioningIdSchema.safeParse(params.provisioningId);
  if (!id.success) {
    return provisioningJson({ error: "job_not_found" }, { status: 404 });
  }
  const body = await readProvisioningJson(request);
  if (!body.ok) return body.response;
  if (
    typeof body.value !== "object" ||
    body.value === null ||
    Array.isArray(body.value) ||
    Object.keys(body.value).length !== 0
  ) {
    return provisioningJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await sendPartnerClientSetupEmail(
      id.data,
      authorization.admin.id,
    );
    return provisioningJson(result);
  } catch (error) {
    return provisioningFailure(error);
  }
}
