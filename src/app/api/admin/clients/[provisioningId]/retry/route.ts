import type { NextRequest } from "next/server";
import {
  provisioningIdSchema,
  retryPartnerClientSchema,
} from "@/lib/admin/clientProvisioning.shared";
import { retryPartnerClientProvisioning } from "@/lib/admin/clientProvisioning.server";
import {
  authorizeProvisioningMutation,
  provisioningFailure,
  provisioningJson,
  readProvisioningJson,
} from "@/lib/admin/clientProvisioningRoute.server";

export async function POST(
  request: NextRequest,
  { params }: { params: { provisioningId: string } },
) {
  const authorization = await authorizeProvisioningMutation(request);
  if ("response" in authorization) return authorization.response;

  const id = provisioningIdSchema.safeParse(params.provisioningId);
  if (!id.success) {
    return provisioningJson({ error: "job_not_found" }, { status: 404 });
  }
  const body = await readProvisioningJson(request);
  if (!body.ok) return body.response;
  const parsed = retryPartnerClientSchema.safeParse(body.value);
  if (!parsed.success) {
    return provisioningJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await retryPartnerClientProvisioning(
      id.data,
      parsed.data,
      authorization.admin.id,
    );
    return provisioningJson(result);
  } catch (error) {
    return provisioningFailure(error);
  }
}
