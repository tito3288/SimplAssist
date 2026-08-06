import { describe, expect, it } from "vitest";
import type { AISettings } from "@/types/database";
import {
  calendarTools,
  CREATE_BOOKING_START_TIME_CONTRACT,
  shouldIncludeCalendarTools,
} from "./tools";

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

describe("calendarTools booking timestamp contract", () => {
  it("requires the exact business-local no-offset start_time format", () => {
    const createBookingTool = calendarTools.find(
      (tool) => tool.name === "create_booking"
    );
    const inputSchema = createBookingTool?.input_schema as
      | {
          properties?: {
            start_time?: { description?: string };
          };
        }
      | undefined;

    expect(CREATE_BOOKING_START_TIME_CONTRACT).toBe(
      "create_booking.start_time must be a business-local wall time in exactly YYYY-MM-DDTHH:mm:ss format with NO Z suffix or UTC offset."
    );
    expect(inputSchema?.properties?.start_time?.description).toBe(
      CREATE_BOOKING_START_TIME_CONTRACT
    );
  });
});
