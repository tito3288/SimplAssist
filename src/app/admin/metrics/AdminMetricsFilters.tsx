"use client";

import Link from "next/link";

import { primaryCtaCompactClass, secondaryCtaCompactClass } from "@/lib/glass";
import type {
  AdminMonthlyBusinessMetricPartnerOptionV1,
  AdminMonthlyMetricScopeKindV1,
} from "@/lib/metrics/contract";
import { bodyFaint, card } from "@/lib/theme-v2/theme";

export interface AdminMetricsFilterSelection {
  month: string;
  scope: AdminMonthlyMetricScopeKindV1;
  partnerId: string | null;
}

interface AdminMetricsFiltersProps {
  filters: AdminMetricsFilterSelection;
  partners: readonly AdminMonthlyBusinessMetricPartnerOptionV1[];
}

const controlClass =
  "w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]";

export function AdminMetricsFilters({
  filters,
  partners,
}: AdminMetricsFiltersProps) {
  const selectedPartnerIsAvailable = partners.some(
    (partner) => partner.partner_id === filters.partnerId,
  );

  return (
    <form
      action="/admin/metrics"
      method="get"
      aria-label="Filter monthly metrics"
      className={`space-y-4 p-4 ${card}`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <FilterLabel
          label="UTC month"
          hint="Month boundaries are calculated in UTC."
        >
          <input
            type="month"
            name="month"
            required
            defaultValue={filters.month}
            className={controlClass}
          />
        </FilterLabel>

        <FilterLabel label="Scope">
          <select
            name="scope"
            defaultValue={filters.scope}
            onChange={(event) => {
              synchronizePartnerControl(
                event.currentTarget.value,
                event.currentTarget.form?.elements.namedItem("partner") ??
                  null,
              );
            }}
            className={controlClass}
          >
            <option value="all">All</option>
            <option value="direct">SimplAssist direct</option>
            <option value="partner">Specific partner</option>
          </select>
        </FilterLabel>

        <FilterLabel
          label="Specific partner"
          hint="Applied only when scope is Specific partner."
        >
          <select
            name="partner"
            defaultValue={filters.partnerId ?? ""}
            disabled={filters.scope !== "partner"}
            required={filters.scope === "partner"}
            className={controlClass}
          >
            <option value="">Choose a partner</option>
            {filters.partnerId && !selectedPartnerIsAvailable ? (
              <option value={filters.partnerId}>
                {historicalPartnerLabel(filters.partnerId)}
              </option>
            ) : null}
            {partners.map((partner) => (
              <option key={partner.partner_id} value={partner.partner_id}>
                {partnerOptionLabel(partner)}
              </option>
            ))}
          </select>
        </FilterLabel>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryCtaCompactClass}>
          View metrics
        </button>
        <Link href="/admin/metrics" className={secondaryCtaCompactClass}>
          Clear filters
        </Link>
        <p className={`text-xs ${bodyFaint}`}>
          Counts are read-only and attributed to the brand at event time.
        </p>
      </div>
    </form>
  );
}

export function synchronizePartnerControl(
  scope: string,
  control: Element | RadioNodeList | null,
): void {
  if (
    control === null ||
    !("disabled" in control) ||
    !("required" in control)
  ) {
    return;
  }

  const partnerScope = scope === "partner";
  control.disabled = !partnerScope;
  control.required = partnerScope;
}

function FilterLabel({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="block font-medium">{label}</span>
      {children}
      {hint ? <span className={`block text-xs ${bodyFaint}`}>{hint}</span> : null}
    </label>
  );
}

function partnerOptionLabel(
  partner: AdminMonthlyBusinessMetricPartnerOptionV1,
): string {
  return (
    partner.partner_name ??
    partner.partner_slug ??
    historicalPartnerLabel(partner.partner_id)
  );
}

function historicalPartnerLabel(partnerId: string): string {
  return `Historical partner (${partnerId})`;
}
