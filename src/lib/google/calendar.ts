import { getAuthenticatedClient, getCalendarService } from "./client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BusinessHours } from "@/types/database";
import {
  canUseFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

const SLOT_DURATION_MINUTES = 30;

/**
 * Attempts to parse relative date strings into YYYY-MM-DD format.
 * Safety net in case the AI passes a non-ISO date string.
 */
function normalizeDate(input: string): string {
  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  const lower = input.toLowerCase().trim();
  const now = new Date();

  // Handle common relative dates
  if (lower === "today") {
    return formatYMD(now);
  }
  if (lower === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatYMD(d);
  }

  // Handle day names: "friday", "this friday", "next friday", etc.
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const isNext = lower.startsWith("next ");
  const cleaned = lower.replace(/^(this |next )/, "");
  const dayIndex = dayNames.indexOf(cleaned);

  if (dayIndex !== -1) {
    const today = now.getDay();
    let daysAhead = dayIndex - today;
    if (daysAhead <= 0) daysAhead += 7;
    if (isNext && daysAhead <= 7) daysAhead += 7;
    const d = new Date(now);
    d.setDate(d.getDate() + daysAhead);
    return formatYMD(d);
  }

  // Try native Date parsing as last resort (handles "April 11, 2026", "4/11/2026", etc.)
  const parsed = new Date(input);
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000) {
    return formatYMD(parsed);
  }

  // Return original — will likely fail downstream, but at least we tried
  return input;
}

function formatYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format as YYYY-MM-DDTHH:MM:SS (no Z suffix) for Google Calendar event creation */
function formatLocalDateTime(d: Date): string {
  return `${formatYMD(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

interface BookingParams {
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  serviceName: string;
  startTime: string; // ISO 8601
  durationMinutes?: number;
}

interface BookingResult {
  eventId: string;
  summary: string;
  startTime: string;
  endTime: string;
}

export class DirectBookingNotEntitledError extends Error {
  constructor() {
    super("Direct booking is not available for this subscription.");
    this.name = "DirectBookingNotEntitledError";
  }
}

async function requireDirectBooking(businessId: string): Promise<void> {
  const entitlements = await resolveBusinessEntitlements(businessId);
  if (!canUseFeature(entitlements, "direct_booking")) {
    throw new DirectBookingNotEntitledError();
  }
}

export async function checkAvailability(
  businessId: string,
  date: string, // YYYY-MM-DD
  timezone: string
): Promise<string[]> {
  await requireDirectBooking(businessId);
  const client = await getAuthenticatedClient(businessId);
  if (!client) {
    throw new Error("Google Calendar not connected");
  }

  const calendar = getCalendarService(client);

  // Get the calendar ID for this business
  const { data: tokenData } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", businessId)
    .single();

  const calendarId = tokenData?.calendar_id || "primary";

  // Normalize date in case AI passes a relative date string
  const normalizedDate = normalizeDate(date);

  // Get business hours for this day
  const dayDate = new Date(`${normalizedDate}T12:00:00`);
  const dayOfWeek = dayDate.getDay();

  const { data: hoursData } = await supabaseAdmin
    .from("business_hours")
    .select("*")
    .eq("business_id", businessId)
    .eq("day_of_week", dayOfWeek)
    .single();

  const hours = hoursData as BusinessHours | null;
  if (!hours || hours.is_closed) {
    return [];
  }

  // Query Google Calendar for busy times
  // Build Date objects from business hours and convert to ISO for Google API
  const [openH, openM] = hours.open_time.split(":").map(Number);
  const [closeH, closeM] = hours.close_time.split(":").map(Number);

  const minDate = new Date(`${normalizedDate}T12:00:00`);
  minDate.setHours(openH, openM, 0, 0);
  const maxDate = new Date(`${normalizedDate}T12:00:00`);
  maxDate.setHours(closeH, closeM, 0, 0);

  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: minDate.toISOString(),
      timeMax: maxDate.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });

  const busySlots =
    freeBusy.data.calendars?.[calendarId]?.busy || [];

  // Generate all possible slots during business hours
  const slots: string[] = [];
  const [openHour, openMin] = hours.open_time.split(":").map(Number);
  const [closeHour, closeMin] = hours.close_time.split(":").map(Number);

  const openMinutes = openHour * 60 + openMin;
  const closeMinutes = closeHour * 60 + closeMin;

  for (
    let m = openMinutes;
    m + SLOT_DURATION_MINUTES <= closeMinutes;
    m += SLOT_DURATION_MINUTES
  ) {
    const slotStart = new Date(`${normalizedDate}T00:00:00`);
    slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0);

    const slotEnd = new Date(slotStart);
    slotEnd.setMinutes(slotEnd.getMinutes() + SLOT_DURATION_MINUTES);

    // Check if this slot overlaps with any busy period
    const isBusy = busySlots.some((busy) => {
      const busyStart = new Date(busy.start!).getTime();
      const busyEnd = new Date(busy.end!).getTime();
      return slotStart.getTime() < busyEnd && slotEnd.getTime() > busyStart;
    });

    if (!isBusy) {
      // Format as readable time
      const hour = Math.floor(m / 60);
      const min = m % 60;
      const period = hour >= 12 ? "PM" : "AM";
      const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
      const displayMin = min === 0 ? "00" : String(min).padStart(2, "0");
      slots.push(`${displayHour}:${displayMin} ${period}`);
    }
  }

  return slots;
}

export async function createBooking(
  businessId: string,
  params: BookingParams,
  timezone: string
): Promise<BookingResult> {
  await requireDirectBooking(businessId);
  const client = await getAuthenticatedClient(businessId);
  if (!client) {
    throw new Error("Google Calendar not connected");
  }

  const calendar = getCalendarService(client);

  const { data: tokenData } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", businessId)
    .single();

  const calendarId = tokenData?.calendar_id || "primary";
  const duration = params.durationMinutes || SLOT_DURATION_MINUTES;

  const startDate = new Date(params.startTime);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  const descriptionParts = [`Service: ${params.serviceName}`];
  if (params.customerPhone)
    descriptionParts.push(`Phone: ${params.customerPhone}`);
  if (params.customerEmail)
    descriptionParts.push(`Email: ${params.customerEmail}`);
  descriptionParts.push("Booked via SimplAssist AI");

  const requestBody: Record<string, unknown> = {
    summary: `${params.serviceName} - ${params.customerName}`,
    description: descriptionParts.join("\n"),
    start: {
      dateTime: formatLocalDateTime(startDate),
      timeZone: timezone,
    },
    end: {
      dateTime: formatLocalDateTime(endDate),
      timeZone: timezone,
    },
    reminders: {
      useDefault: true,
    },
  };

  // Add customer as attendee so Google sends them a calendar invite
  if (params.customerEmail) {
    requestBody.attendees = [{ email: params.customerEmail }];
  }

  const event = await calendar.events.insert({
    calendarId,
    sendUpdates: "all",
    requestBody,
  });

  return {
    eventId: event.data.id!,
    summary: event.data.summary!,
    startTime: event.data.start?.dateTime || params.startTime,
    endTime: event.data.end?.dateTime || endDate.toISOString(),
  };
}
