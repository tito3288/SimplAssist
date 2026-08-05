import "server-only";

import { z } from "zod";
import {
  ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1,
  BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1,
  BUSINESS_METRIC_KEYS_V1,
  type AdminMonthlyBusinessMetricBrandV1,
  type AdminMonthlyBusinessMetricsResponseV1,
  type BusinessMetricCountsV1,
  type BusinessMetricKeyV1,
} from "@/lib/metrics/contract";
import type { AdminMetricsFilters } from "./metricsFilters";

export const ADMIN_MONTHLY_BUSINESS_METRICS_RPC =
  "list_admin_monthly_business_metrics_v1";

export type AdminMetricsReadErrorCode =
  | "query_failed"
  | "invalid_response"
  | "inconsistent_response";

export class AdminMetricsReadError extends Error {
  readonly code: AdminMetricsReadErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: AdminMetricsReadErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "AdminMetricsReadError";
    this.code = code;
    this.cause = cause;
  }
}

const countSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const countsSchema = z
  .object({
    missed_call_caught: countSchema,
    ai_conversation_engaged: countSchema,
    booking_confirmed: countSchema,
    web_chat_session_engaged: countSchema,
    contact_created: countSchema,
    hot_lead_classified: countSchema,
    sms_message_inbound: countSchema,
    sms_message_outbound: countSchema,
    sms_parts_inbound: countSchema,
    sms_parts_outbound: countSchema,
    mms_event_inbound: countSchema,
    mms_event_outbound: countSchema,
    booking_confirmed_ai: countSchema,
    booking_confirmed_dashboard: countSchema,
  })
  .strict();

const utcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isUtcTimestamp, "Timestamp must use UTC");
const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Value must not be blank");
const nullableDisplayStringSchema = nonBlankStringSchema.nullable();

const definitionSchema = z
  .object({
    metric_key: z.enum(BUSINESS_METRIC_KEYS_V1),
    definition_version: z.literal(1),
    available_since: utcTimestampSchema,
    supports_historical_backfill: z.boolean(),
  })
  .strict();

const brandSchema = z
  .object({
    brand_kind: z.enum(["direct", "partner"]),
    partner_id_at_event: z.string().uuid().nullable(),
    partner_name: nullableDisplayStringSchema,
    partner_slug: nullableDisplayStringSchema,
    counts: countsSchema,
  })
  .strict();

const businessSchema = z
  .object({
    business_id: z.string().uuid(),
    business_name: nonBlankStringSchema,
    partner_id_at_event: z.string().uuid().nullable(),
    partner_name: nullableDisplayStringSchema,
    partner_slug: nullableDisplayStringSchema,
    counts: countsSchema,
  })
  .strict();

const partnerOptionSchema = z
  .object({
    partner_id: z.string().uuid(),
    partner_name: nullableDisplayStringSchema,
    partner_slug: nullableDisplayStringSchema,
  })
  .strict();

const responseSchema = z
  .object({
    period: z
      .object({
        month: z.string(),
        start: utcTimestampSchema,
        end_exclusive: utcTimestampSchema,
      })
      .strict(),
    scope: z
      .object({
        kind: z.enum(ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1),
        partner_id: z.string().uuid().nullable(),
      })
      .strict(),
    definitions: z.array(definitionSchema),
    totals: countsSchema,
    brand_totals: z.array(brandSchema),
    businesses: z.array(businessSchema),
    partner_options: z.array(partnerOptionSchema),
  })
  .strict();

const EXPECTED_BACKFILL_SUPPORT = {
  missed_call_caught: false,
  ai_conversation_engaged: false,
  booking_confirmed: true,
  web_chat_session_engaged: false,
  contact_created: true,
  hot_lead_classified: true,
  sms_message_inbound: true,
  sms_message_outbound: true,
  sms_parts_inbound: true,
  sms_parts_outbound: true,
  mms_event_inbound: true,
  mms_event_outbound: true,
} as const satisfies Record<BusinessMetricKeyV1, boolean>;

const COUNT_KEYS = [
  ...BUSINESS_METRIC_KEYS_V1,
  ...BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1,
] as const;

interface RpcResult {
  data: unknown;
  error: unknown;
}

/**
 * Loads one count-only monthly snapshot. The admin page must authenticate
 * before calling this function; the service-role module is therefore imported
 * lazily inside the call instead of during module evaluation.
 */
export async function loadAdminMonthlyBusinessMetrics(
  filters: AdminMetricsFilters,
): Promise<AdminMonthlyBusinessMetricsResponseV1> {
  let result: RpcResult;
  try {
    const { supabaseAdmin } = await import("@/lib/supabase/admin");
    result = await supabaseAdmin.rpc(ADMIN_MONTHLY_BUSINESS_METRICS_RPC, {
      p_month: `${filters.month}-01`,
      p_scope_kind: filters.scope,
      p_partner_id: filters.partnerId,
    });
  } catch (cause) {
    throw new AdminMetricsReadError(
      "query_failed",
      "Could not load admin monthly metrics.",
      cause,
    );
  }

  if (result.error) {
    throw new AdminMetricsReadError(
      "query_failed",
      "Could not load admin monthly metrics.",
      result.error,
    );
  }

  const parsed = responseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AdminMetricsReadError(
      "invalid_response",
      "Admin monthly metrics returned an invalid response.",
      parsed.error,
    );
  }

  const response: AdminMonthlyBusinessMetricsResponseV1 = parsed.data;
  validateResponseConsistency(response, filters);
  return response;
}

function validateResponseConsistency(
  response: AdminMonthlyBusinessMetricsResponseV1,
  filters: AdminMetricsFilters,
): void {
  validatePeriod(response, filters.month);
  validateScope(response, filters);
  validateDefinitions(response);

  const partnerFacts = new Map<
    string,
    { name: string | null; slug: string | null }
  >();
  const businessNames = new Map<string, string>();
  const businessSegments = new Set<string>();
  const partnerOptions = new Set<string>();
  const brandRows = new Map<string, AdminMonthlyBusinessMetricBrandV1>();
  const businessTotals = emptyCounts();
  const totalsByBrand = new Map<string, BusinessMetricCountsV1>();

  validateCounts(response.totals, "overall totals");

  for (const option of response.partner_options) {
    const partnerId = canonicalUuid(option.partner_id);
    if (partnerOptions.has(partnerId)) {
      inconsistent("Admin metrics returned a duplicate partner option.");
    }
    partnerOptions.add(partnerId);
    registerPartnerFacts(
      partnerFacts,
      partnerId,
      option.partner_name,
      option.partner_slug,
    );
  }

  for (const row of response.businesses) {
    validateCounts(row.counts, `business ${row.business_id}`);
    validateScopeAttribution(
      filters,
      row.partner_id_at_event,
      "business row",
    );
    validatePartnerDisplayPair(
      row.partner_id_at_event,
      row.partner_name,
      row.partner_slug,
    );

    const businessId = canonicalUuid(row.business_id);
    const partnerId = nullableCanonicalUuid(row.partner_id_at_event);
    const segmentKey = `${businessId}|${brandKey(partnerId)}`;
    if (businessSegments.has(segmentKey)) {
      inconsistent("Admin metrics returned a duplicate business segment.");
    }
    businessSegments.add(segmentKey);

    const priorBusinessName = businessNames.get(businessId);
    if (priorBusinessName !== undefined && priorBusinessName !== row.business_name) {
      inconsistent("Admin metric business display facts disagree.");
    }
    businessNames.set(businessId, row.business_name);

    if (partnerId !== null) {
      registerPartnerFacts(
        partnerFacts,
        partnerId,
        row.partner_name,
        row.partner_slug,
      );
    }

    addCounts(businessTotals, row.counts, "overall business totals");
    const key = brandKey(partnerId);
    const brandBusinessTotals = totalsByBrand.get(key) ?? emptyCounts();
    addCounts(brandBusinessTotals, row.counts, "brand business totals");
    totalsByBrand.set(key, brandBusinessTotals);
  }

  for (const brand of response.brand_totals) {
    validateCounts(brand.counts, "brand totals");
    validateScopeAttribution(
      filters,
      brand.partner_id_at_event,
      "brand total",
    );
    validatePartnerDisplayPair(
      brand.partner_id_at_event,
      brand.partner_name,
      brand.partner_slug,
    );

    const partnerId = nullableCanonicalUuid(brand.partner_id_at_event);
    if (
      (partnerId === null && brand.brand_kind !== "direct") ||
      (partnerId !== null && brand.brand_kind !== "partner")
    ) {
      inconsistent("Admin metric brand kind disagrees with event attribution.");
    }

    const key = brandKey(partnerId);
    if (brandRows.has(key)) {
      inconsistent("Admin metrics returned a duplicate brand total.");
    }
    brandRows.set(key, brand);

    if (partnerId !== null) {
      registerPartnerFacts(
        partnerFacts,
        partnerId,
        brand.partner_name,
        brand.partner_slug,
      );
    }
  }

  assertCountsEqual(response.totals, businessTotals, "overall totals");

  if (brandRows.size !== totalsByBrand.size) {
    inconsistent("Admin metric brand coverage disagrees with business rows.");
  }
  for (const [key, expected] of Array.from(totalsByBrand.entries())) {
    const brand = brandRows.get(key);
    if (!brand) {
      inconsistent("Admin metric brand coverage is incomplete.");
    }
    assertCountsEqual(brand.counts, expected, "brand totals");
  }
}

function validatePeriod(
  response: AdminMonthlyBusinessMetricsResponseV1,
  requestedMonth: string,
): void {
  const expectedStart = new Date(`${requestedMonth}-01T00:00:00.000Z`);
  if (!Number.isFinite(expectedStart.getTime())) {
    inconsistent("Admin metric request month is invalid.");
  }
  const expectedEnd = new Date(expectedStart.getTime());
  expectedEnd.setUTCMonth(expectedEnd.getUTCMonth() + 1);

  if (
    response.period.month !== requestedMonth ||
    Date.parse(response.period.start) !== expectedStart.getTime() ||
    Date.parse(response.period.end_exclusive) !== expectedEnd.getTime()
  ) {
    inconsistent("Admin metric period metadata disagrees with the request.");
  }
}

function validateScope(
  response: AdminMonthlyBusinessMetricsResponseV1,
  filters: AdminMetricsFilters,
): void {
  if (
    response.scope.kind !== filters.scope ||
    nullableCanonicalUuid(response.scope.partner_id) !==
      nullableCanonicalUuid(filters.partnerId)
  ) {
    inconsistent("Admin metric scope metadata disagrees with the request.");
  }
}

function validateDefinitions(
  response: AdminMonthlyBusinessMetricsResponseV1,
): void {
  const seen = new Set<BusinessMetricKeyV1>();
  for (const definition of response.definitions) {
    if (seen.has(definition.metric_key)) {
      inconsistent("Admin metrics returned a duplicate metric definition.");
    }
    seen.add(definition.metric_key);
    if (
      definition.supports_historical_backfill !==
      EXPECTED_BACKFILL_SUPPORT[definition.metric_key]
    ) {
      inconsistent("Admin metric backfill definitions disagree with v1.");
    }
  }

  if (
    seen.size !== BUSINESS_METRIC_KEYS_V1.length ||
    BUSINESS_METRIC_KEYS_V1.some((metricKey) => !seen.has(metricKey))
  ) {
    inconsistent("Admin metrics returned an incomplete v1 definition set.");
  }
}

function validateCounts(counts: BusinessMetricCountsV1, context: string): void {
  const bookingBreakdown = safeAdd(
    counts.booking_confirmed_ai,
    counts.booking_confirmed_dashboard,
  );
  if (
    bookingBreakdown === null ||
    bookingBreakdown !== counts.booking_confirmed
  ) {
    inconsistent(`Admin metric booking totals disagree for ${context}.`);
  }
}

function validateScopeAttribution(
  filters: AdminMetricsFilters,
  partnerIdAtEvent: string | null,
  context: string,
): void {
  const partnerId = nullableCanonicalUuid(partnerIdAtEvent);
  if (filters.scope === "direct" && partnerId !== null) {
    inconsistent(`Admin metric ${context} leaked outside direct scope.`);
  }
  if (
    filters.scope === "partner" &&
    partnerId !== nullableCanonicalUuid(filters.partnerId)
  ) {
    inconsistent(`Admin metric ${context} leaked outside partner scope.`);
  }
}

function registerPartnerFacts(
  factsByPartner: Map<
    string,
    { name: string | null; slug: string | null }
  >,
  partnerId: string,
  name: string | null,
  slug: string | null,
): void {
  validatePartnerDisplayPair(partnerId, name, slug);
  const existing = factsByPartner.get(partnerId);
  if (existing && (existing.name !== name || existing.slug !== slug)) {
    inconsistent("Admin metric partner display facts disagree.");
  }
  factsByPartner.set(partnerId, { name, slug });
}

function validatePartnerDisplayPair(
  partnerId: string | null,
  name: string | null,
  slug: string | null,
): void {
  if (partnerId === null) {
    if (name !== null || slug !== null) {
      inconsistent("Direct metric attribution contains partner display facts.");
    }
    return;
  }
  if ((name === null) !== (slug === null)) {
    inconsistent("Admin metric partner display facts are incomplete.");
  }
}

function emptyCounts(): BusinessMetricCountsV1 {
  return Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])) as unknown as
    BusinessMetricCountsV1;
}

function addCounts(
  target: BusinessMetricCountsV1,
  source: BusinessMetricCountsV1,
  context: string,
): void {
  for (const key of COUNT_KEYS) {
    const next = safeAdd(target[key], source[key]);
    if (next === null) {
      inconsistent(`Admin metric count overflowed for ${context}.`);
    }
    target[key] = next;
  }
}

function assertCountsEqual(
  actual: BusinessMetricCountsV1,
  expected: BusinessMetricCountsV1,
  context: string,
): void {
  if (COUNT_KEYS.some((key) => actual[key] !== expected[key])) {
    inconsistent(`Admin metric ${context} disagree with business rows.`);
  }
}

function safeAdd(left: number, right: number): number | null {
  const result = left + right;
  return Number.isSafeInteger(result) ? result : null;
}

function brandKey(partnerId: string | null): string {
  return partnerId ?? "direct";
}

function nullableCanonicalUuid(value: string | null): string | null {
  return value === null ? null : canonicalUuid(value);
}

function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

function isUtcTimestamp(value: string): boolean {
  return (
    Number.isFinite(Date.parse(value)) &&
    /(?:z|[+]00(?::?00)?)$/i.test(value)
  );
}

function inconsistent(message: string): never {
  throw new AdminMetricsReadError("inconsistent_response", message);
}
