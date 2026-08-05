import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedClient, getCalendarService } from "@/lib/google/client";
import { requireAuthenticatedFeature } from "@/lib/google/routeAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import {
  assertBookingOperationallyAllowed,
  isBookingOperationalBlockedError,
  isBookingOperationalStateError,
} from "@/lib/google/bookingOperational.server";
import { isOperationalControlsResolutionError } from "@/lib/account/operationalControls.server";

type LinkedCalendarBooking = {
  id: string;
  google_calendar_id: string;
};

function isGoogleEventNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  return (
    candidate.code === 404 ||
    candidate.code === "404" ||
    candidate.response?.status === 404
  );
}

async function findLinkedCalendarBooking(
  businessId: string,
  googleEventId: string,
  selectedCalendarId: string
): Promise<LinkedCalendarBooking | null> {
  const { data, error } = await supabaseAdmin
    .from("calendar_bookings")
    .select("id,google_calendar_id")
    .eq("business_id", businessId)
    .eq("google_event_id", googleEventId)
    .limit(2);

  if (error) {
    throw new Error(
      `Could not resolve linked booking ${googleEventId}: ${error.message}`
    );
  }
  if (!Array.isArray(data)) {
    throw new Error(
      `Linked booking ${googleEventId} returned invalid query data.`
    );
  }
  if (data.length === 0) return null;
  const candidate =
    data.length === 1
      ? data[0]
      : data.find(
          (booking) =>
            booking?.google_calendar_id === selectedCalendarId
        );
  if (!candidate) {
    throw new Error(
      `Linked booking ${googleEventId} is ambiguous across calendars.`
    );
  }
  if (
    typeof candidate.id !== "string" ||
    !candidate.id ||
    typeof candidate.google_calendar_id !== "string" ||
    !candidate.google_calendar_id.trim()
  ) {
    throw new Error(
      `Linked booking ${googleEventId} returned invalid calendar data.`
    );
  }
  return candidate as LinkedCalendarBooking;
}

export async function GET(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params required" },
      { status: 400 }
    );
  }

  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return access.response;
  if (access.businessId !== workspace.access.business.id) {
    return workspaceChangedResponse();
  }

  const { data: token, error: tokenError } = await access.supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", access.businessId)
    .maybeSingle();

  if (tokenError) {
    console.error("[calendar/events] Token lookup failed:", tokenError);
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (!token) {
    return NextResponse.json({ connected: false });
  }

  try {
    const client = await getAuthenticatedClient(access.businessId);
    if (!client) {
      return NextResponse.json({ connected: false });
    }

    const calendar = getCalendarService(client);
    const calendarId = token.calendar_id || "primary";

    const response = await calendar.events.list({
      calendarId,
      timeMin: start,
      timeMax: end,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    });

    const events = (response.data.items ?? []).map((event) => {
      const allDay = !!event.start?.date;
      return {
        id: event.id ?? "",
        title: event.summary ?? "(No title)",
        start: event.start?.dateTime ?? event.start?.date ?? "",
        end: event.end?.dateTime ?? event.end?.date ?? "",
        allDay,
        description: event.description ?? null,
      };
    });

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[calendar/events] Error fetching events:", err);
    return NextResponse.json(
      { error: "Failed to fetch events" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  let body: { title?: string; description?: string; startTime?: string; endTime?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, startTime, endTime } = body;

  if (!title || !startTime || !endTime) {
    return NextResponse.json(
      { error: "title, startTime, and endTime are required" },
      { status: 400 }
    );
  }

  if (new Date(endTime) <= new Date(startTime)) {
    return NextResponse.json(
      { error: "endTime must be after startTime" },
      { status: 400 }
    );
  }

  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return access.response;
  if (access.businessId !== workspace.access.business.id) {
    return workspaceChangedResponse();
  }

  const entryOperationalResponse = await bookingCreationOperationalResponse(
    access.businessId
  );
  if (entryOperationalResponse) return entryOperationalResponse;

  const { data: token, error: tokenError } = await access.supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", access.businessId)
    .maybeSingle();

  if (tokenError) {
    console.error("[calendar/events] Token lookup failed:", tokenError);
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(access.businessId);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const calendarId = token.calendar_id || "primary";

    // Re-read immediately before the provider mutation so a stale browser or a
    // pause applied while Google authentication was resolving cannot create a
    // new commitment.
    const finalOperationalResponse = await bookingCreationOperationalResponse(
      access.businessId
    );
    if (finalOperationalResponse) return finalOperationalResponse;

    const event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: title,
        description: description || undefined,
        start: { dateTime: startTime },
        end: { dateTime: endTime },
        reminders: { useDefault: true },
      },
    });

    return NextResponse.json({
      event: {
        id: event.data.id ?? "",
        title: event.data.summary ?? title,
        start: event.data.start?.dateTime ?? startTime,
        end: event.data.end?.dateTime ?? endTime,
      },
    });
  } catch (err) {
    console.error("[calendar/events] Error creating event:", err);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  let body: {
    eventId?: string;
    title?: string;
    description?: string;
    startTime?: string;
    endTime?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { eventId, title, description, startTime, endTime } = body;

  if (!eventId) {
    return NextResponse.json(
      { error: "eventId is required" },
      { status: 400 }
    );
  }

  if (startTime && endTime && new Date(endTime) <= new Date(startTime)) {
    return NextResponse.json(
      { error: "endTime must be after startTime" },
      { status: 400 }
    );
  }

  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return access.response;
  if (access.businessId !== workspace.access.business.id) {
    return workspaceChangedResponse();
  }

  const { data: token, error: tokenError } = await access.supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", access.businessId)
    .maybeSingle();

  if (tokenError) {
    console.error("[calendar/events] Token lookup failed:", tokenError);
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(access.businessId);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const selectedCalendarId = token.calendar_id || "primary";
    const linkedBooking = await findLinkedCalendarBooking(
      access.businessId,
      eventId,
      selectedCalendarId
    );
    const calendarId =
      linkedBooking?.google_calendar_id || selectedCalendarId;

    // Build only the fields that were provided
    const requestBody: Record<string, unknown> = {};
    if (title !== undefined) requestBody.summary = title;
    if (description !== undefined) requestBody.description = description;
    if (startTime) requestBody.start = { dateTime: startTime };
    if (endTime) requestBody.end = { dateTime: endTime };

    const event = await calendar.events.patch({
      calendarId,
      eventId,
      sendUpdates: "all",
      requestBody,
    });

    const startsAt =
      event.data.start?.dateTime ?? event.data.start?.date ?? startTime;
    const endsAt = event.data.end?.dateTime ?? event.data.end?.date ?? endTime;
    if (!startsAt || !endsAt) {
      throw new Error(
        `Google Calendar event ${eventId} did not return complete timing data.`
      );
    }

    if (linkedBooking) {
      const { data: updatedBookings, error: bookingUpdateError } =
        await supabaseAdmin
          .from("calendar_bookings")
          .update({
            starts_at: startsAt,
            ends_at: endsAt,
            updated_at: new Date().toISOString(),
          })
          .eq("business_id", access.businessId)
          .eq("id", linkedBooking.id)
          .select("id");

      if (
        bookingUpdateError ||
        !Array.isArray(updatedBookings) ||
        updatedBookings.length !== 1
      ) {
        throw new Error(
          `Could not synchronize linked booking ${eventId}: ${
            bookingUpdateError?.message ?? "booking row changed concurrently"
          }`
        );
      }
    }

    return NextResponse.json({
      event: {
        id: event.data.id ?? "",
        title: event.data.summary ?? "",
        start: event.data.start?.dateTime ?? event.data.start?.date ?? "",
        end: event.data.end?.dateTime ?? event.data.end?.date ?? "",
        description: event.data.description ?? null,
      },
    });
  } catch (err) {
    console.error("[calendar/events] Error updating event:", err);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const { searchParams } = request.nextUrl;
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return NextResponse.json(
      { error: "eventId query param required" },
      { status: 400 }
    );
  }

  const access = await requireAuthenticatedFeature("calendar");
  if (!access.ok) return access.response;
  if (access.businessId !== workspace.access.business.id) {
    return workspaceChangedResponse();
  }

  const { data: token, error: tokenError } = await access.supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", access.businessId)
    .maybeSingle();

  if (tokenError) {
    console.error("[calendar/events] Token lookup failed:", tokenError);
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(access.businessId);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const selectedCalendarId = token.calendar_id || "primary";
    const linkedBooking = await findLinkedCalendarBooking(
      access.businessId,
      eventId,
      selectedCalendarId
    );
    const calendarId =
      linkedBooking?.google_calendar_id || selectedCalendarId;

    try {
      await calendar.events.delete({
        calendarId,
        eventId,
        sendUpdates: "all",
      });
    } catch (error) {
      if (!isGoogleEventNotFound(error)) throw error;
      console.warn(
        `[calendar/events] Google event ${eventId} was already deleted; reconciling local booking.`
      );
    }

    if (linkedBooking) {
      const cancelledAt = new Date().toISOString();
      const { data: updatedBookings, error: bookingUpdateError } =
        await supabaseAdmin
          .from("calendar_bookings")
          .update({
            status: "cancelled",
            cancelled_at: cancelledAt,
            updated_at: cancelledAt,
          })
          .eq("business_id", access.businessId)
          .eq("id", linkedBooking.id)
          .select("id");

      if (
        bookingUpdateError ||
        !Array.isArray(updatedBookings) ||
        updatedBookings.length !== 1
      ) {
        throw new Error(
          `Could not cancel linked booking ${eventId}: ${
            bookingUpdateError?.message ?? "booking row changed concurrently"
          }`
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[calendar/events] Error deleting event:", err);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}

function workspaceChangedResponse(): NextResponse {
  return NextResponse.json(
    { error: "workspace_access_unavailable", retryable: true },
    { status: 503 }
  );
}

async function bookingCreationOperationalResponse(
  businessId: string
): Promise<NextResponse | null> {
  try {
    await assertBookingOperationallyAllowed(businessId);
    return null;
  } catch (error) {
    if (isBookingOperationalBlockedError(error)) {
      return NextResponse.json(
        {
          error: "booking_creation_unavailable",
          reason: error.reason,
        },
        { status: 403 }
      );
    }
    if (
      isOperationalControlsResolutionError(error) ||
      isBookingOperationalStateError(error)
    ) {
      return NextResponse.json(
        { error: "service_state_unavailable", retryable: true },
        { status: 503 }
      );
    }
    throw error;
  }
}
