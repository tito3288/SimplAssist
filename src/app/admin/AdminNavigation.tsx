"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import AdminSignOutButton from "./AdminSignOutButton";

const ADMIN_SECTIONS = [
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/metrics", label: "Metrics" },
  { href: "/admin/partners", label: "Partners" },
  { href: "/admin/tickets", label: "Tickets" },
  { href: "/admin/waitlist", label: "Waitlist" },
] as const;

type AdminSectionHref = (typeof ADMIN_SECTIONS)[number]["href"];

export function getActiveAdminSection(
  pathname: string,
): AdminSectionHref | null {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";

  for (const { href } of ADMIN_SECTIONS) {
    if (normalizedPath === href || normalizedPath.startsWith(`${href}/`)) {
      return href;
    }
  }

  return null;
}

export function AdminNavigation() {
  const activeSection = getActiveAdminSection(usePathname());

  return (
    <nav
      aria-label="Admin sections"
      className="flex w-full flex-wrap items-center justify-start gap-x-5 gap-y-1 md:w-auto md:justify-end"
    >
      {ADMIN_SECTIONS.map(({ href, label }) => {
        const active = activeSection === href;

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex border-b-2 px-0.5 py-2 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] ${
              active
                ? "border-[var(--brand-primary)] text-[var(--brand-primary-active)] dark:text-[var(--brand-primary-dark)]"
                : "border-transparent text-stone-600 hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary-active)] dark:text-stone-300 dark:hover:text-[var(--brand-primary-dark)]"
            }`}
          >
            {label}
          </Link>
        );
      })}
      <AdminSignOutButton />
    </nav>
  );
}
