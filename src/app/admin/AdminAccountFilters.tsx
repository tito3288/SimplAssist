import {
  primaryCtaCompactClass,
  secondaryCtaCompactClass,
} from "@/lib/glass";
import type { AdminAccountFilters } from "@/lib/admin/accountFilters";
import { bodyFaint, card } from "@/lib/theme-v2/theme";

export interface AdminAccountPartnerOption {
  id: string;
  name: string;
}

interface AdminAccountFiltersProps {
  filters: AdminAccountFilters;
  partners: AdminAccountPartnerOption[];
}

const controlClass =
  "w-full rounded-md border border-[#e3dacc] bg-white px-3 py-2 text-sm text-stone-900 dark:border-white/[0.12] dark:bg-[#242426] dark:text-[#f5f5f5]";

export function AdminAccountFilters({
  filters,
  partners,
}: AdminAccountFiltersProps) {
  const selectedPartnerIsAvailable = partners.some(
    (partner) => partner.id === filters.partnerId,
  );

  return (
    <form
      action="/admin"
      method="get"
      aria-label="Filter accounts"
      className={`space-y-4 p-4 ${card}`}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
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

        <FilterLabel label="Ownership">
          <select
            name="ownership"
            defaultValue={filters.ownership ?? ""}
            className={controlClass}
          >
            <option value="">All ownership</option>
            <option value="direct">Direct</option>
            <option value="partner">Partner</option>
          </select>
        </FilterLabel>

        <FilterLabel
          label="Specific partner"
          hint="Applied only when ownership is Partner."
        >
          <select
            name="partner"
            defaultValue={filters.partnerId ?? ""}
            className={controlClass}
          >
            <option value="">All partners</option>
            {filters.partnerId && !selectedPartnerIsAvailable ? (
              <option value={filters.partnerId}>Selected partner unavailable</option>
            ) : null}
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
              </option>
            ))}
          </select>
        </FilterLabel>

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

        <FilterLabel label="Search">
          <input
            type="search"
            name="q"
            defaultValue={filters.query ?? ""}
            pattern={"\\s*[\\s\\S]{0,100}\\s*"}
            title="Search must be 100 characters or fewer, excluding surrounding spaces."
            placeholder="Business name or contact email"
            className={controlClass}
          />
        </FilterLabel>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryCtaCompactClass}>
          Apply filters
        </button>
        <a href="/admin" className={secondaryCtaCompactClass}>
          Clear filters
        </a>
        <p className={`text-xs ${bodyFaint}`}>
          Filters combine to narrow the newest 75 accounts.
        </p>
      </div>
    </form>
  );
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
