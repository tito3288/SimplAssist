import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  PROVISIONING_STATUS_PRESENTATION,
  provisioningIdSchema,
  type AdminProvisioningRecord,
  type PublicProvisioningJob,
} from "@/lib/admin/clientProvisioning.shared";
import { loadAdminProvisioningRecord } from "@/lib/admin/clientProvisioningLifecycle.server";
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
import { ClientProvisioningLifecycleActions } from "./ClientProvisioningLifecycleActions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PartnerClientProvisioningDetailPage({
  params,
}: {
  params: { provisioningId: string };
}) {
  noStore();
  await requireAdminUser();

  const id = provisioningIdSchema.safeParse(params.provisioningId);
  if (!id.success) notFound();

  const record = await loadAdminProvisioningRecord(id.data);
  if (!record) {
    console.error(
      `[admin-clients] Provisioning ${id.data} was missing or failed read validation.`,
    );
    notFound();
  }

  const provisioning = record.provisioning;
  const presentation = PROVISIONING_STATUS_PRESENTATION[provisioning.status];

  return (
    <main className="space-y-6">
      <section>
        <div className="flex flex-wrap gap-4 text-sm">
          <Link
            href="/admin/clients"
            className="text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            Back to clients
          </Link>
          <Link
            href="/admin/clients/new"
            className="text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            Create another client
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">{provisioning.businessName}</h1>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusClass(presentation.tone)}`}
          >
            {presentation.label}
          </span>
          <span
            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${partnerStatusClass(record.partnerAvailability)}`}
          >
            {partnerStatusLabel(record.partnerAvailability)}
          </span>
        </div>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          {provisioning.email} · {provisioning.partnerName}
        </p>
      </section>

      <section className={`p-5 sm:p-6 ${card}`}>
        <h2 className="text-lg font-semibold">Provisioning details</h2>
        <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <Detail label="Billing mode">{provisioning.billingMode}</Detail>
          <Detail label="Partner plan">{provisioning.partnerPlan}</Detail>
          <Detail label="Auth user">
            {provisioning.authUserId ? "Created" : "Not created"}
          </Detail>
          <Detail label="Business">
            {record.accountBusinessId ? (
              <Link
                href={`/admin/${record.accountBusinessId}`}
                className="text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
              >
                {provisioning.businessId
                  ? "Open prepared business"
                  : "Open Auth account business"}
              </Link>
            ) : (
              "Not prepared"
            )}
          </Detail>
          <Detail label="Setup email sent">
            {formatTimestamp(provisioning.setupEmailSentAt)}
          </Detail>
          <Detail label="Invite attempts">
            {String(provisioning.inviteAttemptCount)}
          </Detail>
          <Detail label="Last error code">
            {provisioning.lastErrorCode ?? "None"}
          </Detail>
          <Detail label="Operation state">{record.operationState}</Detail>
          <Detail label="Updated">
            {formatTimestamp(provisioning.updatedAt)}
          </Detail>
          {record.dismissedAt ? (
            <Detail label="Dismissed">
              {formatTimestamp(record.dismissedAt)}
            </Detail>
          ) : null}
        </dl>
      </section>

      {provisioning.status !== "dismissed" ? (
        <section className={`p-5 sm:p-6 ${tile}`}>
          <h2 className="text-lg font-semibold">Client setup actions</h2>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            Generate an admin-held recovery link or send a fresh partner-branded
            setup email. Both actions require an active partner with a connected
            domain.
          </p>
          <div className="mt-5">
            <ClientProvisioningActions
              initialProvisioning={provisioning}
              expectedPartnerOrigin={record.partnerOrigin}
            />
          </div>
        </section>
      ) : null}

      <section className={`p-5 sm:p-6 ${card}`}>
        <h2 className="text-lg font-semibold">Provisioning lifecycle</h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Dismissal hides only resource-free failed jobs. It never deletes an
          Auth user, business, setup email, or the unique email reservation.
        </p>
        <div className="mt-5">
          <ClientProvisioningLifecycleActions
            key={`${provisioning.id}:${record.dismissalState}`}
            provisioningId={provisioning.id}
            dismissalState={record.dismissalState}
            businessId={record.accountBusinessId}
          />
        </div>
      </section>
    </main>
  );
}

function Detail({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className={`text-xs uppercase tracking-wide ${bodyFaint}`}>
        {label}
      </dt>
      <dd className="mt-1 break-all font-medium">{children}</dd>
    </div>
  );
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

function partnerStatusLabel(
  availability: AdminProvisioningRecord["partnerAvailability"],
): string {
  return {
    active_connected: "Partner active/connected",
    inactive: "Partner inactive",
    domain_pending: "Partner domain pending",
    unavailable: "Partner unavailable",
  }[availability];
}

function partnerStatusClass(
  availability: AdminProvisioningRecord["partnerAvailability"],
): string {
  return availability === "active_connected"
    ? statusSuccess
    : availability === "domain_pending"
      ? statusWarning
      : statusDanger;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
