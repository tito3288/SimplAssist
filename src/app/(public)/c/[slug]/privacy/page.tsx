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
 * is the canonical safe projection — extend with care.
 */

type PageProps = { params: Promise<{ slug: string }> };

const PUBLIC_PROJECTION =
  "slug, name, email, phone_number, address, city, state, zip, opt_in_description";

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
  return data as unknown as LegalTemplateBusiness & { slug: string };
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
