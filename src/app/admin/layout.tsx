import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";
import { pageShell, fontStack, lightAmbient, darkAmbient } from "@/lib/theme-v2/theme";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminUser();

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
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between border-b border-[#ece4d8] pb-4 dark:border-white/[0.10]">
          <Link href="/admin" className="text-lg font-semibold">
            SimplAssist Admin
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/admin/tickets" className="text-sm text-stone-500 hover:text-[#c2410c] dark:hover:text-[#ff914d]">
              Tickets
            </Link>
            <Link href="/" className="text-sm text-stone-500 hover:text-[#c2410c] dark:hover:text-[#ff914d]">
              Back to app
            </Link>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
