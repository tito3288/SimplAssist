import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { glassCard, textSecondary } from "@/lib/glass";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="
        relative min-h-screen overflow-x-hidden
        flex flex-col items-center justify-center p-4 sm:p-6
        bg-gradient-to-b from-slate-50 via-white to-slate-100
        dark:bg-none dark:bg-[#050505]
      "
    >
      {/* Dark-mode ambient gradient */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{
          background:
            "radial-gradient(circle at 85% 8%, rgba(255,145,77,.20), transparent 28%), radial-gradient(circle at 10% 35%, rgba(255,145,77,.10), transparent 22%), linear-gradient(180deg, #080808 0%, #050505 45%, #0a0a0c 100%)",
        }}
      />

      {/* Orange orbs */}
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-25 dark:opacity-40"
        style={{
          width: 520,
          height: 520,
          background: "rgba(255,145,77,.22)",
          top: -120,
          right: -160,
          filter: "blur(64px)",
        }}
      />
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-18 dark:opacity-35"
        style={{
          width: 280,
          height: 280,
          background: "rgba(255,145,77,.16)",
          left: -100,
          bottom: "12%",
          filter: "blur(56px)",
        }}
      />

      <div className="relative z-[1] w-full max-w-[440px]">
        {/* Top bar */}
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/home"
            className={`
              inline-flex items-center gap-2 text-sm font-medium
              text-slate-600 dark:text-[#bdbdbf]
              hover:text-[#ff914d] transition-colors
            `}
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to home
          </Link>
          <ThemeToggle />
        </div>

        {/* Brand */}
        <div className="mb-8 text-center">
          <Link
            href="/home"
            className="inline-flex flex-col items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff914d]/50 focus-visible:ring-offset-2 rounded-[28px] focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#050505]"
          >
            <Image
              src="/logo-light.png"
              alt="SimplAssist"
              width={180}
              height={48}
              className="h-10 w-auto object-contain dark:hidden"
              priority
            />
            <Image
              src="/logo-dark.png"
              alt="SimplAssist"
              width={180}
              height={48}
              className="hidden h-10 w-auto object-contain dark:block"
              priority
            />
          </Link>
          <p className={`mt-3 max-w-[320px] mx-auto text-sm leading-relaxed ${textSecondary}`}>
            AI-powered customer communication for small businesses
          </p>
          <Link
            href="/home"
            className="mt-2 inline-block text-xs font-semibold text-[#ff914d] hover:text-[#ffb07a] transition-colors"
          >
            Learn more
          </Link>
        </div>

        {/* Form card */}
        <div className={`p-8 sm:p-10 ${glassCard}`}>
          {children}
        </div>

        <p className={`mt-6 text-center text-xs ${textSecondary}`}>
          &copy; {new Date().getFullYear()} SimplAssist
        </p>
      </div>
    </div>
  );
}
