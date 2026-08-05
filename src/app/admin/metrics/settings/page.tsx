import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import { bodyFaint } from "@/lib/theme-v2/theme";
import { MetricsReportSettings } from "./MetricsReportSettings";

export const dynamic = "force-dynamic";

export default async function AdminMetricsReportSettingsPage() {
  await requireAdminUser();

  // Keep the service-role-backed module behind the page's soft-navigation
  // authorization boundary. Do not move this import to module scope.
  const { loadAdminMetricsReportConfigSettings } = await import(
    "@/lib/admin/metricsReportConfigs.server"
  );
  const settings = await loadAdminMetricsReportConfigSettings();

  return (
    <main className="space-y-8">
      <section>
        <Link
          href="/admin/metrics"
          className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Back to metrics
        </Link>
        <h1 className="mt-3 text-2xl font-bold">Monthly report settings</h1>
        <p className={`mt-1 max-w-3xl text-sm ${bodyFaint}`}>
          Configure count-only monthly reports for SimplAssist and each partner.
          Config, recipient, and business-selection edits take effect when the
          next snapshot is generated. Already-frozen reports and deliveries are
          unchanged.
        </p>
      </section>

      <MetricsReportSettings settings={settings} />
    </main>
  );
}
