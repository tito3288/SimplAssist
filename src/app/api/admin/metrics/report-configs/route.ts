import type { NextRequest } from "next/server";
import {
  adminMutationJson,
  authorizeAdminMutation,
  readAdminMutationJson,
} from "@/lib/admin/adminMutation.server";
import {
  adminMetricsReportConfigSaveRequestSchema,
  adminMetricsReportConfigSchema,
} from "@/lib/admin/metricsReportConfigs.shared";
import {
  AdminMetricsReportConfigError,
  saveAdminMetricsReportConfig,
} from "@/lib/admin/metricsReportConfigs.server";

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminMutation(request);
  if ("response" in authorization) return authorization.response;

  const body = await readAdminMutationJson(request);
  if (!body.ok) return body.response;

  const input = adminMetricsReportConfigSaveRequestSchema.safeParse(body.value);
  if (!input.success) {
    return adminMutationJson({ error: "invalid_request" }, { status: 400 });
  }

  try {
    const saved = await saveAdminMetricsReportConfig(input.data);
    const response = adminMetricsReportConfigSchema.safeParse(saved);
    if (!response.success) {
      console.error("[admin:metrics-report-configs] invalid save response");
      return adminMutationJson({ error: "save_failed" }, { status: 500 });
    }

    return adminMutationJson(response.data);
  } catch (error) {
    if (error instanceof AdminMetricsReportConfigError) {
      return adminMutationJson({ error: error.code }, { status: error.status });
    }

    // Never log the error object: database errors can echo recipient addresses
    // or other fields from the replacement payload.
    console.error("[admin:metrics-report-configs] save failed");
    return adminMutationJson({ error: "save_failed" }, { status: 500 });
  }
}
