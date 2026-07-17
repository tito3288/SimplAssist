import Sidebar from "@/app/(dashboard)/_components/sidebar";
import { pageShell, fontStack, lightAmbient, darkAmbient } from "@/lib/theme-v2/theme";
import { DEMO_BUSINESS } from "../_fixtures/business";

/**
 * Visual replica of the dashboard chrome — src/app/(dashboard)/layout.tsx
 * L42-85 minus the auth redirects (that layout is auth-gated, so the demo
 * pages rebuild its presentational wrapper here). Keep in visual sync with
 * the real layout if it changes.
 *
 * `activePath` makes the sidebar highlight the nav item the demo page is
 * imitating (the real pathname is /demo/*, which matches no nav href).
 */
export function DemoShell({
  activePath,
  children,
}: {
  activePath: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${pageShell} isolate flex flex-col lg:flex-row lg:p-5 lg:gap-5`}
      style={{ fontFamily: fontStack }}
    >
      {/* Ambient backgrounds — light gets its own warm treatment */}
      <div
        className="fixed inset-0 -z-10 pointer-events-none dark:hidden"
        style={{ background: lightAmbient }}
      />
      <div
        className="hidden dark:block fixed inset-0 pointer-events-none -z-10"
        style={{ background: darkAmbient }}
      />

      {/* Decorative orbs */}
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-30 dark:opacity-45"
        style={{
          width: 640,
          height: 640,
          background: "rgba(255,145,77,.20)",
          top: -70,
          right: -210,
          filter: "blur(60px)",
        }}
      />
      <div
        className="fixed rounded-full pointer-events-none z-0 opacity-20 dark:opacity-45"
        style={{
          width: 260,
          height: 260,
          background: "rgba(255,145,77,.14)",
          left: -80,
          top: "40%",
          filter: "blur(60px)",
        }}
      />

      <Sidebar
        userEmail={DEMO_BUSINESS.ownerEmail}
        websiteUrl={DEMO_BUSINESS.websiteUrl}
        activePath={activePath}
      />
      <main className="flex-1 bg-transparent px-4 pt-[4.75rem] pb-6 lg:pt-5 lg:pr-6 lg:pb-6 lg:pl-0 relative z-[1] min-w-0 lg:min-h-0 lg:overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
