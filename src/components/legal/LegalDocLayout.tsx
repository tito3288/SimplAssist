import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ThemeToggleV2 } from "@/lib/theme-v2/ui";
import {
  body,
  card,
  darkAmbient,
  fontStack,
  ink,
  inlineLink,
  lightAmbient,
  pageShell,
} from "@/lib/theme-v2/theme";

/**
 * Shared public-page shell (theme-v2): warm page background with ambient
 * layers, frosted header bar, and centered main column. Used by the legal
 * pages below and by the per-business landing page (/c/[slug]) so the
 * carrier-facing surfaces share one shell definition.
 */
export function PublicPageShell({
  headerLeft,
  headerRight,
  footer,
  children,
}: {
  headerLeft: React.ReactNode;
  headerRight: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${pageShell} isolate overflow-x-hidden`}
      style={{ fontFamily: fontStack }}
    >
      <div
        className="pointer-events-none fixed inset-0 -z-10 dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{ background: darkAmbient }}
      />

      <header className="relative z-[1] border-b border-black/[0.06] dark:border-white/[0.08] bg-[#faf8f4]/70 dark:bg-[rgba(8,8,10,0.65)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            {headerLeft}
          </div>
          <div className="flex items-center gap-3">{headerRight}</div>
        </div>
      </header>

      <main className="relative z-[1] mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        {children}
        {footer}
      </main>
    </div>
  );
}

/** Quiet header link (back links, header nav) with split light/dark accents. */
export const publicHeaderLink = `
  text-sm font-medium text-stone-600 dark:text-[#bdbdbf]
  transition-colors hover:text-[#c2410c] dark:hover:text-[#ff914d]
`;

type LegalDocLayoutProps = {
  title: string;
  lastUpdated?: string;
  /** Cross-link to the other legal page */
  siblingHref?: string;
  siblingLabel?: string;
  /**
   * Back-link target. Defaults to "/home" (SimplAssist marketing page). For
   * per-business legal pages (Phase 6), override to "/c/[slug]" and label
   * with the business name.
   */
  backHref?: string;
  backLabel?: string;
  /**
   * When set, replaces the SimplAssist logo + global copyright footer with
   * the business's name and a "Messaging service powered by SimplAssist"
   * subline. Used by per-business legal pages so the business's identity
   * (not SimplAssist's) is what carrier reviewers see at the top and bottom.
   */
  businessName?: string;
  children: React.ReactNode;
};

export function LegalDocLayout({
  title,
  lastUpdated = "March 2026",
  siblingHref,
  siblingLabel,
  backHref = "/home",
  backLabel = "Back to home",
  businessName,
  children,
}: LegalDocLayoutProps) {
  const isPerBusiness = Boolean(businessName);
  return (
    <PublicPageShell
      headerLeft={
        <>
          <Link
            href={backHref}
            className={`inline-flex items-center gap-2 ${publicHeaderLink}`}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            {backLabel}
          </Link>
          {siblingHref && siblingLabel && (
            <Link href={siblingHref} className={`text-sm ${inlineLink}`}>
              {siblingLabel}
            </Link>
          )}
        </>
      }
      headerRight={
        <>
          {isPerBusiness ? (
            <span
              className={`hidden sm:block text-sm font-semibold tracking-tight ${ink}`}
            >
              {businessName}
            </span>
          ) : (
            <Link
              href="/home"
              className="hidden sm:block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/50 dark:focus-visible:ring-[#ff914d]/50"
            >
              <Image
                src="/logo-light.png"
                alt="SimplAssist"
                width={140}
                height={36}
                className="h-8 w-auto object-contain dark:hidden"
              />
              <Image
                src="/logo-dark.png"
                alt="SimplAssist"
                width={140}
                height={36}
                className="hidden h-8 w-auto object-contain dark:block"
              />
            </Link>
          )}
          <ThemeToggleV2 />
        </>
      }
      footer={
        isPerBusiness ? (
          <p className={`mt-8 text-center text-xs ${body}`}>
            &copy; {new Date().getFullYear()} {businessName}. Messaging service powered by SimplAssist.
          </p>
        ) : (
          <p className={`mt-8 text-center text-xs ${body}`}>
            &copy; {new Date().getFullYear()} SimplAssist, a product of Arambula Ventures LLC.
          </p>
        )
      }
    >
      <article className={`p-8 sm:p-10 lg:p-12 ${card}`}>
        <h1
          className={`text-[clamp(1.75rem,4vw,2.25rem)] font-bold tracking-tight ${ink}`}
        >
          {title}
        </h1>
        <p className={`mt-2 text-sm ${body}`}>
          Last updated: {lastUpdated}
        </p>
        <div className="mt-10 space-y-10">{children}</div>
      </article>
    </PublicPageShell>
  );
}
