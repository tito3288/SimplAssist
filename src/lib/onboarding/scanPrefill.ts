import { normalizeUsStateCode } from "@/lib/usStates";

export type ScannedBusinessHours = {
  day: string;
  open_time: string;
  close_time: string;
  is_closed: boolean;
};

export type OnboardingScanData = {
  business_name?: string | null;
  phone_number?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  services?: {
    name: string;
    description?: string | null;
    price?: string | null;
  }[];
  faqs?: { question: string; answer: string }[];
  business_hours?: ScannedBusinessHours[] | null;
};

export type BusinessInfoPrefillValues = {
  name: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
};

export type EditableBusinessHours = {
  day: string;
  is_closed: boolean;
  open_time: string;
  close_time: string;
};

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const DAY_ALIASES = new Map<string, (typeof DAYS)[number]>(
  DAYS.flatMap((day) => [
    [day, day] as const,
    [day.slice(0, 3), day] as const,
  ])
);

function cleanString(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Returns only scan suggestions that can safely fill a currently blank
 * business-info field. Email and business type are intentionally absent:
 * neither is supplied by the website extractor.
 */
export function getBusinessInfoScanPrefill(
  current: BusinessInfoPrefillValues,
  scan: OnboardingScanData
): Partial<BusinessInfoPrefillValues> {
  const prefill: Partial<BusinessInfoPrefillValues> = {};

  const copyIfBlank = (
    field: Exclude<keyof BusinessInfoPrefillValues, "state">,
    scannedValue?: string | null
  ) => {
    if (current[field].trim()) return;
    const value = cleanString(scannedValue);
    if (value) prefill[field] = value;
  };

  copyIfBlank("name", scan.business_name);
  copyIfBlank("phone", scan.phone_number);
  copyIfBlank("address", scan.address);
  copyIfBlank("city", scan.city);
  copyIfBlank("zip", scan.zip);

  if (!current.state.trim()) {
    const normalizedState = normalizeUsStateCode(scan.state);
    if (normalizedState) prefill.state = normalizedState;
  }

  return prefill;
}

function defaultBusinessHours(): EditableBusinessHours[] {
  return DAYS.map((day) => ({
    day,
    is_closed: day === "sunday" || day === "saturday",
    open_time: "09:00",
    close_time: "17:00",
  }));
}

function normalizeDay(value: string): (typeof DAYS)[number] | null {
  return DAY_ALIASES.get(value.trim().toLowerCase().replace(/\.$/, "")) ?? null;
}

function normalizeTime(value: string): string | null {
  const match = value
    .trim()
    .match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?(?:\s*([ap])\.?m\.?)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === "a") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
  } else if (hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

/**
 * Produces the seven canonical Sunday-Saturday rows used by the hours form.
 * Any saved database rows win as a unit; scan data is considered only when
 * there are no saved rows. Missing scan days retain the normal form defaults.
 * For duplicate days, the first valid row wins.
 */
export function buildBusinessHoursDefaults({
  savedHours,
  scannedHours,
}: {
  savedHours?: readonly EditableBusinessHours[];
  scannedHours?: readonly ScannedBusinessHours[] | null;
}): EditableBusinessHours[] {
  const defaults = defaultBusinessHours();
  const source =
    savedHours && savedHours.length > 0 ? savedHours : scannedHours ?? [];
  const seenDays = new Set<string>();

  for (const row of source) {
    const day = normalizeDay(row.day);
    if (!day || seenDays.has(day)) continue;

    const index = DAYS.indexOf(day);
    if (row.is_closed) {
      const openTime = normalizeTime(row.open_time);
      const closeTime = normalizeTime(row.close_time);
      defaults[index] = {
        day,
        is_closed: true,
        open_time: openTime ?? defaults[index].open_time,
        close_time: closeTime ?? defaults[index].close_time,
      };
      seenDays.add(day);
      continue;
    }

    const openTime = normalizeTime(row.open_time);
    const closeTime = normalizeTime(row.close_time);
    if (!openTime || !closeTime) continue;

    defaults[index] = {
      day,
      is_closed: false,
      open_time: openTime,
      close_time: closeTime,
    };
    seenDays.add(day);
  }

  return defaults;
}
