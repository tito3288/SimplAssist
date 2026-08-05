import { describe, expect, it } from "vitest";

import type { BusinessMetricCountsV1 } from "./contract";
import {
  METRICS_REPORT_COUNT_KEYS_V1,
  METRICS_REPORT_METRIC_KEYS_V1,
  METRICS_REPORT_SNAPSHOT_VERSION_V1,
  MetricsReportSnapshotValidationError,
  parseMetricsReportPayloadV1,
  parseMetricsReportSnapshotV1,
  type MetricsReportSnapshotPayloadV1,
} from "./reportSnapshot";

const PARTNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUSINESS_ID_1 = "11111111-1111-4111-8111-111111111111";
const BUSINESS_ID_2 = "22222222-2222-4222-8222-222222222222";

const BACKFILL_SUPPORT = {
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
} as const;

describe("metrics report snapshot v1 parser", () => {
  it("accepts the exact payload and two-key database envelope", () => {
    const payload = validPayload();

    expect(parseMetricsReportPayloadV1(payload)).toEqual(payload);
    expect(
      parseMetricsReportSnapshotV1({
        snapshot_version: METRICS_REPORT_SNAPSHOT_VERSION_V1,
        snapshot_payload: payload,
      }),
    ).toEqual({ snapshot_version: 1, snapshot_payload: payload });
  });

  it("publishes the exact migration-backed key order", () => {
    expect(METRICS_REPORT_METRIC_KEYS_V1).toEqual([
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
    ]);
    expect(METRICS_REPORT_COUNT_KEYS_V1).toEqual([
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
    ]);
  });

  it("rejects unsupported versions and missing or extra envelope fields", () => {
    const payload = validPayload();
    expectInvalidEnvelope({ snapshot_version: 2, snapshot_payload: payload });
    expectInvalidEnvelope({ snapshot_payload: payload });
    expectInvalidEnvelope({
      snapshot_version: 1,
      snapshot_payload: payload,
      report_id: BUSINESS_ID_1,
    });
  });

  it("rejects missing or extra keys at every nested payload level", () => {
    const missingTop = clone(validPayload());
    delete (missingTop as Partial<MetricsReportSnapshotPayloadV1>).totals;
    expectInvalidPayload(missingTop);

    const extraTop = clone(validPayload()) as MetricsReportSnapshotPayloadV1 & {
      recipient?: string;
    };
    extraTop.recipient = "admin@example.com";
    expectInvalidPayload(extraTop);

    const extraPeriod = clone(validPayload());
    Object.assign(extraPeriod.period, { timezone: "UTC" });
    expectInvalidPayload(extraPeriod);

    const extraScope = clone(validPayload());
    Object.assign(extraScope.scope, { contact_phone: "+13175550100" });
    expectInvalidPayload(extraScope);

    const extraSelection = clone(validPayload());
    Object.assign(extraSelection.selection, { all_or_selected: "selected" });
    expectInvalidPayload(extraSelection);

    const extraDefinition = clone(validPayload());
    Object.assign(extraDefinition.definitions[0], {
      description: "message content",
    });
    expectInvalidPayload(extraDefinition);

    const extraTotals = clone(validPayload());
    Object.assign(extraTotals.totals, { recipient_count: 1 });
    expectInvalidPayload(extraTotals);

    const extraBusiness = clone(validPayload());
    Object.assign(extraBusiness.businesses[0], {
      message_content: "private message",
    });
    expectInvalidPayload(extraBusiness);

    const extraCounts = clone(validPayload());
    Object.assign(extraCounts.businesses[0].counts, { phone_calls: 1 });
    expectInvalidPayload(extraCounts);
  });

  it("requires exact UTC month boundaries, including year rollover", () => {
    const wrongStart = clone(validPayload());
    wrongStart.period.start = "2026-07-02T00:00:00+00:00";
    expectInvalidPayload(wrongStart);

    const wrongEnd = clone(validPayload());
    wrongEnd.period.end_exclusive = "2026-09-01T00:00:00+00:00";
    expectInvalidPayload(wrongEnd);

    const yearZero = clone(validPayload());
    yearZero.period = {
      month: "0000-12",
      start: "0000-12-01T00:00:00+00:00",
      end_exclusive: "0001-01-01T00:00:00+00:00",
    };
    expectInvalidPayload(yearZero);

    const december = clone(validPayload());
    december.period = {
      month: "2026-12",
      start: "2026-12-01T00:00:00+00:00",
      end_exclusive: "2027-01-01T00:00:00+00:00",
    };
    expect(parseMetricsReportPayloadV1(december).period.month).toBe("2026-12");
  });

  it("enforces the direct and partner scope discriminators exactly", () => {
    const direct = validDirectPayload();
    expect(parseMetricsReportPayloadV1(direct).scope).toEqual({
      kind: "direct",
      partner_id: null,
      brand_name: "SimplAssist",
      partner_slug: null,
    });

    const directWithPartner = clone(direct);
    Object.assign(directWithPartner.scope, { partner_id: PARTNER_ID });
    expectInvalidPayload(directWithPartner);

    const partnerWithoutSlug = clone(validPayload());
    Object.assign(partnerWithoutSlug.scope, { partner_slug: null });
    expectInvalidPayload(partnerWithoutSlug);

    const uppercaseUuid = clone(validPayload());
    Object.assign(uppercaseUuid.scope, {
      partner_id: PARTNER_ID.toUpperCase(),
    });
    expectInvalidPayload(uppercaseUuid);

    const invalidSlug = clone(validPayload());
    Object.assign(invalidSlug.scope, { partner_slug: "Partner Brand" });
    expectInvalidPayload(invalidSlug);
  });

  it("requires selected identities to be canonical, sorted, and represented", () => {
    const reversed = clone(validPayload());
    reversed.selection.business_ids.reverse();
    expectInvalidPayload(reversed);

    const duplicate = clone(validPayload());
    duplicate.selection.business_ids[1] = BUSINESS_ID_1;
    expectInvalidPayload(duplicate);

    const uppercase = clone(validPayload());
    uppercase.selection.business_ids[0] =
      "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    expectInvalidPayload(uppercase);

    const missingRow = clone(validPayload());
    missingRow.businesses.pop();
    missingRow.totals = sumCounts(
      missingRow.businesses.map((row) => row.counts),
    );
    expectInvalidPayload(missingRow);

    const allWithIds = clone(validPayload());
    allWithIds.selection = {
      mode: "all",
      business_ids: [BUSINESS_ID_1],
    } as never;
    expectInvalidPayload(allWithIds);
  });

  it("requires the exact ordered definition set and coverage flags", () => {
    const swapped = clone(validPayload());
    [swapped.definitions[0], swapped.definitions[1]] = [
      swapped.definitions[1],
      swapped.definitions[0],
    ];
    expectInvalidPayload(swapped);

    const wrongVersion = clone(validPayload());
    Object.assign(wrongVersion.definitions[0], { definition_version: 2 });
    expectInvalidPayload(wrongVersion);

    const wrongBackfill = clone(validPayload());
    wrongBackfill.definitions[0].supports_historical_backfill = true;
    expectInvalidPayload(wrongBackfill);

    const invalidCalendarDate = clone(validPayload());
    invalidCalendarDate.definitions[0].available_since =
      "2026-02-30T12:34:56+00:00";
    expectInvalidPayload(invalidCalendarDate);

    const nonUtc = clone(validPayload());
    nonUtc.definitions[0].available_since = "2026-02-01T12:34:56Z";
    expectInvalidPayload(nonUtc);
  });

  it("rejects unsafe, negative, fractional, missing, and extra counts", () => {
    const unsafe = clone(validPayload());
    unsafe.businesses[0].counts.contact_created = Number.MAX_SAFE_INTEGER + 1;
    expectInvalidPayload(unsafe);

    const negative = clone(validPayload());
    negative.totals.contact_created = -1;
    expectInvalidPayload(negative);

    const fractional = clone(validPayload());
    fractional.businesses[0].counts.sms_parts_inbound = 1.5;
    expectInvalidPayload(fractional);

    const missing = clone(validPayload());
    delete (missing.totals as Partial<BusinessMetricCountsV1>)
      .missed_call_caught;
    expectInvalidPayload(missing);

    const extra = clone(validPayload());
    Object.assign(extra.totals, { unknown_count: 0 });
    expectInvalidPayload(extra);
  });

  it("enforces booking breakdowns and exact safe totals", () => {
    const rowBreakdown = clone(validPayload());
    rowBreakdown.businesses[0].counts.booking_confirmed += 1;
    rowBreakdown.totals.booking_confirmed += 1;
    expectInvalidPayload(rowBreakdown);

    const totalBreakdown = clone(validPayload());
    totalBreakdown.totals.booking_confirmed_ai += 1;
    expectInvalidPayload(totalBreakdown);

    const totalMismatch = clone(validPayload());
    totalMismatch.totals.sms_message_inbound += 1;
    expectInvalidPayload(totalMismatch);

    const overflow = clone(validPayload());
    overflow.businesses[0].counts.contact_created = Number.MAX_SAFE_INTEGER;
    overflow.businesses[1].counts.contact_created = 1;
    overflow.totals.contact_created = Number.MAX_SAFE_INTEGER;
    expectInvalidPayload(overflow);
  });

  it("enforces event-time brand identity and deterministic unique rows", () => {
    const wrongPartner = clone(validPayload());
    wrongPartner.businesses[0].partner_id_at_event =
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expectInvalidPayload(wrongPartner);

    const wrongDirectPartner = clone(validDirectPayload());
    wrongDirectPartner.businesses[0].partner_id_at_event = PARTNER_ID;
    expectInvalidPayload(wrongDirectPartner);

    const outOfOrder = clone(validPayload());
    outOfOrder.businesses.reverse();
    expectInvalidPayload(outOfOrder);

    const duplicateId = clone(validPayload());
    duplicateId.businesses[1].business_id = BUSINESS_ID_1;
    expectInvalidPayload(duplicateId);
  });

  it("accepts an honest zero-count row for a selected zero-event business", () => {
    const payload = validPayload();
    payload.selection.business_ids = [BUSINESS_ID_1];
    payload.businesses = [
      {
        business_id: BUSINESS_ID_1,
        business_name: "Alpha Plumbing",
        partner_id_at_event: PARTNER_ID,
        counts: zeroCounts(),
      },
    ];
    payload.totals = zeroCounts();

    expect(parseMetricsReportPayloadV1(payload)).toEqual(payload);
  });

  it("accepts an empty all-business payload with exact zero totals", () => {
    const payload = validPayload();
    payload.selection = { mode: "all", business_ids: [] };
    payload.businesses = [];
    payload.totals = zeroCounts();

    expect(parseMetricsReportPayloadV1(payload)).toEqual(payload);
  });
});

function validPayload(): MetricsReportSnapshotPayloadV1 {
  const businesses = [
    {
      business_id: BUSINESS_ID_1,
      business_name: "Alpha Plumbing",
      partner_id_at_event: PARTNER_ID,
      counts: counts(0),
    },
    {
      business_id: BUSINESS_ID_2,
      business_name: "Beta Electric",
      partner_id_at_event: PARTNER_ID,
      counts: counts(10),
    },
  ];

  return {
    period: {
      month: "2026-07",
      start: "2026-07-01T00:00:00+00:00",
      end_exclusive: "2026-08-01T00:00:00+00:00",
    },
    scope: {
      kind: "partner",
      partner_id: PARTNER_ID,
      brand_name: "Acme Services",
      partner_slug: "acme-services",
    },
    selection: {
      mode: "selected",
      business_ids: [BUSINESS_ID_1, BUSINESS_ID_2],
    },
    definitions: METRICS_REPORT_METRIC_KEYS_V1.map((metricKey) => ({
      metric_key: metricKey,
      definition_version: 1,
      available_since: "2026-01-15T12:34:56.123456+00:00",
      supports_historical_backfill: BACKFILL_SUPPORT[metricKey],
    })),
    totals: sumCounts(businesses.map((business) => business.counts)),
    businesses,
  };
}

function validDirectPayload(): MetricsReportSnapshotPayloadV1 {
  const payload = validPayload();
  payload.scope = {
    kind: "direct",
    partner_id: null,
    brand_name: "SimplAssist",
    partner_slug: null,
  };
  payload.businesses.forEach((business) => {
    business.partner_id_at_event = null;
  });
  return payload;
}

function counts(seed: number): BusinessMetricCountsV1 {
  const bookingAi = seed + 2;
  const bookingDashboard = seed + 3;
  return {
    ai_conversation_engaged: seed + 1,
    booking_confirmed: bookingAi + bookingDashboard,
    booking_confirmed_ai: bookingAi,
    booking_confirmed_dashboard: bookingDashboard,
    contact_created: seed + 4,
    hot_lead_classified: seed + 5,
    missed_call_caught: seed + 6,
    mms_event_inbound: seed + 7,
    mms_event_outbound: seed + 8,
    sms_message_inbound: seed + 9,
    sms_message_outbound: seed + 10,
    sms_parts_inbound: seed + 11,
    sms_parts_outbound: seed + 12,
    web_chat_session_engaged: seed + 13,
  };
}

function zeroCounts(): BusinessMetricCountsV1 {
  return Object.fromEntries(
    METRICS_REPORT_COUNT_KEYS_V1.map((key) => [key, 0]),
  ) as unknown as BusinessMetricCountsV1;
}

function sumCounts(rows: BusinessMetricCountsV1[]): BusinessMetricCountsV1 {
  return Object.fromEntries(
    METRICS_REPORT_COUNT_KEYS_V1.map((key) => [
      key,
      rows.reduce((total, countsForRow) => total + countsForRow[key], 0),
    ]),
  ) as unknown as BusinessMetricCountsV1;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function expectInvalidPayload(value: unknown): void {
  expect(() => parseMetricsReportPayloadV1(value)).toThrow(
    MetricsReportSnapshotValidationError,
  );
}

function expectInvalidEnvelope(value: unknown): void {
  expect(() => parseMetricsReportSnapshotV1(value)).toThrow(
    MetricsReportSnapshotValidationError,
  );
}
