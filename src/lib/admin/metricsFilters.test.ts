import { describe, expect, it } from "vitest";
import { parseAdminMetricsFilters } from "./metricsFilters";

const PARTNER_ID = "9C3C5B98-BDA7-48EA-A972-22C1AB4D2F71";
const NOW = new Date("2026-08-05T17:30:00.000Z");

describe("parseAdminMetricsFilters", () => {
  it("defaults missing filters to the current UTC month and all scope", () => {
    expect(parseAdminMetricsFilters(undefined, NOW)).toEqual({
      month: "2026-08",
      scope: "all",
      partnerId: null,
    });
    expect(parseAdminMetricsFilters({}, NOW)).toEqual({
      month: "2026-08",
      scope: "all",
      partnerId: null,
    });
  });

  it("derives the default month in UTC rather than the caller timezone", () => {
    expect(
      parseAdminMetricsFilters(
        {},
        new Date("2026-09-01T00:30:00+02:00"),
      ).month,
    ).toBe("2026-08");
  });

  it.each(["all", "direct"] as const)(
    "accepts %s only without a partner parameter",
    (scope) => {
      expect(
        parseAdminMetricsFilters({ month: "2026-07", scope }, NOW),
      ).toEqual({ month: "2026-07", scope, partnerId: null });
      expect(
        parseAdminMetricsFilters(
          { month: "2026-07", scope, partner: "" },
          NOW,
        ),
      ).toEqual({ month: "2026-07", scope, partnerId: null });
    },
  );

  it("accepts partner scope with one exact UUID and canonicalizes it", () => {
    expect(
      parseAdminMetricsFilters(
        { month: "2026-07", scope: "partner", partner: PARTNER_ID },
        NOW,
      ),
    ).toEqual({
      month: "2026-07",
      scope: "partner",
      partnerId: PARTNER_ID.toLowerCase(),
    });
  });

  it.each([
    { scope: "partner" },
    { scope: "partner", partner: "" },
    { scope: "partner", partner: "not-a-uuid" },
    { scope: "direct", partner: PARTNER_ID },
    { scope: "all", partner: PARTNER_ID },
    { scope: "reseller", partner: PARTNER_ID },
    { scope: ["partner"], partner: PARTNER_ID },
    { scope: "partner", partner: [PARTNER_ID] },
  ])("normalizes malformed scope tuple %# atomically to all", (tuple) => {
    expect(
      parseAdminMetricsFilters({ month: "2026-07", ...tuple }, NOW),
    ).toEqual({ month: "2026-07", scope: "all", partnerId: null });
  });

  it.each([
    "2026-00",
    "2026-13",
    "2026-1",
    "0000-01",
    "2026-01-01",
    " 2026-01",
    "2026-01 ",
  ])("defaults malformed month %s while preserving a valid scope", (month) => {
    expect(
      parseAdminMetricsFilters({ month, scope: "direct" }, NOW),
    ).toEqual({ month: "2026-08", scope: "direct", partnerId: null });
  });

  it("defaults repeated month values instead of selecting one", () => {
    expect(
      parseAdminMetricsFilters(
        { month: ["2026-07", "2026-08"], scope: "all" },
        NOW,
      ),
    ).toEqual({ month: "2026-08", scope: "all", partnerId: null });
  });

  it("does not trim or partially accept a partner UUID", () => {
    expect(
      parseAdminMetricsFilters(
        {
          month: "2026-07",
          scope: "partner",
          partner: ` ${PARTNER_ID}`,
        },
        NOW,
      ),
    ).toEqual({ month: "2026-07", scope: "all", partnerId: null });
  });

  it("rejects an invalid internal default clock", () => {
    expect(() =>
      parseAdminMetricsFilters({}, new Date("invalid")),
    ).toThrow(TypeError);
  });
});
