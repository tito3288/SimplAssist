import { describe, expect, it } from "vitest";
import type { AISettings } from "@/types/database";
import { shouldIncludeCalendarTools } from "./tools";

const directSettings = {
  booking_enabled: true,
  booking_mode: "schedule_direct",
} as AISettings;

describe("shouldIncludeCalendarTools", () => {
  it("enables direct booking only for connected schedule_direct mode", () => {
    expect(shouldIncludeCalendarTools(directSettings, true)).toBe(true);
  });

  it("removes direct-booking tools while booking is operationally unavailable", () => {
    expect(shouldIncludeCalendarTools(directSettings, true, false)).toBe(false);
  });

  it.each([
    [{ ...directSettings, booking_enabled: false }, true],
    [{ ...directSettings, booking_mode: "collect_info" }, true],
    [directSettings, false],
  ])(
    "excludes non-direct booking configuration %#",
    (settings, connected) => {
      expect(
        shouldIncludeCalendarTools(settings as AISettings, connected)
      ).toBe(false);
    }
  );
});
