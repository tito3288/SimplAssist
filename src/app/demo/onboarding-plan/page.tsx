import type { Metadata } from "next";
import { ThemeToggleV2 } from "@/lib/theme-v2/ui";
import {
  card,
  darkAmbient,
  fontStack,
  lightAmbient,
  pageShell,
} from "@/lib/theme-v2/theme";
import { assertDemoPagesEnabled } from "../_lib/guard";
import { OnboardingPlanPreview } from "./onboarding-plan-preview";

/**
 * /demo/onboarding-plan — an isolated visual review page for the onboarding
 * plan selector. Dev-only; it has no auth, billing, persistence, or network I/O.
 */

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  assertDemoPagesEnabled();
  return {
    title: "SimplAssist — Onboarding plan preview (dev only)",
    robots: { index: false, follow: false },
  };
}

export default function DemoOnboardingPlanPage() {
  assertDemoPagesEnabled();

  return (
    <div
      className={`${pageShell} isolate flex flex-col items-center justify-center overflow-x-hidden p-4 sm:p-6`}
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
        className="pointer-events-none fixed z-0 rounded-full opacity-20 dark:opacity-35"
        style={{
          width: 280,
          height: 280,
          background: "rgba(255,145,77,.16)",
          left: -100,
          bottom: "12%",
          filter: "blur(56px)",
        }}
      />

      <div className="relative z-[1] w-full max-w-[720px]">
        <div className="mb-4 flex items-center justify-end">
          <ThemeToggleV2 />
        </div>
        <main className={`p-6 sm:p-8 ${card}`}>
          <OnboardingPlanPreview />
        </main>
      </div>
    </div>
  );
}
