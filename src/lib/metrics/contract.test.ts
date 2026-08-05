import { describe, expect, it } from "vitest";

import {
  ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1,
  BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1,
  BUSINESS_METRIC_BOOKING_ORIGIN_LABELS_V1,
  BUSINESS_METRIC_BOOKING_ORIGINS_V1,
  BUSINESS_METRIC_KEYS_V1,
  BUSINESS_METRIC_LABELS_V1,
  isBusinessMetricBookingOriginV1,
  isBusinessMetricKeyV1,
  type AdminMonthlyBusinessMetricsResponseV1,
  type BusinessMetricCountsV1,
} from "./contract";

const ZERO_COUNTS = Object.fromEntries(
  [...BUSINESS_METRIC_KEYS_V1, ...BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1].map(
    (key) => [key, 0],
  ),
) as BusinessMetricCountsV1;

describe("business metric v1 contract", () => {
  it("exposes the exact schema-backed metric keys", () => {
    expect(BUSINESS_METRIC_KEYS_V1).toEqual([
      "missed_call_caught",
      "ai_conversation_engaged",
      "booking_confirmed",
      "web_chat_session_engaged",
      "contact_created",
      "hot_lead_classified",
      "sms_message_inbound",
      "sms_message_outbound",
      "sms_parts_inbound",
      "sms_parts_outbound",
      "mms_event_inbound",
      "mms_event_outbound",
    ]);
    expect(new Set(BUSINESS_METRIC_KEYS_V1).size).toBe(
      BUSINESS_METRIC_KEYS_V1.length,
    );
  });

  it("keeps labels complete and count-oriented", () => {
    expect(Object.keys(BUSINESS_METRIC_LABELS_V1)).toEqual(
      BUSINESS_METRIC_KEYS_V1,
    );
    expect(Object.values(BUSINESS_METRIC_LABELS_V1)).toEqual([
      "Missed calls caught",
      "AI conversations engaged",
      "Bookings confirmed",
      "Web chat sessions engaged",
      "Contacts created",
      "Hot leads classified",
      "Inbound SMS messages",
      "Outbound SMS messages",
      "Inbound SMS parts",
      "Outbound SMS parts",
      "Inbound MMS events",
      "Outbound MMS events",
    ]);
  });

  it("exposes only the two booking origins", () => {
    expect(BUSINESS_METRIC_BOOKING_ORIGINS_V1).toEqual(["ai", "dashboard"]);
    expect(BUSINESS_METRIC_BOOKING_ORIGIN_LABELS_V1).toEqual({
      ai: "AI",
      dashboard: "Dashboard",
    });
    expect(BUSINESS_METRIC_BOOKING_COUNT_KEYS_V1).toEqual([
      "booking_confirmed_ai",
      "booking_confirmed_dashboard",
    ]);
  });

  it("validates metric keys and booking origins without accepting lookalikes", () => {
    for (const key of BUSINESS_METRIC_KEYS_V1) {
      expect(isBusinessMetricKeyV1(key)).toBe(true);
    }
    for (const origin of BUSINESS_METRIC_BOOKING_ORIGINS_V1) {
      expect(isBusinessMetricBookingOriginV1(origin)).toBe(true);
    }

    expect(isBusinessMetricKeyV1("message_content")).toBe(false);
    expect(isBusinessMetricKeyV1("booking_confirmed_ai")).toBe(false);
    expect(isBusinessMetricKeyV1(null)).toBe(false);
    expect(isBusinessMetricBookingOriginV1("partner")).toBe(false);
    expect(isBusinessMetricBookingOriginV1(undefined)).toBe(false);
  });

  it("defines the exact aggregate scope and a content-free response shape", () => {
    expect(ADMIN_MONTHLY_METRIC_SCOPE_KINDS_V1).toEqual([
      "all",
      "direct",
      "partner",
    ]);

    const response: AdminMonthlyBusinessMetricsResponseV1 = {
      period: {
        month: "2026-08",
        start: "2026-08-01T00:00:00+00:00",
        end_exclusive: "2026-09-01T00:00:00+00:00",
      },
      scope: { kind: "all", partner_id: null },
      definitions: [],
      totals: ZERO_COUNTS,
      brand_totals: [],
      businesses: [],
      partner_options: [],
    };
    expect(Object.keys(response)).toEqual([
      "period",
      "scope",
      "definitions",
      "totals",
      "brand_totals",
      "businesses",
      "partner_options",
    ]);
    expect(collectKeys(response)).not.toEqual(
      expect.arrayContaining([
        "messages",
        "content",
        "metadata",
        "phone",
        "phone_number",
        "prompt",
        "tokens",
        "provider_payload",
      ]),
    );
  });
});

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
}
