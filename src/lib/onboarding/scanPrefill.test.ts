import { describe, expect, it } from "vitest";

import {
  buildBusinessHoursDefaults,
  getBusinessInfoScanPrefill,
} from "./scanPrefill";

describe("getBusinessInfoScanPrefill", () => {
  it("fills only blank supported fields and normalizes a valid US state", () => {
    const current = {
      name: "  ",
      phone: "(555) 111-2222",
      address: "",
      city: "Owner-entered city",
      state: "",
      zip: "",
    };
    const scan = {
      business_name: "  Scanned Business  ",
      phone_number: "(555) 999-0000",
      address: "  123 Main St  ",
      city: "Scanned City",
      state: "Indiana",
      zip: " 46204 ",
    };

    expect(getBusinessInfoScanPrefill(current, scan)).toEqual({
      name: "Scanned Business",
      address: "123 Main St",
      state: "IN",
      zip: "46204",
    });
  });

  it("consumes scanned phone and city values when those fields are blank", () => {
    expect(
      getBusinessInfoScanPrefill(
        {
          name: "Owner-entered business",
          phone: " ",
          address: "Owner-entered address",
          city: "",
          state: "IN",
          zip: "46204",
        },
        {
          business_name: "Scanned Business",
          phone_number: "  (555) 999-0000 ",
          address: "Scanned address",
          city: "  Indianapolis ",
          state: "Ohio",
          zip: "43004",
        }
      )
    ).toEqual({
      phone: "(555) 999-0000",
      city: "Indianapolis",
    });
  });

  it("ignores an invalid state and empty scan strings", () => {
    expect(
      getBusinessInfoScanPrefill(
        {
          name: "",
          phone: "",
          address: "",
          city: "",
          state: "",
          zip: "",
        },
        {
          business_name: " ",
          phone_number: null,
          state: "Not a state",
        }
      )
    ).toEqual({});
  });

  it("does not mutate current values or scan results", () => {
    const current = {
      name: "",
      phone: "",
      address: "",
      city: "",
      state: "",
      zip: "",
    };
    const scan = {
      business_name: "Scanned",
      state: "IN",
    };
    const currentSnapshot = structuredClone(current);
    const scanSnapshot = structuredClone(scan);

    getBusinessInfoScanPrefill(current, scan);

    expect(current).toEqual(currentSnapshot);
    expect(scan).toEqual(scanSnapshot);
  });
});

describe("buildBusinessHoursDefaults", () => {
  it("merges valid partial scan rows into canonical Sunday-Saturday defaults", () => {
    const result = buildBusinessHoursDefaults({
      scannedHours: [
        {
          day: "Mon.",
          is_closed: false,
          open_time: "9:05",
          close_time: "5:30 PM",
        },
        {
          day: "Saturday",
          is_closed: true,
          open_time: "",
          close_time: "",
        },
      ],
    });

    expect(result.map((row) => row.day)).toEqual([
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ]);
    expect(result[1]).toEqual({
      day: "monday",
      is_closed: false,
      open_time: "09:05",
      close_time: "17:30",
    });
    expect(result[2]).toEqual({
      day: "tuesday",
      is_closed: false,
      open_time: "09:00",
      close_time: "17:00",
    });
    expect(result[6]).toEqual({
      day: "saturday",
      is_closed: true,
      open_time: "09:00",
      close_time: "17:00",
    });
  });

  it("ignores invalid days and times and uses the first valid duplicate", () => {
    const result = buildBusinessHoursDefaults({
      scannedHours: [
        {
          day: "Funday",
          is_closed: false,
          open_time: "08:00",
          close_time: "16:00",
        },
        {
          day: "Tuesday",
          is_closed: false,
          open_time: "not-a-time",
          close_time: "16:00",
        },
        {
          day: "Tue",
          is_closed: false,
          open_time: "08:00",
          close_time: "16:00",
        },
        {
          day: "tuesday",
          is_closed: false,
          open_time: "10:00",
          close_time: "18:00",
        },
      ],
    });

    expect(result[2]).toEqual({
      day: "tuesday",
      is_closed: false,
      open_time: "08:00",
      close_time: "16:00",
    });
  });

  it("lets saved database hours win wholesale over scan results", () => {
    const result = buildBusinessHoursDefaults({
      savedHours: [
        {
          day: "Monday",
          is_closed: false,
          open_time: "08:00",
          close_time: "16:00",
        },
      ],
      scannedHours: [
        {
          day: "Tuesday",
          is_closed: false,
          open_time: "10:00",
          close_time: "18:00",
        },
      ],
    });

    expect(result[1].open_time).toBe("08:00");
    expect(result[2]).toEqual({
      day: "tuesday",
      is_closed: false,
      open_time: "09:00",
      close_time: "17:00",
    });
  });

  it("does not mutate saved or scanned hour rows", () => {
    const savedHours = [
      {
        day: "Monday",
        is_closed: false,
        open_time: "08:00",
        close_time: "16:00",
      },
    ];
    const scannedHours = [
      {
        day: "Tuesday",
        is_closed: false,
        open_time: "10:00",
        close_time: "18:00",
      },
    ];
    const savedSnapshot = structuredClone(savedHours);
    const scannedSnapshot = structuredClone(scannedHours);

    const result = buildBusinessHoursDefaults({ savedHours, scannedHours });
    result[1].open_time = "changed";

    expect(savedHours).toEqual(savedSnapshot);
    expect(scannedHours).toEqual(scannedSnapshot);
  });
});
