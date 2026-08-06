import { Search } from "lucide-react";

import { primaryCtaInlineClass } from "@/lib/glass";
import type { AdminAccountFilters } from "@/lib/admin/accountFilters";
import { bodyFaint, card, ink } from "@/lib/theme-v2/theme";
import {
  AdminOwnershipFields,
  type AdminAccountPartnerOption,
} from "./AdminOwnershipFields";

export type { AdminAccountPartnerOption } from "./AdminOwnershipFields";

interface AdminAccountFiltersProps {
  filters: AdminAccountFilters;
  partners: AdminAccountPartnerOption[];
  visibleCount: number;
}

const controlClass =
  "w-full rounded-lg border border-[#e3dacc] bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition-[border-color,box-shadow] focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[rgb(var(--brand-primary-rgb)/.14)] dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5] dark:focus:border-[var(--brand-primary-dark)] dark:focus:ring-[rgb(var(--brand-primary-dark-rgb)/.16)]";

export function AdminAccountFilters({
  filters,
  partners,
  visibleCount,
}: AdminAccountFiltersProps) {
  const activeFilters = buildActiveFilterLinks(filters, partners);

  return (
    <form
      action="/admin"
      method="get"
      aria-label="Filter accounts"
      className={`space-y-5 overflow-visible p-5 sm:p-6 ${card}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className={`text-lg font-semibold ${ink}`}>Find accounts</h2>
          <p className={`mt-1 text-xs ${bodyFaint}`}>
            Filters combine to narrow the newest 75 accounts.
          </p>
        </div>
        <p className={`shrink-0 text-sm ${bodyFaint}`}>
          <span className={`text-xl font-semibold ${ink}`}>{visibleCount}</span>{" "}
          {visibleCount === 1 ? "visible account" : "visible accounts"}
        </p>
      </div>

      <label className="block space-y-2">
        <span className="block text-sm font-medium">Search</span>
        <span className="relative block">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            defaultValue={filters.query ?? ""}
            pattern={"\\s*[\\s\\S]{0,100}\\s*"}
            title="Search must be 100 characters or fewer, excluding surrounding spaces."
            placeholder="Search by business name or contact email"
            className={`${controlClass} py-3 pl-10 text-base`}
          />
        </span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        <FilterLabel label="Account state">
          <select
            name="lifecycle"
            defaultValue={filters.lifecycle ?? ""}
            className={controlClass}
          >
            <option value="">All account states</option>
            <option value="live">Live</option>
            <option value="onboarding">Onboarding</option>
            <option value="past_due">Past due</option>
            <option value="suspended">Suspended</option>
            <option value="pending_deletion">Pending deletion</option>
            <option value="failed_setup">Failed setup</option>
          </select>
        </FilterLabel>

        <AdminOwnershipFields
          controlClass={controlClass}
          initialOwnership={filters.ownership}
          initialPartnerId={filters.partnerId}
          partners={partners}
        />

        <FilterLabel label="Plan">
          <select
            name="plan"
            defaultValue={filters.plan ?? ""}
            className={controlClass}
          >
            <option value="">All plans</option>
            <option value="sms_only">Starter</option>
            <option value="sms_and_chat">Growth</option>
            <option value="full">Full</option>
          </select>
        </FilterLabel>
      </div>

      <div className="flex flex-col gap-4 border-t border-[#eee6da] pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/[0.10]">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${bodyFaint}`}>
            {activeFilters.length > 0 ? "Active:" : "No filters applied"}
          </span>
          {activeFilters.map((filter) => (
            <a
              key={filter.key}
              href={filter.href}
              aria-label={`Remove ${filter.label} filter`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[rgb(var(--brand-primary-rgb)/.24)] bg-[rgb(var(--brand-primary-rgb)/.06)] px-2.5 py-1 text-xs font-medium text-stone-700 transition-colors hover:border-[rgb(var(--brand-primary-rgb)/.45)] hover:bg-[rgb(var(--brand-primary-rgb)/.10)] dark:border-[rgb(var(--brand-primary-dark-rgb)/.28)] dark:bg-[rgb(var(--brand-primary-dark-rgb)/.08)] dark:text-stone-200"
            >
              {filter.label}
              <span aria-hidden>×</span>
            </a>
          ))}
          <a
            href="/admin"
            className="ml-1 text-xs font-medium text-stone-500 underline decoration-stone-300 underline-offset-4 transition-colors hover:text-[var(--brand-primary-active)] dark:text-stone-400 dark:hover:text-[var(--brand-primary-dark)]"
          >
            Clear all
          </a>
        </div>
        <button
          type="submit"
          className={`${primaryCtaInlineClass} w-full sm:w-auto`}
        >
          Apply filters
        </button>
      </div>
    </form>
  );
}

type ActiveFilterKey = "lifecycle" | "ownership" | "plan" | "query";

interface ActiveFilterLink {
  key: ActiveFilterKey;
  label: string;
  href: string;
}

function buildActiveFilterLinks(
  filters: AdminAccountFilters,
  partners: AdminAccountPartnerOption[],
): ActiveFilterLink[] {
  const activeFilters: ActiveFilterLink[] = [];

  if (filters.lifecycle) {
    activeFilters.push({
      key: "lifecycle",
      label: lifecycleLabel(filters.lifecycle),
      href: buildFilterHref(filters, "lifecycle"),
    });
  }

  if (filters.ownership) {
    const partnerName = filters.partnerId
      ? partners.find((partner) => partner.id === filters.partnerId)?.name
      : null;
    activeFilters.push({
      key: "ownership",
      label:
        filters.ownership === "direct"
          ? "SimplAssist Direct"
          : partnerName
            ? `Partner: ${partnerName}`
            : "Partner",
      href: buildFilterHref(filters, "ownership"),
    });
  }

  if (filters.plan) {
    activeFilters.push({
      key: "plan",
      label: planLabel(filters.plan),
      href: buildFilterHref(filters, "plan"),
    });
  }

  if (filters.query) {
    activeFilters.push({
      key: "query",
      label: `Search: “${filters.query}”`,
      href: buildFilterHref(filters, "query"),
    });
  }

  return activeFilters;
}

function buildFilterHref(
  filters: AdminAccountFilters,
  omittedFilter: ActiveFilterKey,
): string {
  const searchParams = new URLSearchParams();

  if (omittedFilter !== "lifecycle" && filters.lifecycle) {
    searchParams.set("lifecycle", filters.lifecycle);
  }
  if (omittedFilter !== "ownership" && filters.ownership) {
    searchParams.set("ownership", filters.ownership);
    if (filters.ownership === "partner" && filters.partnerId) {
      searchParams.set("partner", filters.partnerId);
    }
  }
  if (omittedFilter !== "plan" && filters.plan) {
    searchParams.set("plan", filters.plan);
  }
  if (omittedFilter !== "query" && filters.query) {
    searchParams.set("q", filters.query);
  }

  const query = searchParams.toString();
  return query ? `/admin?${query}` : "/admin";
}

function lifecycleLabel(
  lifecycle: NonNullable<AdminAccountFilters["lifecycle"]>,
) {
  switch (lifecycle) {
    case "live":
      return "Live";
    case "onboarding":
      return "Onboarding";
    case "past_due":
      return "Past due";
    case "suspended":
      return "Suspended";
    case "pending_deletion":
      return "Pending deletion";
    case "failed_setup":
      return "Failed setup";
  }
}

function planLabel(plan: NonNullable<AdminAccountFilters["plan"]>) {
  switch (plan) {
    case "sms_only":
      return "Starter";
    case "sms_and_chat":
      return "Growth";
    case "full":
      return "Full";
  }
}

function FilterLabel({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1.5 text-sm">
      <span className="block font-medium">{label}</span>
      {children}
    </label>
  );
}
