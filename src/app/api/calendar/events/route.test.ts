import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class CalendarProviderSlotUnavailableError extends Error {}
  class CalendarProviderOperationBusyError extends Error {}
  class CalendarProviderOperationConflictError extends Error {}
  class CalendarProviderOperationStateError extends Error {
    constructor(readonly operation: string, options?: ErrorOptions) {
      super("private provider operation state", options);
    }
  }
  class BookingOperationalBlockedError extends Error {
    constructor(
      readonly businessId: string,
      readonly reason: "account_suspended" | "bookings_paused"
    ) {
      super(reason);
    }
  }
  class BookingOperationalStateError extends Error {}
  class OperationalControlsResolutionError extends Error {}

  return {
    requireWorkspaceRouteAccess: vi.fn(),
    requireAuthenticatedFeature: vi.fn(),
    getAuthenticatedClient: vi.fn(),
    getCalendarService: vi.fn(),
    assertBookingOperationallyAllowed: vi.fn(),
    accessFrom: vi.fn(),
    adminFrom: vi.fn(),
    calendarList: vi.fn(),
    calendarGet: vi.fn(),
    calendarInsert: vi.fn(),
    calendarPatch: vi.fn(),
    calendarDelete: vi.fn(),
    calendarFreebusy: vi.fn(),
    readOperation: vi.fn(),
    acquireOperation: vi.fn(),
    markSubmissionStarted: vi.fn(),
    markApplied: vi.fn(),
    markDeleteApplied: vi.fn(),
    finalizeOperation: vi.fn(),
    failOperation: vi.fn(),
    resolveAbsent: vi.fn(),
    buildDashboardBookingSourceKey: vi.fn(),
    recordBusinessMetricEventBestEffort: vi.fn(),
    CalendarProviderSlotUnavailableError,
    CalendarProviderOperationBusyError,
    CalendarProviderOperationConflictError,
    CalendarProviderOperationStateError,
    BookingOperationalBlockedError,
    BookingOperationalStateError,
    OperationalControlsResolutionError,
  };
});

vi.mock("server-only", () => ({}));
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
  assertBookingOperationallyAllowed: mocks.assertBookingOperationallyAllowed,
  BookingOperationalBlockedError: mocks.BookingOperationalBlockedError,
  isBookingOperationalBlockedError: (error: unknown) =>
    error instanceof mocks.BookingOperationalBlockedError,
  isBookingOperationalStateError: (error: unknown) =>
    error instanceof mocks.BookingOperationalStateError,
}));
vi.mock("@/lib/account/operationalControls.server", () => ({
  OperationalControlsResolutionError: mocks.OperationalControlsResolutionError,
  isOperationalControlsResolutionError: (error: unknown) =>
    error instanceof mocks.OperationalControlsResolutionError,
}));
vi.mock("@/lib/metrics/sourceKeys.server", () => ({
  buildDashboardBookingSourceKey: mocks.buildDashboardBookingSourceKey,
}));
vi.mock("@/lib/metrics/recording.server", () => ({
  recordBusinessMetricEventBestEffort:
    mocks.recordBusinessMetricEventBestEffort,
}));
vi.mock("@/lib/google/calendarProviderOperations.server", () => ({
  CALENDAR_OPERATION_PRIVATE_KEY: "simplassistCalendarOperationId",
  CalendarProviderSlotUnavailableError:
    mocks.CalendarProviderSlotUnavailableError,
  CalendarProviderOperationBusyError: mocks.CalendarProviderOperationBusyError,
  CalendarProviderOperationConflictError:
    mocks.CalendarProviderOperationConflictError,
  CalendarProviderOperationStateError: mocks.CalendarProviderOperationStateError,
  readCalendarProviderOperation: mocks.readOperation,
  acquireCalendarProviderOperation: mocks.acquireOperation,
  markCalendarProviderSubmissionStarted: mocks.markSubmissionStarted,
  markCalendarProviderOperationApplied: mocks.markApplied,
  markCalendarProviderDeleteApplied: mocks.markDeleteApplied,
  finalizeCalendarProviderOperation: mocks.finalizeOperation,
  failCalendarProviderOperation: mocks.failOperation,
  resolveCalendarProviderOperationAbsent: mocks.resolveAbsent,
  createDeterministicGoogleEventId: (operationId: string) =>
    operationId.replaceAll("-", "").toLowerCase(),
  hasCalendarProviderOperationMarker: (
    event: unknown,
    operationId: string
  ) => {
    const candidate = event as {
      extendedProperties?: {
        private?: { simplassistCalendarOperationId?: unknown };
      };
    };
    return (
      candidate?.extendedProperties?.private
        ?.simplassistCalendarOperationId === operationId
    );
  },
  buildCalendarProviderEvidence: () => ({
    operation_marker_verified: true,
    provider_status: "confirmed",
  }),
  isDefinitiveCalendarProviderFailure: (error: unknown) => {
    const candidate = error as {
      response?: { status?: unknown };
      code?: unknown;
    };
    const status = Number(candidate?.response?.status ?? candidate?.code);
    return (
      Number.isInteger(status) &&
      status >= 400 &&
      status < 500 &&
      ![408, 409, 425, 429, 499].includes(status)
    );
  },
}));

import { DELETE, GET, PATCH, POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OPERATION_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OPERATION_ID = "10000000-0000-4000-8000-000000000002";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const START_TIME = "2026-07-20T13:00:00.000Z";
const END_TIME = "2026-07-20T14:00:00.000Z";
const EVENT_ID = "event-1";
const DETERMINISTIC_ID = OPERATION_ID.replaceAll("-", "");

type OperationOverrides = Record<string, unknown>;

function operation(overrides: OperationOverrides = {}) {
  return {
    id: OPERATION_ID,
    business_id: BUSINESS_ID,
    operation_kind: "create",
    google_calendar_id: "primary",
    desired_starts_at: START_TIME,
    desired_ends_at: END_TIME,
    linked_booking_id: null,
    deterministic_google_event_id: DETERMINISTIC_ID,
    target_google_event_id: null,
    provider_target_event_id: DETERMINISTIC_ID,
    status: "holding",
    claim_token: CLAIM_TOKEN,
    provider_submission_started_at: null,
    provider_event_id: null,
    provider_starts_at: null,
    provider_ends_at: null,
    ...overrides,
  };
}

function markedEvent(
  operationId = OPERATION_ID,
  overrides: Record<string, unknown> = {}
) {
  return {
    id: DETERMINISTIC_ID,
    summary: "Estimate",
    description: null,
    status: "confirmed",
    etag: '"etag-1"',
    start: { dateTime: START_TIME },
    end: { dateTime: END_TIME },
    extendedProperties: {
      private: { simplassistCalendarOperationId: operationId },
    },
    ...overrides,
  };
}

function tokenQuery(
  result: {
    data: { calendar_id: string; google_email: string } | null;
    error: { code?: string } | null;
  } = {
    data: {
      calendar_id: "primary",
      google_email: "owner@example.test",
    },
    error: null,
  }
) {
  const chain = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = vi.fn().mockResolvedValue(result);
  return chain;
}

function bookingQuery(
  rows: Array<Record<string, unknown>> = []
) {
  const chain = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
  };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
}

function postRequest(operationId = OPERATION_ID) {
  return new NextRequest("http://localhost/api/calendar/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationId,
      title: "Estimate",
      startTime: START_TIME,
      endTime: END_TIME,
    }),
  });
}

function patchRequest(
  body: Record<string, unknown> = {},
  operationId = OPERATION_ID
) {
  return new NextRequest("http://localhost/api/calendar/events", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operationId,
      eventId: EVENT_ID,
      title: "Updated estimate",
      startTime: START_TIME,
      endTime: END_TIME,
      ...body,
    }),
  });
}

function deleteRequest(operationId = OPERATION_ID) {
  return new NextRequest(
    `http://localhost/api/calendar/events?eventId=${EVENT_ID}&operationId=${operationId}`,
    { method: "DELETE" }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: "00000000-0000-4000-8000-000000000099" },
      business: { id: BUSINESS_ID, partner_id: null, primary_goal: null },
      hostKind: "canonical",
    },
  });
  const token = tokenQuery();
  mocks.accessFrom.mockReturnValue(token);
  mocks.requireAuthenticatedFeature.mockResolvedValue({
    ok: true,
    businessId: BUSINESS_ID,
    supabase: { from: mocks.accessFrom },
  });
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
  mocks.getAuthenticatedClient.mockResolvedValue({ credentials: true });
  mocks.getCalendarService.mockReturnValue({
    events: {
      list: mocks.calendarList,
      get: mocks.calendarGet,
      insert: mocks.calendarInsert,
      patch: mocks.calendarPatch,
      delete: mocks.calendarDelete,
    },
    freebusy: { query: mocks.calendarFreebusy },
  });
  mocks.calendarList.mockResolvedValue({ data: { items: [] } });
  mocks.calendarGet.mockRejectedValue({ response: { status: 404 } });
  mocks.calendarFreebusy.mockResolvedValue({
    data: { calendars: { primary: { busy: [] } } },
  });
  mocks.calendarInsert.mockImplementation(
    async ({ requestBody }: { requestBody: Record<string, unknown> }) => ({
      data: { ...requestBody, status: "confirmed", etag: '"etag-new"' },
    })
  );
  mocks.calendarPatch.mockImplementation(
    async ({
      eventId,
      requestBody,
    }: {
      eventId: string;
      requestBody: Record<string, unknown>;
    }) => ({
      data: {
        id: eventId,
        summary: requestBody.summary ?? "Estimate",
        description: requestBody.description ?? null,
        status: "confirmed",
        etag: '"etag-new"',
        start: requestBody.start ?? { dateTime: START_TIME },
        end: requestBody.end ?? { dateTime: END_TIME },
        extendedProperties: requestBody.extendedProperties,
      },
    })
  );
  mocks.calendarDelete.mockResolvedValue({ data: {} });
  mocks.readOperation.mockResolvedValue(null);
  mocks.acquireOperation.mockImplementation(async (input: {
    kind: "create" | "update" | "delete";
    calendarId: string;
    startsAt: string | null;
    endsAt: string | null;
    linkedBookingId: string | null;
    deterministicGoogleEventId: string | null;
    targetGoogleEventId: string | null;
  }) => ({
    claimToken: CLAIM_TOKEN,
    operation: operation({
      operation_kind: input.kind,
      google_calendar_id: input.calendarId,
      desired_starts_at: input.startsAt,
      desired_ends_at: input.endsAt,
      linked_booking_id: input.linkedBookingId,
      deterministic_google_event_id: input.deterministicGoogleEventId,
      target_google_event_id: input.targetGoogleEventId,
      provider_target_event_id:
        input.targetGoogleEventId ?? input.deterministicGoogleEventId,
    }),
  }));
  mocks.markSubmissionStarted.mockImplementation(async () =>
    operation({ provider_submission_started_at: new Date().toISOString() })
  );
  mocks.markApplied.mockResolvedValue(
    operation({ status: "provider_applied" })
  );
  mocks.markDeleteApplied.mockResolvedValue(
    operation({
      operation_kind: "delete",
      status: "provider_applied",
      provider_event_id: EVENT_ID,
    })
  );
  mocks.finalizeOperation.mockImplementation(
    async (_businessId: string, operationId: string) =>
      operation({
        id: operationId,
        status: "finalized",
        provider_event_id: DETERMINISTIC_ID,
        provider_starts_at: START_TIME,
        provider_ends_at: END_TIME,
      })
  );
  mocks.failOperation.mockResolvedValue(operation({ status: "failed" }));
  mocks.resolveAbsent.mockResolvedValue(operation({ status: "failed" }));
  mocks.adminFrom.mockReturnValue(bookingQuery());
  mocks.buildDashboardBookingSourceKey.mockReturnValue("metric-source");
  mocks.recordBusinessMetricEventBestEffort.mockReturnValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("calendar route access and existing-plan protection", () => {
  it.each([401, 403, 503] as const)(
    "returns workspace %s before feature or provider work",
    async (status) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json({ error: "denied" }, { status }),
      });

      const response = await POST(postRequest());

      expect(response.status).toBe(status);
      expect(mocks.requireAuthenticatedFeature).not.toHaveBeenCalled();
      expect(mocks.calendarInsert).not.toHaveBeenCalled();
    }
  );

  it("keeps the signup-goal mutation denial before body parsing", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        business: { id: BUSINESS_ID, primary_goal: "signup" },
      },
    });
    const json = vi.fn(() => {
      throw new Error("must not parse");
    });

    const response = await POST({ json } as unknown as NextRequest);

    expect(response.status).toBe(403);
    expect(json).not.toHaveBeenCalled();
  });

  it("keeps feature denial ahead of tokens and Google", async () => {
    mocks.requireAuthenticatedFeature.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "feature_unavailable" }, { status: 403 }),
    });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(403);
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  it("keeps GET available and disables hidden Google retries", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/calendar/events?start=2026-07-01T00:00:00Z&end=2026-08-01T00:00:00Z"
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.calendarList).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ retry: false, timeout: 60_000 })
    );
  });

  it("keeps raw provider content out of GET logs", async () => {
    mocks.calendarList.mockRejectedValue(
      Object.assign(new Error("customer@example.test bearer-secret"), {
        response: { status: 500, data: { title: "Private title" } },
      })
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/calendar/events?start=2026-07-01T00:00:00Z&end=2026-08-01T00:00:00Z"
      )
    );

    expect(response.status).toBe(500);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "customer@example.test"
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "bearer-secret"
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "Private title"
    );
  });
});

describe("calendar CREATE provider operation", () => {
  it("validates credentials, acquires durably, then reloads before Google mutation", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedClient).toHaveBeenCalledTimes(2);
    expect(
      mocks.getAuthenticatedClient.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.acquireOperation.mock.invocationCallOrder[0]);
    expect(mocks.acquireOperation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAuthenticatedClient.mock.invocationCallOrder[1]
    );
    expect(
      mocks.getAuthenticatedClient.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.calendarInsert.mock.invocationCallOrder[0]);
  });

  it("does not call Google when the first-submission fence observes a later business gate", async () => {
    mocks.markSubmissionStarted.mockRejectedValue(
      new mocks.CalendarProviderOperationStateError("submission_gate")
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "calendar_operation_unavailable",
      retryable: true,
    });
    expect(mocks.markSubmissionStarted).toHaveBeenCalledTimes(1);
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.markApplied).not.toHaveBeenCalled();
  });

  it("retains submitted CREATE authority when the post-acquire token read is uncertain", async () => {
    mocks.accessFrom.mockReset();
    mocks.accessFrom
      .mockReturnValueOnce(tokenQuery())
      .mockReturnValueOnce(
        tokenQuery({ data: null, error: { code: "provider_read_failed" } })
      );
    const submitted = operation({
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(submitted);
    mocks.acquireOperation.mockResolvedValue({
      operation: submitted,
      claimToken: CLAIM_TOKEN,
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
  });

  it("terminalizes pre-submit work when the provider namespace switches before acquire commits", async () => {
    const token = tokenQuery();
    token.maybeSingle
      .mockResolvedValueOnce({
        data: {
          calendar_id: "primary",
          google_email: "account-a@example.test",
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          calendar_id: "primary",
          google_email: "account-b@example.test",
        },
        error: null,
      });
    mocks.accessFrom.mockReturnValue(token);

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "Provider namespace changed before submission."
    );
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
  });

  it("acquires, fences submission, inserts the deterministic ID, and finalizes", async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.acquireOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: OPERATION_ID,
        kind: "create",
        deterministicGoogleEventId: DETERMINISTIC_ID,
      })
    );
    expect(mocks.markSubmissionStarted).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN
    );
    expect(mocks.calendarInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "primary",
        requestBody: expect.objectContaining({
          id: DETERMINISTIC_ID,
          extendedProperties: {
            private: { simplassistCalendarOperationId: OPERATION_ID },
          },
        }),
      }),
      { timeout: 60_000, retry: false }
    );
    expect(
      mocks.markSubmissionStarted.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.calendarInsert.mock.invocationCallOrder[0]);
    expect(mocks.markApplied).toHaveBeenCalledOnce();
    expect(mocks.finalizeOperation).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID
    );
  });

  it("does not call Google when atomic acquisition reports a slot conflict", async () => {
    mocks.acquireOperation.mockRejectedValue(
      new mocks.CalendarProviderSlotUnavailableError()
    );

    const response = await POST(postRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "calendar_time_unavailable",
      retryable: false,
    });
    expect(mocks.calendarGet).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
  });

  it.each([
    { calendars: {} },
    { calendars: { primary: { errors: [{ reason: "backendError" }], busy: [] } } },
    { calendars: { primary: { busy: [{ start: "bad", end: END_TIME }] } } },
  ])("fails closed on invalid free-busy evidence", async (data) => {
    mocks.calendarFreebusy.mockResolvedValue({ data });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).toHaveBeenCalledOnce();
    expect(mocks.markSubmissionStarted).not.toHaveBeenCalled();
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
  });

  it("uses final provider busy state to prevent a response-loss/new-ID duplicate", async () => {
    mocks.calendarFreebusy.mockResolvedValue({
      data: {
        calendars: {
          primary: { busy: [{ start: START_TIME, end: END_TIME }] },
        },
      },
    });

    const response = await POST(postRequest(OTHER_OPERATION_ID));

    expect(response.status).toBe(409);
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.failOperation).toHaveBeenCalledOnce();
  });

  it("recovers a deterministic provider success without inserting twice", async () => {
    mocks.calendarGet.mockResolvedValue({
      data: markedEvent(),
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarInsert).not.toHaveBeenCalled();
    expect(mocks.markApplied).toHaveBeenCalledOnce();
    expect(mocks.finalizeOperation).toHaveBeenCalledOnce();
  });

  it("keeps a timeout ambiguous and retains the post-submission claim", async () => {
    mocks.calendarInsert.mockRejectedValue(new Error("socket timeout"));
    mocks.calendarGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce(new Error("recovery unavailable"));

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.markSubmissionStarted).toHaveBeenCalledOnce();
    expect(mocks.failOperation).not.toHaveBeenCalled();
  });

  it("keeps HTTP 499 ambiguous because client cancellation cannot prove provider absence", async () => {
    mocks.calendarInsert.mockRejectedValue({ response: { status: 499 } });

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.markSubmissionStarted).toHaveBeenCalledOnce();
    expect(mocks.calendarInsert).toHaveBeenCalledOnce();
    expect(mocks.failOperation).not.toHaveBeenCalled();
  });

  it("does not mark failed when Google acknowledged but evidence verification fails", async () => {
    mocks.calendarInsert.mockResolvedValue({ data: { id: DETERMINISTIC_ID } });
    mocks.calendarGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce(new Error("verification read failed"));

    const response = await POST(postRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).not.toHaveBeenCalled();
    expect(mocks.markApplied).not.toHaveBeenCalled();
  });

  it("finalizes durable provider evidence before credential lookup", async () => {
    const applied = operation({
      status: "provider_applied",
      provider_event_id: DETERMINISTIC_ID,
      provider_starts_at: START_TIME,
      provider_ends_at: END_TIME,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(applied);
    mocks.acquireOperation.mockResolvedValue({
      operation: applied,
      claimToken: CLAIM_TOKEN,
    });

    const response = await POST(postRequest());

    expect(response.status).toBe(200);
    expect(mocks.finalizeOperation).toHaveBeenCalledOnce();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarGet).not.toHaveBeenCalled();
  });
});

describe("calendar UPDATE provider operation", () => {
  it("reloads credentials and provider state after acquiring the update hold", async () => {
    prepareUpdateEvent();

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedClient).toHaveBeenCalledTimes(2);
    expect(mocks.acquireOperation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.getAuthenticatedClient.mock.invocationCallOrder[1]
    );
    expect(
      mocks.getAuthenticatedClient.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.calendarPatch.mock.invocationCallOrder[0]);
    expect(mocks.calendarGet).toHaveBeenCalled();
  });

  it("retains submitted UPDATE authority when credential reload returns null", async () => {
    const submitted = operation({
      operation_kind: "update",
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(submitted);
    mocks.acquireOperation.mockResolvedValue({
      operation: submitted,
      claimToken: CLAIM_TOKEN,
    });
    mocks.getAuthenticatedClient
      .mockResolvedValueOnce({ credentials: true })
      .mockResolvedValueOnce(null);

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).not.toHaveBeenCalled();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  function prepareUpdateEvent(event = markedEvent("other-operation", {
    id: EVENT_ID,
    extendedProperties: {
      private: { simplassist_booking_id: "booking-1", custom: "keep" },
      shared: { team: "keep" },
    },
  })) {
    mocks.calendarGet.mockResolvedValue({ data: event });
  }

  it("requires an etag, preserves extended properties, and finalizes atomically", async () => {
    prepareUpdateEvent();
    mocks.adminFrom.mockReturnValue(
      bookingQuery([
        {
          id: "30000000-0000-4000-8000-000000000001",
          google_calendar_id: "primary",
          starts_at: START_TIME,
          ends_at: END_TIME,
        },
      ])
    );

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        requestBody: expect.objectContaining({
          extendedProperties: {
            private: {
              simplassist_booking_id: "booking-1",
              custom: "keep",
              simplassistCalendarOperationId: OPERATION_ID,
            },
            shared: { team: "keep" },
          },
        }),
      }),
      {
        timeout: 60_000,
        retry: false,
        headers: { "If-Match": '"etag-1"' },
      }
    );
    expect(mocks.markSubmissionStarted).toHaveBeenCalledBefore(
      mocks.calendarPatch
    );
    expect(mocks.markApplied).toHaveBeenCalledOnce();
    expect(mocks.finalizeOperation).toHaveBeenCalledOnce();
  });

  it("fails before PATCH when Google omits the concurrency token", async () => {
    prepareUpdateEvent(markedEvent("other-operation", { id: EVENT_ID, etag: "" }));

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).toHaveBeenCalledOnce();
    expect(mocks.markSubmissionStarted).not.toHaveBeenCalled();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  it("treats 412 as a definitive conflict with no second mutation", async () => {
    prepareUpdateEvent();
    mocks.calendarPatch.mockRejectedValue({ response: { status: 412 } });
    mocks.calendarGet
      .mockResolvedValueOnce({ data: markedEvent("other-operation", { id: EVENT_ID }) })
      .mockResolvedValueOnce({ data: markedEvent("other-operation", { id: EVENT_ID }) });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(409);
    expect(mocks.failOperation).toHaveBeenCalledOnce();
    expect(mocks.calendarPatch).toHaveBeenCalledOnce();
  });

  it("keeps a network/5xx PATCH ambiguous without failing or retrying", async () => {
    prepareUpdateEvent();
    mocks.calendarPatch.mockRejectedValue({ response: { status: 503 } });
    mocks.calendarGet
      .mockResolvedValueOnce({ data: markedEvent("other-operation", { id: EVENT_ID }) })
      .mockRejectedValueOnce(new Error("recovery unavailable"));

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(503);
    expect(mocks.calendarPatch).toHaveBeenCalledOnce();
    expect(mocks.failOperation).not.toHaveBeenCalled();
  });

  it("recovers an ambiguous PATCH marker without a second PATCH", async () => {
    const recovery = operation({
      operation_kind: "update",
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(recovery);
    mocks.acquireOperation.mockResolvedValue({
      operation: recovery,
      claimToken: CLAIM_TOKEN,
    });
    mocks.calendarGet.mockResolvedValue({
      data: markedEvent(OPERATION_ID, { id: EVENT_ID }),
    });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
    expect(mocks.markApplied).toHaveBeenCalledOnce();
  });

  it("terminalizes a recovered no-marker UPDATE without mutating again", async () => {
    const recovery = operation({
      operation_kind: "update",
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(recovery);
    mocks.acquireOperation.mockResolvedValue({ operation: recovery, claimToken: CLAIM_TOKEN });
    prepareUpdateEvent();

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).toHaveBeenCalledOnce();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  it("cancels linked local authority when recovered UPDATE target is absent", async () => {
    const recovery = operation({
      operation_kind: "update",
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      linked_booking_id: "30000000-0000-4000-8000-000000000001",
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(recovery);
    mocks.acquireOperation.mockResolvedValue({ operation: recovery, claimToken: CLAIM_TOKEN });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(409);
    expect(mocks.resolveAbsent).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN
    );
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });

  it("finalizes provider_applied UPDATE without tokens or Google", async () => {
    const applied = operation({
      operation_kind: "update",
      status: "provider_applied",
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_event_id: EVENT_ID,
      provider_starts_at: START_TIME,
      provider_ends_at: END_TIME,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(applied);
    mocks.acquireOperation.mockResolvedValue({ operation: applied, claimToken: CLAIM_TOKEN });
    mocks.finalizeOperation.mockResolvedValue({ ...applied, status: "finalized" });

    const response = await PATCH(patchRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarGet).not.toHaveBeenCalled();
    expect(mocks.calendarPatch).not.toHaveBeenCalled();
  });
});

describe("calendar DELETE provider operation", () => {
  it("fences and records provider absence before local finalization", async () => {
    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.markSubmissionStarted).toHaveBeenCalledBefore(
      mocks.calendarDelete
    );
    expect(mocks.calendarDelete).toHaveBeenCalledWith(
      {
        calendarId: "primary",
        eventId: EVENT_ID,
        sendUpdates: "all",
      },
      { timeout: 60_000, retry: false }
    );
    expect(mocks.markDeleteApplied).toHaveBeenCalledBefore(
      mocks.finalizeOperation
    );
  });

  it("retains submitted DELETE authority when credential reload returns null", async () => {
    const submitted = operation({
      operation_kind: "delete",
      desired_starts_at: null,
      desired_ends_at: null,
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(submitted);
    mocks.acquireOperation.mockResolvedValue({
      operation: submitted,
      claimToken: CLAIM_TOKEN,
    });
    mocks.getAuthenticatedClient
      .mockResolvedValueOnce({ credentials: true })
      .mockResolvedValueOnce(null);

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).not.toHaveBeenCalled();
    expect(mocks.calendarDelete).not.toHaveBeenCalled();
  });

  it.each([404, 410])("treats provider %s as idempotent absence", async (status) => {
    mocks.calendarDelete.mockRejectedValue({ response: { status } });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.markDeleteApplied).toHaveBeenCalledOnce();
    expect(mocks.finalizeOperation).toHaveBeenCalledOnce();
  });

  it("keeps an ambiguous DELETE held without issuing a hidden retry", async () => {
    mocks.calendarDelete.mockRejectedValue({ response: { status: 503 } });
    mocks.calendarGet.mockRejectedValue(new Error("provider read unavailable"));

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(mocks.calendarDelete).toHaveBeenCalledOnce();
    expect(mocks.failOperation).not.toHaveBeenCalled();
    expect(mocks.markDeleteApplied).not.toHaveBeenCalled();
  });

  it("recovers cancelled provider resources as absence without deleting again", async () => {
    const recovery = operation({
      operation_kind: "delete",
      desired_starts_at: null,
      desired_ends_at: null,
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(recovery);
    mocks.acquireOperation.mockResolvedValue({ operation: recovery, claimToken: CLAIM_TOKEN });
    mocks.calendarGet.mockResolvedValue({
      data: { id: EVENT_ID, status: "cancelled" },
    });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.calendarDelete).not.toHaveBeenCalled();
    expect(mocks.markDeleteApplied).toHaveBeenCalledOnce();
  });

  it("terminalizes recovered DELETE when one definitive read finds it present", async () => {
    const recovery = operation({
      operation_kind: "delete",
      desired_starts_at: null,
      desired_ends_at: null,
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(recovery);
    mocks.acquireOperation.mockResolvedValue({ operation: recovery, claimToken: CLAIM_TOKEN });
    mocks.calendarGet.mockResolvedValue({ data: { id: EVENT_ID, status: "confirmed" } });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(503);
    expect(mocks.failOperation).toHaveBeenCalledOnce();
    expect(mocks.calendarDelete).not.toHaveBeenCalled();
  });

  it("finalizes provider_applied DELETE without credentials or provider reads", async () => {
    const applied = operation({
      operation_kind: "delete",
      status: "provider_applied",
      desired_starts_at: null,
      desired_ends_at: null,
      deterministic_google_event_id: null,
      target_google_event_id: EVENT_ID,
      provider_target_event_id: EVENT_ID,
      provider_event_id: EVENT_ID,
      provider_submission_started_at: START_TIME,
    });
    mocks.readOperation.mockResolvedValue(applied);
    mocks.acquireOperation.mockResolvedValue({ operation: applied, claimToken: CLAIM_TOKEN });

    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.calendarGet).not.toHaveBeenCalled();
    expect(mocks.calendarDelete).not.toHaveBeenCalled();
  });
});
