import Link from "next/link";
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

const ACCOUNTS_PER_PAGE = 10;

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
  const totalPages = Math.max(1, Math.ceil(records.length / ACCOUNTS_PER_PAGE));
  const currentPage = Math.min(parsePage(searchParams?.page), totalPages);
  const firstRecordIndex = (currentPage - 1) * ACCOUNTS_PER_PAGE;
  const pageRecords = records.slice(
    firstRecordIndex,
    firstRecordIndex + ACCOUNTS_PER_PAGE,
  );
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
            <div>
              {pageRecords.map(
                ({ business, subscription, usage, health }) => {
                  return (
                    <AdminAccountRow
                      key={business.id}
                      business={business}
                      subscription={subscription}
                      usage={usage}
                      health={health}
                    />
                  );
                },
              )}
            </div>
          )}
          {records.length > ACCOUNTS_PER_PAGE ? (
            <nav
              className="flex items-center justify-between gap-4 border-t border-[#ece4d8] px-5 py-4 dark:border-white/[0.10]"
              aria-label="Accounts pagination"
            >
              {currentPage > 1 ? (
                <Link
                  href={buildPageHref(filters, currentPage - 1)}
                  className="text-sm font-medium text-[#c2410c] hover:underline dark:text-[#ff914d]"
                >
                  Previous
                </Link>
              ) : (
                <span className={`text-sm ${bodyFaint}`} aria-disabled="true">
                  Previous
                </span>
              )}
              <span className={`text-center text-sm ${bodyFaint}`}>
                Showing {firstRecordIndex + 1}–
                {Math.min(firstRecordIndex + ACCOUNTS_PER_PAGE, records.length)}
                {" "}of {records.length}
              </span>
              {currentPage < totalPages ? (
                <Link
                  href={buildPageHref(filters, currentPage + 1)}
                  className="text-sm font-medium text-[#c2410c] hover:underline dark:text-[#ff914d]"
                >
                  Next
                </Link>
              ) : (
                <span className={`text-sm ${bodyFaint}`} aria-disabled="true">
                  Next
                </span>
              )}
            </nav>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function parsePage(value: string | string[] | undefined): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return 1;

  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

function buildPageHref(
  filters: ReturnType<typeof parseAdminAccountFilters>,
  page: number,
): string {
  const searchParams = new URLSearchParams();

  if (filters.lifecycle) searchParams.set("lifecycle", filters.lifecycle);
  if (filters.ownership) {
    searchParams.set("ownership", filters.ownership);
    if (filters.ownership === "partner" && filters.partnerId) {
      searchParams.set("partner", filters.partnerId);
    }
  }
  if (filters.plan) searchParams.set("plan", filters.plan);
  if (filters.query) searchParams.set("q", filters.query);
  if (page > 1) searchParams.set("page", String(page));

  const query = searchParams.toString();
  return query ? `/admin?${query}` : "/admin";
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={`p-4 ${tile}`}>
      <p className={`text-sm ${bodyFaint}`}>{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
