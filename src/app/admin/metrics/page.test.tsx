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

import AdminMetricsPage from "./page";

const PARTNER_ID = "9c3c5b98-bda7-48ea-a972-22c1ab4d2f71";

function report(partnerOptions: unknown[] = []) {
  return {
    period: {
      month: "2026-07",
      start: "2026-07-01T00:00:00+00:00",
      end_exclusive: "2026-08-01T00:00:00+00:00",
    },
    scope: { kind: "all", partner_id: null },
    definitions: [],
    totals: {},
    brand_totals: [],
    businesses: [],
    partner_options: partnerOptions,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadMetrics.mockResolvedValue(report());
});

describe("AdminMetricsPage", () => {
  it.each([
    [
      { month: "2026-07", scope: "all" },
      { month: "2026-07", scope: "all", partnerId: null },
    ],
    [
      { month: "2026-07", scope: "direct", partner: "" },
      { month: "2026-07", scope: "direct", partnerId: null },
    ],
    [
      { month: "2026-07", scope: "partner", partner: PARTNER_ID },
      { month: "2026-07", scope: "partner", partnerId: PARTNER_ID },
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
    expect(html).toContain("Report state: ready");
  });

  it("passes aggregate partner options to the native filters", async () => {
    const options = [
      {
        partner_id: PARTNER_ID,
        partner_name: "Agency One",
        partner_slug: "agency-one",
      },
    ];
    mocks.loadMetrics.mockResolvedValue(report(options));

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
      },
      partners: options,
    });
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
      expect.objectContaining({ partners: [] }),
    );
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
  });
});
