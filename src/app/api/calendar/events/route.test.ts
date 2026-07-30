import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAuthenticatedFeature: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
  accessFrom: vi.fn(),
  adminFrom: vi.fn(),
  calendarList: vi.fn(),
  calendarInsert: vi.fn(),
  calendarPatch: vi.fn(),
  calendarDelete: vi.fn(),
}));

vi.mock("@/lib/google/routeAccess", () => ({
  requireAuthenticatedFeature: mocks.requireAuthenticatedFeature,
}));
vi.mock("@/lib/google/client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));

import { DELETE, GET, PATCH, POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const START_TIME = "2026-07-20T13:00:00.000Z";
const END_TIME = "2026-07-20T14:00:00.000Z";

type BookingUpdateResult = {
  data: unknown;
  error: { message: string } | null;
};

interface BookingUpdateChain {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
}

interface BookingLookupChain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
}

function bookingUpdateChain(
  result: BookingUpdateResult = {
    data: [{ id: "booking-1" }],
    error: null,
  }
): BookingUpdateChain {
  const chain = {} as BookingUpdateChain;
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn().mockResolvedValue(result);
  return chain;
}

function bookingLookupChain(
  result: BookingUpdateResult = { data: [], error: null }
): BookingLookupChain {
  const chain = {} as BookingLookupChain;
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue(result);
  return chain;
}

function linkedBooking(calendarId = "primary") {
  return {
    id: "booking-1",
    google_calendar_id: calendarId,
  };
}

function patchRequest() {
  return new NextRequest("http://localhost/api/calendar/events", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventId: "event-1",
      title: "Updated estimate",
      startTime: START_TIME,
      endTime: END_TIME,
    }),
  });
}

function deleteRequest() {
  return new NextRequest(
    "http://localhost/api/calendar/events?eventId=event-1",
    { method: "DELETE" }
  );
}

function postRequest() {
  return new NextRequest("http://localhost/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Estimate",
      startTime: START_TIME,
      endTime: END_TIME,
    }),
  });
}

const operations = [
  {
    method: "GET",
    invoke: () =>
      GET(
        new NextRequest(
          "http://localhost/api/calendar/events?start=2026-07-01T00%3A00%3A00Z&end=2026-08-01T00%3A00%3A00Z"
        )
      ),
  },
  {
    method: "POST",
    invoke: () =>
      POST(
        new NextRequest("http://localhost/api/calendar/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: "Estimate",
            startTime: "2026-07-20T13:00:00Z",
            endTime: "2026-07-20T14:00:00Z",
          }),
        })
      ),
  },
  {
    method: "PATCH",
    invoke: () =>
      PATCH(
        new NextRequest("http://localhost/api/calendar/events", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventId: "event-1",
            title: "Updated estimate",
          }),
        })
      ),
  },
  {
    method: "DELETE",
    invoke: () =>
      DELETE(
        new NextRequest(
          "http://localhost/api/calendar/events?eventId=event-1",
          { method: "DELETE" }
        )
      ),
  },
] as const;

function denyAccess(status: 403 | 503) {
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: false,
    response: NextResponse.json(
      status === 403
        ? {
            error: "feature_unavailable",
            feature: "calendar",
            requiredPlan: "sms_and_chat",
          }
        : { error: "service_unavailable", retryable: true },
      { status }
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  const tokenChain = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { calendar_id: "primary" },
      error: null,
    }),
  };
  tokenChain.select.mockReturnValue(tokenChain);
  tokenChain.eq.mockReturnValue(tokenChain);
  mocks.accessFrom.mockReturnValue(tokenChain);
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
    supabase: { from: mocks.accessFrom },
  });

  mocks.getAuthenticatedClient.mockResolvedValue({ credentials: true });
  mocks.getCalendarService.mockReturnValue({
    events: {
      list: mocks.calendarList,
      insert: mocks.calendarInsert,
      patch: mocks.calendarPatch,
      delete: mocks.calendarDelete,
    },
  });
  mocks.calendarList.mockResolvedValue({ data: { items: [] } });
  mocks.calendarInsert.mockResolvedValue({
    data: {
      id: "event-1",
      summary: "Estimate",
      start: { dateTime: START_TIME },
      end: { dateTime: END_TIME },
    },
  });
  mocks.calendarPatch.mockResolvedValue({
    data: {
      id: "event-1",
      summary: "Updated estimate",
      start: { dateTime: START_TIME },
      end: { dateTime: END_TIME },
      description: null,
    },
  });
  mocks.calendarDelete.mockResolvedValue({ data: {} });
  mocks.adminFrom.mockReturnValue(bookingLookupChain());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("Calendar event entitlement boundary", () => {
  it.each(operations)(
    "$method returns 403 before token or Google access for a known plan denial",
    async ({ invoke }) => {
      denyAccess(403);

      const response = await invoke();

      expect(response.status).toBe(403);
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );

  it.each(operations)(
    "$method returns retryable 503 before token or Google access when access is indeterminate",
    async ({ invoke }) => {
      denyAccess(503);

      const response = await invoke();

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ retryable: true });
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );
});

describe("Calendar event booking synchronization", () => {
  it("PATCH uses the linked booking's original calendar and synchronizes it", async () => {
    const lookupChain = bookingLookupChain({
      data: [linkedBooking("original-calendar")],
      error: null,
    });
    const updateChain = bookingUpdateChain();
    mocks.adminFrom
      .mockReturnValueOnce(lookupChain)
      .mockReturnValueOnce(updateChain);

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "original-calendar",
        eventId: "event-1",
      })
    );
    expect(lookupChain.select).toHaveBeenCalledWith(
      "id,google_calendar_id"
    );
    expect(updateChain.update).toHaveBeenCalledWith({
      starts_at: START_TIME,
      ends_at: END_TIME,
      updated_at: expect.any(String),
    });
    expect(updateChain.eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
      ["id", "booking-1"],
    ]);
    expect(updateChain.select).toHaveBeenCalledWith("id");
  });

  it("marks a linked booking cancelled after DELETE succeeds in Google", async () => {
    const lookupChain = bookingLookupChain({
      data: [linkedBooking()],
      error: null,
    });
    const updateChain = bookingUpdateChain();
    mocks.adminFrom
      .mockReturnValueOnce(lookupChain)
      .mockReturnValueOnce(updateChain);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.calendarDelete).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: "event-1" })
    );
    const update = updateChain.update.mock.calls[0]?.[0];
    expect(update).toEqual({
      status: "cancelled",
      cancelled_at: expect.any(String),
      updated_at: update.cancelled_at,
    });
    expect(update).not.toHaveProperty("lead_status");
    expect(updateChain.eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
      ["id", "booking-1"],
    ]);
    expect(updateChain.select).toHaveBeenCalledWith("id");
  });

  it("treats a generic PATCH with no booking mapping as a successful no-op", async () => {
    const lookupChain = bookingLookupChain();
    mocks.adminFrom.mockReturnValue(lookupChain);

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.adminFrom).toHaveBeenCalledTimes(1);
  });

  it("treats a generic DELETE with no booking mapping as a successful no-op", async () => {
    const lookupChain = bookingLookupChain();
    mocks.adminFrom.mockReturnValue(lookupChain);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.adminFrom).toHaveBeenCalledTimes(1);
  });

  it("fails PATCH before Google when booking lookup is unavailable", async () => {
    mocks.adminFrom.mockReturnValue(
      bookingLookupChain({
        data: null,
        error: { message: "database unavailable" },
      })
    );

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(500);
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  it("fails PATCH when linked-booking persistence fails", async () => {
    mocks.adminFrom
      .mockReturnValueOnce(
        bookingLookupChain({ data: [linkedBooking()], error: null })
      )
      .mockReturnValueOnce(
        bookingUpdateChain({
          data: null,
          error: { message: "database unavailable" },
        })
      );

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to update event" });
  });

  it("fails DELETE when linked-booking persistence fails", async () => {
    mocks.adminFrom
      .mockReturnValueOnce(
        bookingLookupChain({ data: [linkedBooking()], error: null })
      )
      .mockReturnValueOnce(
        bookingUpdateChain({
          data: null,
          error: { message: "database unavailable" },
        })
      );

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to delete event" });
  });

  it("heals a prior Google-success/local-failure DELETE from the original calendar", async () => {
    const failedUpdate = bookingUpdateChain({
      data: null,
      error: { message: "database unavailable" },
    });
    const healedUpdate = bookingUpdateChain();
    mocks.adminFrom
      .mockReturnValueOnce(
        bookingLookupChain({
          data: [linkedBooking("original-calendar")],
          error: null,
        })
      )
      .mockReturnValueOnce(failedUpdate)
      .mockReturnValueOnce(
        bookingLookupChain({
          data: [linkedBooking("original-calendar")],
          error: null,
        })
      )
      .mockReturnValueOnce(healedUpdate);
    mocks.calendarDelete
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce({ response: { status: 404 } });

    const firstResponse = await DELETE(deleteRequest());
    const retryResponse = await DELETE(deleteRequest());

    expect(firstResponse.status).toBe(500);
    expect(retryResponse.status).toBe(200);
    expect(mocks.calendarDelete).toHaveBeenCalledTimes(2);
    expect(mocks.calendarDelete.mock.calls).toEqual([
      [
        {
          calendarId: "original-calendar",
          eventId: "event-1",
          sendUpdates: "all",
        },
      ],
      [
        {
          calendarId: "original-calendar",
          eventId: "event-1",
          sendUpdates: "all",
        },
      ],
    ]);
    expect(mocks.adminFrom).toHaveBeenCalledTimes(4);
    expect(healedUpdate.update).toHaveBeenCalledWith({
      status: "cancelled",
      cancelled_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("does not reconcile locally after a non-404 Google DELETE failure", async () => {
    mocks.calendarDelete.mockRejectedValueOnce({
      response: { status: 500 },
    });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(500);
    expect(mocks.adminFrom).toHaveBeenCalledTimes(1);
  });

  it("does not create a booking for generic calendar POST", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarInsert).toHaveBeenCalledTimes(1);
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });
});
