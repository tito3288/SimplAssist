import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { LegalDocLayout } from "@/components/legal/LegalDocLayout";
import { LegalSection } from "@/components/legal/legal-section";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildPrivacyContent,
  type LegalTemplateBusiness,
} from "@/lib/legal/perBusinessCopy";
import { isPendingSlug } from "@/lib/util/slug";

/**
 * Per-business privacy policy (Phase 6).
 *
 * Public, unauthenticated. Carrier reviewers (T-Mobile/AT&T/Verizon, TCR) hit
 * this URL when reviewing the campaign registered for this business.
 *
 * IMPORTANT — column projection: this page MUST only read public-safe
 * fields. NEVER project ein, last_4_ssn, registrant_mobile, authorized_rep_*,
 * tax_id_type, or any other PII column on `businesses`. The select() below
 * includes id only so the server can read the active SimpleAssist number; id
 * is not rendered into the public page.
 */

type PageProps = { params: Promise<{ slug: string }> };

const PUBLIC_PROJECTION =
  "id, slug, name, email, phone_number, address, city, state, zip, opt_in_description";

async function loadBusiness(
  slug: string
): Promise<(LegalTemplateBusiness & { slug: string }) | null> {
  if (isPendingSlug(slug)) return null;

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(PUBLIC_PROJECTION)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;

  const business = data as unknown as LegalTemplateBusiness & {
    id: string;
    slug: string;
  };

  const { data: phoneNumber } = await supabaseAdmin
    .from("phone_numbers")
    .select("phone_number")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    ...business,
    sms_phone_number: phoneNumber?.phone_number ?? null,
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await loadBusiness(slug);
  if (!business) return { title: "Privacy Policy" };
  return {
    title: `${business.name} — Privacy Policy`,
    description: `Privacy policy and SMS messaging disclosures for ${business.name}.`,
  };
}

export default async function PerBusinessPrivacyPage({ params }: PageProps) {
  const { slug } = await params;
  const business = await loadBusiness(slug);
  if (!business) notFound();

  const doc = buildPrivacyContent(business);

  return (
    <LegalDocLayout
      title="Privacy Policy"
      lastUpdated={doc.lastUpdated}
      backHref={`/c/${business.slug}`}
      backLabel={`Back to ${business.name}`}
      siblingHref={`/c/${business.slug}/terms`}
      siblingLabel="Terms of Service"
      businessName={business.name}
    >
      {doc.sections.map((section) => (
        <LegalSection key={section.title} title={section.title}>
          {section.paragraphs.map((p, idx) => (
            <p key={idx}>{p}</p>
          ))}
        </LegalSection>
      ))}
    </LegalDocLayout>
  );
}
