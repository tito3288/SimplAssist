import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminGateState } from "@/lib/admin/auth";
import {
  accentText,
  darkAmbient,
  fontStack,
  ink,
  lightAmbient,
  pageShell,
} from "@/lib/theme-v2/theme";
import AdminLoginForm from "./AdminLoginForm";
import { AdminNavigation } from "./AdminNavigation";
import { AdminSetupLinkProvider } from "./AdminSetupLinkProvider";
import { PRIVATE_ROUTE_METADATA } from "@/lib/seo/privateMetadata";

export const dynamic = "force-dynamic";
export const metadata = PRIVATE_ROUTE_METADATA;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const gate = await getAdminGateState();
  if (gate.state === "forbidden") notFound();

  return (
    <div
      className={`${pageShell} isolate px-4 py-6 sm:px-6`}
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
      {gate.state === "unauthenticated" ? (
        // On full loads and router.refresh() the form renders INSTEAD of
        // {children}, so the page function never runs. Soft navigations do
        // NOT re-execute this layout — each admin page's own
        // requireAdminUser() is the security boundary there, so every new
        // admin page must call it.
        <AdminLoginForm />
      ) : (
        <AdminSetupLinkProvider>
          <div className="mx-auto max-w-6xl">
            <header className="mb-8 rounded-[20px] border border-[#eadfce] bg-[#fffaf6] px-4 py-3.5 shadow-[0_10px_26px_-22px_rgba(67,46,28,0.35)] sm:rounded-[22px] sm:px-5 sm:py-4 dark:border-white/[0.12] dark:bg-white/[0.05] dark:shadow-[0_16px_36px_-24px_rgba(0,0,0,0.75)]">
              <div className="flex flex-col items-center gap-4 text-center lg:flex-row lg:justify-between lg:text-left">
                <div>
                  <p
                    className={`text-[11px] font-bold uppercase tracking-[0.18em] ${accentText}`}
                  >
                    Admin console
                  </p>
                  <Link
                    href="/admin"
                    className={`mx-auto mt-0.5 block w-fit rounded-md text-lg font-bold lg:mx-0 ${ink} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]`}
                  >
                    SimplAssist Admin
                  </Link>
                </div>
                <AdminNavigation />
              </div>
            </header>
            {children}
          </div>
        </AdminSetupLinkProvider>
      )}
    </div>
  );
}
