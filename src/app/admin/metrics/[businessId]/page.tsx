import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requireAdminUser } from "@/lib/admin/auth";
import {
  parseAdminMetricsFilters,
  type AdminMetricsSearchParams,
} from "@/lib/admin/metricsFilters";
import {
  AdminMetricsReadError,
  loadAdminMonthlyBusinessMetrics,
} from "@/lib/admin/metrics.server";
import { btnSecondaryCompact } from "@/lib/theme-v2/theme";
import {
  AdminBusinessMetricsReport,
  type AdminBusinessMetricsReportState,
} from "../AdminMetricsReport";

export const dynamic = "force-dynamic";

export default async function AdminBusinessMetricsPage({
  params,
  searchParams,
}: {
  params: { businessId: string };
  searchParams?: AdminMetricsSearchParams;
}) {
  await requireAdminUser();

  const filters = parseAdminMetricsFilters({
    month: searchParams?.month,
    business: params.businessId,
  });
  const businessId = filters.businessId;
  let reportState: AdminBusinessMetricsReportState;

  if (businessId === null) {
    reportState = { state: "business_unavailable" };
  } else {
    try {
      const report = await loadAdminMonthlyBusinessMetrics(filters);
      reportState = reportContainsBusiness(report, businessId)
        ? { state: "ready", report }
        : { state: "business_unavailable" };
    } catch (error) {
      if (!(error instanceof AdminMetricsReadError)) throw error;
      reportState = { state: error.code };
    }
  }

  return (
    <main className="space-y-6">
      <Link
        href="/admin/metrics"
        aria-label="Back to admin metrics"
        className={`${btnSecondaryCompact} w-fit`}
      >
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
        Back
      </Link>
      <AdminBusinessMetricsReport
        result={reportState}
        businessId={businessId ?? params.businessId}
        month={filters.month}
      />
    </main>
  );
}

function reportContainsBusiness(
  report: Awaited<ReturnType<typeof loadAdminMonthlyBusinessMetrics>>,
  businessId: string,
): boolean {
  const selectedId = businessId.toLowerCase();
  return (
    report.business_options.some(
      (business) => business.business_id.toLowerCase() === selectedId,
    ) ||
    report.businesses.some(
      (business) => business.business_id.toLowerCase() === selectedId,
    )
  );
}
