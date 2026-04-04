"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  Calendar,
  Cog,
  AppWindow,
  CreditCard,
  LogOut,
} from "lucide-react";
import Image from "next/image";
import { createBrowserClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/theme-toggle";
import { StaggeredMenuIcon } from "@/components/icons/staggered-menu-icon";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/conversations", label: "Conversations", icon: MessageSquare },
  { href: "/contacts", label: "Contacts", icon: Users },
  { href: "/calendar", label: "Calendar", icon: Calendar },
  { href: "/settings", label: "Settings", icon: Cog },
  { href: "/widget", label: "Widget", icon: AppWindow },
  { href: "/billing", label: "Billing", icon: CreditCard },
];

export default function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const supabase = createBrowserClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/home");
  }

  const sidebarContent = (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-6 shrink-0">
        <Link href="/dashboard">
          <Image
            src="/logo-dark.png"
            alt="SimplAssist"
            width={140}
            height={34}
            className="hidden dark:block h-8 w-auto object-contain"
          />
          <Image
            src="/logo-light.png"
            alt="SimplAssist"
            width={140}
            height={34}
            className="block dark:hidden h-8 w-auto object-contain"
          />
        </Link>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto min-h-0">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-[22px] text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[rgba(255,145,77,.12)] dark:bg-[rgba(255,145,77,.15)] text-[#ff914d] border border-[rgba(255,145,77,.20)]"
                  : "text-slate-600 dark:text-[#bdbdbf] hover:bg-slate-100 dark:hover:bg-white/[0.06] hover:text-slate-900 dark:hover:text-white border border-transparent"
              }`}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 dark:border-white/[0.10] shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-500 dark:text-[#bdbdbf] truncate">
            {userEmail}
          </p>
          <ThemeToggle />
        </div>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 text-sm text-slate-600 dark:text-[#bdbdbf] hover:text-slate-900 dark:hover:text-white transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile header: logo left, menu right */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 flex items-center justify-between gap-3 px-4 py-3 bg-white/85 dark:bg-[rgba(18,18,20,0.92)] backdrop-blur-[14px] border-b border-slate-200/60 dark:border-white/[0.10]">
        <Link href="/dashboard" className="flex items-center shrink-0 min-w-0" onClick={() => setMobileOpen(false)}>
          <Image
            src="/logo-dark.png"
            alt="SimplAssist"
            width={160}
            height={40}
            className="hidden dark:block h-9 w-auto max-w-[min(100%,9rem)] object-contain object-left"
            priority
          />
          <Image
            src="/logo-light.png"
            alt="SimplAssist"
            width={160}
            height={40}
            className="block dark:hidden h-9 w-auto max-w-[min(100%,9rem)] object-contain object-left"
            priority
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          aria-expanded={mobileOpen}
          className="shrink-0 flex items-center justify-center min-h-[44px] min-w-[44px] -mr-1 rounded-lg text-[#FF8533] transition-transform duration-200 active:scale-90 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8533]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#121214]"
        >
          <StaggeredMenuIcon open={mobileOpen} />
        </button>
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar — floating panel */}
      <aside
        className={`lg:hidden fixed z-50 w-[min(16rem,calc(100vw-1.5rem))] left-3 top-3 bottom-3 flex flex-col
          bg-white/95 dark:bg-[rgba(18,18,20,0.94)] backdrop-blur-[20px] backdrop-saturate-[1.4]
          border border-slate-200/80 dark:border-white/[0.12]
          rounded-2xl shadow-[0_24px_64px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.55)]
          transform transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] overflow-hidden
          ${mobileOpen ? "translate-x-0" : "-translate-x-[calc(100%+14px)]"}`}
      >
        {sidebarContent}
      </aside>

      {/* Desktop sidebar — floating, rounded */}
      <aside
        className="hidden lg:flex flex-col flex-shrink-0 w-64 h-[calc(100dvh-2.5rem)] max-h-[calc(100dvh-2.5rem)]
          rounded-[28px] overflow-hidden
          bg-white/90 dark:bg-[rgba(20,20,24,0.92)] backdrop-blur-[20px] backdrop-saturate-[1.4]
          border border-slate-200/80 dark:border-white/[0.12]
          shadow-[0_20px_60px_rgba(0,0,0,0.08)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.55)]
          lg:sticky lg:top-5 lg:self-start"
      >
        {sidebarContent}
      </aside>
    </>
  );
}
