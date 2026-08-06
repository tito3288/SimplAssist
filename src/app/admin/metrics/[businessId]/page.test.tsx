import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../AdminMetricsReport", () => ({
  AdminBusinessMetricsReport: (props: {
    result: { state: string };
    businessId: string;
    month: string;
  }) => {
    mocks.renderReport(props);
    return props.result.state === "ready" ? (
      <div>Business report ready</div>
    ) : (
      <div role="alert">Business report error: {props.result.state}</div>
    );
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

import AdminBusinessMetricsPage from "./page";

const BUSINESS_ID = "10000000-0000-4000-a050-000000000001";
const UNKNOWN_BUSINESS_ID = "10000000-0000-4000-a050-000000000099";

function report({
  businessId = BUSINESS_ID,
  known = true,
  withRow = false,
}: {
  businessId?: string;
  known?: boolean;
  withRow?: boolean;
} = {}) {
  return {
    period: {
      month: "2026-08",
      start: "2026-08-01T00:00:00+00:00",
      end_exclusive: "2026-09-01T00:00:00+00:00",
    },
    scope: { kind: "all", partner_id: null, business_id: businessId },
    definitions: [],
    totals: {},
    brand_totals: [],
    businesses: withRow
      ? [
          {
            business_id: businessId,
            business_name: "River City Dental",
            partner_id_at_event: null,
            partner_name: null,
            partner_slug: null,
            counts: {},
          },
        ]
      : [],
    partner_options: [],
    business_options: known
      ? [
          {
            business_id: businessId,
            business_name: "River City Dental",
          },
        ]
      : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.loadMetrics.mockResolvedValue(report());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AdminBusinessMetricsPage", () => {
  it("authenticates before loading normalized all-scope business metrics", async () => {
    const html = renderToStaticMarkup(
      await AdminBusinessMetricsPage({
        params: { businessId: BUSINESS_ID.toUpperCase() },
        searchParams: {
          month: "2026-08",
          scope: "partner",
          partner: UNKNOWN_BUSINESS_ID,
          business: UNKNOWN_BUSINESS_ID,
        },
      }),
    );

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.loadMetrics).toHaveBeenCalledOnce();
    expect(mocks.loadMetrics).toHaveBeenCalledWith({
      month: "2026-08",
      scope: "all",
      partnerId: null,
      businessId: BUSINESS_ID,
    });
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.loadMetrics.mock.invocationCallOrder[0],
    );
    expect(mocks.renderReport).toHaveBeenCalledWith({
      result: { state: "ready", report: expect.any(Object) },
      businessId: BUSINESS_ID,
      month: "2026-08",
    });
    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain('aria-label="Back to admin metrics"');
    expect(html).toContain("Back</a>");
    expect(html).toContain("Business report ready");
  });

  it("uses the existing parser to default an invalid month to the current UTC month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T15:30:00.000Z"));

    await AdminBusinessMetricsPage({
      params: { businessId: BUSINESS_ID },
      searchParams: { month: "2026-99" },
    });

    expect(mocks.loadMetrics).toHaveBeenCalledWith({
      month: "2026-08",
      scope: "all",
      partnerId: null,
      businessId: BUSINESS_ID,
    });
  });

  it("defaults an omitted month to the current UTC month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T15:30:00.000Z"));

    await AdminBusinessMetricsPage({
      params: { businessId: BUSINESS_ID },
    });

    expect(mocks.loadMetrics).toHaveBeenCalledWith({
      month: "2026-08",
      scope: "all",
      partnerId: null,
      businessId: BUSINESS_ID,
    });
  });

  it("authenticates but does not broaden the read for an invalid business id", async () => {
    const html = renderToStaticMarkup(
      await AdminBusinessMetricsPage({
        params: { businessId: "not-a-uuid" },
        searchParams: { month: "2026-08" },
      }),
    );

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.loadMetrics).not.toHaveBeenCalled();
    expect(mocks.renderReport).toHaveBeenCalledWith({
      result: { state: "business_unavailable" },
      businessId: "not-a-uuid",
      month: "2026-08",
    });
    expect(html).toContain('role="alert"');
    expect(html).toContain("Business report error: business_unavailable");
  });

  it("renders the page error state for an unknown valid business id", async () => {
    mocks.loadMetrics.mockResolvedValue(
      report({ businessId: UNKNOWN_BUSINESS_ID, known: false }),
    );

    const html = renderToStaticMarkup(
      await AdminBusinessMetricsPage({
        params: { businessId: UNKNOWN_BUSINESS_ID },
        searchParams: { month: "2026-08" },
      }),
    );

    expect(mocks.loadMetrics).toHaveBeenCalledWith({
      month: "2026-08",
      scope: "all",
      partnerId: null,
      businessId: UNKNOWN_BUSINESS_ID,
    });
    expect(mocks.renderReport).toHaveBeenCalledWith({
      result: { state: "business_unavailable" },
      businessId: UNKNOWN_BUSINESS_ID,
      month: "2026-08",
    });
    expect(html).toContain("Business report error: business_unavailable");
  });

  it("keeps a known zero-event business in the ready state", async () => {
    mocks.loadMetrics.mockResolvedValue(
      report({ known: true, withRow: false }),
    );

    renderToStaticMarkup(
      await AdminBusinessMetricsPage({
        params: { businessId: BUSINESS_ID },
        searchParams: { month: "2026-08" },
      }),
    );

    expect(mocks.renderReport).toHaveBeenCalledWith({
      result: { state: "ready", report: expect.any(Object) },
      businessId: BUSINESS_ID,
      month: "2026-08",
    });
  });

  it.each([
    "query_failed",
    "invalid_response",
    "inconsistent_response",
  ] as const)(
    "maps the %s loader error to the report error state",
    async (code) => {
      mocks.loadMetrics.mockRejectedValue(
        new mocks.AdminMetricsReadError(code),
      );

      const html = renderToStaticMarkup(
        await AdminBusinessMetricsPage({
          params: { businessId: BUSINESS_ID },
          searchParams: { month: "2026-08" },
        }),
      );

      expect(mocks.renderReport).toHaveBeenCalledWith({
        result: { state: code },
        businessId: BUSINESS_ID,
        month: "2026-08",
      });
      expect(html).toContain(`Business report error: ${code}`);
    },
  );

  it("rethrows unexpected loader failures", async () => {
    mocks.loadMetrics.mockRejectedValue(new Error("unexpected"));

    await expect(
      AdminBusinessMetricsPage({
        params: { businessId: BUSINESS_ID },
        searchParams: { month: "2026-08" },
      }),
    ).rejects.toThrow("unexpected");
  });

  it("does not start the metrics read when admin authentication fails", async () => {
    mocks.requireAdminUser.mockRejectedValue(new Error("NOT_FOUND"));

    await expect(
      AdminBusinessMetricsPage({
        params: { businessId: BUSINESS_ID },
        searchParams: { month: "2026-08" },
      }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.loadMetrics).not.toHaveBeenCalled();
    expect(mocks.renderReport).not.toHaveBeenCalled();
  });
});
