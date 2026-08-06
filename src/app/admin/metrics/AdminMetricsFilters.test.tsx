import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => {
  throw new Error("Metrics Clear must use a literal anchor");
});

import {
  AdminMetricsFilters,
  clearBusinessControl,
  synchronizePartnerControl,
} from "./AdminMetricsFilters";

const PARTNER_ID = "20000000-0000-4000-a050-000000000001";
const HISTORICAL_PARTNER_ID = "20000000-0000-4000-a050-000000000002";
const BUSINESS_ID = "10000000-0000-4000-a050-000000000001";
const ZERO_EVENT_BUSINESS_ID = "10000000-0000-4000-a050-000000000002";
const MISSING_BUSINESS_ID = "10000000-0000-4000-a050-000000000099";

const PARTNERS = [
  {
    partner_id: PARTNER_ID,
    partner_name: "Alpha Agency",
    partner_slug: "alpha-agency",
  },
  {
    partner_id: HISTORICAL_PARTNER_ID,
    partner_name: null,
    partner_slug: null,
  },
] as const;

const BUSINESSES = [
  {
    business_id: BUSINESS_ID,
    business_name: "River City Dental",
  },
  {
    business_id: ZERO_EVENT_BUSINESS_ID,
    business_name: "Zero Event Dental",
  },
] as const;

const BUSINESS_GROUPS = [
  {
    id: "direct",
    label: "SimplAssist direct",
    businesses: [BUSINESSES[0]],
  },
  {
    id: PARTNER_ID,
    label: "Alpha Agency",
    businesses: [BUSINESSES[1]],
  },
] as const;

describe("AdminMetricsFilters", () => {
  it("renders a native read-only GET filter with the exact controls", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope: "all",
          partnerId: null,
          businessId: null,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toContain(
      '<form action="/admin/metrics" method="get" aria-label="Filter monthly metrics"',
    );
    expect(html).toContain('type="month" name="month" required=""');
    expect(html).toContain('value="2026-08"');
    expect(html).toContain('name="scope"');
    expect(html).toContain('<option value="all" selected="">All</option>');
    expect(html).toContain('name="partner"');
    expect(html).toContain('name="partner" disabled=""');
    expect(html).toContain('name="business"');
    expect(html).toContain('<option value="" selected="">All businesses</option>');
    expect(html).toContain(
      `<option value="${ZERO_EVENT_BUSINESS_ID}">Zero Event Dental</option>`,
    );
    expect(html).toContain('value="direct">SimplAssist direct</option>');
    expect(html).toContain('value="partner">Specific partner</option>');
    expect(html).toContain("Month boundaries are calculated in UTC.");
    expect(html).toContain(
      "Applied only when scope is Specific partner.",
    );
    expect(html).toContain("View metrics");
    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain("Clear filters");
    expect(html).not.toContain("<optgroup");
    expect(html).not.toMatch(/onChange|fetch\(|service.role/i);
    expect(AdminMetricsFilters.toString()).not.toMatch(/\bfetch\s*\(/);
  });

  it("renders trustworthy All-scope groups in helper-provided order", () => {
    const groups = [
      BUSINESS_GROUPS[0],
      BUSINESS_GROUPS[1],
      {
        id: HISTORICAL_PARTNER_ID,
        label: "Zulu Agency",
        businesses: [],
      },
    ] as const;
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope: "all",
          partnerId: null,
          businessId: ZERO_EVENT_BUSINESS_ID,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={groups}
      />,
    );

    expect(html).toContain('<optgroup label="SimplAssist direct">');
    expect(html).toContain('<optgroup label="Alpha Agency">');
    expect(html).toContain('<optgroup label="Zulu Agency">');
    expect(html.indexOf('label="SimplAssist direct"')).toBeLessThan(
      html.indexOf('label="Alpha Agency"'),
    );
    expect(html.indexOf('label="Alpha Agency"')).toBeLessThan(
      html.indexOf('label="Zulu Agency"'),
    );
    expect(html).toContain(
      `<option value="${ZERO_EVENT_BUSINESS_ID}" selected="">Zero Event Dental</option>`,
    );
  });

  it("uses literal document navigation to clear every displayed control", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-07",
          scope: "partner",
          partnerId: PARTNER_ID,
          businessId: BUSINESS_ID,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toMatch(
      /<a href="\/admin\/metrics"[^>]*>Clear filters<\/a>/,
    );
    expect(html).toContain('value="2026-07"');
    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Alpha Agency</option>`,
    );
    expect(html).toContain(
      `<option value="${BUSINESS_ID}" selected="">River City Dental</option>`,
    );
  });

  it.each([
    ["all", "All"],
    ["direct", "SimplAssist direct"],
    ["partner", "Specific partner"],
  ] as const)("preserves the %s scope selection", (scope, label) => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope,
          partnerId: scope === "partner" ? PARTNER_ID : null,
          businessId: null,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toContain(
      `<option value="${scope}" selected="">${label}</option>`,
    );
  });

  it("renders named and historical partner options and preserves a selection", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope: "partner",
          partnerId: HISTORICAL_PARTNER_ID,
          businessId: null,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toContain(
      `<option value="${PARTNER_ID}">Alpha Agency</option>`,
    );
    expect(html).toContain(
      `<option value="${HISTORICAL_PARTNER_ID}" selected="">Historical partner (${HISTORICAL_PARTNER_ID})</option>`,
    );
  });

  it("preserves a selected partner even when the current response has no option", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-07",
          scope: "partner",
          partnerId: PARTNER_ID,
          businessId: null,
        }}
        partners={[]}
        businesses={[]}
        businessGroups={null}
      />,
    );

    expect(html).toContain('value="2026-07"');
    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Historical partner (${PARTNER_ID})</option>`,
    );
    expect(html).toContain('name="partner" required=""');
    expect(html).not.toContain('name="partner" disabled=""');
  });

  it("preserves a selected business from the scoped business options", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope: "direct",
          partnerId: null,
          businessId: ZERO_EVENT_BUSINESS_ID,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toContain(
      `<option value="${ZERO_EVENT_BUSINESS_ID}" selected="">Zero Event Dental</option>`,
    );
  });

  it("preserves a selected business even when it is absent from the response options", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{
          month: "2026-08",
          scope: "all",
          partnerId: null,
          businessId: MISSING_BUSINESS_ID,
        }}
        partners={PARTNERS}
        businesses={BUSINESSES}
        businessGroups={null}
      />,
    );

    expect(html).toContain(
      `<option value="${MISSING_BUSINESS_ID}" selected="">Selected business (${MISSING_BUSINESS_ID})</option>`,
    );
  });

  it("omits a stale partner when the scope changes from partner to direct", () => {
    const partnerControl = {
      disabled: false,
      required: true,
    } as HTMLSelectElement;

    synchronizePartnerControl("direct", partnerControl);

    expect(partnerControl).toMatchObject({
      disabled: true,
      required: false,
    });
  });

  it("clears a stale business when scope or partner changes", () => {
    const businessControl = {
      value: BUSINESS_ID,
    } as HTMLSelectElement;

    clearBusinessControl(businessControl);

    expect(businessControl.value).toBe("");
  });
});
