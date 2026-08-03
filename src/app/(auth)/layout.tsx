import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BrandLogo } from "@/components/branding/BrandLogo";
import { ThemeToggleV2 } from "@/lib/theme-v2/ui";
import { getRequestBrand } from "@/lib/branding/requestBrand.server";
import { PRIVATE_ROUTE_METADATA } from "@/lib/seo/privateMetadata";
import {
  body,
  card,
  darkAmbient,
  fontStack,
  inlineLink,
  lightAmbient,
  pageShell,
} from "@/lib/theme-v2/theme";

export const metadata = PRIVATE_ROUTE_METADATA;

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { brand } = await getRequestBrand();
  const isPartner = brand.kind === "partner";

  const logo = (
    <BrandLogo
      width={180}
      height={48}
      className="h-10 w-auto object-contain"
      wordmarkClassName="text-2xl"
      priority
    />
  );

  return (
    <div
      className={`${pageShell} isolate flex flex-col items-center justify-center p-4 sm:p-6`}
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
          background: "rgb(var(--brand-primary-dark-rgb) / .20)",
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
          background: "rgb(var(--brand-primary-dark-rgb) / .14)",
          left: -100,
          bottom: "12%",
          filter: "blur(56px)",
        }}
      />

      <div className="relative z-[1] w-full max-w-[440px]">
        {/* Top bar */}
        <div
          className={`mb-6 flex items-center gap-4 ${isPartner ? "justify-end" : "justify-between"}`}
        >
          {!isPartner && (
            <Link
              href="/"
              className="
                inline-flex items-center gap-2 text-sm font-medium
                text-stone-600 hover:text-[var(--brand-accent)]
                dark:text-[#bdbdbf] dark:hover:text-[var(--brand-accent-dark)]
                transition-colors
              "
            >
              <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
              Back to home
            </Link>
          )}
          <ThemeToggleV2 />
        </div>

        {/* Brand */}
        <div className="mb-8 text-center">
          {isPartner ? (
            <div className="inline-flex flex-col items-center gap-3">{logo}</div>
          ) : (
            <Link
              href="/"
              className="
                inline-flex flex-col items-center gap-3 rounded-[28px]
                focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-primary-rgb)/.50)]
                dark:focus-visible:ring-[rgb(var(--brand-primary-dark-rgb)/.50)] focus-visible:ring-offset-2
                focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#050505]
              "
            >
              {logo}
            </Link>
          )}
          <p className={`mt-3 max-w-[320px] mx-auto text-sm leading-relaxed ${body}`}>
            AI-powered customer communication for small businesses
          </p>
          {!isPartner && (
            <Link href="/" className={`mt-2 inline-block text-xs ${inlineLink}`}>
              Learn more
            </Link>
          )}
        </div>

        {/* Form card */}
        <div className={`p-8 sm:p-10 ${card}`}>
          {children}
        </div>

        <p className={`mt-6 text-center text-xs ${body}`}>
          &copy; {new Date().getFullYear()} {brand.name}
        </p>
      </div>
    </div>
  );
}
