import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  BUSINESS_METRIC_KEYS_V1,
  type AdminMonthlyBusinessMetricsResponseV2,
  type BusinessMetricCountsV1,
} from "@/lib/metrics/contract";
import {
  AdminMetricsReport,
  buildBrandTotalsCsvData,
  buildMetricsExportFilters,
  buildPerBusinessCsvData,
  type AdminMetricsReportErrorState,
} from "./AdminMetricsReport";
import {
  buildAdminMetricsCsv,
  buildAdminMetricsExportFilename,
} from "./AdminMetricsExport";

const BUSINESS_ID = "10000000-0000-4000-a050-000000000001";
const MISSING_BUSINESS_ID = "10000000-0000-4000-a050-000000000099";
const PARTNER_ID = "20000000-0000-4000-a050-000000000001";

const METRIC_HEADERS = [
  "Missed calls caught",
  "AI conversations engaged",
  "Bookings confirmed",
  "AI bookings",
  "Dashboard bookings",
  "Web chat sessions engaged",
  "Contacts created",
  "Hot leads classified",
  "Inbound SMS messages",
  "Outbound SMS messages",
  "Inbound SMS parts",
  "Outbound SMS parts",
  "Inbound MMS events",
  "Outbound MMS events",
];

function counts(overrides: Partial<BusinessMetricCountsV1> = {}) {
  return {
    missed_call_caught: 0,
    ai_conversation_engaged: 0,
    booking_confirmed: 0,
    web_chat_session_engaged: 0,
    contact_created: 0,
    hot_lead_classified: 0,
    sms_message_inbound: 0,
    sms_message_outbound: 0,
    sms_parts_inbound: 0,
    sms_parts_outbound: 0,
    mms_event_inbound: 0,
    mms_event_outbound: 0,
    booking_confirmed_ai: 0,
    booking_confirmed_dashboard: 0,
    ...overrides,
  } satisfies BusinessMetricCountsV1;
}

function report(
  overrides: Partial<AdminMonthlyBusinessMetricsResponseV2> = {},
): AdminMonthlyBusinessMetricsResponseV2 {
  const totalCounts = counts({
    missed_call_caught: 1,
    ai_conversation_engaged: 2,
    booking_confirmed: 5,
    booking_confirmed_ai: 3,
    booking_confirmed_dashboard: 2,
    web_chat_session_engaged: 6,
    contact_created: 7,
    hot_lead_classified: 8,
    sms_message_inbound: 9,
    sms_message_outbound: 10,
    sms_parts_inbound: 11,
    sms_parts_outbound: 12,
    mms_event_inbound: 13,
    mms_event_outbound: 14,
  });
  return {
    period: {
      month: "2026-08",
      start: "2026-08-01T00:00:00+00:00",
      end_exclusive: "2026-09-01T00:00:00+00:00",
    },
    scope: { kind: "all", partner_id: null, business_id: null },
    definitions: BUSINESS_METRIC_KEYS_V1.map((metric_key) => ({
      metric_key,
      definition_version: 1,
      available_since: "2026-08-05T12:00:00.000Z",
      supports_historical_backfill: [
        "booking_confirmed",
        "contact_created",
        "hot_lead_classified",
        "sms_message_inbound",
        "sms_message_outbound",
        "sms_parts_inbound",
        "sms_parts_outbound",
        "mms_event_inbound",
        "mms_event_outbound",
      ].includes(metric_key),
    })),
    totals: totalCounts,
    brand_totals: [
      {
        brand_kind: "direct",
        partner_id_at_event: null,
        partner_name: null,
        partner_slug: null,
        counts: counts({ missed_call_caught: 1 }),
      },
      {
        brand_kind: "partner",
        partner_id_at_event: PARTNER_ID,
        partner_name: "Alpha Agency",
        partner_slug: "alpha-agency",
        counts: counts({
          ai_conversation_engaged: 2,
          booking_confirmed: 5,
          booking_confirmed_ai: 3,
          booking_confirmed_dashboard: 2,
        }),
      },
    ],
    businesses: [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
        partner_id_at_event: null,
        partner_name: null,
        partner_slug: null,
        counts: counts({ missed_call_caught: 1 }),
      },
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
        partner_id_at_event: PARTNER_ID,
        partner_name: "Alpha Agency",
        partner_slug: "alpha-agency",
        counts: counts({
          ai_conversation_engaged: 2,
          booking_confirmed: 5,
          booking_confirmed_ai: 3,
          booking_confirmed_dashboard: 2,
        }),
      },
    ],
    partner_options: [
      {
        partner_id: PARTNER_ID,
        partner_name: "Alpha Agency",
        partner_slug: "alpha-agency",
      },
    ],
    business_options: [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
      },
    ],
    ...overrides,
  };
}

describe("AdminMetricsReport", () => {
  it("renders early four-digit UTC years without the Date.UTC 1900 offset", () => {
    const earlyReport = report({
      period: {
        month: "0099-08",
        start: "0099-08-01T00:00:00.000Z",
        end_exclusive: "0099-09-01T00:00:00.000Z",
      },
    });

    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: earlyReport }} />,
    );

    expect(html).toContain("August 99 totals");
    expect(html).not.toContain("August 1999 totals");
  });

  it("renders grouped overall outcomes and distinct SMS/MMS units", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: report() }} />,
    );

    expect(html).toContain("August 2026 totals");
    expect(html).toContain("All brands");
    expect(html).toContain("Engagement and outcomes");
    expect(html).toContain("SMS and MMS usage");
    expect(html).toMatch(/Bookings confirmed[\s\S]*AI 3 · Dashboard 2/);
    for (const label of [
      "Inbound SMS messages",
      "Outbound SMS messages",
      "Inbound SMS parts",
      "Outbound SMS parts",
      "Inbound MMS events",
      "Outbound MMS events",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/Inbound SMS messages[\s\S]*>9</);
    expect(html).toMatch(/Inbound SMS parts[\s\S]*>11</);
    expect(html).toMatch(/Inbound MMS events[\s\S]*>13</);
  });

  it("keeps per-business event-time brand segments distinct", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: report() }} />,
    );

    expect(html).toContain('aria-label="Monthly brand metric totals"');
    expect(html).toContain(
      'aria-label="Monthly event-time business metric rows"',
    );
    expect(html.match(/River City Dental/g)).toHaveLength(2);
    expect(html).toContain("Event-time brand: SimplAssist direct");
    expect(html).toContain("Event-time brand: Alpha Agency");
    expect(html).toContain("AI bookings");
    expect(html).toContain("Dashboard bookings");
  });

  it("projects brand and per-business CSV columns in the displayed metric order", () => {
    const current = report();
    const brandTotals = buildBrandTotalsCsvData(current);
    const perBusiness = buildPerBusinessCsvData(current);

    expect(brandTotals.headers).toEqual([
      "Event-time brand",
      "Brand kind",
      "partner_id_at_event",
      ...METRIC_HEADERS,
    ]);
    expect(brandTotals.rows[0]).toEqual([
      "SimplAssist direct",
      "direct",
      "",
      1,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ]);
    expect(brandTotals.rows[1]?.slice(0, 8)).toEqual([
      "Alpha Agency",
      "partner",
      PARTNER_ID,
      0,
      2,
      5,
      3,
      2,
    ]);

    expect(perBusiness.headers).toEqual([
      "Business name",
      "business_id",
      "Event-time brand",
      "partner_id_at_event",
      ...METRIC_HEADERS,
    ]);
    expect(perBusiness.rows[0]?.slice(0, 5)).toEqual([
      "River City Dental",
      BUSINESS_ID,
      "SimplAssist direct",
      "",
      1,
    ]);
    expect(perBusiness.rows[1]?.slice(0, 9)).toEqual([
      "River City Dental",
      BUSINESS_ID,
      "Alpha Agency",
      PARTNER_ID,
      0,
      2,
      5,
      3,
      2,
    ]);
  });

  it.each(["=", "+", "-", "@"])(
    "hardens projected report labels beginning with %s against formulas",
    (prefix) => {
      const current = report();
      current.brand_totals[1] = {
        ...current.brand_totals[1]!,
        partner_name: `${prefix}Agency`,
      };
      current.businesses[1] = {
        ...current.businesses[1]!,
        business_name: `${prefix}Business`,
        partner_name: `${prefix}Agency`,
      };

      const brandCsv = buildAdminMetricsCsv(buildBrandTotalsCsvData(current));
      const businessCsv = buildAdminMetricsCsv(
        buildPerBusinessCsvData(current),
      );

      expect(brandCsv).toContain(`\r\n'${prefix}Agency,partner,${PARTNER_ID},`);
      expect(businessCsv).toContain(
        `\r\n'${prefix}Business,${BUSINESS_ID},'${prefix}Agency,${PARTNER_ID},`,
      );
    },
  );

  it("renders each export only for its corresponding ready table with rows", () => {
    const both = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: report() }} />,
    );
    const brandOnly = renderToStaticMarkup(
      <AdminMetricsReport
        result={{
          state: "ready",
          report: report({ businesses: [] }),
        }}
      />,
    );
    const perBusinessOnly = renderToStaticMarkup(
      <AdminMetricsReport
        result={{
          state: "ready",
          report: report({ brand_totals: [] }),
        }}
      />,
    );

    expect(both).toContain("Export brand totals (CSV)");
    expect(both).toContain("Export per-business (CSV)");
    expect(brandOnly).toContain("Export brand totals (CSV)");
    expect(brandOnly).not.toContain("Export per-business (CSV)");
    expect(perBusinessOnly).not.toContain("Export brand totals (CSV)");
    expect(perBusinessOnly).toContain("Export per-business (CSV)");
  });

  it("renders every definition with UTC availability and honest coverage labels", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: report() }} />,
    );

    expect(html).toContain("Metric availability");
    expect(html.match(/Definition v1/g)).toHaveLength(12);
    expect(html).toContain(
      '<time dateTime="2026-08-05T12:00:00.000Z">Aug 5, 2026 UTC</time>',
    );
    expect(html).toContain("Recoverable historical source backfill");
    expect(html).toContain("Live collection only");
    expect(html).toMatch(/Missed calls caught[\s\S]*Live collection only/);
    expect(html).toMatch(
      /Contacts created[\s\S]*Recoverable historical source backfill/,
    );
  });

  it("renders legitimate zeros and definitions for an empty successful month", () => {
    const emptyReport = report({
      totals: counts(),
      brand_totals: [],
      businesses: [],
    });
    const html = renderToStaticMarkup(
      <AdminMetricsReport
        result={{ state: "ready", report: emptyReport }}
      />,
    );

    expect(html).toContain(
      "No metric events were recorded for this UTC month and scope.",
    );
    expect(html).toContain("Overall metric totals");
    expect(html).toContain("Metric availability");
    expect(html).not.toContain('aria-label="Monthly brand metric totals"');
    expect(html).not.toContain(
      'aria-label="Monthly event-time business metric rows"',
    );
    expect(html).not.toContain("Export brand totals (CSV)");
    expect(html).not.toContain("Export per-business (CSV)");
    expect(html).not.toContain("Metrics query unavailable");
  });

  it("prepends the selected business name to the scope header", () => {
    const filtered = report({
      scope: {
        kind: "all",
        partner_id: null,
        business_id: BUSINESS_ID,
      },
    });
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: filtered }} />,
    );

    expect(html).toContain(
      "River City Dental · All brands · UTC range 2026-08-01T00:00:00+00:00",
    );
  });

  it("derives partner and business filename filters from the loaded report", () => {
    const scoped = report({
      scope: {
        kind: "partner",
        partner_id: PARTNER_ID,
        business_id: BUSINESS_ID,
      },
    });

    expect(
      buildAdminMetricsExportFilename(
        "per-business",
        buildMetricsExportFilters(scoped),
      ),
    ).toBe(
      "simplassist-per-business-2026-08-partner-alpha-agency-business-river-city-dental-10000000-0000-4000-a050-000000000001.csv",
    );
  });

  it("uses the selected UUID when the business is absent from response options", () => {
    const filtered = report({
      scope: {
        kind: "all",
        partner_id: null,
        business_id: MISSING_BUSINESS_ID,
      },
      business_options: [],
    });
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: filtered }} />,
    );

    expect(html).toContain(
      `Selected business (${MISSING_BUSINESS_ID}) · All brands · UTC range`,
    );
    expect(
      buildAdminMetricsExportFilename(
        "per-business",
        buildMetricsExportFilters(filtered),
      ),
    ).toBe(
      `simplassist-per-business-2026-08-all-business-${MISSING_BUSINESS_ID}.csv`,
    );
  });

  it("keeps the selected zero-event business visible for an empty month", () => {
    const emptyReport = report({
      scope: {
        kind: "direct",
        partner_id: null,
        business_id: BUSINESS_ID,
      },
      totals: counts(),
      brand_totals: [],
      businesses: [],
    });
    const html = renderToStaticMarkup(
      <AdminMetricsReport
        result={{ state: "ready", report: emptyReport }}
      />,
    );

    expect(html).toContain(
      "River City Dental · SimplAssist direct · UTC range",
    );
    expect(html).toContain(
      "No metric events were recorded for this UTC month and scope.",
    );
    expect(html).not.toContain('aria-label="Monthly brand metric totals"');
    expect(html).not.toContain(
      'aria-label="Monthly event-time business metric rows"',
    );
  });

  it.each([
    ["query_failed", "Metrics query unavailable", "could not be completed"],
    [
      "invalid_response",
      "Metrics response unavailable",
      "failed strict validation",
    ],
    [
      "inconsistent_response",
      "Metrics totals unavailable",
      "did not pass consistency checks",
    ],
  ] as const)(
    "renders the typed %s state without fabricated counts",
    (state, heading, detail) => {
      const html = renderToStaticMarkup(
        <AdminMetricsReport
          result={{ state: state as AdminMetricsReportErrorState }}
        />,
      );

      expect(html).toContain('role="alert"');
      expect(html).toContain(heading);
      expect(html).toContain(detail);
      expect(html).toContain(
        "No partial, estimated, or fabricated zero counts are shown.",
      );
      expect(html).not.toContain("Overall metric totals");
      expect(html).not.toContain("Metric availability");
      expect(html).not.toContain("Export brand totals (CSV)");
      expect(html).not.toContain("Export per-business (CSV)");
    },
  );

  it("projects only modeled count fields from a validated report", () => {
    const unsafeReport = {
      ...report(),
      content: "private message body",
      metadata: { phone: "+15551234567" },
      provider_payload: "private provider payload",
    } as AdminMonthlyBusinessMetricsResponseV2;

    const html = renderToStaticMarkup(
      <AdminMetricsReport
        result={{ state: "ready", report: unsafeReport }}
      />,
    );

    expect(html).not.toContain("private message body");
    expect(html).not.toContain("+15551234567");
    expect(html).not.toContain("private provider payload");
  });

  it("labels a deleted historical partner without inventing its name", () => {
    const historicalId = "20000000-0000-4000-a050-000000000099";
    const scoped = report({
      scope: {
        kind: "partner",
        partner_id: historicalId,
        business_id: null,
      },
      partner_options: [
        {
          partner_id: historicalId,
          partner_name: null,
          partner_slug: null,
        },
      ],
      brand_totals: [
        {
          brand_kind: "partner",
          partner_id_at_event: historicalId,
          partner_name: null,
          partner_slug: null,
          counts: counts({ contact_created: 1 }),
        },
      ],
      businesses: [
        {
          business_id: BUSINESS_ID,
          business_name: "Historical Dental",
          partner_id_at_event: historicalId,
          partner_name: null,
          partner_slug: null,
          counts: counts({ contact_created: 1 }),
        },
      ],
    });
    const html = renderToStaticMarkup(
      <AdminMetricsReport result={{ state: "ready", report: scoped }} />,
    );

    expect(html).toContain(`Historical partner (${historicalId})`);
    expect(html).not.toContain("Unknown partner");
    expect(
      buildAdminMetricsExportFilename(
        "brand-totals",
        buildMetricsExportFilters(scoped),
      ),
    ).toBe(
      `simplassist-brand-totals-2026-08-partner-historical-${historicalId}.csv`,
    );
  });
});
