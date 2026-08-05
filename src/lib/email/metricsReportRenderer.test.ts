import { describe, expect, it } from "vitest";

import {
  BUSINESS_METRIC_KEYS_V1,
  BUSINESS_METRIC_LABELS_V1,
  type BusinessMetricCountsV1,
} from "@/lib/metrics/contract";
import {
  METRICS_REPORT_COUNT_KEYS_V1,
  METRICS_REPORT_METRIC_KEYS_V1,
  MetricsReportSnapshotValidationError,
  type MetricsReportSnapshotPayloadV1,
} from "@/lib/metrics/reportSnapshot";
import { renderMetricsReportEmail } from "./metricsReportRenderer";

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

describe("metrics report email renderer", () => {
  it("builds the exact partner, direct, and test subjects", () => {
    expect(renderMetricsReportEmail(validPayload()).subject).toBe(
      "Acme Services — July 2026 SimplAssist activity report",
    );

    const direct = validDirectPayload();
    expect(renderMetricsReportEmail(direct).subject).toBe(
      "SimplAssist — July 2026 SimplAssist activity report",
    );
    expect(renderMetricsReportEmail(direct, { test: true }).subject).toBe(
      "[TEST] SimplAssist — July 2026 SimplAssist activity report",
    );
  });

  it("renders every count, including the booking-origin breakdown", () => {
    const payload = validPayload();
    const message = renderMetricsReportEmail(payload);

    expect(message.text).toContain("Brand totals");
    expect(message.html).toContain("<h2>Brand totals</h2>");
    for (const key of BUSINESS_METRIC_KEYS_V1) {
      expect(message.text).toContain(BUSINESS_METRIC_LABELS_V1[key]);
      expect(message.html).toContain(BUSINESS_METRIC_LABELS_V1[key]);
    }
    expect(message.text).toContain("Bookings confirmed — AI: 1,004");
    expect(message.text).toContain("Bookings confirmed — Dashboard: 1,006");
    expect(message.html).toContain("Bookings confirmed — AI");
    expect(message.html).toContain("Bookings confirmed — Dashboard");

    for (const key of METRICS_REPORT_COUNT_KEYS_V1) {
      expect(message.text).toContain(
        payload.totals[key].toLocaleString("en-US"),
      );
      expect(message.html).toContain(
        payload.totals[key].toLocaleString("en-US"),
      );
    }
  });

  it("renders deterministic per-business rows, including honest zeros", () => {
    const payload = validPayload();
    payload.businesses[0].counts = zeroCounts();
    payload.totals = sumCounts(payload.businesses.map((row) => row.counts));

    const first = renderMetricsReportEmail(payload);
    const second = renderMetricsReportEmail(structuredClone(payload));
    expect(second).toEqual(first);

    const alphaText = first.text.indexOf("Alpha Plumbing");
    const betaText = first.text.indexOf("Beta Electric");
    const alphaHtml = first.html.indexOf("Alpha Plumbing");
    const betaHtml = first.html.indexOf("Beta Electric");
    expect(alphaText).toBeGreaterThan(-1);
    expect(betaText).toBeGreaterThan(alphaText);
    expect(alphaHtml).toBeGreaterThan(-1);
    expect(betaHtml).toBeGreaterThan(alphaHtml);
    expect(first.text).toMatch(/Alpha Plumbing(?: \| 0){14}/);
    expect(first.html).toMatch(/Alpha Plumbing<\/th>(?:<td>0<\/td>){14}/);
  });

  it("explains definition version, UTC availability, and coverage", () => {
    const message = renderMetricsReportEmail(validPayload());

    expect(message.text.match(/Definition v1/g)).toHaveLength(12);
    expect(message.html.match(/Definition v1/g)).toHaveLength(12);
    expect(message.text.match(/Available since 2026-01-15 UTC/g)).toHaveLength(
      12,
    );
    expect(message.text.match(/Live collection only/g)).toHaveLength(3);
    expect(
      message.text.match(/Recoverable historical source backfill/g),
    ).toHaveLength(9);
    expect(message.html.match(/Live collection only/g)).toHaveLength(3);
    expect(
      message.html.match(/Recoverable historical source backfill/g),
    ).toHaveLength(9);
  });

  it("escapes all dynamic HTML and neutralizes text-table delimiters", () => {
    const payload = validPayload();
    payload.scope.brand_name = `Acme & <Co> "Prime" 'One'`;
    payload.businesses[0].business_name = `<script>alert("x")</script> & O'Reilly | Plumbing`;
    payload.businesses[1].business_name = "Zeta Electric";

    const message = renderMetricsReportEmail(payload);
    expect(message.html).toContain(
      `Acme &amp; &lt;Co&gt; &quot;Prime&quot; &#39;One&#39;`,
    );
    expect(message.html).toContain(
      `&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; O&#39;Reilly | Plumbing`,
    );
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain("O'Reilly \\| Plumbing");
  });

  it("removes control characters from the subject and plain text", () => {
    const payload = validPayload();
    payload.scope.brand_name = "Acme\r\nBcc: attacker@example.com";
    payload.businesses[0].business_name = "Alpha\nPlumbing";

    const message = renderMetricsReportEmail(payload);

    expect(message.subject).toBe(
      "Acme Bcc: attacker@example.com — July 2026 SimplAssist activity report",
    );
    expect(message.subject).not.toMatch(/[\r\n]/);
    expect(message.text).toContain("Acme Bcc: attacker@example.com");
    expect(message.text).toContain("Alpha Plumbing");
  });

  it("contains no links, recipient data, IDs, or messaging content", () => {
    const message = renderMetricsReportEmail(validPayload());
    const combined = `${message.text}\n${message.html}`;

    expect(combined).not.toMatch(/<a\b|href=|https?:\/\//i);
    expect(combined).not.toContain("admin@example.com");
    expect(combined).not.toContain("+13175550100");
    expect(combined).not.toContain(PARTNER_ID);
    expect(combined).not.toContain(BUSINESS_ID_1);
    expect(combined).not.toContain(BUSINESS_ID_2);
    expect(combined).not.toContain("message_content");
    expect(combined).not.toContain("recipient");
  });

  it("renders an honest empty all-business month without fabricating rows", () => {
    const payload = validPayload();
    payload.selection = { mode: "all", business_ids: [] };
    payload.businesses = [];
    payload.totals = zeroCounts();

    const message = renderMetricsReportEmail(payload);
    expect(message.text).toContain("Business selection: All businesses");
    expect(message.text).toContain(
      "No businesses recorded activity in this reporting period.",
    );
    expect(message.html).toContain(
      "No businesses recorded activity in this reporting period.",
    );
    expect(message.text).not.toContain("Alpha Plumbing");
  });

  it("reparses the input and refuses forged or content-bearing objects", () => {
    const inconsistent = validPayload();
    inconsistent.totals.booking_confirmed += 1;
    expect(() => renderMetricsReportEmail(inconsistent)).toThrow(
      MetricsReportSnapshotValidationError,
    );

    const contentBearing = validPayload();
    Object.assign(contentBearing.businesses[0], {
      recipient: "admin@example.com",
      message_content: "private message",
    });
    expect(() => renderMetricsReportEmail(contentBearing)).toThrow(
      MetricsReportSnapshotValidationError,
    );
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
      counts: counts(1_000),
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
      rows.reduce((total, row) => total + row[key], 0),
    ]),
  ) as unknown as BusinessMetricCountsV1;
}
