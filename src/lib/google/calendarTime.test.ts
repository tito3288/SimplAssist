import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { businessWallTimeToInstant } from "./calendarTime";

const BUSINESS_TIMEZONE = "America/Indiana/Indianapolis";

beforeAll(() => {
  vi.stubEnv("TZ", "UTC");
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("businessWallTimeToInstant", () => {
  it("converts normal summer and winter business wall times with the applicable offset", () => {
    expect(
      businessWallTimeToInstant(
        "2026-07-15",
        "17:00",
        BUSINESS_TIMEZONE,
      ).toISOString(),
    ).toBe("2026-07-15T21:00:00.000Z");
    expect(
      businessWallTimeToInstant(
        "2026-01-15",
        "17:00:42",
        BUSINESS_TIMEZONE,
      ).toISOString(),
    ).toBe("2026-01-15T22:00:42.000Z");
  });

  it("rejects a nonexistent wall time during the March 2026 spring-forward gap", () => {
    expect(() =>
      businessWallTimeToInstant(
        "2026-03-08",
        "02:30",
        BUSINESS_TIMEZONE,
      ),
    ).toThrow(
      "Business-local time 2026-03-08T02:30:00 does not exist in America/Indiana/Indianapolis because of a daylight-saving time transition",
    );

    expect(
      businessWallTimeToInstant(
        "2026-03-08",
        "01:30",
        BUSINESS_TIMEZONE,
      ).toISOString(),
    ).toBe("2026-03-08T06:30:00.000Z");
    expect(
      businessWallTimeToInstant(
        "2026-03-08",
        "03:30",
        BUSINESS_TIMEZONE,
      ).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
  });

  it("chooses the earlier instant in the November 2026 fall-back overlap", () => {
    expect(
      businessWallTimeToInstant(
        "2026-11-01",
        "01:30",
        BUSINESS_TIMEZONE,
      ).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it.each([undefined, null, "", "   "])(
    "rejects a missing or empty business timezone: %s",
    (timeZone) => {
      expect(() =>
        businessWallTimeToInstant(
          "2026-07-15",
          "17:00",
          timeZone as unknown as string,
        ),
      ).toThrow("Business timezone is required");
    },
  );

  it("rejects an invalid IANA business timezone", () => {
    expect(() =>
      businessWallTimeToInstant("2026-07-15", "17:00", "Indianapolis"),
    ).toThrow('Invalid business timezone: "Indianapolis"');
  });

  it.each([
    ["2026-02-29", "17:00", "Invalid business-local date"],
    ["2026-13-01", "17:00", "Invalid business-local date"],
    ["2026-7-15", "17:00", "must use YYYY-MM-DD"],
    ["2026-07-15", "24:00", "Invalid business-local time"],
    ["2026-07-15", "17:60", "Invalid business-local time"],
    ["2026-07-15", "5:00", "must use HH:mm or HH:mm:ss"],
  ])("rejects invalid wall input %s %s", (date, time, message) => {
    expect(() =>
      businessWallTimeToInstant(date, time, BUSINESS_TIMEZONE),
    ).toThrow(message);
  });
});
