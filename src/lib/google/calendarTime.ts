const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const HOUR_IN_MS = 60 * 60 * 1000;

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  if (typeof timeZone !== "string" || timeZone.trim() === "") {
    throw new RangeError("Business timezone is required");
  }

  const cached = formatterCache.get(timeZone);
  if (cached) return cached;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    // Some Intl implementations defer timezone validation until formatting.
    formatter.format(new Date(0));
    formatterCache.set(timeZone, formatter);
    return formatter;
  } catch {
    throw new RangeError(`Invalid business timezone: "${timeZone}"`);
  }
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function parseWallTime(date: string, time: string): WallTimeParts {
  const dateMatch = DATE_PATTERN.exec(date);
  if (!dateMatch) {
    throw new RangeError(
      `Business-local date must use YYYY-MM-DD: "${date}"`,
    );
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new RangeError(`Invalid business-local date: "${date}"`);
  }

  const timeMatch = TIME_PATTERN.exec(time);
  if (!timeMatch) {
    throw new RangeError(
      `Business-local time must use HH:mm or HH:mm:ss: "${time}"`,
    );
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new RangeError(`Invalid business-local time: "${time}"`);
  }

  return { year, month, day, hour, minute, second };
}

function utcEpoch(parts: WallTimeParts): number {
  const instant = new Date(0);
  instant.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  instant.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return instant.getTime();
}

function partsAtInstant(
  formatter: Intl.DateTimeFormat,
  epoch: number,
): WallTimeParts {
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(epoch))) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

function partsEqual(left: WallTimeParts, right: WallTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function offsetAtInstant(
  formatter: Intl.DateTimeFormat,
  epoch: number,
): number {
  return utcEpoch(partsAtInstant(formatter, epoch)) - epoch;
}

/**
 * Converts a business-local wall time into an absolute instant.
 *
 * A nonexistent wall time during a forward DST transition is rejected. When a
 * backward transition repeats a wall time, the earlier matching instant wins.
 */
export function businessWallTimeToInstant(
  date: string,
  time: string,
  timeZone: string,
): Date {
  const requested = parseWallTime(date, time);
  const formatter = getFormatter(timeZone);
  const wallEpoch = utcEpoch(requested);
  const offsets = new Set<number>();

  // Probe both sides of any nearby timezone transition so duplicated and
  // skipped wall times consider every offset that can apply to this date.
  for (let hour = -36; hour <= 36; hour += 6) {
    offsets.add(offsetAtInstant(formatter, wallEpoch + hour * HOUR_IN_MS));
  }

  // Also converge from the wall-time-shaped epoch. This covers zones whose
  // absolute offset places the matching instant between the probes above.
  let candidateEpoch = wallEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = offsetAtInstant(formatter, candidateEpoch);
    offsets.add(offset);
    const nextCandidate = wallEpoch - offset;
    if (nextCandidate === candidateEpoch) break;
    candidateEpoch = nextCandidate;
  }

  const matches = Array.from(offsets)
    .map((offset) => wallEpoch - offset)
    .filter((epoch) => partsEqual(partsAtInstant(formatter, epoch), requested))
    .sort((left, right) => left - right);

  if (matches.length === 0) {
    const normalizedTime = `${String(requested.hour).padStart(2, "0")}:${String(requested.minute).padStart(2, "0")}:${String(requested.second).padStart(2, "0")}`;
    throw new RangeError(
      `Business-local time ${date}T${normalizedTime} does not exist in ${timeZone} because of a daylight-saving time transition`,
    );
  }

  return new Date(matches[0]);
}
