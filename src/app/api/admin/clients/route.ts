import type { NextRequest } from "next/server";
import { createPartnerClientSchema } from "@/lib/admin/clientProvisioning.shared";
import { provisionPartnerClient } from "@/lib/admin/clientProvisioning.server";
import {
  authorizeAdminMutation,
  provisioningFailure,
  provisioningJson,
  readProvisioningJson,
} from "@/lib/admin/clientProvisioningRoute.server";

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const body = await readProvisioningJson(request);
  if (!body.ok) return body.response;
  const parsed = createPartnerClientSchema.safeParse(body.value);
  if (!parsed.success) {
    return provisioningJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await provisionPartnerClient(
      parsed.data,
      authorization.admin.id,
    );
    return provisioningJson(result);
  } catch (error) {
    return provisioningFailure(error);
  }
}
