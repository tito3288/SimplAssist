import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminGateState } from "@/lib/admin/auth";
import {
  btnSecondaryCompact,
  pageShell,
  fontStack,
  lightAmbient,
  darkAmbient,
} from "@/lib/theme-v2/theme";
import AdminLoginForm from "./AdminLoginForm";
import AdminSignOutButton from "./AdminSignOutButton";
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
            <header className="mb-6 flex flex-col items-start gap-3 border-b border-[#ece4d8] pb-4 md:flex-row md:items-center md:justify-between dark:border-white/[0.10]">
              <Link href="/admin" className="text-lg font-semibold">
                SimplAssist Admin
              </Link>
              <nav
                aria-label="Admin sections"
                className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end"
              >
                <Link href="/admin/clients" className={btnSecondaryCompact}>
                  Clients
                </Link>
                <Link href="/admin/metrics" className={btnSecondaryCompact}>
                  Metrics
                </Link>
                <Link href="/admin/partners" className={btnSecondaryCompact}>
                  Partners
                </Link>
                <Link href="/admin/tickets" className={btnSecondaryCompact}>
                  Tickets
                </Link>
                <Link href="/admin/waitlist" className={btnSecondaryCompact}>
                  Waitlist
                </Link>
                <AdminSignOutButton />
              </nav>
            </header>
            {children}
          </div>
        </AdminSetupLinkProvider>
      )}
    </div>
  );
}
