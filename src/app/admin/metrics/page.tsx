import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  parseAdminMetricsFilters,
  type AdminMetricsSearchParams,
} from "@/lib/admin/metricsFilters";
import {
  AdminMetricsReadError,
  loadAdminMonthlyBusinessMetrics,
} from "@/lib/admin/metrics.server";
import { loadAdminMetricsBusinessOptionGroups } from "@/lib/admin/metricsBusinessOptions.server";
import { bodyFaint } from "@/lib/theme-v2/theme";
import { AdminBackLink } from "../AdminBackLink";
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
  let businessGroups: Awaited<
    ReturnType<typeof loadAdminMetricsBusinessOptionGroups>
  > = null;
  if (reportState.state === "ready" && filters.scope === "all") {
    try {
      businessGroups = await loadAdminMetricsBusinessOptionGroups(
        businessOptions,
        partnerOptions,
      );
    } catch {
      businessGroups = null;
    }
  }

  return (
    <main className="space-y-8">
      <AdminBackLink />

      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admin metrics</h1>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            Read-only monthly counts with event-time brand attribution. Month
            boundaries and availability dates use UTC.
          </p>
        </div>
        <Link
          href="/admin/metrics/settings"
          className="text-sm font-semibold text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Report settings
        </Link>
      </section>

      <AdminMetricsFilters
        filters={filters}
        partners={partnerOptions}
        businesses={businessOptions}
        businessGroups={businessGroups}
      />
      <AdminMetricsReport result={reportState} />
    </main>
  );
}
