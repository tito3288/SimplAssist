import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import type { A2pRiskReviewStatus, SubscriptionPlan, SubscriptionStatus } from "@/types/database";

export const dynamic = "force-dynamic";

type BusinessRow = {
  id: string;
  name: string;
  website_url: string | null;
  business_type: string | null;
  a2p_risk_review_status: A2pRiskReviewStatus | null;
  a2p_risk_review_message: string | null;
  onboarding_registration_status: string | null;
  brand_status: string | null;
  campaign_status: string | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
  telnyx_submission_disabled: boolean;
  sms_overage_opt_in: boolean;
  created_at: string;
};

type SubscriptionRow = {
  business_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
};

type UsageRow = {
  business_id: string;
  included_sms_parts: number;
  inbound_sms_parts: number;
  outbound_sms_parts: number;
  inbound_mms_events: number;
  outbound_mms_events: number;
  period_start: string;
};

export default async function AdminPage() {
  await requireAdminUser();

  const { data: businesses } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, website_url, business_type, a2p_risk_review_status, a2p_risk_review_message, onboarding_registration_status, brand_status, campaign_status, billing_pilot, billing_comped, billing_exempt, telnyx_submission_disabled, sms_overage_opt_in, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(75)
    .returns<BusinessRow[]>();

  const businessIds = (businesses ?? []).map((business) => business.id);
  const [{ data: subscriptions }, { data: usageRows }] = await Promise.all([
    businessIds.length > 0
      ? supabaseAdmin
          .from("subscriptions")
          .select("business_id, plan, status")
          .in("business_id", businessIds)
          .returns<SubscriptionRow[]>()
      : Promise.resolve({ data: [] as SubscriptionRow[] }),
    businessIds.length > 0
      ? supabaseAdmin
          .from("billing_usage_periods")
          .select(
            "business_id, included_sms_parts, inbound_sms_parts, outbound_sms_parts, inbound_mms_events, outbound_mms_events, period_start"
          )
          .in("business_id", businessIds)
          .order("period_start", { ascending: false })
          .returns<UsageRow[]>()
      : Promise.resolve({ data: [] as UsageRow[] }),
  ]);

  const subscriptionByBusiness = new Map(
    (subscriptions ?? []).map((subscription) => [
      subscription.business_id,
      subscription,
    ])
  );
  const latestUsageByBusiness = new Map<string, UsageRow>();
  for (const row of usageRows ?? []) {
    if (!latestUsageByBusiness.has(row.business_id)) {
      latestUsageByBusiness.set(row.business_id, row);
    }
  }

  const reviewQueue = (businesses ?? []).filter((business) =>
    ["pending_review", "blocked", "admin_approved"].includes(
      business.a2p_risk_review_status ?? ""
    )
  );
  const highUsage = (businesses ?? []).filter((business) => {
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
        <p className="mt-1 text-sm text-slate-500 dark:text-[#bdbdbf]">
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
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-white/[0.10] dark:bg-white/[0.04]">
          {(businesses ?? []).map((business) => {
            const subscription = subscriptionByBusiness.get(business.id);
            const usage = latestUsageByBusiness.get(business.id);
            const used = usage
              ? usage.inbound_sms_parts + usage.outbound_sms_parts
              : 0;
            const included = usage?.included_sms_parts ?? 0;
            const usagePercent =
              included > 0 ? Math.round((used / included) * 100) : 0;
            const revenue =
              subscription?.plan ? SUBSCRIPTION_PLANS[subscription.plan].price : 0;
            const estimatedSmsCost = used * 0.01;
            const roughMargin = revenue - estimatedSmsCost - 10;

            return (
              <Link
                key={business.id}
                href={`/admin/${business.id}`}
                className="block border-b border-slate-100 px-4 py-4 last:border-b-0 hover:bg-slate-50 dark:border-white/[0.08] dark:hover:bg-white/[0.04]"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-medium">{business.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {business.website_url ?? "No website"} · {business.business_type ?? "unknown"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge>Risk: {business.a2p_risk_review_status ?? "not_started"}</Badge>
                      <Badge>Brand: {business.brand_status ?? "not submitted"}</Badge>
                      <Badge>Campaign: {business.campaign_status ?? "not submitted"}</Badge>
                      {business.telnyx_submission_disabled && <Badge tone="danger">No Telnyx submit</Badge>}
                      {business.billing_pilot && <Badge>Pilot</Badge>}
                      {business.billing_comped && <Badge>Comped</Badge>}
                      {business.billing_exempt && <Badge>Billing exempt</Badge>}
                    </div>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-[#bdbdbf] md:text-right">
                    <p>{subscription?.plan ?? "no plan"} · {subscription?.status ?? "no subscription"}</p>
                    <p>{used.toLocaleString()} / {included.toLocaleString()} SMS parts ({usagePercent}%)</p>
                    <p>Rough margin: ${roughMargin.toFixed(2)}</p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-white/[0.10] dark:bg-white/[0.04]">
      <p className="text-sm text-slate-500 dark:text-[#bdbdbf]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        tone === "danger"
          ? "bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300"
          : "bg-slate-100 text-slate-600 dark:bg-white/[0.08] dark:text-[#d8d8d8]"
      }`}
    >
      {children}
    </span>
  );
}
