import { requireAdminUser } from "@/lib/admin/auth";
import {
  parseAdminMetricsFilters,
  type AdminMetricsSearchParams,
} from "@/lib/admin/metricsFilters";
import {
  AdminMetricsReadError,
  loadAdminMonthlyBusinessMetrics,
} from "@/lib/admin/metrics.server";
import { bodyFaint } from "@/lib/theme-v2/theme";
import { AdminMetricsFilters } from "./AdminMetricsFilters";
import {
  AdminMetricsReport,
  type AdminMetricsReportState,
} from "./AdminMetricsReport";

export const dynamic = "force-dynamic";

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams?: AdminMetricsSearchParams;
}) {
  await requireAdminUser();

  const filters = parseAdminMetricsFilters(searchParams);
  let reportState: AdminMetricsReportState;
  try {
    reportState = {
      state: "ready",
      report: await loadAdminMonthlyBusinessMetrics(filters),
    };
  } catch (error) {
    if (!(error instanceof AdminMetricsReadError)) throw error;
    reportState = { state: error.code };
  }

  const partnerOptions =
    reportState.state === "ready" ? reportState.report.partner_options : [];
  const businessOptions =
    reportState.state === "ready" ? reportState.report.business_options : [];

  return (
    <main className="space-y-8">
      <section>
        <h1 className="text-2xl font-bold">Admin metrics</h1>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Read-only monthly counts with event-time brand attribution. Month
          boundaries and availability dates use UTC.
        </p>
      </section>

      <AdminMetricsFilters
        filters={filters}
        partners={partnerOptions}
        businesses={businessOptions}
      />
      <AdminMetricsReport result={reportState} />
    </main>
  );
}
