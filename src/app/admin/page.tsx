import {
  bodyFaint,
  card,
  ink,
  tile,
} from "@/lib/theme-v2/theme";
import {
  parseAdminAccountFilters,
  type AdminAccountFilterSearchParams,
} from "@/lib/admin/accountFilters";
import { getAdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";
import { loadAdminAccountHealthList } from "@/lib/admin/accountHealth.server";
import { requireAdminUser } from "@/lib/admin/auth";
import { loadAdminPartnerFilterOptions } from "@/lib/admin/partnerFilterOptions.server";
import { AdminAccountFilters } from "./AdminAccountFilters";
import { AdminAccountRow } from "./AdminAccountRow";

export const dynamic = "force-dynamic";

export default async function AdminPage(
  {
    searchParams,
  }: { searchParams?: AdminAccountFilterSearchParams },
) {
  await requireAdminUser();

  const filters = parseAdminAccountFilters(searchParams);
  const [records, partnerOptions] = await Promise.all([
    loadAdminAccountHealthList(filters),
    loadAdminPartnerFilterOptions(),
  ]);
  const activeRecords = records.filter(
    ({ business }) =>
      getAdminBusinessLifecycle({
        deletedAt: business.deleted_at,
        deletionScheduledFor: business.deletion_scheduled_for,
      }) === "active",
  );
  const reviewQueue = activeRecords.filter(({ business }) =>
    ["pending_review", "blocked", "admin_approved"].includes(
      business.a2p_risk_review_status ?? "",
    ),
  );
  const highUsage = activeRecords.filter(({ usage }) => {
    if (!usage || usage.included_sms_parts <= 0) return false;
    return (
      (usage.inbound_sms_parts + usage.outbound_sms_parts) /
        usage.included_sms_parts >=
      0.8
    );
  });

  return (
    <main className="space-y-8">
      <section>
        <h1 className={`text-3xl font-bold tracking-tight ${ink}`}>
          Operations overview
        </h1>
        <p className={`mt-1.5 max-w-2xl text-sm leading-6 ${bodyFaint}`}>
          A2P review queue, billing flags, usage, and high-usage visibility.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="A2P review queue" value={reviewQueue.length} />
        <Metric label="High usage accounts" value={highUsage.length} />
        <Metric label="Visible accounts" value={records.length} />
      </section>

      <AdminAccountFilters
        filters={filters}
        partners={partnerOptions}
        visibleCount={records.length}
      />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <div className={`overflow-hidden ${card}`}>
          {records.length === 0 ? (
            <p className={`px-5 py-6 text-sm ${bodyFaint}`}>
              No accounts match these filters.
            </p>
          ) : (
            records.map(({ business, subscription, usage, health }) => {
              return (
                <AdminAccountRow
                  key={business.id}
                  business={business}
                  subscription={subscription}
                  usage={usage}
                  health={health}
                />
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={`p-4 ${tile}`}>
      <p className={`text-sm ${bodyFaint}`}>{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
