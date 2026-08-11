import { renderToStaticMarkup } from "react-dom/server";
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
    requireWorkspacePageAccess: vi.fn(),
    getRequestBrand: vi.fn(),
    getDashboardEntitledContext: vi.fn(),
    canUseFeature: vi.fn(),
    assertBookingOperationallyAllowed: vi.fn(),
    BookingOperationalBlockedError,
    BookingOperationalStateError,
    OperationalControlsResolutionError,
  };
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspacePageAccess: mocks.requireWorkspacePageAccess,
}));
vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardEntitledContext: mocks.getDashboardEntitledContext,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: mocks.canUseFeature,
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

import CalendarPage from "./page";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const BOOKING_REQUEST_LIST_LIMIT = 200;

interface QueryResult {
  data?: unknown;
  count?: number | null;
  error: unknown;
}

interface QueryRecorder {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  then: Promise<QueryResult>["then"];
  catch: Promise<QueryResult>["catch"];
}

function query(result: QueryResult): QueryRecorder {
  const recorder = {} as QueryRecorder;
  const promise = Promise.resolve(result);
  recorder.select = vi.fn(() => recorder);
  recorder.eq = vi.fn(() => recorder);
  recorder.order = vi.fn(() => recorder);
  recorder.limit = vi.fn(() => recorder);
  recorder.single = vi.fn(() => promise);
  recorder.then = promise.then.bind(promise);
  recorder.catch = promise.catch.bind(promise);
  return recorder;
}

function bookingRequest(
  id: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    id,
    conversation_id: `conversation-${id}`,
    requested_service: `Service ${id}`,
    requested_time_text: "next Tuesday after lunch",
    customer_name: `Customer ${id}`,
    customer_phone: null,
    customer_email: null,
    status: "new",
    handled_at: null,
    created_at: "2026-08-10T17:30:00.000Z",
    contact: null,
    ...overrides,
  };
}

function dashboardContext({
  bookingEnabled = false,
  bookingMode = "schedule_direct",
  calendarToken = { google_email: "owner@example.com" } as {
    google_email: string;
  } | null,
  primaryGoal = null,
  requests = [] as ReturnType<typeof bookingRequest>[],
  listError = null as unknown,
  count = 0 as number | null,
  countError = null as unknown,
  timezone = "America/Indiana/Indianapolis",
}: {
  bookingEnabled?: boolean;
  bookingMode?: "collect_info" | "schedule_direct";
  calendarToken?: { google_email: string } | null;
  primaryGoal?: "book" | "signup" | "quote" | "callback" | null;
  requests?: ReturnType<typeof bookingRequest>[];
  listError?: unknown;
  count?: number | null;
  countError?: unknown;
  timezone?: string | null;
} = {}) {
  const calendar = query({ data: calendarToken, error: null });
  const settings = query({
    data: {
      booking_enabled: bookingEnabled,
      booking_mode: bookingMode,
    },
    error: null,
  });
  const requestList = query({ data: requests, error: listError });
  const requestCount = query({ count, error: countError });
  let bookingRequestReads = 0;
  const from = vi.fn((table: string) => {
    if (table === "google_calendar_tokens") return calendar;
    if (table === "ai_settings") return settings;
    if (table === "booking_requests") {
      bookingRequestReads += 1;
      return bookingRequestReads === 1 ? requestList : requestCount;
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    status: "resolved",
    supabase: { from },
    business: {
      id: BUSINESS_ID,
      primary_goal: primaryGoal,
      timezone,
    },
    entitlements: { active: true, plan: "sms_and_chat" },
    queries: { calendar, settings, requestList, requestCount },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.requireWorkspacePageAccess.mockResolvedValue(undefined);
  mocks.getRequestBrand.mockResolvedValue({
    brand: { name: "SimplAssist" },
  });
  mocks.getDashboardEntitledContext.mockResolvedValue(dashboardContext());
  mocks.canUseFeature.mockReturnValue(true);
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
});

describe("Calendar page primary-goal boundary", () => {
  it("redirects signup-goal businesses before token, settings, feature, or operational reads", async () => {
    const context = dashboardContext({ primaryGoal: "signup" });
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(context);

    await expect(CalendarPage()).rejects.toThrow("redirect:/dashboard");

    expect(context.supabase.from).not.toHaveBeenCalled();
    expect(mocks.getRequestBrand).toHaveBeenCalledOnce();
    expect(mocks.canUseFeature).not.toHaveBeenCalled();
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
  });

  it.each([null, "book", "quote", "callback"] as const)(
    "preserves the existing Calendar path for primary_goal=%s",
    async (primaryGoal) => {
      const context = dashboardContext({ primaryGoal });
      mocks.getDashboardEntitledContext.mockResolvedValueOnce(context);

      const html = renderToStaticMarkup(await CalendarPage());

      expect(html).toContain("Calendar");
      expect(context.supabase.from.mock.calls.map(([table]) => table)).toEqual([
        "google_calendar_tokens",
        "ai_settings",
        "booking_requests",
        "booking_requests",
      ]);
      expect(mocks.getRequestBrand).toHaveBeenCalledOnce();
      expect(mocks.canUseFeature).toHaveBeenCalledWith(
        context.entitlements,
        "calendar"
      );
      expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledWith(
        BUSINESS_ID
      );
    }
  );
});

describe("Calendar page appointment-request read model", () => {
  it("redirects unresolved sessions before appointment-request reads", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce({
      status: "unauthenticated",
    });

    await expect(CalendarPage()).rejects.toThrow("redirect:/login");
    expect(mocks.requireWorkspacePageAccess).toHaveBeenCalledOnce();

    mocks.getDashboardEntitledContext.mockResolvedValueOnce({
      status: "business_not_found",
    });
    await expect(CalendarPage()).rejects.toThrow("redirect:/onboarding");
  });

  it("uses the owner client for a capped stable list and an independent exact new count", async () => {
    const context = dashboardContext({
      bookingEnabled: true,
      bookingMode: "collect_info",
    });
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(context);

    await CalendarPage();

    expect(context.supabase.from.mock.calls.map(([table]) => table)).toEqual([
      "google_calendar_tokens",
      "ai_settings",
      "booking_requests",
      "booking_requests",
    ]);
    expect(context.queries.settings.select).toHaveBeenCalledWith(
      "booking_enabled,booking_mode"
    );
    expect(
      String(context.queries.requestList.select.mock.calls[0]?.[0])
        .replace(/\s+/g, " ")
        .trim()
    ).toBe(
      "id, conversation_id, requested_service, requested_time_text, customer_name, customer_phone, customer_email, status, handled_at, created_at, contact:contacts!booking_requests_contact_id_fkey ( name, phone_number, email )"
    );
    expect(context.queries.requestList.eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
    ]);
    expect(context.queries.requestList.order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(context.queries.requestList.limit).toHaveBeenCalledWith(
      BOOKING_REQUEST_LIST_LIMIT
    );
    expect(context.queries.requestCount.select).toHaveBeenCalledWith("id", {
      count: "exact",
      head: true,
    });
    expect(context.queries.requestCount.eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
      ["status", "new"],
    ]);
    expect(context.queries.requestCount.order).not.toHaveBeenCalled();
    expect(context.queries.requestCount.limit).not.toHaveBeenCalled();
  });

  it("shows an empty queue only while active collect mode can receive requests", async () => {
    const inactive = dashboardContext({
      bookingEnabled: true,
      bookingMode: "schedule_direct",
    });
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(inactive);
    const inactiveHtml = renderToStaticMarkup(await CalendarPage());
    expect(inactiveHtml).not.toContain("Appointment requests");

    const active = dashboardContext({
      bookingEnabled: true,
      bookingMode: "collect_info",
    });
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(active);
    const activeHtml = renderToStaticMarkup(await CalendarPage());
    expect(activeHtml).toContain("Appointment requests");
    expect(activeHtml).toContain("No appointment requests yet.");
    expect(activeHtml).toContain("New requests");
    expect(activeHtml).toContain(">0</p>");
  });

  it.each([
    ["mode change", true, "schedule_direct"],
    ["booking disablement", false, "collect_info"],
  ] as const)(
    "keeps historical requests visible after %s",
    async (_label, bookingEnabled, bookingMode) => {
      mocks.getDashboardEntitledContext.mockResolvedValueOnce(
        dashboardContext({
          bookingEnabled,
          bookingMode,
          requests: [
            bookingRequest("history", {
              status: "handled",
              handled_at: "2026-08-11T18:00:00.000Z",
            }),
          ],
          count: 0,
        })
      );

      const html = renderToStaticMarkup(await CalendarPage());
      expect(html).toContain("Appointment requests");
      expect(html).toContain("Service history");
      expect(html).toContain("Handled");
    }
  );

  it("keeps historical requests above Calendar content during an operational pause", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        requests: [bookingRequest("paused")],
        count: 1,
      })
    );
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
      new mocks.BookingOperationalBlockedError(BUSINESS_ID, "bookings_paused")
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html.indexOf("Appointment requests")).toBeLessThan(
      html.indexOf("New event creation is paused.")
    );
    expect(html).toContain("Service paused");
  });

  it("places requests before the connection card and connected Calendar surface", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        bookingEnabled: true,
        calendarToken: null,
        requests: [bookingRequest("disconnected")],
        count: 1,
      })
    );
    const disconnectedHtml = renderToStaticMarkup(await CalendarPage());
    expect(disconnectedHtml.indexOf("Appointment requests")).toBeLessThan(
      disconnectedHtml.indexOf(
        "Connect Google Calendar to make direct scheduling available for your assistant."
      )
    );

    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        requests: [bookingRequest("connected")],
        count: 1,
      })
    );
    const connectedHtml = renderToStaticMarkup(await CalendarPage());
    expect(connectedHtml.indexOf("Appointment requests")).toBeLessThan(
      connectedHtml.indexOf('aria-label="Create event"')
    );
  });

  it("keeps historical requests above the locked card after a Calendar-plan downgrade", async () => {
    mocks.canUseFeature.mockReturnValue(false);
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        requests: [bookingRequest("downgrade")],
        count: 1,
      })
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html).toContain("Service downgrade");
    expect(html.indexOf("Appointment requests")).toBeLessThan(
      html.indexOf("Google Calendar is available on Growth")
    );
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
  });

  it("renders a successful list when its independent count fails", async () => {
    const countError = { message: "count unavailable" };
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        requests: [bookingRequest("count-failure")],
        count: null,
        countError,
      })
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html).toContain("Service count-failure");
    expect(html).toContain(">—</p>");
    expect(html).not.toContain("Appointment requests could not be loaded.");
    expect(console.error).toHaveBeenCalledWith(
      `[calendar:page] Could not count new appointment requests for business=${BUSINESS_ID}:`,
      countError
    );
  });

  it("separates a list failure from empty history while preserving a successful count", async () => {
    const listError = { message: "list unavailable" };
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({ listError, count: 7 })
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html).toContain("Appointment requests could not be loaded.");
    expect(html).not.toContain("No appointment requests yet.");
    expect(html).toContain(">7</p>");
    expect(console.error).toHaveBeenCalledWith(
      `[calendar:page] Could not load appointment requests for business=${BUSINESS_ID}:`,
      listError
    );
  });

  it("treats an unavailable exact count as possible history instead of hiding it", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({ count: null })
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html).toContain("Appointment requests");
    expect(html).toContain(">—</p>");
  });

  it("passes the business timezone through for request system timestamps", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({
        timezone: "America/Indiana/Indianapolis",
        requests: [
          bookingRequest("timezone", {
            created_at: "2026-08-10T17:30:00.000Z",
            status: "handled",
            handled_at: "2026-08-11T18:00:00.000Z",
          }),
        ],
        count: 0,
      })
    );

    const html = renderToStaticMarkup(await CalendarPage());
    expect(html).toContain("Aug 10, 2026, 1:30 PM");
    expect(html).toContain("Aug 11, 2026, 2:00 PM");
  });
});

describe("Calendar page Google Calendar connection prompt", () => {
  it.each([
    ["booking is enabled and Calendar is disconnected", true, null, true],
    [
      "Calendar is already connected",
      true,
      { google_email: "owner@example.com" },
      false,
    ],
    ["booking is disabled", false, null, false],
  ] as const)(
    "%s",
    async (_scenario, bookingEnabled, calendarToken, shouldShowPrompt) => {
      mocks.getDashboardEntitledContext.mockResolvedValueOnce(
        dashboardContext({ bookingEnabled, calendarToken })
      );

      const html = renderToStaticMarkup(await CalendarPage());

      expect(html.includes("Connect Google Calendar")).toBe(shouldShowPrompt);
      expect(
        html.includes(
          "Connect Google Calendar to make direct scheduling available for your assistant."
        )
      ).toBe(shouldShowPrompt);
    }
  );

  it("places the connection card before the Calendar view", async () => {
    mocks.getDashboardEntitledContext.mockResolvedValueOnce(
      dashboardContext({ bookingEnabled: true, calendarToken: null })
    );

    const html = renderToStaticMarkup(await CalendarPage());

    expect(
      html.indexOf(
        "Connect Google Calendar to make direct scheduling available for your assistant."
      )
    ).toBeLessThan(html.indexOf("Connect your Google Calendar"));
  });
});

describe("Calendar page event creation state", () => {
  it("keeps creation available after a fresh allowed read", async () => {
    const html = renderToStaticMarkup(await CalendarPage());

    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledWith(
      BUSINESS_ID
    );
    expect(html).toContain('aria-label="Create event"');
    expect(html).not.toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Create event"/
    );
  });

  it.each([
    [
      "account_suspended",
      "New event creation is unavailable while your account is suspended.",
    ],
    ["bookings_paused", "New event creation is paused."],
  ] as const)(
    "maps %s to disabled creation while retaining the Calendar page",
    async (reason, expectedCopy) => {
      mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
        new mocks.BookingOperationalBlockedError(BUSINESS_ID, reason)
      );

      const html = renderToStaticMarkup(await CalendarPage());

      expect(html).toContain("Calendar");
      expect(html).toContain(expectedCopy);
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*aria-label="Create event"/
      );
    }
  );

  it("keeps the Calendar readable when control state is temporarily unavailable", async () => {
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(
      new mocks.OperationalControlsResolutionError(BUSINESS_ID)
    );

    const html = renderToStaticMarkup(await CalendarPage());

    expect(html).toContain("Calendar");
    expect(html).toContain(
      "New event creation is temporarily unavailable while we check booking status."
    );
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*aria-label="Create event"/
    );
  });

  it("does not read operational state when Calendar is not entitled", async () => {
    mocks.canUseFeature.mockReturnValue(false);

    const html = renderToStaticMarkup(await CalendarPage());

    expect(html).toContain("Google Calendar is available on Growth");
    expect(mocks.assertBookingOperationallyAllowed).not.toHaveBeenCalled();
  });
});
