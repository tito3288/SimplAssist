import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdminUser } from "@/lib/admin/auth";
import {
  ADMIN_PARTNER_COLUMNS,
  parseAdminPartnerRow,
  type AdminPartnerDto,
} from "@/lib/admin/partnerValidation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bodyFaint, card, tile } from "@/lib/theme-v2/theme";
import { PartnerForm } from "../PartnerForm";

export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: { partnerId: string };
}) {
  await requireAdminUser();

  if (!UUID.test(params.partnerId)) notFound();

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select(ADMIN_PARTNER_COLUMNS)
    .eq("id", params.partnerId)
    .maybeSingle();

  if (error) {
    throw new Error("Could not load the partner record");
  }
  if (!data) notFound();

  let partner: AdminPartnerDto;
  try {
    partner = parseAdminPartnerRow(data);
  } catch {
    console.error(
      "[admin-partners] Refused to render a stored partner record that failed read validation.",
    );
    notFound();
  }

  return (
    <main className="space-y-6">
      <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            href="/admin/partners"
            className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
          >
            Back to partners
          </Link>
          <h1 className="mt-3 text-2xl font-bold">{partner.name}</h1>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            {partner.slug} · {partner.status === "active" ? "Active" : "Inactive"}
          </p>
        </div>
        <Link
          href={`/login?brand=${partner.slug}`}
          className="text-sm font-semibold text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Preview login
        </Link>
      </section>

      <section className={`p-5 sm:p-6 ${card}`}>
        <h2 className="text-lg font-semibold">Partner profile</h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Profile saves, sender verification, and domain connection actions are
          intentionally separate.
        </p>
        <div className="mt-6">
          <PartnerForm
            key={partner.updatedAt}
            mode="edit"
            partner={partner}
          />
        </div>
      </section>

      <section className={`space-y-4 p-5 sm:p-6 ${tile}`}>
        <div>
          <h2 className="text-lg font-semibold">Alpha Dog DNS and TLS checklist</h2>
          <p className={`mt-1 text-sm ${bodyFaint}`}>
            Follow these steps before marking the first partner domain Connected.
          </p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-stone-600 dark:text-[#bdbdbf]">
          <li>
            Create the <code>app</code> CNAME using the target Railway presents
            in the service&apos;s Custom Domains panel.
          </li>
          <li>
            Add <code>app.alphadogagency.ai</code> to Railway as a custom domain.
          </li>
          <li>Wait for Railway to finish issuing TLS for the domain.</li>
          <li>
            Manually verify DNS, HTTPS, and the exact hostname before changing
            application state.
          </li>
          <li>Use the separate Mark Connected action only after verification.</li>
        </ol>
        <p className="text-xs text-stone-500 dark:text-[#888]">
          The Railway CNAME target is intentionally not hardcoded here; use the
          value currently presented by Railway.
        </p>
      </section>
    </main>
  );
}
