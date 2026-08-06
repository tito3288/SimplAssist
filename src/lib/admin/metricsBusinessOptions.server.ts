import "server-only";

import { z } from "zod";
import type {
  AdminMonthlyBusinessMetricBusinessOptionV2,
  AdminMonthlyBusinessMetricPartnerOptionV1,
} from "@/lib/metrics/contract";

export const ADMIN_METRICS_BUSINESS_ATTRIBUTION_COLUMNS = "id,partner_id";
export const ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE = 200;

export interface AdminMetricsBusinessOptionGroup {
  id: "direct" | string;
  label: string;
  businesses: readonly AdminMonthlyBusinessMetricBusinessOptionV2[];
}

const attributionRowSchema = z
  .object({
    id: z.string().uuid(),
    partner_id: z.string().uuid().nullable(),
  })
  .strict();

/**
 * Adds current ownership presentation to the RPC's authoritative business
 * options. The caller must authenticate the admin before invoking this
 * service-role read. A null result means the caller must preserve the flat
 * picker rather than guess at ownership or fail the metrics report.
 */
export async function loadAdminMetricsBusinessOptionGroups(
  businesses: readonly AdminMonthlyBusinessMetricBusinessOptionV2[],
  partners: readonly AdminMonthlyBusinessMetricPartnerOptionV1[],
): Promise<AdminMetricsBusinessOptionGroup[] | null> {
  if (businesses.length === 0) return [];

  const businessesById = new Map<
    string,
    AdminMonthlyBusinessMetricBusinessOptionV2
  >();
  for (const business of businesses) {
    const id = canonicalUuid(business.business_id);
    if (businessesById.has(id)) return null;
    businessesById.set(id, business);
  }

  const partnersById = new Map<
    string,
    AdminMonthlyBusinessMetricPartnerOptionV1
  >();
  for (const partner of partners) {
    const id = canonicalUuid(partner.partner_id);
    if (partnersById.has(id)) return null;
    partnersById.set(id, partner);
  }

  let supabaseAdmin: typeof import("@/lib/supabase/admin").supabaseAdmin;
  try {
    ({ supabaseAdmin } = await import("@/lib/supabase/admin"));
  } catch {
    return null;
  }

  const attributionByBusinessId = new Map<string, string | null>();
  const businessIds = Array.from(businessesById.keys());

  for (
    let start = 0;
    start < businessIds.length;
    start += ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE
  ) {
    const chunk = businessIds.slice(
      start,
      start + ADMIN_METRICS_BUSINESS_ATTRIBUTION_CHUNK_SIZE,
    );

    let result: { data: unknown; error: unknown };
    try {
      result = await supabaseAdmin
        .from("businesses")
        .select(ADMIN_METRICS_BUSINESS_ATTRIBUTION_COLUMNS)
        .in("id", chunk);
    } catch {
      return null;
    }

    if (result.error) return null;

    const parsed = z.array(attributionRowSchema).safeParse(result.data);
    if (!parsed.success) return null;

    for (const row of parsed.data) {
      const businessId = canonicalUuid(row.id);
      if (
        !businessesById.has(businessId) ||
        attributionByBusinessId.has(businessId)
      ) {
        return null;
      }

      const partnerId =
        row.partner_id === null ? null : canonicalUuid(row.partner_id);
      if (partnerId !== null && !partnersById.has(partnerId)) return null;
      attributionByBusinessId.set(businessId, partnerId);
    }
  }

  if (attributionByBusinessId.size !== businessesById.size) return null;

  const directBusinesses: AdminMonthlyBusinessMetricBusinessOptionV2[] = [];
  const partnerBusinesses = new Map<
    string,
    AdminMonthlyBusinessMetricBusinessOptionV2[]
  >();

  for (const [businessId, business] of Array.from(businessesById)) {
    const partnerId = attributionByBusinessId.get(businessId);
    if (partnerId === undefined) return null;

    if (partnerId === null) {
      directBusinesses.push(business);
      continue;
    }

    const group = partnerBusinesses.get(partnerId) ?? [];
    group.push(business);
    partnerBusinesses.set(partnerId, group);
  }

  const groups: AdminMetricsBusinessOptionGroup[] = [];
  if (directBusinesses.length > 0) {
    groups.push({
      id: "direct",
      label: "SimplAssist direct",
      businesses: directBusinesses.sort(compareBusinesses),
    });
  }

  const namedPartnerGroups = Array.from(partnerBusinesses, ([id, options]) => {
    const partner = partnersById.get(id);
    if (!partner) return null;
    return {
      id,
      label: partnerOptionLabel(partner),
      businesses: options.sort(compareBusinesses),
    };
  });

  if (namedPartnerGroups.some((group) => group === null)) return null;

  groups.push(
    ...(namedPartnerGroups as AdminMetricsBusinessOptionGroup[]).sort(
      (left, right) =>
        compareDisplayText(left.label, right.label) ||
        left.id.localeCompare(right.id),
    ),
  );

  return groups;
}

function partnerOptionLabel(
  partner: AdminMonthlyBusinessMetricPartnerOptionV1,
): string {
  return (
    partner.partner_name ??
    partner.partner_slug ??
    `Historical partner (${partner.partner_id})`
  );
}

function compareBusinesses(
  left: AdminMonthlyBusinessMetricBusinessOptionV2,
  right: AdminMonthlyBusinessMetricBusinessOptionV2,
): number {
  return (
    compareDisplayText(left.business_name, right.business_name) ||
    canonicalUuid(left.business_id).localeCompare(
      canonicalUuid(right.business_id),
    )
  );
}

function compareDisplayText(left: string, right: string): number {
  return (
    left.localeCompare(right, "en", { sensitivity: "base" }) ||
    left.localeCompare(right, "en")
  );
}

function canonicalUuid(value: string): string {
  return value.toLowerCase();
}
