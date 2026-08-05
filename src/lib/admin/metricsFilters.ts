import type { AdminMonthlyMetricScopeKindV1 } from "@/lib/metrics/contract";

export type AdminMetricsSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface AdminMetricsFilters {
  month: string;
  scope: AdminMonthlyMetricScopeKindV1;
  partnerId: string | null;
}

const MONTH = /^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ["all", "direct", "partner"] as const;

export function parseAdminMetricsFilters(
  searchParams: AdminMetricsSearchParams | null | undefined,
  now: Date = new Date(),
): AdminMetricsFilters {
  const month = parseMonth(searchParams?.month, now);
  const scope = searchParams?.scope;
  const partner = searchParams?.partner;

  if (scope === undefined) {
    return { month, scope: "all", partnerId: null };
  }
  if (
    !isAdminMetricScope(scope) ||
    (partner !== undefined && typeof partner !== "string")
  ) {
    return { month, scope: "all", partnerId: null };
  }

  const partnerValue = typeof partner === "string" ? partner : "";
  if (scope === "partner") {
    return UUID.test(partnerValue)
      ? { month, scope, partnerId: partnerValue.toLowerCase() }
      : { month, scope: "all", partnerId: null };
  }

  if (partnerValue !== "") {
    return { month, scope: "all", partnerId: null };
  }

  return { month, scope, partnerId: null };
}

function isAdminMetricScope(
  value: unknown,
): value is AdminMonthlyMetricScopeKindV1 {
  return (
    typeof value === "string" &&
    SCOPES.includes(value as AdminMonthlyMetricScopeKindV1)
  );
}

function parseMonth(
  value: string | string[] | undefined,
  now: Date,
): string {
  if (typeof value === "string" && MONTH.test(value)) return value;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("now must be a valid Date");
  }
  return now.toISOString().slice(0, 7);
}
