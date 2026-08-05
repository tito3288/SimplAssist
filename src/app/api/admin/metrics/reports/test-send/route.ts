import { z } from "zod";
import type { NextRequest } from "next/server";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";

const CANONICAL_EMAIL =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const testSendRequestSchema = z
  .object({
    configId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    email: z
      .string()
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.string().max(254).regex(CANONICAL_EMAIL)),
  })
  .strict();

const testSendResponseSchema = z
  .object({
    outcome: z.enum(["accepted", "failed", "needs_review"]),
  })
  .strict();

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const body = await readAdminMutationJson(request);
  if (!body.ok) return body.response;

  const parsed = testSendRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  let service:
    | typeof import("@/lib/admin/metricsReportTestSend.server")
    | null = null;
  try {
    // Keep service-role and provider modules behind the complete admin request
    // boundary. Unauthorized or malformed requests cannot initialize them.
    service = await import("@/lib/admin/metricsReportTestSend.server");
    const result = await service.sendAdminMetricsReportTest(parsed.data);
    const safeResult = testSendResponseSchema.safeParse(result);
    if (!safeResult.success) {
      console.error("[admin:metrics-report-test-send] invalid service result");
      return adminMutationJson({ error: "test_send_failed" }, { status: 500 });
    }
    return adminMutationJson(safeResult.data);
  } catch (error) {
    if (service && error instanceof service.AdminMetricsReportTestSendError) {
      return adminMutationJson({ error: error.code }, { status: error.status });
    }

    // Never log the recipient, rendered report, provider result, or raw error.
    console.error("[admin:metrics-report-test-send] request failed");
    return adminMutationJson({ error: "test_send_failed" }, { status: 500 });
  }
}
