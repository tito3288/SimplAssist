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

function dashboardContext({
  bookingEnabled = false,
  calendarToken = { google_email: "owner@example.com" } as {
    google_email: string;
  } | null,
}: {
  bookingEnabled?: boolean;
  calendarToken?: { google_email: string } | null;
} = {}) {
  const from = vi.fn((table: string) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data:
          table === "google_calendar_tokens"
            ? calendarToken
            : { booking_enabled: bookingEnabled },
        error: null,
      }),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    return query;
  });

  return {
    status: "resolved",
    supabase: { from },
    business: { id: BUSINESS_ID },
    entitlements: { active: true, plan: "sms_and_chat" },
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
