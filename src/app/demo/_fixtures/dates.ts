/**
 * Pure date helpers for demo fixtures. Every helper takes the request-time
 * `now` (captured once in the server page) so a whole fixture set is built
 * from a single instant — timestamps serialize once and hydrate identically.
 *
 * Offsets used by fixtures sit mid-bucket (7m, 26m, 2h…) so the seconds
 * between server render and client hydration can never flip a timeAgo label.
 */

export const minutesAgo = (now: Date, n: number): string =>
  new Date(now.getTime() - n * 60_000).toISOString();

export const hoursAgo = (now: Date, n: number): string =>
  new Date(now.getTime() - n * 3_600_000).toISOString();

/** N days back at a fixed local time (default 10:00). */
export const daysAgo = (now: Date, n: number, hour = 10, minute = 0): string => {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/** hour:minute on a given day-of-the-current-month. */
export const atHourOnDay = (now: Date, dayOfMonth: number, hour: number, minute = 0): string =>
  new Date(now.getFullYear(), now.getMonth(), dayOfMonth, hour, minute).toISOString();

/**
 * Next occurrence of `weekday` (0=Sun…6=Sat) strictly after today, at
 * hour:minute. May land in next month near month-end — such events simply
 * don't render on the current month's grid, which is harmless.
 */
export const nextWeekday = (now: Date, weekday: number, hour: number, minute = 0): string => {
  const d = new Date(now);
  const delta = ((weekday - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + delta);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

/** Today at hour:minute (for the calendar's pre-selected day panel). */
export const todayAt = (now: Date, hour: number, minute = 0): string =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute).toISOString();
