import { createHash, randomUUID } from "node:crypto";
import type { calendar_v3 } from "googleapis";
import { getAuthenticatedClient, getCalendarService } from "./client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BusinessHours } from "@/types/database";
import {
  canUseFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import {
  assertBookingOperationallyAllowed,
  BookingOperationalStateError,
  isBookingOperationalBlockedError,
} from "./bookingOperational.server";

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

export interface BookingLinkage {
  contactId: string;
  conversationId: string;
  sourceMessageId: string;
}

interface BookingResult {
  eventId: string;
  summary: string;
  startTime: string;
  endTime: string;
}

export interface RecoverableCalendarBooking {
  id: string;
  business_id: string;
  contact_id: string;
  conversation_id: string;
  source_message_id: string;
  google_calendar_id: string;
  google_event_id: string | null;
  event_summary: string;
  request_fingerprint: string;
  operation_claim_token: string | null;
  operation_claimed_at: string | null;
  reconciliation_attempt_count: number;
  reconciliation_attempted_at: string | null;
  status: "pending" | "confirmed" | "failed" | "cancelled";
  starts_at: string;
  ends_at: string;
}

type CalendarBookingRow = RecoverableCalendarBooking;

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
  await assertBookingOperationallyAllowed(businessId);
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
    await assertBookingOperationallyAllowed(businessId);
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

  await assertBookingOperationallyAllowed(businessId);
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: minDate.toISOString(),
      timeMax: maxDate.toISOString(),
      timeZone: timezone,
      items: [{ id: calendarId }],
    },
  });
  await assertBookingOperationallyAllowed(businessId);

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
  timezone: string,
  linkage: BookingLinkage
): Promise<BookingResult> {
  await assertBookingOperationallyAllowed(businessId);
  await requireDirectBooking(businessId);
  const client = await getAuthenticatedClient(businessId);
  if (!client) {
    throw new Error("Google Calendar not connected");
  }

  const { data: tokenData, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", businessId)
    .single();

  if (tokenError) {
    throw new Error(
      `Could not load the connected Google Calendar: ${tokenError.message}`
    );
  }

  const selectedCalendarId = tokenData?.calendar_id || "primary";
  const duration = params.durationMinutes ?? SLOT_DURATION_MINUTES;

  const startDate = new Date(params.startTime);
  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
  validateBookingInput(params, linkage, startDate, endDate, duration);
  const requestedSummary = `${params.serviceName} - ${params.customerName}`;
  const requestFingerprint = bookingRequestFingerprint(
    params,
    timezone,
    startDate,
    endDate
  );

  const claimToken = randomUUID();
  const reservation = await reserveCalendarBooking(
    businessId,
    linkage,
    startDate,
    endDate,
    claimToken,
    selectedCalendarId,
    requestedSummary,
    requestFingerprint
  );
  assertBookingLinkage(reservation, businessId, linkage);
  const calendarId = reservation.google_calendar_id;
  const summary = reservation.event_summary;

  // Entry authorization applies to the invocation, but once that allowed
  // invocation has reserved work, durable/provider evidence must converge even
  // if a pause lands. A confirmed reservation is the idempotency result.
  if (reservation.status === "confirmed") {
    return bookingResultFromRow(reservation);
  }
  if (reservation.status !== "pending") {
    throw new Error(
      `Calendar booking ${reservation.id} cannot be created from status ${reservation.status}.`
    );
  }
  if (reservation.request_fingerprint !== requestFingerprint) {
    throw new Error(
      `Calendar booking ${reservation.id} was replayed with different booking details.`
    );
  }

  const calendar = getCalendarService(client);
  const reservedStartDate = new Date(reservation.starts_at);
  const reservedEndDate = new Date(reservation.ends_at);
  const recoveredEvent = await findReservedGoogleEvent(
    calendar,
    calendarId,
    reservation.id
  );
  if (recoveredEvent) {
    // Recovery is confirmation work, not a new provider mutation, so it stays
    // ungated after this invocation crossed its entry/reservation boundary.
    const recoveredEventId = requireGoogleEventId(
      recoveredEvent.id,
      reservation.id
    );
    const confirmed = await confirmCalendarBooking(
      businessId,
      reservation.id,
      recoveredEventId,
      eventDateTime(recoveredEvent.start?.dateTime, reservedStartDate),
      eventDateTime(recoveredEvent.end?.dateTime, reservedEndDate),
      requireBookingClaimToken(reservation)
    );
    assertBookingLinkage(confirmed, businessId, linkage, reservation);
    return bookingResultFromRow(confirmed);
  }
  if (reservation.operation_claim_token !== claimToken) {
    throw new CalendarBookingInProgressError(reservation.id);
  }

  const descriptionParts = [`Service: ${params.serviceName}`];
  if (params.customerPhone)
    descriptionParts.push(`Phone: ${params.customerPhone}`);
  if (params.customerEmail)
    descriptionParts.push(`Email: ${params.customerEmail}`);
  descriptionParts.push("Booked via AI assistant");

  const requestBody: Record<string, unknown> = {
    id: googleEventIdForBooking(reservation.id),
    summary,
    description: descriptionParts.join("\n"),
    start: {
      dateTime: formatLocalDateTime(reservedStartDate),
      timeZone: timezone,
    },
    end: {
      dateTime: formatLocalDateTime(reservedEndDate),
      timeZone: timezone,
    },
    reminders: {
      useDefault: true,
    },
    extendedProperties: {
      private: {
        simplassist_booking_id: reservation.id,
        simplassist_business_id: businessId,
        simplassist_contact_id: linkage.contactId,
        simplassist_conversation_id: linkage.conversationId,
        simplassist_source_message_id: linkage.sourceMessageId,
      },
    },
  };

  // Add customer as attendee so Google sends them a calendar invite
  if (params.customerEmail) {
    requestBody.attendees = [{ email: params.customerEmail }];
  }

  try {
    await assertBookingOperationallyAllowed(businessId);
  } catch (error) {
    if (!isBookingOperationalBlockedError(error)) throw error;

    const stopped = await stopCalendarBookingBeforeProviderSubmission(
      reservation,
      claimToken,
    );
    if (stopped.status === "confirmed") {
      assertBookingLinkage(stopped, businessId, linkage, reservation);
      return bookingResultFromRow(stopped);
    }
    throw error;
  }

  let event;
  try {
    event = await calendar.events.insert({
      calendarId,
      sendUpdates: "all",
      requestBody,
    });
  } catch (error) {
    const recoveredAfterError = await recoverAfterGoogleInsertError(
      calendar,
      reservation
    );
    if (recoveredAfterError) {
      const confirmed = await confirmRecoveredCalendarBooking(
        reservation,
        recoveredAfterError
      );
      assertBookingLinkage(confirmed, businessId, linkage, reservation);
      return bookingResultFromRow(confirmed);
    }
    if (isDefinitiveGoogleInsertFailure(error)) {
      await markCalendarBookingFailedBestEffort(
        businessId,
        reservation.id,
        claimToken,
        error
      );
    }
    throw error;
  }

  // From this point on Google may have created the event. Never mark the local
  // reservation failed: a retry can find it by the private booking ID and
  // finish the local confirmation without creating a duplicate event.
  const eventId = requireGoogleEventId(event.data.id, reservation.id);
  const confirmed = await confirmCalendarBooking(
    businessId,
    reservation.id,
    eventId,
    eventDateTime(event.data.start?.dateTime, reservedStartDate),
    eventDateTime(event.data.end?.dateTime, reservedEndDate),
    claimToken
  );

  assertBookingLinkage(confirmed, businessId, linkage, reservation);
  return bookingResultFromRow(confirmed);
}

function validateBookingInput(
  params: BookingParams,
  linkage: BookingLinkage,
  startDate: Date,
  endDate: Date,
  durationMinutes: number
): void {
  if (!params.customerName.trim()) {
    throw new Error("Customer name is required to create a booking.");
  }
  if (!params.serviceName.trim()) {
    throw new Error("Service name is required to create a booking.");
  }
  if (
    !Number.isFinite(startDate.getTime()) ||
    !Number.isFinite(durationMinutes) ||
    durationMinutes <= 0 ||
    !Number.isFinite(endDate.getTime()) ||
    endDate <= startDate
  ) {
    throw new Error("A valid booking start time and duration are required.");
  }
  if (
    !linkage?.contactId?.trim() ||
    !linkage.conversationId?.trim() ||
    !linkage.sourceMessageId?.trim()
  ) {
    throw new Error(
      "Contact, conversation, and source message linkage are required."
    );
  }
}

function bookingRequestFingerprint(
  params: BookingParams,
  timezone: string,
  startDate: Date,
  endDate: Date
): string {
  const canonicalPayload = {
    customerName: params.customerName.normalize("NFKC").trim(),
    customerPhone:
      params.customerPhone?.normalize("NFKC").trim() || null,
    customerEmail:
      params.customerEmail?.normalize("NFKC").trim().toLowerCase() || null,
    serviceName: params.serviceName.normalize("NFKC").trim(),
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    timezone: timezone.trim(),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonicalPayload))
    .digest("hex");
}

async function reserveCalendarBooking(
  businessId: string,
  linkage: BookingLinkage,
  startDate: Date,
  endDate: Date,
  claimToken: string,
  googleCalendarId: string,
  eventSummary: string,
  requestFingerprint: string
): Promise<CalendarBookingRow> {
  const { data, error } = await supabaseAdmin.rpc("reserve_calendar_booking", {
    p_business_id: businessId,
    p_contact_id: linkage.contactId,
    p_conversation_id: linkage.conversationId,
    p_source_message_id: linkage.sourceMessageId,
    p_starts_at: startDate.toISOString(),
    p_ends_at: endDate.toISOString(),
    p_claim_token: claimToken,
    p_google_calendar_id: googleCalendarId,
    p_event_summary: eventSummary,
    p_request_fingerprint: requestFingerprint,
  });
  if (error) {
    await assertBookingOperationallyAllowed(businessId);
    throw new Error(`Could not reserve calendar booking: ${error.message}`);
  }
  return requireCalendarBookingRow(data, "reserve");
}

async function stopCalendarBookingBeforeProviderSubmission(
  reservation: CalendarBookingRow,
  claimToken: string,
): Promise<CalendarBookingRow> {
  let result: { data: unknown; error: { message?: unknown } | null };
  try {
    result = await supabaseAdmin.rpc("fail_calendar_booking", {
      p_business_id: reservation.business_id,
      p_booking_id: reservation.id,
      p_claim_token: claimToken,
      p_failure_reason:
        "Booking was blocked before Google Calendar submission.",
    });
  } catch (error) {
    throw bookingCleanupError(reservation, error);
  }

  if (result.error) {
    throw bookingCleanupError(reservation, result.error);
  }

  let stopped: CalendarBookingRow;
  try {
    stopped = requireCalendarBookingRow(result.data, "fail");
    assertBookingLinkage(
      stopped,
      reservation.business_id,
      {
        contactId: reservation.contact_id,
        conversationId: reservation.conversation_id,
        sourceMessageId: reservation.source_message_id,
      },
      reservation,
    );
  } catch (error) {
    throw bookingCleanupError(reservation, error);
  }

  const failedCleanly =
    stopped.status === "failed" &&
    stopped.google_event_id === null &&
    stopped.operation_claim_token === null &&
    stopped.operation_claimed_at === null;
  const concurrentlyConfirmed =
    stopped.status === "confirmed" &&
    Boolean(stopped.google_event_id) &&
    stopped.operation_claim_token === null &&
    stopped.operation_claimed_at === null;
  if (!failedCleanly && !concurrentlyConfirmed) {
    throw bookingCleanupError(reservation);
  }
  return stopped;
}

function bookingCleanupError(
  reservation: CalendarBookingRow,
  cause?: unknown,
): BookingOperationalStateError {
  return new BookingOperationalStateError({
    businessId: reservation.business_id,
    code: "booking_cleanup_failed",
    message: `Could not safely stop calendar booking ${reservation.id} before provider submission.`,
    cause,
  });
}

async function confirmCalendarBooking(
  businessId: string,
  bookingId: string,
  googleEventId: string,
  startsAt: string,
  endsAt: string,
  claimToken: string
): Promise<CalendarBookingRow> {
  const { data, error } = await supabaseAdmin.rpc("confirm_calendar_booking", {
    p_business_id: businessId,
    p_booking_id: bookingId,
    p_google_event_id: googleEventId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_claim_token: claimToken,
  });
  if (error) {
    throw new Error(`Could not confirm calendar booking: ${error.message}`);
  }
  return requireCalendarBookingRow(data, "confirm");
}

function requireCalendarBookingRow(
  data: unknown,
  operation: "reserve" | "confirm" | "fail"
): CalendarBookingRow {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as CalendarBookingRow).id !== "string" ||
    typeof (candidate as CalendarBookingRow).business_id !== "string" ||
    typeof (candidate as CalendarBookingRow).contact_id !== "string" ||
    typeof (candidate as CalendarBookingRow).conversation_id !== "string" ||
    typeof (candidate as CalendarBookingRow).source_message_id !== "string" ||
    typeof (candidate as CalendarBookingRow).google_calendar_id !== "string" ||
    !(candidate as CalendarBookingRow).google_calendar_id.trim() ||
    typeof (candidate as CalendarBookingRow).event_summary !== "string" ||
    !(candidate as CalendarBookingRow).event_summary.trim() ||
    typeof (candidate as CalendarBookingRow).request_fingerprint !==
      "string" ||
    !/^[0-9a-f]{64}$/.test(
      (candidate as CalendarBookingRow).request_fingerprint
    ) ||
    !["pending", "confirmed", "failed", "cancelled"].includes(
      (candidate as CalendarBookingRow).status
    ) ||
    !(
      (candidate as CalendarBookingRow).google_event_id === null ||
      typeof (candidate as CalendarBookingRow).google_event_id === "string"
    ) ||
    !(
      (candidate as CalendarBookingRow).operation_claim_token === null ||
      typeof (candidate as CalendarBookingRow).operation_claim_token ===
        "string"
    ) ||
    !(
      (candidate as CalendarBookingRow).operation_claimed_at === null ||
      typeof (candidate as CalendarBookingRow).operation_claimed_at ===
        "string"
    ) ||
    !Number.isSafeInteger(
      (candidate as CalendarBookingRow).reconciliation_attempt_count
    ) ||
    (candidate as CalendarBookingRow).reconciliation_attempt_count < 0 ||
    !(
      (candidate as CalendarBookingRow).reconciliation_attempted_at === null ||
      typeof (candidate as CalendarBookingRow).reconciliation_attempted_at ===
        "string"
    ) ||
    typeof (candidate as CalendarBookingRow).starts_at !== "string" ||
    typeof (candidate as CalendarBookingRow).ends_at !== "string"
  ) {
    throw new Error(
      `Calendar booking ${operation} returned an invalid booking row.`
    );
  }
  return candidate as CalendarBookingRow;
}

function assertBookingLinkage(
  booking: CalendarBookingRow,
  businessId: string,
  linkage: BookingLinkage,
  expectedReservation?: CalendarBookingRow
): void {
  if (
    booking.business_id !== businessId ||
    booking.contact_id !== linkage.contactId ||
    booking.conversation_id !== linkage.conversationId ||
    booking.source_message_id !== linkage.sourceMessageId ||
    (expectedReservation !== undefined &&
      (booking.id !== expectedReservation.id ||
        booking.google_calendar_id !==
          expectedReservation.google_calendar_id ||
        booking.event_summary !== expectedReservation.event_summary ||
        booking.request_fingerprint !==
          expectedReservation.request_fingerprint))
  ) {
    throw new Error(
      `Calendar booking ${booking.id} returned inconsistent tenant or linkage data.`
    );
  }
}

export class CalendarBookingInProgressError extends Error {
  constructor(readonly bookingId: string) {
    super(`Calendar booking ${bookingId} is already being created.`);
    this.name = "CalendarBookingInProgressError";
  }
}

function requireBookingClaimToken(booking: CalendarBookingRow): string {
  if (!booking.operation_claim_token) {
    throw new Error(
      `Calendar booking ${booking.id} has no active operation claim.`
    );
  }
  return booking.operation_claim_token;
}

async function findReservedGoogleEvent(
  calendar: ReturnType<typeof getCalendarService>,
  calendarId: string,
  bookingId: string
): Promise<calendar_v3.Schema$Event | null> {
  const deterministicEventId = googleEventIdForBooking(bookingId);
  try {
    const direct = await calendar.events.get({
      calendarId,
      eventId: deterministicEventId,
    });
    assertGoogleEventBookingId(direct.data, bookingId);
    if (direct.data.status !== "cancelled") return direct.data;
  } catch (error) {
    if (!isGoogleEventNotFound(error)) throw error;
  }

  const response = await calendar.events.list({
    calendarId,
    maxResults: 1,
    showDeleted: false,
    singleEvents: true,
    privateExtendedProperty: [`simplassist_booking_id=${bookingId}`],
  });
  const found =
    response.data.items?.find(
      (event) => Boolean(event.id) && event.status !== "cancelled"
    ) ?? null;
  if (found) assertGoogleEventBookingId(found, bookingId);
  return found;
}

function googleEventIdForBooking(bookingId: string): string {
  const eventId = bookingId.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-v]{5,1024}$/.test(eventId)) {
    throw new Error(
      `Calendar booking ${bookingId} cannot form a valid Google event ID.`
    );
  }
  return eventId;
}

function assertGoogleEventBookingId(
  event: calendar_v3.Schema$Event,
  bookingId: string
): void {
  if (
    event.extendedProperties?.private?.simplassist_booking_id !== bookingId
  ) {
    throw new Error(
      `Google event ${event.id ?? "(missing id)"} does not belong to booking ${bookingId}.`
    );
  }
}

function isGoogleEventNotFound(error: unknown): boolean {
  const status = googleErrorStatus(error);
  return status === 404 || status === 410;
}

function googleErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [
    candidate.code,
    candidate.status,
    candidate.response?.status,
  ]) {
    const parsed =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number(value)
          : Number.NaN;
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function isDefinitiveGoogleInsertFailure(error: unknown): boolean {
  const status = googleErrorStatus(error);
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 409 &&
    status !== 429
  );
}

async function recoverAfterGoogleInsertError(
  calendar: ReturnType<typeof getCalendarService>,
  booking: CalendarBookingRow
): Promise<calendar_v3.Schema$Event | null> {
  try {
    return await findReservedGoogleEvent(
      calendar,
      booking.google_calendar_id,
      booking.id
    );
  } catch {
    console.error(
      `[calendar] Could not reconcile ambiguous Google insert for booking ${booking.id}`
    );
    return null;
  }
}

async function confirmRecoveredCalendarBooking(
  booking: CalendarBookingRow,
  event: calendar_v3.Schema$Event
): Promise<CalendarBookingRow> {
  return confirmCalendarBooking(
    booking.business_id,
    booking.id,
    requireGoogleEventId(event.id, booking.id),
    eventDateTime(event.start?.dateTime, new Date(booking.starts_at)),
    eventDateTime(event.end?.dateTime, new Date(booking.ends_at)),
    requireBookingClaimToken(booking)
  );
}

export async function recoverCalendarBookingConfirmation(
  booking: RecoverableCalendarBooking
): Promise<boolean> {
  const parsed = requireCalendarBookingRow(booking, "reserve");
  if (parsed.status === "confirmed") return true;
  if (parsed.status !== "pending") {
    throw new Error(
      `Calendar booking ${parsed.id} is not pending confirmation.`
    );
  }
  requireBookingClaimToken(parsed);

  const client = await getAuthenticatedClient(parsed.business_id);
  if (!client) {
    throw new Error(
      `Google Calendar is not connected for booking ${parsed.id}.`
    );
  }
  const event = await findReservedGoogleEvent(
    getCalendarService(client),
    parsed.google_calendar_id,
    parsed.id
  );
  if (!event) return false;

  const confirmed = await confirmRecoveredCalendarBooking(parsed, event);
  assertBookingLinkage(
    confirmed,
    parsed.business_id,
    {
      contactId: parsed.contact_id,
      conversationId: parsed.conversation_id,
      sourceMessageId: parsed.source_message_id,
    },
    parsed
  );
  return true;
}

export async function claimCalendarBookingReconciliation(
  booking: RecoverableCalendarBooking
): Promise<RecoverableCalendarBooking> {
  const parsed = requireCalendarBookingRow(booking, "reserve");
  const { data, error } = await supabaseAdmin.rpc(
    "claim_calendar_booking_reconciliation",
    {
      p_business_id: parsed.business_id,
      p_booking_id: parsed.id,
      p_claim_token: requireBookingClaimToken(parsed),
    }
  );
  if (error) {
    throw new Error(
      `Could not claim calendar booking ${parsed.id} for reconciliation: ${error.message}`
    );
  }

  const claimed = requireCalendarBookingRow(data, "reserve");
  assertBookingLinkage(
    claimed,
    parsed.business_id,
    {
      contactId: parsed.contact_id,
      conversationId: parsed.conversation_id,
      sourceMessageId: parsed.source_message_id,
    },
    parsed
  );
  return claimed;
}

export async function failCalendarBookingRecovery(
  booking: RecoverableCalendarBooking
): Promise<RecoverableCalendarBooking["status"]> {
  const parsed = requireCalendarBookingRow(booking, "reserve");
  if (parsed.status !== "pending") return parsed.status;

  const { data, error } = await supabaseAdmin.rpc("fail_calendar_booking", {
    p_business_id: parsed.business_id,
    p_booking_id: parsed.id,
    p_claim_token: requireBookingClaimToken(parsed),
    p_failure_reason:
      "Google Calendar event was not found during booking reconciliation.",
  });
  if (error) {
    throw new Error(
      `Could not release missing calendar booking ${parsed.id}: ${error.message}`
    );
  }

  const released = requireCalendarBookingRow(data, "fail");
  assertBookingLinkage(
    released,
    parsed.business_id,
    {
      contactId: parsed.contact_id,
      conversationId: parsed.conversation_id,
      sourceMessageId: parsed.source_message_id,
    },
    parsed
  );
  return released.status;
}

function requireGoogleEventId(
  eventId: string | null | undefined,
  bookingId: string
): string {
  if (!eventId) {
    throw new Error(
      `Google Calendar did not return an event ID for booking ${bookingId}.`
    );
  }
  return eventId;
}

function eventDateTime(
  value: string | null | undefined,
  fallback: Date
): string {
  if (value && Number.isFinite(Date.parse(value))) return value;
  return fallback.toISOString();
}

function bookingResultFromRow(booking: CalendarBookingRow): BookingResult {
  if (booking.status !== "confirmed" || !booking.google_event_id) {
    throw new Error(
      `Calendar booking ${booking.id} did not return confirmed event state.`
    );
  }
  return {
    eventId: booking.google_event_id,
    summary: booking.event_summary,
    startTime: booking.starts_at,
    endTime: booking.ends_at,
  };
}

async function markCalendarBookingFailedBestEffort(
  businessId: string,
  bookingId: string,
  claimToken: string,
  cause: unknown
): Promise<void> {
  const failureReason =
    cause instanceof Error ? cause.message : "Google Calendar event creation failed";
  try {
    const { error } = await supabaseAdmin.rpc("fail_calendar_booking", {
      p_business_id: businessId,
      p_booking_id: bookingId,
      p_claim_token: claimToken,
      p_failure_reason: failureReason.slice(0, 1000),
    });
    if (error) {
      console.error(
        `[calendar] Failed to mark booking ${bookingId} failed: ${error.message}`
      );
    }
  } catch (error) {
    console.error(
      `[calendar] Failed to mark booking ${bookingId} failed:`,
      error
    );
  }
}
