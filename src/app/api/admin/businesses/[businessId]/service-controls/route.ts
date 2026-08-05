import type { NextRequest } from "next/server";
import { z } from "zod";
import { adminAccountServiceControlRequestSchema } from "@/lib/admin/accountServiceControls.shared";
import {
  AdminAccountServiceControlsError,
  setAdminAccountServiceControl,
} from "@/lib/admin/accountServiceControls.server";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";

const businessIdSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

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

  const input = adminAccountServiceControlRequestSchema.safeParse(body.value);
  if (!input.success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    return adminMutationJson(
      await setAdminAccountServiceControl({
        businessId: businessId.data,
        actorAdminUserId: authorization.admin.id,
        input: input.data,
      }),
    );
  } catch (error) {
    if (error instanceof AdminAccountServiceControlsError) {
      if (error.code === "business_not_found") {
        return adminMutationJson({ error: "Not found" }, { status: 404 });
      }
      return adminMutationJson({ error: error.code }, { status: error.status });
    }

    console.error(
      `[admin:service-controls] request failed for business ${businessId.data}`,
    );
    return adminMutationJson(
      { error: "service_controls_failed" },
      { status: 500 },
    );
  }
}
