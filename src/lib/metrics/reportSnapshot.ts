import { z } from "zod";

import type {
  BusinessMetricCountKeyV1,
  BusinessMetricCountsV1,
  BusinessMetricKeyV1,
} from "./contract";

export const METRICS_REPORT_SNAPSHOT_VERSION_V1 = 1 as const;

export const METRICS_REPORT_METRIC_KEYS_V1 = [
  "ai_conversation_engaged",
  "booking_confirmed",
  "contact_created",
  "hot_lead_classified",
  "missed_call_caught",
  "mms_event_inbound",
  "mms_event_outbound",
  "sms_message_inbound",
  "sms_message_outbound",
  "sms_parts_inbound",
  "sms_parts_outbound",
  "web_chat_session_engaged",
] as const satisfies readonly BusinessMetricKeyV1[];

export const METRICS_REPORT_COUNT_KEYS_V1 = [
  "ai_conversation_engaged",
  "booking_confirmed",
  "booking_confirmed_ai",
  "booking_confirmed_dashboard",
  "contact_created",
  "hot_lead_classified",
  "missed_call_caught",
  "mms_event_inbound",
  "mms_event_outbound",
  "sms_message_inbound",
  "sms_message_outbound",
  "sms_parts_inbound",
  "sms_parts_outbound",
  "web_chat_session_engaged",
] as const satisfies readonly BusinessMetricCountKeyV1[];

const EXPECTED_BACKFILL_SUPPORT = {
  ai_conversation_engaged: false,
  booking_confirmed: true,
  contact_created: true,
  hot_lead_classified: true,
  missed_call_caught: false,
  mms_event_inbound: true,
  mms_event_outbound: true,
  sms_message_inbound: true,
  sms_message_outbound: true,
  sms_parts_inbound: true,
  sms_parts_outbound: true,
  web_chat_session_engaged: false,
} as const satisfies Record<BusinessMetricKeyV1, boolean>;

const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PERIOD_MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PERIOD_BOUNDARY_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])-01T00:00:00\+00:00$/;
const UTC_TIMESTAMP_PATTERN =
  /^([0-9]{4})-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.([0-9]{1,6}))?\+00:00$/;
const PARTNER_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const canonicalUuidSchema = z.string().regex(CANONICAL_UUID_PATTERN);
const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const countsSchema = z
  .object({
    ai_conversation_engaged: countSchema,
    booking_confirmed: countSchema,
    booking_confirmed_ai: countSchema,
    booking_confirmed_dashboard: countSchema,
    contact_created: countSchema,
    hot_lead_classified: countSchema,
    missed_call_caught: countSchema,
    mms_event_inbound: countSchema,
    mms_event_outbound: countSchema,
    sms_message_inbound: countSchema,
    sms_message_outbound: countSchema,
    sms_parts_inbound: countSchema,
    sms_parts_outbound: countSchema,
    web_chat_session_engaged: countSchema,
  })
  .strict();

const periodSchema = z
  .object({
    month: z.string().regex(PERIOD_MONTH_PATTERN),
    start: z.string().regex(PERIOD_BOUNDARY_PATTERN),
    end_exclusive: z.string().regex(PERIOD_BOUNDARY_PATTERN),
  })
  .strict();

const directScopeSchema = z
  .object({
    kind: z.literal("direct"),
    partner_id: z.null(),
    brand_name: z.literal("SimplAssist"),
    partner_slug: z.null(),
  })
  .strict();

const partnerScopeSchema = z
  .object({
    kind: z.literal("partner"),
    partner_id: canonicalUuidSchema,
    brand_name: z.string().refine((value) => value.trim().length > 0),
    partner_slug: z.string().max(63).regex(PARTNER_SLUG_PATTERN),
  })
  .strict();

const scopeSchema = z.discriminatedUnion("kind", [
  directScopeSchema,
  partnerScopeSchema,
]);

const allSelectionSchema = z
  .object({
    mode: z.literal("all"),
    business_ids: z.array(canonicalUuidSchema).length(0),
  })
  .strict();

const selectedSelectionSchema = z
  .object({
    mode: z.literal("selected"),
    business_ids: z.array(canonicalUuidSchema).min(1),
  })
  .strict();

const selectionSchema = z.discriminatedUnion("mode", [
  allSelectionSchema,
  selectedSelectionSchema,
]);

const definitionSchema = z
  .object({
    metric_key: z.enum(METRICS_REPORT_METRIC_KEYS_V1),
    definition_version: z.literal(1),
    available_since: z.string().regex(UTC_TIMESTAMP_PATTERN),
    supports_historical_backfill: z.boolean(),
  })
  .strict();

const businessSchema = z
  .object({
    business_id: canonicalUuidSchema,
    business_name: z.string(),
    partner_id_at_event: canonicalUuidSchema.nullable(),
    counts: countsSchema,
  })
  .strict();

const payloadSchema = z
  .object({
    period: periodSchema,
    scope: scopeSchema,
    selection: selectionSchema,
    definitions: z.array(definitionSchema).length(12),
    totals: countsSchema,
    businesses: z.array(businessSchema),
  })
  .strict();

const envelopeSchema = z
  .object({
    snapshot_version: z.literal(METRICS_REPORT_SNAPSHOT_VERSION_V1),
    snapshot_payload: payloadSchema,
  })
  .strict();

export type MetricsReportDefinitionV1 = z.infer<typeof definitionSchema>;
export type MetricsReportScopeV1 = z.infer<typeof scopeSchema>;
export type MetricsReportSelectionV1 = z.infer<typeof selectionSchema>;
export type MetricsReportBusinessV1 = z.infer<typeof businessSchema>;

export interface MetricsReportSnapshotPayloadV1 {
  period: z.infer<typeof periodSchema>;
  scope: MetricsReportScopeV1;
  selection: MetricsReportSelectionV1;
  definitions: MetricsReportDefinitionV1[];
  totals: BusinessMetricCountsV1;
  businesses: MetricsReportBusinessV1[];
}

export interface MetricsReportSnapshotV1 {
  snapshot_version: typeof METRICS_REPORT_SNAPSHOT_VERSION_V1;
  snapshot_payload: MetricsReportSnapshotPayloadV1;
}

export class MetricsReportSnapshotValidationError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "MetricsReportSnapshotValidationError";
    this.cause = cause;
  }
}

/**
 * Parses the exact count-only payload produced by migration 051. Structural
 * validation is followed by the same cross-field invariants enforced by the
 * database snapshot check.
 */
export function parseMetricsReportPayloadV1(
  value: unknown,
): MetricsReportSnapshotPayloadV1 {
  const parsed = payloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new MetricsReportSnapshotValidationError(
      "Metrics report snapshot payload is invalid.",
      parsed.error,
    );
  }

  const payload = parsed.data as MetricsReportSnapshotPayloadV1;
  validatePeriod(payload);
  validateDefinitions(payload);
  validateSelection(payload);
  validateBusinesses(payload);
  validateTotals(payload);
  return payload;
}

/** Parses the exact two-key snapshot envelope read from metrics_reports. */
export function parseMetricsReportSnapshotV1(
  value: unknown,
): MetricsReportSnapshotV1 {
  const parsed = envelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new MetricsReportSnapshotValidationError(
      "Metrics report snapshot envelope is invalid.",
      parsed.error,
    );
  }

  return {
    snapshot_version: METRICS_REPORT_SNAPSHOT_VERSION_V1,
    snapshot_payload: parseMetricsReportPayloadV1(parsed.data.snapshot_payload),
  };
}

function validatePeriod(payload: MetricsReportSnapshotPayloadV1): void {
  const { month, start, end_exclusive: endExclusive } = payload.period;
  const [yearText, monthText] = month.split("-");
  const year = Number(yearText);
  const monthNumber = Number(monthText);

  if (year < 1) {
    invalid("Snapshot period uses an invalid calendar year.");
  }

  const expectedStart = `${month}-01T00:00:00+00:00`;
  const nextMonth = monthNumber === 12 ? 1 : monthNumber + 1;
  const nextYear = monthNumber === 12 ? year + 1 : year;
  if (nextYear > 9999) {
    invalid("Snapshot period end is outside the supported calendar range.");
  }
  const expectedEnd = `${String(nextYear).padStart(4, "0")}-${String(
    nextMonth,
  ).padStart(2, "0")}-01T00:00:00+00:00`;

  if (start !== expectedStart || endExclusive !== expectedEnd) {
    invalid("Snapshot period boundaries do not match its UTC month.");
  }
}

function validateDefinitions(payload: MetricsReportSnapshotPayloadV1): void {
  payload.definitions.forEach((definition, index) => {
    const expectedKey = METRICS_REPORT_METRIC_KEYS_V1[index];
    if (definition.metric_key !== expectedKey) {
      invalid("Snapshot metric definitions are missing or out of order.");
    }
    if (!isValidUtcCalendarTimestamp(definition.available_since)) {
      invalid("Snapshot metric availability timestamp is invalid.");
    }
    if (
      definition.supports_historical_backfill !==
      EXPECTED_BACKFILL_SUPPORT[definition.metric_key]
    ) {
      invalid("Snapshot metric backfill support is inconsistent.");
    }
  });
}

function validateSelection(payload: MetricsReportSnapshotPayloadV1): void {
  const ids = payload.selection.business_ids;
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index] <= ids[index - 1]) {
      invalid("Snapshot selected business IDs must be unique and sorted.");
    }
  }
}

function validateBusinesses(payload: MetricsReportSnapshotPayloadV1): void {
  const seenIds = new Set<string>();

  payload.businesses.forEach((business, index) => {
    if (seenIds.has(business.business_id)) {
      invalid("Snapshot business IDs must be unique.");
    }
    seenIds.add(business.business_id);

    if (payload.scope.kind === "direct") {
      if (business.partner_id_at_event !== null) {
        invalid("Direct snapshot business has a partner identity.");
      }
    } else if (business.partner_id_at_event !== payload.scope.partner_id) {
      invalid("Partner snapshot business has a mismatched event-time partner.");
    }

    const previous = payload.businesses[index - 1];
    if (
      previous &&
      (business.business_name < previous.business_name ||
        (business.business_name === previous.business_name &&
          business.business_id <= previous.business_id))
    ) {
      invalid("Snapshot businesses must be deterministically sorted.");
    }

    validateBookingBreakdown(business.counts, "business");
  });

  if (payload.selection.mode === "selected") {
    const rowIds = Array.from(seenIds).sort();
    if (!sameStrings(rowIds, payload.selection.business_ids)) {
      invalid(
        "Selected snapshot must include exactly one row for every selected business.",
      );
    }
  }
}

function validateTotals(payload: MetricsReportSnapshotPayloadV1): void {
  for (const key of METRICS_REPORT_COUNT_KEYS_V1) {
    let total = 0;
    for (const business of payload.businesses) {
      total += business.counts[key];
      if (!Number.isSafeInteger(total)) {
        invalid("Snapshot business row sum exceeds the safe integer range.");
      }
    }
    if (total !== payload.totals[key]) {
      invalid("Snapshot totals do not equal the sum of business rows.");
    }
  }

  validateBookingBreakdown(payload.totals, "total");
}

function validateBookingBreakdown(
  counts: BusinessMetricCountsV1,
  level: "business" | "total",
): void {
  const breakdown =
    counts.booking_confirmed_ai + counts.booking_confirmed_dashboard;
  if (
    !Number.isSafeInteger(breakdown) ||
    breakdown !== counts.booking_confirmed
  ) {
    invalid(`Snapshot ${level} booking breakdown is inconsistent.`);
  }
}

function isValidUtcCalendarTimestamp(value: string): boolean {
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1) return false;

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1];
  return day <= daysInMonth;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function invalid(message: string): never {
  throw new MetricsReportSnapshotValidationError(message);
}
