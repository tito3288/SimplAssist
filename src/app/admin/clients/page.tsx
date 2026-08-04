import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  PROVISIONING_STATUS_PRESENTATION,
  type AdminProvisioningRecord,
} from "@/lib/admin/clientProvisioning.shared";
import { listAdminProvisioningRecords } from "@/lib/admin/clientProvisioningLifecycle.server";
import {
  bodyFaint,
  card,
  statusDanger,
  statusInfo,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminClientsPage({
  searchParams,
}: {
  searchParams?: { view?: string | string[] };
}) {
  noStore();
  await requireAdminUser();

  const view =
    typeof searchParams?.view === "string" && searchParams.view === "dismissed"
      ? "dismissed"
      : "current";
  const { records, invalidRecordCount } =
    await listAdminProvisioningRecords(view);
  if (invalidRecordCount > 0) {
    console.error(
      `[admin-clients] Hid ${invalidRecordCount} provisioning record(s) that failed read validation.`,
    );
  }

  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clients</h1>
          <p className={`mt-1 max-w-3xl text-sm ${bodyFaint}`}>
            Inspect partner-client provisioning, recover failed setup work, and
            manage resource-free failed jobs without deleting Auth users or
            businesses.
          </p>
        </div>
        <Link
          href="/admin/clients/new"
          className="inline-flex rounded-full bg-[#c2410c] px-4 py-2 text-sm font-medium text-white hover:bg-[#9a3412] dark:bg-[#ff914d] dark:text-stone-950 dark:hover:bg-[#ffb07a]"
        >
          Create client
        </Link>
      </section>

      <nav className="flex gap-2" aria-label="Client queue views">
        <ViewLink href="/admin/clients" active={view === "current"}>
          Current
        </ViewLink>
        <ViewLink
          href="/admin/clients?view=dismissed"
          active={view === "dismissed"}
        >
          Dismissed
        </ViewLink>
      </nav>

      <section className={card}>
        {records.length === 0 ? (
          <p className={`p-6 text-sm ${bodyFaint}`}>
            {view === "dismissed"
              ? "No dismissed provisioning jobs."
              : "No current provisioning jobs."}
          </p>
        ) : (
          <div className="divide-y divide-[#ece4d8] dark:divide-white/[0.1]">
            {records.map((record) => (
              <ClientRow key={record.provisioning.id} record={record} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ClientRow({ record }: { record: AdminProvisioningRecord }) {
  const job = record.provisioning;
  const presentation = PROVISIONING_STATUS_PRESENTATION[job.status];
  return (
    <article className="p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/clients/${job.id}`}
              className="font-semibold hover:text-[#c2410c] dark:hover:text-[#ff914d]"
            >
              {job.businessName}
            </Link>
            <Badge tone={presentation.tone}>{presentation.label}</Badge>
            <Badge tone={partnerTone(record.partnerAvailability)}>
              {partnerLabel(record.partnerAvailability)}
            </Badge>
          </div>
          <p className={`mt-1 break-all text-sm ${bodyFaint}`}>{job.email}</p>
          <p className={`mt-1 text-xs ${bodyFaint}`}>
            {job.partnerName} · Updated {formatTimestamp(job.updatedAt)}
          </p>
          {job.lastErrorCode ? (
            <p className="mt-2 text-xs text-red-700 dark:text-red-300">
              Last error: {job.lastErrorCode}
            </p>
          ) : null}
        </div>

        <div
          className={`grid gap-1 text-sm ${bodyFaint} sm:grid-cols-2 lg:text-right`}
        >
          <span>{job.authUserId ? "Auth created" : "Auth not created"}</span>
          {record.accountBusinessId ? (
            <Link
              href={`/admin/${record.accountBusinessId}`}
              className="text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
            >
              {job.businessId ? "Business prepared" : "Account business found"}
            </Link>
          ) : (
            <span>Business not prepared</span>
          )}
          <span>Operation: {record.operationState}</span>
          <Link
            href={`/admin/clients/${job.id}`}
            className="text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            View details
          </Link>
        </div>
      </div>
    </article>
  );
}

function ViewLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full px-3 py-1.5 text-sm ${
        active
          ? "bg-stone-900 text-white dark:bg-white dark:text-stone-950"
          : "bg-stone-100 text-stone-600 hover:bg-stone-200 dark:bg-white/[0.08] dark:text-[#bdbdbf] dark:hover:bg-white/[0.12]"
      }`}
    >
      {children}
    </Link>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "neutral" | "info" | "warning" | "success" | "danger";
  children: React.ReactNode;
}) {
  const className = {
    neutral: statusNeutral,
    info: statusInfo,
    warning: statusWarning,
    success: statusSuccess,
    danger: statusDanger,
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${className}`}>
      {children}
    </span>
  );
}

function partnerLabel(
  availability: AdminProvisioningRecord["partnerAvailability"],
): string {
  return {
    active_connected: "Partner active/connected",
    inactive: "Partner inactive",
    domain_pending: "Partner domain pending",
    unavailable: "Partner unavailable",
  }[availability];
}

function partnerTone(
  availability: AdminProvisioningRecord["partnerAvailability"],
): "success" | "warning" | "danger" {
  return availability === "active_connected"
    ? "success"
    : availability === "domain_pending"
      ? "warning"
      : "danger";
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
