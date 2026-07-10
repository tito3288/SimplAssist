import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { ThemeToggleV2 } from "@/lib/theme-v2/ui";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { body, card, ink, inlineLink } from "@/lib/theme-v2/theme";
import {
  PublicPageShell,
  publicHeaderLink,
} from "@/components/legal/LegalDocLayout";
import { formatPhoneNumber } from "@/lib/utils";
import { isPendingSlug } from "@/lib/util/slug";

/**
 * Per-business public landing page (Phase 6).
 *
 * Serves two purposes:
 *   1. The fallback URL submitted to Telnyx as `website` when the customer
 *      has no website_url of their own (see brand.ts).
 *   2. A reachable backstop from the per-business privacy/terms pages so
 *      a carrier reviewer who clicks "Back to {Business}" lands somewhere
 *      that confirms the brand identity.
 *
 * IMPORTANT — column projection: NEVER project ein, last_4_ssn,
 * registrant_mobile, authorized_rep_*, tax_id_type, or any other PII column.
 * The select() below is the canonical safe projection.
 */

type PageProps = { params: Promise<{ slug: string }> };

const PUBLIC_PROJECTION =
  "id, slug, name, business_type, email, phone_number, address, city, state, zip, opt_in_description";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type PublicBusiness = {
  id: string;
  slug: string;
  name: string;
  business_type: string;
  email: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  opt_in_description: string | null;
};

type Hours = {
  day_of_week: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

async function loadBusiness(
  slug: string
): Promise<{ business: PublicBusiness; hours: Hours[] } | null> {
  if (isPendingSlug(slug)) return null;

  const { data: business, error } = await supabaseAdmin
    .from("businesses")
    .select(PUBLIC_PROJECTION)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !business) return null;

  const { data: hours } = await supabaseAdmin
    .from("business_hours")
    .select("day_of_week, open_time, close_time, is_closed")
    .eq("business_id", (business as unknown as PublicBusiness).id)
    .order("day_of_week");

  return {
    business: business as unknown as PublicBusiness,
    hours: (hours ?? []) as Hours[],
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadBusiness(slug);
  if (!loaded) return { title: "Business" };
  return {
    title: loaded.business.name,
    description: `${loaded.business.name} — contact information, hours, and SMS messaging policies.`,
  };
}

function formatTime(t: string): string {
  // t is a Postgres "time" string like "09:00:00"
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = parseInt(mStr ?? "0", 10);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  if (m === 0) return `${hour12} ${period}`;
  return `${hour12}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatAddress(b: PublicBusiness): string | null {
  const cityState = [b.city, b.state].filter(Boolean).join(", ");
  const parts = [b.address, cityState, b.zip].filter(
    (p) => p && p.trim().length > 0
  );
  if (parts.length === 0) return null;
  return parts.join(", ");
}

export default async function BusinessLandingPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadBusiness(slug);
  if (!loaded) notFound();
  const { business, hours } = loaded;
  const address = formatAddress(business);

  return (
    <PublicPageShell
      headerLeft={
        <span className={`text-sm font-semibold tracking-tight ${ink}`}>
          {business.name}
        </span>
      }
      headerRight={
        <>
          <Link href={`/c/${business.slug}/privacy`} className={publicHeaderLink}>
            Privacy
          </Link>
          <Link href={`/c/${business.slug}/terms`} className={publicHeaderLink}>
            Terms
          </Link>
          <ThemeToggleV2 />
        </>
      }
      footer={
        <p className={`mt-8 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} {business.name}. Messaging service powered by SimplAssist.
        </p>
      }
    >
      <article className={`p-8 sm:p-10 lg:p-12 ${card}`}>
        <h1
          className={`text-[clamp(1.75rem,4vw,2.25rem)] font-bold tracking-tight ${ink}`}
        >
          {business.name}
        </h1>

        <div className={`mt-8 grid gap-4 ${body}`}>
          {business.phone_number && (
            <a
              href={`tel:${business.phone_number}`}
              className="inline-flex items-center gap-3 text-base transition-colors hover:text-[#c2410c] dark:hover:text-[#ff914d]"
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden />
              <span>{formatPhoneNumber(business.phone_number)}</span>
            </a>
          )}
          {business.email && (
            <a
              href={`mailto:${business.email}`}
              className="inline-flex items-center gap-3 text-base transition-colors hover:text-[#c2410c] dark:hover:text-[#ff914d]"
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden />
              <span>{business.email}</span>
            </a>
          )}
          {address && (
            <div className="inline-flex items-start gap-3 text-base">
              <MapPin className="h-4 w-4 shrink-0 mt-1" aria-hidden />
              <span>{address}</span>
            </div>
          )}
        </div>

        {hours.length > 0 && (
          <section className="mt-10">
            <h2
              className={`mb-3 inline-flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl ${ink}`}
            >
              <Clock className="h-5 w-5 shrink-0" aria-hidden />
              Hours
            </h2>
            <ul className={`space-y-1.5 text-[15px] sm:text-base ${body}`}>
              {hours.map((h) => (
                <li key={h.day_of_week} className="flex justify-between gap-6">
                  <span>{DAY_NAMES[h.day_of_week]}</span>
                  <span>
                    {h.is_closed
                      ? "Closed"
                      : `${formatTime(h.open_time)} – ${formatTime(h.close_time)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {business.opt_in_description && (
          <section className="mt-10">
            <h2
              className={`mb-3 text-lg font-semibold tracking-tight sm:text-xl ${ink}`}
            >
              About our SMS messaging
            </h2>
            <p className={`text-[15px] leading-relaxed sm:text-base ${body}`}>
              {business.opt_in_description}
            </p>
            <p className={`mt-3 text-sm ${body}`}>
              See our{" "}
              <Link
                href={`/c/${business.slug}/privacy`}
                className={`${inlineLink} underline-offset-2 hover:underline`}
              >
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link
                href={`/c/${business.slug}/terms`}
                className={`${inlineLink} underline-offset-2 hover:underline`}
              >
                Terms of Service
              </Link>{" "}
              for details on opt-in, opt-out, and message frequency.
            </p>
          </section>
        )}
      </article>
    </PublicPageShell>
  );
}
