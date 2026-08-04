import type { SubscriptionPlan } from "@/types/database";

export const ADMIN_ACCOUNT_LIFECYCLE_FILTERS = [
  "live",
  "onboarding",
  "past_due",
  "pending_deletion",
  "failed_setup",
] as const;

export const ADMIN_ACCOUNT_OWNERSHIP_FILTERS = ["direct", "partner"] as const;

export const ADMIN_ACCOUNT_PLAN_FILTERS = [
  "sms_only",
  "sms_and_chat",
  "full",
] as const satisfies readonly SubscriptionPlan[];

export type AdminAccountLifecycleFilter =
  (typeof ADMIN_ACCOUNT_LIFECYCLE_FILTERS)[number];
export type AdminAccountOwnershipFilter =
  (typeof ADMIN_ACCOUNT_OWNERSHIP_FILTERS)[number];

export type AdminAccountFilterSearchParams = Record<
  string,
  string | string[] | undefined
>;

export interface AdminAccountFilters {
  lifecycle: AdminAccountLifecycleFilter | null;
  ownership: AdminAccountOwnershipFilter | null;
  partnerId: string | null;
  plan: SubscriptionPlan | null;
  query: string | null;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAdminAccountFilters(
  searchParams: AdminAccountFilterSearchParams | null | undefined,
): AdminAccountFilters {
  const lifecycle = parseEnum(
    searchParams?.lifecycle,
    ADMIN_ACCOUNT_LIFECYCLE_FILTERS,
  );
  const ownership = parseEnum(
    searchParams?.ownership,
    ADMIN_ACCOUNT_OWNERSHIP_FILTERS,
  );
  const plan = parseEnum(searchParams?.plan, ADMIN_ACCOUNT_PLAN_FILTERS);
  const query = parseQuery(searchParams?.q);
  const partnerId =
    ownership === "partner" ? parseUuid(searchParams?.partner) : null;

  return { lifecycle, ownership, partnerId, plan, query };
}

function parseEnum<const Value extends string>(
  value: string | string[] | undefined,
  allowed: readonly Value[],
): Value | null {
  if (typeof value !== "string") return null;
  return (allowed as readonly string[]).includes(value)
    ? (value as Value)
    : null;
}

function parseUuid(value: string | string[] | undefined): string | null {
  return typeof value === "string" && UUID.test(value)
    ? value.toLowerCase()
    : null;
}

function parseQuery(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;

  const query = value.trim();
  if (!query || Array.from(query).length > 100) return null;
  return query;
}
