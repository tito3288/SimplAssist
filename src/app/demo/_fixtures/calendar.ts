/**
 * Calendar fixtures for /demo/calendar — a busy month at Manny's Plumbing.
 *
 * ~28 deterministic events for the current month (no Math.random — the same
 * day always gets the same bookings, so screenshots are reproducible):
 * - AI bookings mimic EXACTLY what createBooking writes to Google Calendar
 *   (src/lib/google/calendar.ts): title "${service} - ${customer}", description
 *   "Service: …\nPhone: …[\nEmail: …]\nBooked via SimplAssist AI". The
 *   day-detail card clamps descriptions to 2 lines, so "Booked via
 *   SimplAssist AI" lands visibly for phone-only bookings.
 * - Today ALWAYS gets exactly 4 bookings — selectedDate initializes to today,
 *   so the day-detail sidebar looks alive on first paint.
 * - A few continuity events match the /demo/conversations threads (Sarah M.'s
 *   Tuesday water heater repair, Maria G.'s drain cleaning, …). Ones landing
 *   in next month near month-end simply don't render — harmless.
 * - 4 manual-looking events (no AI description) for realism.
 */

import type { CalendarEvent } from "@/components/calendar/CalendarView";
import { atHourOnDay, nextWeekday, todayAt } from "./dates";

/** [service, customer, phone10, email?] rotated across weekday slots. */
const AI_JOBS: Array<[string, string, string, string?]> = [
  ["Drain cleaning", "Maria G.", "5125550152"],
  ["Water heater repair", "Luis O.", "5125550183"],
  ["Leak detection", "Priya P.", "5125550146"],
  ["Toilet install", "Hannah S.", "5125550129"],
  ["Garbage disposal replacement", "Tom C.", "5125550138"],
  ["Sewer camera inspection", "Angela B.", "5125550195"],
  ["Faucet repair", "Derek W.", "5125550115"],
  ["Repipe estimate", "Rob J.", "5125550171"],
  ["Water softener install", "Emily T.", "5125550142", "emily.tran@utexas.edu"],
  ["Gas line pressure test", "Sam R.", "5125550167"],
  ["Tankless flush", "Dan K.", "5125550176", "dan.k@gmail.com"],
  ["Shower valve replacement", "Nicole F.", "5125550158"],
  ["Emergency call-out", "Greg M.", "5125550191"],
  ["Backflow test", "Olivia H.", "5125550103"],
];

/** [startHour, startMinute, durationMinutes] */
const SLOTS: Array<[number, number, number]> = [
  [8, 30, 90],
  [10, 30, 60],
  [13, 0, 90],
  [15, 30, 60],
];

/** Mon..Fri booking counts — busy but plausible for one plumber. */
const WEEKDAY_PATTERN = [3, 2, 4, 2, 3];

function fmtPhone(p: string): string {
  return `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}`;
}

function aiEvent(
  id: string,
  job: [string, string, string, string?],
  start: string,
  durationMin: number
): CalendarEvent {
  const [service, customer, phone, email] = job;
  const lines = [`Service: ${service}`, `Phone: ${fmtPhone(phone)}`];
  if (email) lines.push(`Email: ${email}`);
  lines.push("Booked via SimplAssist AI");
  return {
    id,
    title: `${service} - ${customer}`,
    start,
    end: new Date(new Date(start).getTime() + durationMin * 60_000).toISOString(),
    allDay: false,
    description: lines.join("\n"),
  };
}

function plainEvent(
  id: string,
  title: string,
  start: string,
  durationMin: number,
  allDay = false
): CalendarEvent {
  return {
    id,
    title,
    start,
    end: allDay ? start : new Date(new Date(start).getTime() + durationMin * 60_000).toISOString(),
    allDay,
    description: null,
  };
}

export function buildCalendarEvents(now: Date): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();
  let jobIndex = 0;
  let saturdays = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const weekday = new Date(now.getFullYear(), now.getMonth(), day).getDay();
    if (weekday === 0) continue; // closed Sundays
    if (day === today) continue; // today gets its own curated set below

    let count: number;
    if (weekday === 6) {
      // Two Saturday mornings a month
      saturdays += 1;
      if (saturdays > 2) continue;
      count = 1;
    } else {
      count = WEEKDAY_PATTERN[weekday - 1];
      // Thin out a couple of weekdays so the month breathes
      if (day % 9 === 0) count = Math.max(1, count - 2);
    }

    for (let slot = 0; slot < count; slot++) {
      const [h, m, dur] = SLOTS[slot % SLOTS.length];
      events.push(
        aiEvent(
          `demo-evt-${day}-${slot}`,
          AI_JOBS[jobIndex % AI_JOBS.length],
          atHourOnDay(now, day, h, m),
          dur
        )
      );
      jobIndex += 1;
    }
  }

  // Today — exactly 4 bookings, fills the day-detail panel on first paint
  events.push(
    aiEvent("demo-today-1", ["Faucet repair", "Carlos R.", "5125550107"], todayAt(now, 8, 30), 60),
    aiEvent("demo-today-2", ["Water heater estimate", "Rob J.", "5125550171"], todayAt(now, 10, 30), 60),
    aiEvent("demo-today-3", ["Toilet install", "Emily T.", "5125550142"], todayAt(now, 13, 0), 90),
    aiEvent(
      "demo-today-4",
      ["Garbage disposal replacement", "Tom C.", "5125550138"],
      todayAt(now, 15, 30),
      60
    )
  );

  // Continuity with the /demo/conversations threads
  events.push(
    aiEvent(
      "demo-sarah",
      ["Water heater repair", "Sarah M.", "5125550134"],
      nextWeekday(now, 2, 9, 0),
      90
    ),
    aiEvent("demo-maria", ["Drain cleaning", "Maria G.", "5125550152"], nextWeekday(now, (now.getDay() + 1) % 7, 8, 30), 60),
    aiEvent("demo-angela", ["Sewer camera inspection", "Angela B.", "5125550195"], nextWeekday(now, 1, 11, 0), 60),
    aiEvent("demo-dan", ["Tankless flush", "Dan K.", "5125550176", "dan.k@gmail.com"], nextWeekday(now, 4, 14, 0), 60)
  );

  // Manual-looking events for realism (no AI description)
  events.push(
    plainEvent("demo-supply", "Supply run - Ferguson", nextWeekday(now, 2, 7, 30), 60),
    plainEvent("demo-meeting", "Team meeting", atHourOnDay(now, 2, 7, 0), 45),
    plainEvent("demo-truck", "Truck 2 maintenance", nextWeekday(now, 5, 16, 0), 60),
    plainEvent("demo-pto", "Miguel - PTO", nextWeekday(now, 4, 0, 0), 0, true)
  );

  return events;
}
