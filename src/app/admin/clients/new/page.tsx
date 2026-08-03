import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { requireAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bodyFaint, card } from "@/lib/theme-v2/theme";
import {
  CreateClientForm,
} from "../CreateClientForm";
import { parseActiveConnectedPartnerOptions } from "../partnerOptions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewPartnerClientPage() {
  noStore();
  await requireAdminUser();

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select("id, name, custom_domain, status, domain_status")
    .eq("status", "active")
    .eq("domain_status", "connected")
    .not("custom_domain", "is", null)
    .order("name", { ascending: true });

  if (error) throw new Error("Could not load eligible partners");

  const { partners, invalidRecordCount } =
    parseActiveConnectedPartnerOptions(data ?? []);
  if (invalidRecordCount > 0) {
    console.error(
      `[admin-clients] Hid ${invalidRecordCount} eligible partner record(s) that failed read validation.`,
    );
  }

  return (
    <main className="space-y-6">
      <section>
        <Link
          href="/admin"
          className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a]"
        >
          Back to admin
        </Link>
        <h1 className="mt-3 text-2xl font-bold">Create partner client</h1>
        <p className={`mt-1 max-w-3xl text-sm ${bodyFaint}`}>
          Create a confirmed customer account, attach its trigger-created
          business to a connected partner, and choose whether to hold the first
          recovery link in this admin session or send it by email.
        </p>
      </section>

      <section className={`p-5 sm:p-6 ${card}`}>
        <CreateClientForm activePartners={partners} />
      </section>
    </main>
  );
}
