import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const expectedToken = process.env.METRICS_REPORTS_CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!expectedToken || authorization !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Keep all service-role/provider imports behind the dedicated cron secret.
    const { metricsReportRunSummarySchema, runDueMetricsReports } =
      await import("@/lib/admin/metricsReportRunner.server");
    const summary = metricsReportRunSummarySchema.safeParse(
      await runDueMetricsReports(),
    );
    if (!summary.success) throw new Error("invalid_metrics_report_run_summary");
    return NextResponse.json(summary.data);
  } catch {
    // Database/provider errors can contain frozen recipients or payload data.
    // Log only this stable route classification.
    console.error("[metrics-report-runner] run failed");
    return NextResponse.json(
      { error: "metrics_report_run_failed" },
      { status: 500 },
    );
  }
}
