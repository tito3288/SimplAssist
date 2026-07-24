import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminGateState } from "@/lib/admin/auth";
import { pageShell, fontStack, lightAmbient, darkAmbient } from "@/lib/theme-v2/theme";
import AdminLoginForm from "./AdminLoginForm";
import AdminSignOutButton from "./AdminSignOutButton";

export const dynamic = "force-dynamic";

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
        <div className="mx-auto max-w-6xl">
          <header className="mb-6 flex items-center justify-between border-b border-[#ece4d8] pb-4 dark:border-white/[0.10]">
            <Link href="/admin" className="text-lg font-semibold">
              SimplAssist Admin
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/admin/tickets" className="text-sm text-stone-500 hover:text-[#c2410c] dark:hover:text-[#ff914d]">
                Tickets
              </Link>
              <AdminSignOutButton />
            </div>
          </header>
          {children}
        </div>
      )}
    </div>
  );
}
