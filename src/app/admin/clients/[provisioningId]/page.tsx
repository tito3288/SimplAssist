import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  PROVISIONING_STATUS_PRESENTATION,
  provisioningIdSchema,
  type PublicProvisioningJob,
} from "@/lib/admin/clientProvisioning.shared";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  bodyFaint,
  card,
  statusDanger,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";
import { ClientProvisioningActions } from "./ClientProvisioningActions";
import { parseProvisioningDetailRows } from "./provisioningDetail";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROVISIONING_COLUMNS = [
  "id",
  "email",
  "requested_business_name",
  "partner_id",
  "billing_mode",
  "partner_plan",
  "auth_user_id",
  "business_id",
  "status",
  "last_error_code",
  "setup_email_sent_at",
  "invite_attempt_count",
  "created_at",
  "updated_at",
].join(", ");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function statusClass(
  tone: (typeof PROVISIONING_STATUS_PRESENTATION)[PublicProvisioningJob["status"]]["tone"],
): string {
  return {
    neutral: statusNeutral,
    info: statusInfo,
    warning: statusWarning,
    success: statusSuccess,
    danger: statusDanger,
  }[tone];
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export default async function PartnerClientProvisioningDetailPage({
  params,
}: {
  params: { provisioningId: string };
}) {
  noStore();
  await requireAdminUser();

  if (!provisioningIdSchema.safeParse(params.provisioningId).success) {
    notFound();
  }

  const { data: jobRow, error: jobError } = await supabaseAdmin
    .from("partner_client_provisioning_jobs")
    .select(PROVISIONING_COLUMNS)
    .eq("id", params.provisioningId)
    .maybeSingle();

  if (jobError) throw new Error("Could not load the provisioning job");
  if (!jobRow || !isRecord(jobRow) || typeof jobRow.partner_id !== "string") {
    notFound();
  }

  const { data: partnerRow, error: partnerError } = await supabaseAdmin
    .from("partners")
    .select("id, name, custom_domain, status, domain_status")
    .eq("id", jobRow.partner_id)
    .eq("status", "active")
    .eq("domain_status", "connected")
    .not("custom_domain", "is", null)
    .maybeSingle();

  if (partnerError) throw new Error("Could not load the provisioning partner");

  const provisioning = parseProvisioningDetailRows(jobRow, partnerRow);
  const partnerDomain =
    isRecord(partnerRow) && typeof partnerRow.custom_domain === "string"
      ? partnerRow.custom_domain
      : null;
  if (!provisioning || !partnerDomain) {
    console.error(
      "[admin-clients] Refused to render a provisioning record that failed read validation.",
    );
    notFound();
  }

  const presentation = PROVISIONING_STATUS_PRESENTATION[provisioning.status];

  return (
    <main className="space-y-6">
      <section>
        <Link
          href="/admin/clients/new"
          className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Create another client
        </Link>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{provisioning.businessName}</h1>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(presentation.tone)}`}
          >
            {presentation.label}
          </span>
        </div>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          {provisioning.email} · {provisioning.partnerName}
        </p>
      </section>

      <section className={`p-5 sm:p-6 ${card}`}>
        <h2 className="text-lg font-semibold">Provisioning details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Detail label="Billing mode" value={provisioning.billingMode} />
          <Detail label="Partner plan" value={provisioning.partnerPlan} />
          <Detail
            label="Auth user"
            value={provisioning.authUserId ?? "Not created"}
          />
          <Detail
            label="Business"
            value={provisioning.businessId ?? "Not prepared"}
          />
          <Detail
            label="Setup email sent"
            value={formatTimestamp(provisioning.setupEmailSentAt)}
          />
          <Detail
            label="Invite attempts"
            value={String(provisioning.inviteAttemptCount)}
          />
          <Detail
            label="Last error code"
            value={provisioning.lastErrorCode ?? "None"}
          />
          <Detail label="Updated" value={formatTimestamp(provisioning.updatedAt)} />
        </dl>
      </section>

      <section className={`p-5 sm:p-6 ${tile}`}>
        <h2 className="text-lg font-semibold">Client setup actions</h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Generate an admin-held recovery link or send a fresh partner-branded
          setup email. Each action generates a new recovery token.
        </p>
        <div className="mt-5">
          <ClientProvisioningActions
            initialProvisioning={provisioning}
            expectedPartnerOrigin={`https://${partnerDomain}`}
          />
        </div>
      </section>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className={`text-xs uppercase tracking-wide ${bodyFaint}`}>{label}</dt>
      <dd className="mt-1 break-all font-medium">{value}</dd>
    </div>
  );
}
