import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminMetricsExport,
  buildAdminMetricsCsv,
  buildAdminMetricsExportFilename,
  downloadAdminMetricsCsv,
  escapeAdminMetricsCsvField,
  type AdminMetricsExportFilters,
} from "./AdminMetricsExport";

const ALL_FILTERS = {
  month: "2026-07",
  scope: "all",
  partnerSlug: null,
  partnerId: null,
  businessName: null,
  businessId: null,
} satisfies AdminMetricsExportFilters;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AdminMetricsExport", () => {
  it("renders the compact download control only when rows are present", () => {
    const populated = renderToStaticMarkup(
      <AdminMetricsExport
        kind="brand-totals"
        filters={ALL_FILTERS}
        data={{ headers: ["Brand"], rows: [["SimplAssist direct"]] }}
      />,
    );
    const empty = renderToStaticMarkup(
      <AdminMetricsExport
        kind="brand-totals"
        filters={ALL_FILTERS}
        data={{ headers: ["Brand"], rows: [] }}
      />,
    );

    expect(populated).toContain('<button type="button"');
    expect(populated).toContain("Export brand totals (CSV)");
    expect(empty).toBe("");
  });

  it("uses the kind label by default and supports a caller override", () => {
    const data = { headers: ["Business"], rows: [["River City Dental"]] };
    const defaultLabel = renderToStaticMarkup(
      <AdminMetricsExport
        kind="per-business"
        filters={ALL_FILTERS}
        data={data}
      />,
    );
    const overriddenLabel = renderToStaticMarkup(
      <AdminMetricsExport
        kind="per-business"
        filters={ALL_FILTERS}
        data={data}
        label="Export CSV"
      />,
    );

    expect(defaultLabel).toContain("Export per-business (CSV)");
    expect(overriddenLabel).toContain("Export CSV");
    expect(overriddenLabel).not.toContain("Export per-business (CSV)");
  });

  it.each([
    ["plain", "plain"],
    ["", ""],
    [42, "42"],
    ["comma,value", '"comma,value"'],
    ['say "yes"', '"say ""yes"""'],
    ["line one\nline two", '"line one\nline two"'],
    ["line one\r\nline two", '"line one\r\nline two"'],
    ["=1+1", "'=1+1"],
    ["+command", "'+command"],
    ["-2", "'-2"],
    ["@SUM", "'@SUM"],
    ["=SUM(1,2)", '"\'=SUM(1,2)"'],
  ])("escapes CSV field %j", (value, expected) => {
    expect(escapeAdminMetricsCsvField(value)).toBe(expected);
  });

  it("writes headers and rows in order with CRLF line endings", () => {
    expect(
      buildAdminMetricsCsv({
        headers: ["Business name", "Count"],
        rows: [
          ["River City Dental", 2],
          ["North, East & West", 4],
        ],
      }),
    ).toBe(
      "Business name,Count\r\n" +
        "River City Dental,2\r\n" +
        '"North, East & West",4\r\n',
    );
  });

  it("builds filenames from every applied report filter", () => {
    expect(buildAdminMetricsExportFilename("brand-totals", ALL_FILTERS)).toBe(
      "simplassist-brand-totals-2026-07-all.csv",
    );
    expect(
      buildAdminMetricsExportFilename("per-business", {
        ...ALL_FILTERS,
        scope: "direct",
      }),
    ).toBe("simplassist-per-business-2026-07-direct.csv");
    expect(
      buildAdminMetricsExportFilename("brand-totals", {
        ...ALL_FILTERS,
        scope: "partner",
        partnerSlug: "Alpha Agency",
        partnerId: "20000000-0000-4000-a050-000000000001",
      }),
    ).toBe("simplassist-brand-totals-2026-07-partner-alpha-agency.csv");
    expect(
      buildAdminMetricsExportFilename("per-business", {
        ...ALL_FILTERS,
        scope: "partner",
        partnerSlug: null,
        partnerId: "20000000-0000-4000-a050-000000000099",
      }),
    ).toBe(
      "simplassist-per-business-2026-07-partner-historical-20000000-0000-4000-a050-000000000099.csv",
    );
    expect(
      buildAdminMetricsExportFilename("per-business", {
        ...ALL_FILTERS,
        businessName: "Rivér City Dental",
        businessId: "10000000-0000-4000-a050-000000000001",
      }),
    ).toBe(
      "simplassist-per-business-2026-07-all-business-river-city-dental-10000000-0000-4000-a050-000000000001.csv",
    );
  });

  it("downloads through a temporary Blob URL and revokes it after the click", async () => {
    vi.useFakeTimers();
    const anchor = {
      href: "",
      download: "",
      style: { display: "" },
      click: vi.fn(),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    const createElement = vi.fn(() => anchor);
    const createObjectURL = vi.fn<(blob: Blob) => string>(
      () => "blob:metrics-csv",
    );
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("document", {
      createElement,
      body: { appendChild },
    });
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    downloadAdminMetricsCsv("metrics.csv", "Heading\r\nValue\r\n");

    expect(createElement).toHaveBeenCalledWith("a");
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    await expect(blob.text()).resolves.toBe("Heading\r\nValue\r\n");
    expect(anchor.href).toBe("blob:metrics-csv");
    expect(anchor.download).toBe("metrics.csv");
    expect(anchor.style.display).toBe("none");
    expect(appendChild).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:metrics-csv");
    expect(anchor.click.mock.invocationCallOrder[0]).toBeLessThan(
      revokeObjectURL.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });
});
