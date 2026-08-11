import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class BookingOperationalBlockedError extends Error {
    constructor(
      readonly businessId: string,
      readonly reason: "account_suspended" | "bookings_paused"
    ) {
      super(reason);
      this.name = "BookingOperationalBlockedError";
    }
  }

  class OperationalControlsResolutionError extends Error {
    readonly retryable = true;

    constructor(readonly businessId: string) {
      super("private operational-state detail");
      this.name = "OperationalControlsResolutionError";
    }
  }

  class BookingOperationalStateError extends Error {
    readonly retryable = true;

    constructor(readonly businessId: string) {
      super("private booking-state detail");
      this.name = "BookingOperationalStateError";
    }
  }

  return {
    requireWorkspaceRouteAccess: vi.fn(),
    requireAuthenticatedFeature: vi.fn(),
    getAuthenticatedClient: vi.fn(),
    getCalendarService: vi.fn(),
    assertBookingOperationallyAllowed: vi.fn(),
    accessFrom: vi.fn(),
    adminFrom: vi.fn(),
    calendarList: vi.fn(),
    calendarInsert: vi.fn(),
    calendarPatch: vi.fn(),
    calendarDelete: vi.fn(),
    buildDashboardBookingSourceKey: vi.fn(),
    recordBusinessMetricEventBestEffort: vi.fn(),
    BookingOperationalBlockedError,
    BookingOperationalStateError,
    OperationalControlsResolutionError,
  };
});

vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
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
vi.mock("@/lib/google/bookingOperational.server", () => ({
  assertBookingOperationallyAllowed:
    mocks.assertBookingOperationallyAllowed,
  BookingOperationalBlockedError: mocks.BookingOperationalBlockedError,
  isBookingOperationalBlockedError: (error: unknown) =>
    error instanceof mocks.BookingOperationalBlockedError,
  isBookingOperationalStateError: (error: unknown) =>
    error instanceof mocks.BookingOperationalStateError,
}));
vi.mock("@/lib/account/operationalControls.server", () => ({
  OperationalControlsResolutionError:
    mocks.OperationalControlsResolutionError,
  isOperationalControlsResolutionError: (error: unknown) =>
    error instanceof mocks.OperationalControlsResolutionError,
}));
vi.mock("@/lib/metrics/sourceKeys.server", () => ({
  buildDashboardBookingSourceKey:
    mocks.buildDashboardBookingSourceKey,
}));
vi.mock("@/lib/metrics/recording.server", () => ({
  recordBusinessMetricEventBestEffort:
    mocks.recordBusinessMetricEventBestEffort,
}));

import { DELETE, GET, PATCH, POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const START_TIME = "2026-07-20T13:00:00.000Z";
const END_TIME = "2026-07-20T14:00:00.000Z";
const DASHBOARD_BOOKING_SOURCE_KEY = `dashboard-booking:${"a".repeat(64)}`;

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

function denyWorkspace(status: 401 | 403 | 503) {
  const body =
    status === 401
      ? { error: "Unauthorized" }
      : status === 403
        ? { error: "workspace_access_denied" }
        : { error: "workspace_access_unavailable", retryable: true };
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: false,
    response: NextResponse.json(body, { status }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "00000000-0000-4000-8000-000000000002" },
      business: {
        id: BUSINESS_ID,
        partner_id: null,
        primary_goal: null,
      },
      hostKind: "canonical",
    },
  });

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
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
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
  mocks.buildDashboardBookingSourceKey.mockReturnValue(
    DASHBOARD_BOOKING_SOURCE_KEY
  );
  mocks.recordBusinessMetricEventBestEffort.mockReturnValue(undefined);
  mocks.adminFrom.mockReturnValue(bookingLookupChain());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("Calendar event entitlement boundary", () => {
  it.each(operations.flatMap((operation) =>
    ([401, 403, 503] as const).map((status) => ({ ...operation, status }))
  ))(
    "$method returns workspace $status before parsing, feature, database, or provider access",
    async ({ invoke, status }) => {
      denyWorkspace(status);

      const response = await invoke();

      expect(response.status).toBe(status);
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
      expect(mocks.accessFrom).not.toHaveBeenCalled();
      expect(mocks.adminFrom).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );

  it.each([
    { method: "GET", invoke: (request: NextRequest) => GET(request) },
    { method: "DELETE", invoke: (request: NextRequest) => DELETE(request) },
  ])(
    "$method does not inspect query parameters before the workspace gate",
    async ({ invoke }) => {
      denyWorkspace(403);
      const request = Object.create(null) as NextRequest;
      Object.defineProperty(request, "nextUrl", {
        get: vi.fn(() => {
          throw new Error("query parameters were inspected");
        }),
      });

      const response = await invoke(request);

      expect(response.status).toBe(403);
    }
  );

  it.each([
    { method: "POST", invoke: (request: NextRequest) => POST(request) },
    { method: "PATCH", invoke: (request: NextRequest) => PATCH(request) },
  ])(
    "$method does not parse JSON before the workspace gate",
    async ({ invoke }) => {
      denyWorkspace(403);
      const json = vi.fn(() => {
        throw new Error("request body was parsed");
      });

      const response = await invoke({ json } as unknown as NextRequest);

      expect(response.status).toBe(403);
      expect(json).not.toHaveBeenCalled();
    }
  );

  it("continues to calendar access on a correctly matched partner host", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: "00000000-0000-4000-8000-000000000002" },
        business: {
          id: BUSINESS_ID,
          partner_id: "00000000-0000-4000-8000-000000000003",
        },
        hostKind: "partner",
      },
    });

    const response = await GET(
      new NextRequest(
        "https://partner.example/api/calendar/events?start=2026-07-01T00%3A00%3A00Z&end=2026-08-01T00%3A00%3A00Z"
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
    expect(mocks.calendarList).toHaveBeenCalledOnce();
  });

  it.each(operations)(
    "$method returns 403 before token or Google access for a known plan denial",
    async ({ invoke }) => {
      denyAccess(403);

      const response = await invoke();

      expect(response.status).toBe(403);
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
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
      expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
    }
  );
});

describe("Calendar event primary-goal boundary", () => {
  function setWorkspacePrimaryGoal(
    primaryGoal: "book" | "signup" | "quote" | "callback" | null
  ) {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: "00000000-0000-4000-8000-000000000002" },
        business: {
          id: BUSINESS_ID,
          partner_id: null,
          primary_goal: primaryGoal,
        },
        hostKind: "canonical",
      },
    });
  }

  function expectNoCalendarMutationWork() {
    expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
    expect(mocks.accessFrom).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.getCalendarService).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
    expect(mocks.calendarDelete).not.toHaveBeenCalled();
    expect(mocks.buildDashboardBookingSourceKey).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  }

  it.each([
    {
      method: "POST",
      invoke: (request: NextRequest) => POST(request),
      bodyKind: "malformed",
      jsonImplementation: () => ({}),
    },
    {
      method: "POST",
      invoke: (request: NextRequest) => POST(request),
      bodyKind: "unparseable",
      jsonImplementation: () => {
        throw new SyntaxError("invalid JSON");
      },
    },
    {
      method: "PATCH",
      invoke: (request: NextRequest) => PATCH(request),
      bodyKind: "malformed",
      jsonImplementation: () => ({}),
    },
    {
      method: "PATCH",
      invoke: (request: NextRequest) => PATCH(request),
      bodyKind: "unparseable",
      jsonImplementation: () => {
        throw new SyntaxError("invalid JSON");
      },
    },
  ])(
    "$method returns the fixed signup-goal denial before a $bodyKind body can produce 400",
    async ({ invoke, jsonImplementation }) => {
      setWorkspacePrimaryGoal("signup");
      const json = vi.fn(jsonImplementation);

      const response = await invoke({ json } as unknown as NextRequest);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "goal_unavailable",
        feature: "calendar",
      });
      expect(json).not.toHaveBeenCalled();
      expectNoCalendarMutationWork();
    }
  );

  it("returns the fixed signup-goal denial before DELETE eventId validation", async () => {
    setWorkspacePrimaryGoal("signup");
    const nextUrl = vi.fn(() => {
      throw new Error("query parameters were inspected");
    });
    const request = Object.create(null) as NextRequest;
    Object.defineProperty(request, "nextUrl", { get: nextUrl });

    const response = await DELETE(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "goal_unavailable",
      feature: "calendar",
    });
    expect(nextUrl).not.toHaveBeenCalled();
    expectNoCalendarMutationWork();
  });

  it("leaves GET unchanged for signup-goal workspaces", async () => {
    setWorkspacePrimaryGoal("signup");

    const response = await operations[0].invoke();

    expect(response.status).toBe(200);
    expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
    expect(mocks.calendarList).toHaveBeenCalledOnce();
  });

  it.each(
    ([null, "book", "quote", "callback"] as const).flatMap(
      (primaryGoal) => [
        { primaryGoal, method: "POST", invoke: () => POST(postRequest()) },
        { primaryGoal, method: "PATCH", invoke: () => PATCH(patchRequest()) },
        {
          primaryGoal,
          method: "DELETE",
          invoke: () => DELETE(deleteRequest()),
        },
      ]
    )
  )(
    "preserves $method for primary_goal=$primaryGoal",
    async ({ primaryGoal, method, invoke }) => {
      setWorkspacePrimaryGoal(primaryGoal);

      const response = await invoke();

      expect(response.status).toBe(200);
      expect(mocks.requireAuthenticatedFeature).toHaveBeenCalledWith("calendar");
      if (method === "POST") {
        expect(mocks.calendarInsert).toHaveBeenCalledOnce();
      } else if (method === "PATCH") {
        expect(mocks.calendarPatch).toHaveBeenCalledOnce();
      } else {
        expect(mocks.calendarDelete).toHaveBeenCalledOnce();
      }
    }
  );
});

describe("Calendar event operational controls", () => {
  it("rejects a changed workspace before resolving operational state", async () => {
    mocks.requireAuthenticatedFeature.mockResolvedValueOnce({
      ok: true,
      businessId: "00000000-0000-4000-8000-000000000099",
      supabase: { from: mocks.accessFrom },
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "workspace_access_unavailable",
      retryable: true,
    });
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
    expect(mocks.accessFrom).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  });

  it.each(["account_suspended", "bookings_paused"] as const)(
    "blocks POST at entry with the privacy-safe %s response",
    async (reason) => {
      mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
        new mocks.BookingOperationalBlockedError(BUSINESS_ID, reason)
      );

      const response = await POST(postRequest());

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "booking_creation_unavailable",
        reason,
      });
      expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledOnce();
      expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledWith(
        BUSINESS_ID
      );
      expect(mocks.accessFrom).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.getCalendarService).not.toHaveBeenCalled();
      expect(mocks.calendarInsert).not.toHaveBeenCalled();
      expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
    }
  );

  it("returns a generic retryable 503 when the entry state is indeterminate", async () => {
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
      new mocks.OperationalControlsResolutionError(BUSINESS_ID)
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_state_unavailable",
      retryable: true,
    });
    expect(mocks.accessFrom).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  });

  it("keeps internal booking-state failures private and retryable", async () => {
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
      new mocks.BookingOperationalStateError(BUSINESS_ID)
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_state_unavailable",
      retryable: true,
    });
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  });

  it.each(["account_suspended", "bookings_paused"] as const)(
    "blocks a stale POST at the final provider gate when %s lands after entry",
    async (reason) => {
      mocks.assertBookingOperationallyAllowed
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new mocks.BookingOperationalBlockedError(BUSINESS_ID, reason)
        );

      const response = await POST(postRequest());

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "booking_creation_unavailable",
        reason,
      });
      expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
      expect(mocks.getAuthenticatedClient).toHaveBeenCalledWith(BUSINESS_ID);
      expect(mocks.getCalendarService).toHaveBeenCalledOnce();
      expect(mocks.calendarInsert).not.toHaveBeenCalled();
      expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
    }
  );

  it("fails closed at the final provider gate when state becomes indeterminate", async () => {
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new mocks.OperationalControlsResolutionError(BUSINESS_ID)
      );

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "service_state_unavailable",
      retryable: true,
    });
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  });

  it("checks entry and final state immediately around an allowed provider insert", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(
      mocks.assertBookingOperationallyAllowed.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.accessFrom.mock.invocationCallOrder[0]);
    expect(
      mocks.assertBookingOperationallyAllowed.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.calendarInsert.mock.invocationCallOrder[0]);
    expect(mocks.calendarInsert).toHaveBeenCalledOnce();
    expect(mocks.buildDashboardBookingSourceKey).toHaveBeenCalledWith(
      BUSINESS_ID,
      "primary",
      "event-1"
    );
    expect(mocks.recordBusinessMetricEventBestEffort).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      metricKey: "booking_confirmed",
      quantity: 1,
      occurredAt: expect.any(Date),
      sourceKey: DASHBOARD_BOOKING_SOURCE_KEY,
      origin: "dashboard",
    });
    expect(
      mocks.calendarInsert.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.recordBusinessMetricEventBestEffort.mock.invocationCallOrder[0]
    );
  });

  it("keeps an accepted Google booking successful when metric dispatch throws", async () => {
    mocks.recordBusinessMetricEventBestEffort.mockImplementationOnce(() => {
      throw new Error("private metric failure");
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      event: { id: "event-1", title: "Estimate" },
    });
    expect(mocks.calendarInsert).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "[metrics] Metric dispatch failed:",
      {
        businessId: BUSINESS_ID,
        metricKey: "booking_confirmed",
      }
    );
  });

  it("does not record when Google rejects the booking", async () => {
    mocks.calendarInsert.mockRejectedValueOnce(new Error("provider rejected"));

    const response = await POST(postRequest());

    expect(response.status).toBe(500);
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
  });

  it("skips recording when Google accepts without a provider event ID", async () => {
    mocks.calendarInsert.mockResolvedValueOnce({
      data: {
        id: null,
        summary: "Estimate",
        start: { dateTime: START_TIME },
        end: { dateTime: END_TIME },
      },
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.buildDashboardBookingSourceKey).not.toHaveBeenCalled();
    expect(mocks.recordBusinessMetricEventBestEffort).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[metrics] Metric dispatch skipped:",
      {
        businessId: BUSINESS_ID,
        metricKey: "booking_confirmed",
      }
    );
  });

  it("reuses the source key when one accepted provider event is handled twice", async () => {
    // The repeated provider ID models duplicate handling of the same accepted
    // Google event. A different provider ID is a distinct accepted booking.
    const firstResponse = await POST(postRequest());
    const secondResponse = await POST(postRequest());

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(mocks.buildDashboardBookingSourceKey.mock.calls).toEqual([
      [BUSINESS_ID, "primary", "event-1"],
      [BUSINESS_ID, "primary", "event-1"],
    ]);
    expect(
      mocks.recordBusinessMetricEventBestEffort.mock.calls.map(
        ([input]) => input.sourceKey
      )
    ).toEqual([DASHBOARD_BOOKING_SOURCE_KEY, DASHBOARD_BOOKING_SOURCE_KEY]);
  });

  it("keeps GET, PATCH, and DELETE available while new bookings are blocked", async () => {
    mocks.assertBookingOperationallyAllowed.mockRejectedValue(
      new mocks.BookingOperationalBlockedError(
        BUSINESS_ID,
        "bookings_paused"
      )
    );

    const getResponse = await operations[0].invoke();
    const patchResponse = await PATCH(patchRequest());
    const deleteResponse = await DELETE(deleteRequest());

    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
    expect(mocks.calendarList).toHaveBeenCalledOnce();
    expect(mocks.calendarPatch).toHaveBeenCalledOnce();
    expect(mocks.calendarDelete).toHaveBeenCalledOnce();
  });
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
