"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { btnPrimaryCompact, btnSecondaryCompact } from "@/lib/theme-v2/theme";
import AdminSignOutButton from "./AdminSignOutButton";

const ADMIN_SECTIONS = [
  { href: "/admin", label: "Overview" },
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

  for (const { href } of ADMIN_SECTIONS.slice(1)) {
    if (normalizedPath === href || normalizedPath.startsWith(`${href}/`)) {
      return href;
    }
  }

  if (normalizedPath === "/admin" || /^\/admin\/[^/]+$/.test(normalizedPath)) {
    return "/admin";
  }

  return null;
}

export function AdminNavigation() {
  const activeSection = getActiveAdminSection(usePathname());

  return (
    <nav
      aria-label="Admin sections"
      className="flex w-full flex-wrap items-center justify-center gap-2 lg:w-auto lg:justify-end"
    >
      {ADMIN_SECTIONS.map(({ href, label }) => {
        const active = activeSection === href;

        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={active ? btnPrimaryCompact : btnSecondaryCompact}
          >
            {label}
          </Link>
        );
      })}
      <AdminSignOutButton />
    </nav>
  );
}
