import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthenticatedClient, getCalendarService } from "@/lib/google/client";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json(
      { error: "start and end query params required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: token } = await supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", business.id)
    .single();

  if (!token) {
    return NextResponse.json({ connected: false });
  }

  try {
    const client = await getAuthenticatedClient(business.id);
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: token } = await supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", business.id)
    .single();

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(business.id);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const calendarId = token.calendar_id || "primary";

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: token } = await supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", business.id)
    .single();

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(business.id);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const calendarId = token.calendar_id || "primary";

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
  const { searchParams } = request.nextUrl;
  const eventId = searchParams.get("eventId");

  if (!eventId) {
    return NextResponse.json(
      { error: "eventId query param required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: token } = await supabase
    .from("google_calendar_tokens")
    .select("calendar_id")
    .eq("business_id", business.id)
    .single();

  if (!token) {
    return NextResponse.json(
      { error: "Google Calendar not connected" },
      { status: 400 }
    );
  }

  try {
    const client = await getAuthenticatedClient(business.id);
    if (!client) {
      return NextResponse.json(
        { error: "Google Calendar not connected" },
        { status: 400 }
      );
    }

    const calendar = getCalendarService(client);
    const calendarId = token.calendar_id || "primary";

    await calendar.events.delete({
      calendarId,
      eventId,
      sendUpdates: "all",
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[calendar/events] Error deleting event:", err);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
