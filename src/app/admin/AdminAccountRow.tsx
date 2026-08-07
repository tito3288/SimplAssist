import Link from "next/link";
import { getAdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";
import { isSubscriptionPlan } from "@/lib/billing/features";
import { getPlanPresentation } from "@/lib/billing/planPresentation";
import { SUBSCRIPTION_PLANS } from "@/lib/stripe/config";
import type { AdminAccountHealth } from "@/lib/admin/accountHealth";
import { body } from "@/lib/theme-v2/theme";
import type {
  A2pRiskReviewStatus,
  BillingMode,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/types/database";
import { AdminAccountHealthChips } from "./AdminAccountHealthChips";

type PartnerSummary = {
  name: string;
  slug: string;
};

export type AdminAccountBusinessRow = {
  id: string;
  name: string;
  website_url: string | null;
  business_type: string | null;
  a2p_risk_review_status: A2pRiskReviewStatus | null;
  a2p_risk_review_message: string | null;
  onboarding_registration_status: string | null;
  brand_status: string | null;
  campaign_status: string | null;
  partner_id: string | null;
  billing_mode: BillingMode;
  partner_plan: SubscriptionPlan | null;
  partner: PartnerSummary | PartnerSummary[] | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
  telnyx_submission_disabled: boolean;
  sms_overage_opt_in: boolean;
  deleted_at: string | null;
  deletion_scheduled_for: string | null;
  created_at: string | null;
};

export type AdminAccountSubscriptionRow = {
  business_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
};

export type AdminAccountUsageRow = {
  business_id: string;
  included_sms_parts: number;
  inbound_sms_parts: number;
  outbound_sms_parts: number;
  inbound_mms_events: number;
  outbound_mms_events: number;
  period_start: string;
};

export function AdminAccountRow({
  business,
  subscription,
  usage,
  health,
}: {
  business: AdminAccountBusinessRow;
  subscription: AdminAccountSubscriptionRow | undefined;
  usage: AdminAccountUsageRow | undefined;
  health: AdminAccountHealth | null;
}) {
  const lifecycle = getAdminBusinessLifecycle({
    deletedAt: business.deleted_at,
    deletionScheduledFor: business.deletion_scheduled_for,
  });
  const used = usage
    ? usage.inbound_sms_parts + usage.outbound_sms_parts
    : 0;
  const included = usage?.included_sms_parts ?? 0;
  const usagePercent = included > 0 ? Math.round((used / included) * 100) : 0;
  const revenue = subscription?.plan
    ? SUBSCRIPTION_PLANS[subscription.plan].price
    : 0;
  const estimatedSmsCost = used * 0.01;
  const roughMargin = revenue - estimatedSmsCost - 10;

  return (
    <div className="border-b border-[#f0e9de] px-4 py-4 last:border-b-0 dark:border-white/[0.08]">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <Link
            href={`/admin/${business.id}`}
            className="block rounded-sm transition-colors hover:text-[var(--brand-primary-active)] dark:hover:text-[var(--brand-primary-dark)]"
          >
            <p className="font-medium">{business.name}</p>
            <p className="mt-1 text-xs text-stone-500 dark:text-[#bdbdbf]">
              {business.website_url ?? "No website"} ·{" "}
              {business.business_type ?? "unknown"}
            </p>
          </Link>
          <AdminAccountHealthChips
            health={lifecycle === "terminal" ? null : health}
            listAccount={{
              lifecycle,
              riskReviewStatus: business.a2p_risk_review_status,
              brandStatus: business.brand_status,
              campaignStatus: business.campaign_status,
              telnyxSubmissionDisabled: business.telnyx_submission_disabled,
              billingPilot: business.billing_pilot,
              billingComped: business.billing_comped,
              billingExempt: business.billing_exempt,
              deletionScheduledFor: business.deletion_scheduled_for,
            }}
          />
        </div>
        {lifecycle === "terminal" ? (
          <div className={`text-sm ${body} md:text-right`}>
            <p>Read-only retained tombstone</p>
          </div>
        ) : (
          <div className={`text-sm ${body} md:text-right`}>
            <BillingLine business={business} subscription={subscription} />
            <p>
              {used.toLocaleString()} / {included.toLocaleString()} SMS parts (
              {usagePercent}%)
            </p>
            {business.billing_mode === "stripe" ? (
              <p>Rough margin: ${roughMargin.toFixed(2)}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function BillingLine({
  business,
  subscription,
}: {
  business: AdminAccountBusinessRow;
  subscription: AdminAccountSubscriptionRow | undefined;
}) {
  if (business.billing_mode === "stripe") {
    return (
      <p>
        {subscription?.plan ?? "no plan"} ·{" "}
        {subscription?.status ?? "no subscription"}
      </p>
    );
  }

  const partner = Array.isArray(business.partner)
    ? (business.partner[0] ?? null)
    : business.partner;
  const partnerName = partner?.name?.trim() || partner?.slug?.trim();
  if (
    (business.billing_mode !== "invoiced" &&
      business.billing_mode !== "comped") ||
    !business.partner_id ||
    !isSubscriptionPlan(business.partner_plan) ||
    !partnerName
  ) {
    return (
      <p className="text-red-700 dark:text-red-300">
        Partner billing configuration invalid
      </p>
    );
  }

  const plan = getPlanPresentation(business.partner_plan, partnerName);
  return (
    <p>
      {partnerName} · {plan.name} · {business.billing_mode}
    </p>
  );
}
