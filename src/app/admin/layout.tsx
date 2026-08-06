import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminGateState } from "@/lib/admin/auth";
import {
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
            <header className="mb-8 border-b border-[#e8dfd3] pb-4 dark:border-white/[0.10]">
              <div className="flex items-center justify-between gap-4">
                <Link
                  href="/admin"
                  className={`inline-flex w-fit items-center rounded-md ${ink} focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)]`}
                >
                  <Image
                    src="/logo-light.png"
                    alt="SimplAssist"
                    width={190}
                    height={44}
                    className="h-10 w-auto object-contain dark:hidden sm:h-11"
                    priority
                  />
                  <Image
                    src="/logo-dark.png"
                    alt="SimplAssist"
                    width={187}
                    height={44}
                    className="hidden h-10 w-auto object-contain dark:block sm:h-11"
                    priority
                  />
                </Link>
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
