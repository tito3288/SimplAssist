import "server-only";

import { parseMetricsReportPayloadV1 } from "@/lib/metrics/reportSnapshot";
import { renderMetricsReportEmail } from "@/lib/email/metricsReportRenderer";
import { sendMetricsReportTestEmail } from "@/lib/email/metricsReportSender";
import { previousMetricsReportPeriodStart } from "./metricsReportRunner.server";

export const ADMIN_METRICS_REPORT_PREVIEW_RPC =
  "preview_metrics_report_payload_v1";

export type AdminMetricsReportTestSendOutcome =
  | "accepted"
  | "failed"
  | "needs_review";

export type AdminMetricsReportTestSendResult = {
  outcome: AdminMetricsReportTestSendOutcome;
};

export type AdminMetricsReportTestSendErrorCode =
  | "config_not_found"
  | "preview_failed"
  | "invalid_snapshot";

export class AdminMetricsReportTestSendError extends Error {
  constructor(
    readonly code: AdminMetricsReportTestSendErrorCode,
    readonly status: 404 | 500,
  ) {
    super(code);
    this.name = "AdminMetricsReportTestSendError";
  }
}

type Preview = (input: {
  configId: string;
  periodStart: string;
}) => Promise<unknown>;

type TestSender = typeof sendMetricsReportTestEmail;

type TestSendDependencies = {
  now?: () => Date;
  preview?: Preview;
  send?: TestSender;
};

async function previewMetricsReportPayload(input: {
  configId: string;
  periodStart: string;
}): Promise<unknown> {
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const { data, error } = await supabaseAdmin.rpc(
    ADMIN_METRICS_REPORT_PREVIEW_RPC,
    {
      p_config_id: input.configId,
      p_period_start: input.periodStart,
    },
  );

  if (error) {
    const candidate = error as { code?: unknown; message?: unknown };
    if (
      candidate.code === "P0002" &&
      candidate.message === "metrics_report_config_not_found"
    ) {
      throw new AdminMetricsReportTestSendError("config_not_found", 404);
    }

    // Database errors may echo report configuration data. Keep logs static.
    console.error("[admin:metrics-report-test-send] preview failed");
    throw new AdminMetricsReportTestSendError("preview_failed", 500);
  }

  return data;
}

export async function sendAdminMetricsReportTest(
  input: {
    configId: string;
    email: string;
    now?: Date;
  },
  dependencies: TestSendDependencies = {},
): Promise<AdminMetricsReportTestSendResult> {
  const now = input.now ?? dependencies.now?.() ?? new Date();
  const periodStart = previousMetricsReportPeriodStart(now);
  const preview = dependencies.preview ?? previewMetricsReportPayload;
  const send = dependencies.send ?? sendMetricsReportTestEmail;

  const rawPayload = await preview({
    configId: input.configId,
    periodStart,
  });

  let payload: ReturnType<typeof parseMetricsReportPayloadV1>;
  try {
    payload = parseMetricsReportPayloadV1(rawPayload);
  } catch {
    console.error("[admin:metrics-report-test-send] invalid snapshot payload");
    throw new AdminMetricsReportTestSendError("invalid_snapshot", 500);
  }

  const rendered = renderMetricsReportEmail(payload, { test: true });
  const sendOutcome = await send({
    message: {
      to: input.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    },
  });

  if (sendOutcome.kind === "accepted") {
    return { outcome: "accepted" };
  }
  if (sendOutcome.kind === "definite_no_send") {
    return { outcome: "failed" };
  }
  return { outcome: "needs_review" };
}
