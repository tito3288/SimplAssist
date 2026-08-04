import "server-only";

import { ClientProvisioningError } from "./clientProvisioning.server";
import { adminMutationJson as provisioningJson } from "./adminMutation.server";

export {
  adminMutationJson as provisioningJson,
  authorizeAdminMutation,
  readAdminMutationJson as readProvisioningJson,
} from "./adminMutation.server";

export function provisioningFailure(error: unknown) {
  if (error instanceof ClientProvisioningError) {
    return provisioningJson(
      {
        error: error.code,
        ...(error.provisioningId
          ? { provisioningId: error.provisioningId }
          : {}),
      },
      { status: error.status },
    );
  }

  // Never log provider/Auth error objects here. They can echo request bodies,
  // recovery tokens, or action links.
  console.error("[admin:client-provisioning] request failed");
  return provisioningJson({ error: "provisioning_failed" }, { status: 500 });
}
