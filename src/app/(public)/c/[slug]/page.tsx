import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Phone, Mail, MapPin, Clock } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { glassCard, textPrimary, textSecondary } from "@/lib/glass";
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
    <div
      className="
        relative min-h-screen overflow-x-hidden
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:bg-none dark:bg-[#050505]
      "
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{
          background:
            "radial-gradient(circle at 80% 0%, rgba(255,145,77,.18), transparent 26%), radial-gradient(circle at 12% 40%, rgba(255,145,77,.08), transparent 20%), linear-gradient(180deg, #080808 0%, #050505 45%, #0a0a0c 100%)",
        }}
      />

      <header className="relative z-[1] border-b border-slate-200/80 dark:border-white/[0.08] bg-white/60 dark:bg-[rgba(8,8,10,0.65)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <span className={`text-sm font-semibold tracking-tight ${textPrimary}`}>
            {business.name}
          </span>
          <div className="flex items-center gap-4">
            <Link
              href={`/c/${business.slug}/privacy`}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#ff914d] dark:text-[#bdbdbf]"
            >
              Privacy
            </Link>
            <Link
              href={`/c/${business.slug}/terms`}
              className="text-sm font-medium text-slate-600 transition-colors hover:text-[#ff914d] dark:text-[#bdbdbf]"
            >
              Terms
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-[1] mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <article className={`p-8 sm:p-10 lg:p-12 ${glassCard}`}>
          <h1
            className={`text-[clamp(1.75rem,4vw,2.25rem)] font-bold tracking-tight ${textPrimary}`}
          >
            {business.name}
          </h1>

          <div className={`mt-8 grid gap-4 ${textSecondary}`}>
            {business.phone_number && (
              <a
                href={`tel:${business.phone_number}`}
                className="inline-flex items-center gap-3 text-base transition-colors hover:text-[#ff914d]"
              >
                <Phone className="h-4 w-4 shrink-0" aria-hidden />
                <span>{formatPhoneNumber(business.phone_number)}</span>
              </a>
            )}
            {business.email && (
              <a
                href={`mailto:${business.email}`}
                className="inline-flex items-center gap-3 text-base transition-colors hover:text-[#ff914d]"
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
                className={`mb-3 inline-flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl ${textPrimary}`}
              >
                <Clock className="h-5 w-5 shrink-0" aria-hidden />
                Hours
              </h2>
              <ul className={`space-y-1.5 text-[15px] sm:text-base ${textSecondary}`}>
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
                className={`mb-3 text-lg font-semibold tracking-tight sm:text-xl ${textPrimary}`}
              >
                About our SMS messaging
              </h2>
              <p className={`text-[15px] leading-relaxed sm:text-base ${textSecondary}`}>
                {business.opt_in_description}
              </p>
              <p className={`mt-3 text-sm ${textSecondary}`}>
                See our{" "}
                <Link
                  href={`/c/${business.slug}/privacy`}
                  className="font-medium text-[#ff914d] underline-offset-2 hover:underline"
                >
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link
                  href={`/c/${business.slug}/terms`}
                  className="font-medium text-[#ff914d] underline-offset-2 hover:underline"
                >
                  Terms of Service
                </Link>{" "}
                for details on opt-in, opt-out, and message frequency.
              </p>
            </section>
          )}
        </article>

        <p className={`mt-8 text-center text-xs ${textSecondary}`}>
          &copy; {new Date().getFullYear()} {business.name}. Messaging service powered by SimplAssist.
        </p>
      </main>
    </div>
  );
}
