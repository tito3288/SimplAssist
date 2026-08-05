import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AdminMetricsFilters,
  synchronizePartnerControl,
} from "./AdminMetricsFilters";

const PARTNER_ID = "20000000-0000-4000-a050-000000000001";
const HISTORICAL_PARTNER_ID = "20000000-0000-4000-a050-000000000002";

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

describe("AdminMetricsFilters", () => {
  it("renders a native read-only GET filter with the exact controls", () => {
    const html = renderToStaticMarkup(
      <AdminMetricsFilters
        filters={{ month: "2026-08", scope: "all", partnerId: null }}
        partners={PARTNERS}
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
    expect(html).toContain('value="direct">SimplAssist direct</option>');
    expect(html).toContain('value="partner">Specific partner</option>');
    expect(html).toContain("Month boundaries are calculated in UTC.");
    expect(html).toContain(
      "Applied only when scope is Specific partner.",
    );
    expect(html).toContain("View metrics");
    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain("Clear filters");
    expect(html).not.toMatch(/onChange|fetch\(|service.role/i);
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
        }}
        partners={PARTNERS}
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
        }}
        partners={PARTNERS}
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
        }}
        partners={[]}
      />,
    );

    expect(html).toContain('value="2026-07"');
    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Historical partner (${PARTNER_ID})</option>`,
    );
    expect(html).toContain('name="partner" required=""');
    expect(html).not.toContain('name="partner" disabled=""');
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
});
