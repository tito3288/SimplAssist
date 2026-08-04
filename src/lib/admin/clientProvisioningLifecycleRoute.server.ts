import "server-only";

import { z } from "zod";
import { adminMutationJson } from "./adminMutation.server";
import { ProvisioningLifecycleError } from "./clientProvisioningLifecycle.server";

export const emptyProvisioningLifecycleBodySchema = z.object({}).strict();

export function provisioningLifecycleFailure(error: unknown) {
  if (error instanceof ProvisioningLifecycleError) {
    return adminMutationJson({ error: error.code }, { status: error.status });
  }

  // Raw RPC rows/errors can contain email addresses, Auth IDs, operation
  // tokens, or provider details. Never log the object.
  console.error("[admin:client-lifecycle] request failed");
  return adminMutationJson(
    { error: "provisioning_action_failed" },
    { status: 500 },
  );
}
