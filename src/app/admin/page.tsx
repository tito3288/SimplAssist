import {
  bodyFaint,
  card,
  tile,
} from "@/lib/theme-v2/theme";
import { getAdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";
import { requireAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  AdminAccountRow,
  type AdminAccountBusinessRow,
  type AdminAccountSubscriptionRow,
  type AdminAccountUsageRow,
} from "./AdminAccountRow";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdminUser();

  const { data: businesses, error: businessesError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, website_url, business_type, a2p_risk_review_status, a2p_risk_review_message, onboarding_registration_status, brand_status, campaign_status, partner_id, billing_mode, partner_plan, partner:partners!businesses_partner_id_fkey(name, slug), billing_pilot, billing_comped, billing_exempt, telnyx_submission_disabled, sms_overage_opt_in, deleted_at, deletion_scheduled_for, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(75)
    .returns<AdminAccountBusinessRow[]>();

  if (businessesError) {
    throw new Error("Could not load admin accounts.");
  }

  const businessIds = (businesses ?? [])
    .filter(
      (business) =>
        getAdminBusinessLifecycle({
          deletedAt: business.deleted_at,
          deletionScheduledFor: business.deletion_scheduled_for,
        }) !== "terminal",
    )
    .map((business) => business.id);
  const [subscriptionsResult, usageResult] = await Promise.all([
    businessIds.length > 0
      ? supabaseAdmin
          .from("subscriptions")
          .select("business_id, plan, status")
          .in("business_id", businessIds)
          .returns<AdminAccountSubscriptionRow[]>()
      : Promise.resolve({
          data: [] as AdminAccountSubscriptionRow[],
          error: null,
        }),
    businessIds.length > 0
      ? supabaseAdmin
          .from("billing_usage_periods")
          .select(
            "business_id, included_sms_parts, inbound_sms_parts, outbound_sms_parts, inbound_mms_events, outbound_mms_events, period_start",
          )
          .in("business_id", businessIds)
          .order("period_start", { ascending: false })
          .returns<AdminAccountUsageRow[]>()
      : Promise.resolve({ data: [] as AdminAccountUsageRow[], error: null }),
  ]);

  if (subscriptionsResult.error || usageResult.error) {
    throw new Error("Could not load admin account statistics.");
  }

  const subscriptions = subscriptionsResult.data;
  const usageRows = usageResult.data;

  const subscriptionByBusiness = new Map(
    (subscriptions ?? []).map((subscription) => [
      subscription.business_id,
      subscription,
    ]),
  );
  const latestUsageByBusiness = new Map<string, AdminAccountUsageRow>();
  for (const row of usageRows ?? []) {
    if (!latestUsageByBusiness.has(row.business_id)) {
      latestUsageByBusiness.set(row.business_id, row);
    }
  }

  const activeBusinesses = (businesses ?? []).filter(
    (business) =>
      getAdminBusinessLifecycle({
        deletedAt: business.deleted_at,
        deletionScheduledFor: business.deletion_scheduled_for,
      }) === "active",
  );
  const reviewQueue = activeBusinesses.filter((business) =>
    ["pending_review", "blocked", "admin_approved"].includes(
      business.a2p_risk_review_status ?? "",
    ),
  );
  const highUsage = activeBusinesses.filter((business) => {
    const usage = latestUsageByBusiness.get(business.id);
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
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          A2P review queue, billing flags, usage, and high-usage visibility.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Metric label="A2P review queue" value={reviewQueue.length} />
        <Metric label="High usage accounts" value={highUsage.length} />
        <Metric label="Visible accounts" value={(businesses ?? []).length} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <div className={`overflow-hidden ${card}`}>
          {(businesses ?? []).map((business) => {
            return (
              <AdminAccountRow
                key={business.id}
                business={business}
                subscription={subscriptionByBusiness.get(business.id)}
                usage={latestUsageByBusiness.get(business.id)}
              />
            );
          })}
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
