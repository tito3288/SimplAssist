import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  ADMIN_PARTNER_COLUMNS,
  parseAdminPartnerRow,
  type AdminPartnerDto,
} from "@/lib/admin/partnerValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  bodyFaint,
  card,
  statusDanger,
  statusNeutral,
  statusSuccess,
  statusWarning,
} from "@/lib/theme-v2/theme";
import { PartnerForm } from "./PartnerForm";

export const dynamic = "force-dynamic";

export default async function AdminPartnersPage() {
  await requireAdminUser();

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select(ADMIN_PARTNER_COLUMNS)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Could not load partner records");
  }

  const partners: AdminPartnerDto[] = [];
  let invalidRecordCount = 0;
  for (const row of data ?? []) {
    try {
      partners.push(parseAdminPartnerRow(row));
    } catch {
      invalidRecordCount += 1;
    }
  }

  if (invalidRecordCount > 0) {
    console.error(
      `[admin-partners] Hid ${invalidRecordCount} stored partner record(s) that failed read validation.`,
    );
  }

  return (
    <main className="space-y-8">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/admin"
            className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            Back to admin
          </Link>
          <h1 className="mt-3 text-2xl font-bold">Partners</h1>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            Manage white-label presentation domains and public brand assets.
          </p>
        </div>
        <Link
          href="#create-partner"
          className="text-sm font-semibold text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Create partner
        </Link>
      </section>

      {invalidRecordCount > 0 && (
        <p className={`rounded-xl px-4 py-3 text-sm ${statusDanger}`}>
          {invalidRecordCount === 1
            ? "1 stored partner record was hidden because its values failed validation."
            : `${invalidRecordCount} stored partner records were hidden because their values failed validation.`}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Partner records</h2>
        <div className={`overflow-hidden ${card}`}>
          {partners.length === 0 ? (
            <p className={`px-5 py-6 text-sm ${bodyFaint}`}>
              No valid partner records yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-[#ece4d8] bg-[#faf7f2] text-xs uppercase tracking-wide text-stone-500 dark:border-white/[0.10] dark:bg-white/[0.04] dark:text-[#bdbdbf]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Partner</th>
                    <th className="px-4 py-3 font-medium">Custom domain</th>
                    <th className="px-4 py-3 font-medium">Domain</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#ece4d8] dark:divide-white/[0.08]">
                  {partners.map((partner) => (
                    <tr key={partner.id}>
                      <td className="px-4 py-4">
                        <p className="font-medium">{partner.name}</p>
                        <p className={`mt-1 text-xs ${bodyFaint}`}>
                          {partner.slug}
                        </p>
                      </td>
                      <td className="px-4 py-4">
                        {partner.customDomain ?? "Not set"}
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge
                          tone={
                            partner.domainStatus === "connected"
                              ? "success"
                              : "warning"
                          }
                        >
                          {partner.domainStatus === "connected"
                            ? "Connected"
                            : "Pending"}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-4">
                        <StatusBadge
                          tone={
                            partner.status === "active" ? "neutral" : "danger"
                          }
                        >
                          {partner.status === "active" ? "Active" : "Inactive"}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/admin/partners/${partner.id}`}
                            className="font-semibold text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
                          >
                            Edit
                          </Link>
                          <Link
                            href={`/login?brand=${partner.slug}`}
                            className="text-stone-500 hover:text-stone-900 dark:text-[#bdbdbf] dark:hover:text-white"
                          >
                            Preview
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section id="create-partner" className={`scroll-mt-6 p-5 sm:p-6 ${card}`}>
        <h2 className="text-lg font-semibold">Create partner</h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Add profile values and assets. The custom domain remains Pending until
          DNS and TLS are verified manually.
        </p>
        <div className="mt-6">
          <PartnerForm mode="create" />
        </div>
      </section>
    </main>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const toneClass = {
    success: statusSuccess,
    warning: statusWarning,
    danger: statusDanger,
    neutral: statusNeutral,
  }[tone];

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs ${toneClass}`}>
      {children}
    </span>
  );
}
