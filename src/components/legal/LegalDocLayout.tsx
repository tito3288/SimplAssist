import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { glassCard, textPrimary, textSecondary } from "@/lib/glass";

type LegalDocLayoutProps = {
  title: string;
  lastUpdated?: string;
  /** Cross-link to the other legal page */
  siblingHref?: string;
  siblingLabel?: string;
  children: React.ReactNode;
};

export function LegalDocLayout({
  title,
  lastUpdated = "March 2026",
  siblingHref,
  siblingLabel,
  children,
}: LegalDocLayoutProps) {
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
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-22 dark:opacity-38"
        style={{
          width: 480,
          height: 480,
          background: "rgba(255,145,77,.20)",
          top: -100,
          right: -140,
          filter: "blur(64px)",
        }}
      />
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-15 dark:opacity-32"
        style={{
          width: 240,
          height: 240,
          background: "rgba(255,145,77,.14)",
          left: -80,
          bottom: "20%",
          filter: "blur(52px)",
        }}
      />

      <header className="relative z-[1] border-b border-slate-200/80 dark:border-white/[0.08] bg-white/60 dark:bg-[rgba(8,8,10,0.65)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Link
              href="/home"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-[#ff914d] dark:text-[#bdbdbf]"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
              Back to home
            </Link>
            {siblingHref && siblingLabel && (
              <Link
                href={siblingHref}
                className="text-sm font-semibold text-[#ff914d] transition-colors hover:text-[#ffb07a]"
              >
                {siblingLabel}
              </Link>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/home"
              className="hidden sm:block focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff914d]/50 rounded-lg"
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
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="relative z-[1] mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <article className={`p-8 sm:p-10 lg:p-12 ${glassCard}`}>
          <h1
            className={`text-[clamp(1.75rem,4vw,2.25rem)] font-bold tracking-tight ${textPrimary}`}
          >
            {title}
          </h1>
          <p className={`mt-2 text-sm ${textSecondary}`}>
            Last updated: {lastUpdated}
          </p>
          <div className="mt-10 space-y-10">{children}</div>
        </article>

        <p className={`mt-8 text-center text-xs ${textSecondary}`}>
          &copy; {new Date().getFullYear()} ARAMBULA VENTURES LLC. SimplAssist is a product of ARAMBULA VENTURES LLC. All rights reserved.
        </p>
      </main>
    </div>
  );
}
