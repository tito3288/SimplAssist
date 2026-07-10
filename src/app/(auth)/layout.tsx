import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { ThemeToggleV2 } from "@/app/preview/_v2/ui";
import {
  body,
  card,
  darkAmbient,
  fontStack,
  inlineLink,
  lightAmbient,
  pageShell,
} from "@/app/preview/_v2/theme";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${pageShell} flex flex-col items-center justify-center p-4 sm:p-6`}
      style={{ fontFamily: fontStack }}
    >
      {/* Ambient backgrounds */}
      <div
        className="pointer-events-none fixed inset-0 -z-10 dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="pointer-events-none fixed inset-0 -z-10 hidden dark:block"
        style={{ background: darkAmbient }}
      />

      {/* Orange orbs */}
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-20 dark:opacity-40"
        style={{
          width: 520,
          height: 520,
          background: "rgba(255,145,77,.20)",
          top: -120,
          right: -160,
          filter: "blur(64px)",
        }}
      />
      <div
        className="pointer-events-none fixed z-0 rounded-full opacity-15 dark:opacity-35"
        style={{
          width: 280,
          height: 280,
          background: "rgba(255,145,77,.14)",
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
            className="
              inline-flex items-center gap-2 text-sm font-medium
              text-stone-600 hover:text-[#c2410c]
              dark:text-[#bdbdbf] dark:hover:text-[#ff914d]
              transition-colors
            "
          >
            <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
            Back to home
          </Link>
          <ThemeToggleV2 />
        </div>

        {/* Brand */}
        <div className="mb-8 text-center">
          <Link
            href="/home"
            className="
              inline-flex flex-col items-center gap-3 rounded-[28px]
              focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ea580c]/50
              dark:focus-visible:ring-[#ff914d]/50 focus-visible:ring-offset-2
              focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
            "
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
          <p className={`mt-3 max-w-[320px] mx-auto text-sm leading-relaxed ${body}`}>
            AI-powered customer communication for small businesses
          </p>
          <Link href="/home" className={`mt-2 inline-block text-xs ${inlineLink}`}>
            Learn more
          </Link>
        </div>

        {/* Form card */}
        <div className={`p-8 sm:p-10 ${card}`}>
          {children}
        </div>

        <p className={`mt-6 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} SimplAssist
        </p>
      </div>
    </div>
  );
}
