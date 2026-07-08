import Link from "next/link";
import { requireAdminUser } from "@/lib/admin/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminUser();

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 dark:bg-[#050505] dark:text-[#f5f5f5] sm:px-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-center justify-between border-b border-slate-200 pb-4 dark:border-white/[0.10]">
          <Link href="/admin" className="text-lg font-semibold">
            SimplAssist Admin
          </Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-[#ff914d]">
            Back to app
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
