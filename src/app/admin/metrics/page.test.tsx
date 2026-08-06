import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class AdminMetricsReadError extends Error {
    constructor(
      readonly code:
        | "query_failed"
        | "invalid_response"
        | "inconsistent_response",
    ) {
      super(code);
      this.name = "AdminMetricsReadError";
    }
  }

  return {
    requireAdminUser: vi.fn(),
    loadMetrics: vi.fn(),
    loadBusinessOptionGroups: vi.fn(),
    renderFilters: vi.fn(),
    renderReport: vi.fn(),
    AdminMetricsReadError,
  };
});

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/admin/metrics.server", () => ({
  AdminMetricsReadError: mocks.AdminMetricsReadError,
  loadAdminMonthlyBusinessMetrics: mocks.loadMetrics,
}));
vi.mock("@/lib/admin/metricsBusinessOptions.server", () => ({
  loadAdminMetricsBusinessOptionGroups: mocks.loadBusinessOptionGroups,
}));
vi.mock("./AdminMetricsFilters", () => ({
  AdminMetricsFilters: (props: unknown) => {
    mocks.renderFilters(props);
    return <div>Metrics filters</div>;
  },
}));
vi.mock("./AdminMetricsReport", () => ({
  AdminMetricsReport: (props: { result: { state: string } }) => {
    mocks.renderReport(props);
    return <div>Report state: {props.result.state}</div>;
  },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import AdminMetricsPage from "./page";

const PARTNER_ID = "9c3c5b98-bda7-48ea-a972-22c1ab4d2f71";
const BUSINESS_ID = "10000000-0000-4000-a050-000000000001";

function report(
  partnerOptions: unknown[] = [],
  businessOptions: unknown[] = [],
) {
  return {
    period: {
      month: "2026-07",
      start: "2026-07-01T00:00:00+00:00",
      end_exclusive: "2026-08-01T00:00:00+00:00",
    },
    scope: { kind: "all", partner_id: null, business_id: null },
    definitions: [],
    totals: {},
    brand_totals: [],
    businesses: [],
    partner_options: partnerOptions,
    business_options: businessOptions,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadMetrics.mockResolvedValue(report());
  mocks.loadBusinessOptionGroups.mockResolvedValue(null);
});

describe("AdminMetricsPage", () => {
  it.each([
    [
      { month: "2026-07", scope: "all" },
      {
        month: "2026-07",
        scope: "all",
        partnerId: null,
        businessId: null,
      },
    ],
    [
      { month: "2026-07", scope: "direct", partner: "" },
      {
        month: "2026-07",
        scope: "direct",
        partnerId: null,
        businessId: null,
      },
    ],
    [
      { month: "2026-07", scope: "partner", partner: PARTNER_ID },
      {
        month: "2026-07",
        scope: "partner",
        partnerId: PARTNER_ID,
        businessId: null,
      },
    ],
    [
      { month: "2026-07", scope: "all", business: BUSINESS_ID.toUpperCase() },
      {
        month: "2026-07",
        scope: "all",
        partnerId: null,
        businessId: BUSINESS_ID,
      },
    ],
  ] as const)("authenticates before loading normalized filters %#", async (
    searchParams,
    expectedFilters,
  ) => {
    const html = renderToStaticMarkup(
      await AdminMetricsPage({ searchParams: { ...searchParams } }),
    );

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.loadMetrics).toHaveBeenCalledOnce();
    expect(mocks.loadMetrics).toHaveBeenCalledWith(expectedFilters);
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadMetrics.mock.invocationCallOrder[0],
    );
    expect(html).toContain("Admin metrics");
    expect(html).toContain("Read-only monthly counts");
    expect(html).toContain("UTC");
    expect(html).toContain('href="/admin"');
    expect(html).toContain('aria-label="Back to admin"');
    expect(html).toContain("Back</a>");
    expect(html).toContain('href="/admin/metrics/settings"');
    expect(html).toContain("Report settings");
    expect(html).toContain("Report state: ready");
  });

  it("passes aggregate partner and business options to the native filters", async () => {
    const partnerOptions = [
      {
        partner_id: PARTNER_ID,
        partner_name: "Agency One",
        partner_slug: "agency-one",
      },
    ];
    const businessOptions = [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
      },
    ];
    mocks.loadMetrics.mockResolvedValue(
      report(partnerOptions, businessOptions),
    );

    renderToStaticMarkup(
      await AdminMetricsPage({
        searchParams: {
          month: "2026-07",
          scope: "partner",
          partner: PARTNER_ID,
        },
      }),
    );

    expect(mocks.renderFilters).toHaveBeenCalledWith({
      filters: {
        month: "2026-07",
        scope: "partner",
        partnerId: PARTNER_ID,
        businessId: null,
      },
      partners: partnerOptions,
      businesses: businessOptions,
      businessGroups: null,
    });
    expect(mocks.loadBusinessOptionGroups).not.toHaveBeenCalled();
  });

  it("enriches All-scope options and passes only trustworthy groups", async () => {
    const partnerOptions = [
      {
        partner_id: PARTNER_ID,
        partner_name: "Agency One",
        partner_slug: "agency-one",
      },
    ];
    const businessOptions = [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
      },
    ];
    const businessGroups = [
      {
        id: PARTNER_ID,
        label: "Agency One",
        businesses: businessOptions,
      },
    ];
    mocks.loadMetrics.mockResolvedValue(
      report(partnerOptions, businessOptions),
    );
    mocks.loadBusinessOptionGroups.mockResolvedValue(businessGroups);

    renderToStaticMarkup(
      await AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    );

    expect(mocks.loadBusinessOptionGroups).toHaveBeenCalledOnce();
    expect(mocks.loadBusinessOptionGroups).toHaveBeenCalledWith(
      businessOptions,
      partnerOptions,
    );
    expect(mocks.loadMetrics.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadBusinessOptionGroups.mock.invocationCallOrder[0],
    );
    expect(mocks.renderFilters).toHaveBeenCalledWith({
      filters: {
        month: "2026-07",
        scope: "all",
        partnerId: null,
        businessId: null,
      },
      partners: partnerOptions,
      businesses: businessOptions,
      businessGroups,
    });
  });

  it("keeps the authoritative flat options when enrichment is incomplete", async () => {
    const businessOptions = [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
      },
    ];
    mocks.loadMetrics.mockResolvedValue(report([], businessOptions));
    mocks.loadBusinessOptionGroups.mockResolvedValue(null);

    renderToStaticMarkup(
      await AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    );

    expect(mocks.renderFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        businesses: businessOptions,
        businessGroups: null,
      }),
    );
    expect(mocks.renderReport).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({ state: "ready" }),
      }),
    );
  });

  it("keeps the report and flat picker if optional enrichment throws", async () => {
    const businessOptions = [
      {
        business_id: BUSINESS_ID,
        business_name: "River City Dental",
      },
    ];
    mocks.loadMetrics.mockResolvedValue(report([], businessOptions));
    mocks.loadBusinessOptionGroups.mockRejectedValue(
      new Error("optional enrichment failed"),
    );

    const html = renderToStaticMarkup(
      await AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    );

    expect(html).toContain("Report state: ready");
    expect(mocks.renderFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        businesses: businessOptions,
        businessGroups: null,
      }),
    );
  });

  it.each([
    "query_failed",
    "invalid_response",
    "inconsistent_response",
  ] as const)("renders the typed %s state without fabricated report data", async (code) => {
    mocks.loadMetrics.mockRejectedValue(
      new mocks.AdminMetricsReadError(code),
    );

    const html = renderToStaticMarkup(
      await AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    );

    expect(html).toContain(`Report state: ${code}`);
    expect(mocks.renderReport).toHaveBeenCalledWith({
      result: { state: code },
    });
    expect(mocks.renderFilters).toHaveBeenCalledWith(
      expect.objectContaining({
        partners: [],
        businesses: [],
        businessGroups: null,
      }),
    );
    expect(mocks.loadBusinessOptionGroups).not.toHaveBeenCalled();
  });

  it("does not create or call the service-role loader when authentication fails", async () => {
    const authError = new Error("NEXT_NOT_FOUND");
    mocks.requireAdminUser.mockRejectedValue(authError);

    await expect(
      AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    ).rejects.toBe(authError);

    expect(mocks.loadMetrics).not.toHaveBeenCalled();
    expect(mocks.loadBusinessOptionGroups).not.toHaveBeenCalled();
    expect(mocks.renderFilters).not.toHaveBeenCalled();
    expect(mocks.renderReport).not.toHaveBeenCalled();
  });

  it("does not disguise an unexpected loader defect as a typed read state", async () => {
    const unexpected = new Error("programmer defect");
    mocks.loadMetrics.mockRejectedValue(unexpected);

    await expect(
      AdminMetricsPage({
        searchParams: { month: "2026-07", scope: "all" },
      }),
    ).rejects.toBe(unexpected);
    expect(mocks.loadBusinessOptionGroups).not.toHaveBeenCalled();
  });
});
