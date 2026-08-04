import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildA2pRiskInputForBusiness,
  hashA2pRiskInput,
} from "@/lib/messaging/registration/riskScreening";
import { AdminFlagForm } from "../AdminFlagForm";
import { BusinessPartnerBillingForm } from "../BusinessPartnerBillingForm";
import { A2pApproveForm } from "../A2pApproveForm";
import { ExistingTelnyxBrandForm } from "../ExistingTelnyxBrandForm";
import { getExistingTelnyxBrandLinkState } from "@/lib/messaging/registration/existingBrand";
import {
  AccountDeletionServiceError,
  getAdminAccountDeletionPreview,
} from "@/lib/account/deletion.server";
import { getAdminBusinessLifecycle } from "@/lib/admin/accountLifecycle";
import { card, statusDanger, statusWarning } from "@/lib/theme-v2/theme";
import { AdminAccountDeletionPanel } from "./AdminAccountDeletionPanel";
import type {
  BillingMode,
  PartnerDomainStatus,
  PartnerStatus,
  SubscriptionPlan,
} from "@/types/database";

export const dynamic = "force-dynamic";

type DetailBusiness = {
  id: string;
  owner_id: string | null;
  deleted_at: string | null;
  deletion_scheduled_for: string | null;
  partner_id: string | null;
  billing_mode: BillingMode;
  partner_plan: SubscriptionPlan | null;
  name: string;
  business_type: string | null;
  business_type_other: string | null;
  website_url: string | null;
  use_case_description: string | null;
  sample_messages: string[] | null;
  opt_in_description: string | null;
  a2p_risk_review_status: string | null;
  a2p_risk_review_input_hash: string | null;
  a2p_risk_review_message: string | null;
  a2p_risk_review_reason: string | null;
  a2p_risk_review_findings: Array<{
    ruleId: string;
    severity: string;
    label: string;
    evidence: string[];
    source: string;
  }> | null;
  a2p_risk_review_customer_answer: string | null;
  a2p_risk_review_customer_selections: string[] | null;
  a2p_risk_review_reviewed_at: string | null;
  a2p_risk_review_override_note: string | null;
  onboarding_registration_status: string | null;
  brand_status: string | null;
  campaign_status: string | null;
  pending_phone_number: string | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
  telnyx_submission_disabled: boolean;
  sms_overage_opt_in: boolean;
  billing_admin_notes: string | null;
};

type PartnerRow = {
  id: string;
  name: string;
  status: PartnerStatus;
  domain_status: PartnerDomainStatus;
};

type UsageRow = {
  included_sms_parts: number;
  inbound_sms_parts: number;
  outbound_sms_parts: number;
  inbound_mms_events: number;
  outbound_mms_events: number;
  period_start: string;
  period_end: string;
};

export default async function AdminBusinessPage({
  params,
}: {
  params: { businessId: string };
}) {
  await requireAdminUser();

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, owner_id, deleted_at, deletion_scheduled_for, partner_id, billing_mode, partner_plan, name, business_type, business_type_other, website_url, use_case_description, sample_messages, opt_in_description, a2p_risk_review_status, a2p_risk_review_input_hash, a2p_risk_review_message, a2p_risk_review_reason, a2p_risk_review_findings, a2p_risk_review_customer_answer, a2p_risk_review_customer_selections, a2p_risk_review_reviewed_at, a2p_risk_review_override_note, onboarding_registration_status, brand_status, campaign_status, pending_phone_number, billing_pilot, billing_comped, billing_exempt, telnyx_submission_disabled, sms_overage_opt_in, billing_admin_notes",
    )
    .eq("id", params.businessId)
    .maybeSingle<DetailBusiness>();

  if (!business) notFound();

  const lifecycle = getAdminBusinessLifecycle({
    deletedAt: business.deleted_at,
    deletionScheduledFor: business.deletion_scheduled_for,
  });

  if (lifecycle === "terminal") {
    return <TerminalBusiness business={business} />;
  }

  let deletionPreview;
  try {
    deletionPreview = await getAdminAccountDeletionPreview(business.id);
  } catch (error) {
    if (
      error instanceof AccountDeletionServiceError &&
      error.code === "business_not_found"
    ) {
      notFound();
    }
    throw error;
  }

  // The preview is loaded after the business row and therefore wins if a
  // concurrent schedule/reactivation changed lifecycle state between reads.
  const effectiveLifecycle =
    deletionPreview.lifecycleStage === "suspended" ? "scheduled" : "active";

  if (effectiveLifecycle === "scheduled") {
    return (
      <main className="space-y-6">
        <BackToAdmin />
        <BusinessHeading business={business} lifecycle={effectiveLifecycle} />
        <AdminAccountDeletionPanel initialPreview={deletionPreview} />
      </main>
    );
  }

  const [
    { data: usage },
    existingBrandLinkState,
    { data: partners, error: partnersError },
  ] = await Promise.all([
    supabaseAdmin
      .from("billing_usage_periods")
      .select(
        "included_sms_parts, inbound_sms_parts, outbound_sms_parts, inbound_mms_events, outbound_mms_events, period_start, period_end",
      )
      .eq("business_id", params.businessId)
      .order("period_start", { ascending: false })
      .limit(1)
      .maybeSingle<UsageRow>(),
    getExistingTelnyxBrandLinkState(params.businessId),
    supabaseAdmin
      .from("partners")
      .select("id, name, status, domain_status")
      .order("name", { ascending: true })
      .returns<PartnerRow[]>(),
  ]);

  if (partnersError) {
    throw new Error("Failed to load partner options");
  }

  const { input } = await buildA2pRiskInputForBusiness(business.id);
  const currentInputHash = hashA2pRiskInput(input);
  const hashMatches = business.a2p_risk_review_input_hash === currentInputHash;
  const usedSms = usage
    ? usage.inbound_sms_parts + usage.outbound_sms_parts
    : 0;
  const matchedPartner =
    (partners ?? []).find((partner) => partner.id === business.partner_id) ??
    null;
  const currentPartner = matchedPartner
    ? {
        id: matchedPartner.id,
        name: matchedPartner.name,
        status:
          matchedPartner.status === "active" &&
          matchedPartner.domain_status === "connected"
            ? ("active" as const)
            : matchedPartner.status === "inactive"
              ? ("inactive" as const)
              : ("unavailable" as const),
      }
    : business.partner_id
      ? {
          id: business.partner_id,
          name: "Assigned partner",
          status: "unavailable" as const,
        }
      : null;
  const activePartners = (partners ?? [])
    .filter(
      (partner) =>
        partner.status === "active" && partner.domain_status === "connected",
    )
    .map(({ id, name }) => ({ id, name }));

  return (
    <main className="space-y-6">
      <BackToAdmin />
      <BusinessHeading business={business} lifecycle={effectiveLifecycle} />

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="A2P Review">
          <dl className="space-y-2 text-sm">
            <Row
              label="Status"
              value={business.a2p_risk_review_status ?? "not_started"}
            />
            <Row
              label="Hash matches current input"
              value={hashMatches ? "yes" : "no"}
            />
            <Row
              label="Customer answer"
              value={business.a2p_risk_review_customer_answer ?? "none"}
            />
            <Row
              label="Selections"
              value={
                (business.a2p_risk_review_customer_selections ?? []).join(
                  ", ",
                ) || "none"
              }
            />
            <Row
              label="Message"
              value={business.a2p_risk_review_message ?? "none"}
            />
            <Row
              label="Reason"
              value={business.a2p_risk_review_reason ?? "none"}
            />
          </dl>
          {(business.a2p_risk_review_status === "pending_review" ||
            business.a2p_risk_review_status === "blocked") && (
            <div className="mt-4">
              <A2pApproveForm businessId={business.id} />
            </div>
          )}
        </Card>

        <Card title="Partner Billing">
          <BusinessPartnerBillingForm
            key={`${business.partner_id ?? "unassigned"}:${business.billing_mode}:${business.partner_plan ?? "none"}`}
            businessId={business.id}
            initialPartnerId={business.partner_id}
            initialBillingMode={business.billing_mode}
            initialPartnerPlan={business.partner_plan}
            currentPartner={currentPartner}
            activePartners={activePartners}
          />
        </Card>

        <Card title="Billing Flags">
          {/* A router refresh preserves client component state. Remount when
              any server value changes so stale legacy flags cannot cross a
              partner-billing transition on the next flags save. */}
          <AdminFlagForm
            key={`${business.billing_mode}:${business.billing_pilot}:${business.billing_comped}:${business.billing_exempt}:${business.sms_overage_opt_in}`}
            businessId={business.id}
            billingMode={business.billing_mode}
            initial={{
              billing_pilot: business.billing_pilot,
              billing_comped: business.billing_comped,
              billing_exempt: business.billing_exempt,
              telnyx_submission_disabled: business.telnyx_submission_disabled,
              sms_overage_opt_in: business.sms_overage_opt_in,
              billing_admin_notes: business.billing_admin_notes,
            }}
          />
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card title="Usage">
          <dl className="space-y-2 text-sm">
            <Row
              label="Period"
              value={
                usage
                  ? `${formatDate(usage.period_start)} - ${formatDate(usage.period_end)}`
                  : "none"
              }
            />
            <Row
              label="SMS parts"
              value={`${usedSms.toLocaleString()} / ${(usage?.included_sms_parts ?? 0).toLocaleString()}`}
            />
            <Row
              label="Inbound MMS events"
              value={(usage?.inbound_mms_events ?? 0).toLocaleString()}
            />
            <Row
              label="Outbound MMS events"
              value={(usage?.outbound_mms_events ?? 0).toLocaleString()}
            />
          </dl>
        </Card>

        <Card title="Registration">
          <dl className="space-y-2 text-sm">
            <Row
              label="Onboarding registration"
              value={business.onboarding_registration_status ?? "not_started"}
            />
            <Row
              label="Brand"
              value={business.brand_status ?? "not submitted"}
            />
            <Row
              label="Campaign"
              value={business.campaign_status ?? "not submitted"}
            />
            <Row
              label="Pending number"
              value={business.pending_phone_number ?? "none"}
            />
          </dl>
        </Card>
      </section>

      <Card title="Existing Telnyx Brand">
        <ExistingTelnyxBrandForm
          businessId={business.id}
          initialLinkState={existingBrandLinkState}
        />
      </Card>

      <Card title="Carrier-Safe Review Fields">
        <div className="space-y-4 text-sm">
          <Block label="Use case" value={business.use_case_description} />
          <Block
            label="Opt-in description"
            value={business.opt_in_description}
          />
          <div>
            <p className="font-medium">Sample messages</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-600 dark:text-[#bdbdbf]">
              {(business.sample_messages ?? []).map((sample, index) => (
                <li key={`${index}-${sample}`}>{sample}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card title="Risk Findings">
        {(business.a2p_risk_review_findings ?? []).length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-[#bdbdbf]">
            No findings stored.
          </p>
        ) : (
          <div className="space-y-3">
            {(business.a2p_risk_review_findings ?? []).map((finding) => (
              <div
                key={finding.ruleId}
                className="rounded-md border border-[#ece4d8] p-3 text-sm dark:border-white/[0.10]"
              >
                <p className="font-medium">{finding.label}</p>
                <p className="text-xs text-stone-500 dark:text-[#bdbdbf]">
                  {finding.severity} · {finding.source}
                </p>
                <ul className="mt-2 list-disc pl-5 text-stone-600 dark:text-[#bdbdbf]">
                  {finding.evidence.map((evidence) => (
                    <li key={evidence}>{evidence}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <AdminAccountDeletionPanel initialPreview={deletionPreview} />
    </main>
  );
}

function TerminalBusiness({ business }: { business: DetailBusiness }) {
  return (
    <main className="space-y-6">
      <BackToAdmin />
      <BusinessHeading business={business} lifecycle="terminal" />
      <section className={`${card} p-5`}>
        <h2 className="text-lg font-semibold">Terminally cleaned account</h2>
        <p className="mt-2 text-sm text-stone-600 dark:text-[#bdbdbf]">
          This retained tombstone is read-only. Customer identity, partner
          assignment, configuration, credentials, and account-linked
          provisioning state have completed terminal cleanup under the account
          lifecycle policy.
        </p>
        <p className="mt-3 font-mono text-xs text-stone-500">{business.id}</p>
      </section>
    </main>
  );
}

function BackToAdmin() {
  return (
    <Link
      href="/admin"
      className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
    >
      Back to admin
    </Link>
  );
}

function BusinessHeading({
  business,
  lifecycle,
}: {
  business: DetailBusiness;
  lifecycle: "active" | "scheduled" | "terminal";
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">{business.name}</h1>
        {lifecycle === "scheduled" ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusWarning}`}>
            Deletion scheduled
          </span>
        ) : null}
        {lifecycle === "terminal" ? (
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusDanger}`}>
            Terminally cleaned
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
        {business.website_url ?? "No website"} ·{" "}
        {business.business_type_other ?? business.business_type ?? "unknown"}
      </p>
      {lifecycle === "scheduled" && business.deletion_scheduled_for ? (
        <p className="mt-1 text-sm text-amber-700 dark:text-amber-200">
          Terminal cleanup: {formatDate(business.deletion_scheduled_for)}
        </p>
      ) : null}
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${card} p-4`}>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stone-500 dark:text-[#bdbdbf]">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function Block({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="font-medium">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-stone-600 dark:text-[#bdbdbf]">
        {value ?? "none"}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}
