import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({
  randomUUID: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  tokenSelect: vi.fn(),
  tokenBusinessEq: vi.fn(),
  tokenSingle: vi.fn(),
  eventsGet: vi.fn(),
  eventsList: vi.fn(),
  eventsInsert: vi.fn(),
  assertBookingOperationallyAllowed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("node:crypto", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:crypto")>()),
  randomUUID: mocks.randomUUID,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("./client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("./bookingOperational.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./bookingOperational.server")>();
  return {
    ...actual,
    assertBookingOperationallyAllowed:
      mocks.assertBookingOperationallyAllowed,
  };
});

import { OperationalControlsResolutionError } from "@/lib/account/operationalControls.server";
import {
  BookingOperationalBlockedError,
} from "./bookingOperational.server";
import {
  CalendarBookingInProgressError,
  claimCalendarBookingReconciliation,
  createBooking,
  failCalendarBookingRecovery,
  recoverCalendarBookingConfirmation,
} from "./calendar";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CONTACT_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const SOURCE_MESSAGE_ID = "00000000-0000-4000-8000-000000000004";
const BOOKING_ID = "00000000-0000-4000-8000-000000000005";
const CALENDAR_ID = "connected-calendar";
const STARTS_AT = "2026-08-01T14:00:00.000Z";
const ENDS_AT = "2026-08-01T14:30:00.000Z";
const CURRENT_CLAIM = "00000000-0000-4000-8000-000000000006";
const OTHER_CLAIM = "00000000-0000-4000-8000-000000000007";

const params = {
  customerName: "Jane Customer",
  customerPhone: "+13175550123",
  customerEmail: "jane@example.com",
  serviceName: "Estimate",
  startTime: STARTS_AT,
  durationMinutes: 30,
};

const linkage = {
  contactId: CONTACT_ID,
  conversationId: CONVERSATION_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
};

const REQUEST_FINGERPRINT = createHash("sha256")
  .update(
    JSON.stringify({
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      customerEmail: params.customerEmail,
      serviceName: params.serviceName,
      startTime: STARTS_AT,
      endTime: ENDS_AT,
      timezone: "UTC",
    })
  )
  .digest("hex");

function bookingRow(
  overrides: Partial<{
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
  }> = {}
) {
  return {
    id: BOOKING_ID,
    business_id: BUSINESS_ID,
    contact_id: CONTACT_ID,
    conversation_id: CONVERSATION_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    google_calendar_id: CALENDAR_ID,
    google_event_id: null,
    event_summary: "Estimate - Jane Customer",
    request_fingerprint: REQUEST_FINGERPRINT,
    operation_claim_token: CURRENT_CLAIM,
    operation_claimed_at: "2026-08-01T13:59:00.000Z",
    reconciliation_attempt_count: 0,
    reconciliation_attempted_at: null,
    status: "pending" as const,
    starts_at: STARTS_AT,
    ends_at: ENDS_AT,
    ...overrides,
  };
}

function googleEvent(id = "google-event-1") {
  return {
    id,
    summary: "Estimate - Jane Customer",
    start: { dateTime: STARTS_AT },
    end: { dateTime: ENDS_AT },
    extendedProperties: {
      private: { simplassist_booking_id: BOOKING_ID },
    },
  };
}

async function book() {
  return createBooking(BUSINESS_ID, params, "UTC", linkage);
}

beforeEach(() => {
  vi.resetAllMocks();

  const tokenQuery = {
    select: mocks.tokenSelect,
    eq: mocks.tokenBusinessEq,
    single: mocks.tokenSingle,
  };
  mocks.tokenSelect.mockReturnValue(tokenQuery);
  mocks.tokenBusinessEq.mockReturnValue(tokenQuery);
  mocks.tokenSingle.mockResolvedValue({
    data: { calendar_id: CALENDAR_ID },
    error: null,
  });

  mocks.from.mockImplementation((table: string) => {
    if (table === "google_calendar_tokens") return tokenQuery;
    throw new Error(`Unexpected Supabase table: ${table}`);
  });

  mocks.resolveBusinessEntitlements.mockResolvedValue({
    businessId: BUSINESS_ID,
    plan: "full",
    status: "active",
    source: "subscription",
    active: true,
    cancelAtPeriodEnd: false,
  });
  mocks.canUseFeature.mockReturnValue(true);
  mocks.getAuthenticatedClient.mockResolvedValue({ credentials: {} });
  mocks.getCalendarService.mockReturnValue({
    events: {
      get: mocks.eventsGet,
      list: mocks.eventsList,
      insert: mocks.eventsInsert,
    },
  });
  mocks.randomUUID.mockReturnValue(CURRENT_CLAIM);
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
  mocks.eventsGet.mockRejectedValue({ response: { status: 404 } });
  mocks.eventsList.mockResolvedValue({ data: { items: [] } });
  mocks.eventsInsert.mockResolvedValue({ data: googleEvent() });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBooking lifecycle", () => {
  it.each([
    [
      "account suspension",
      new BookingOperationalBlockedError(BUSINESS_ID, "account_suspended"),
    ],
    [
      "booking pause",
      new BookingOperationalBlockedError(BUSINESS_ID, "bookings_paused"),
    ],
  ])(
    "blocks entry on %s before entitlement, token, reservation, or Google work",
    async (_name, error) => {
      mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(error);

      await expect(book()).rejects.toBe(error);

      expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
      expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
      expect(mocks.from).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.eventsGet).not.toHaveBeenCalled();
      expect(mocks.eventsList).not.toHaveBeenCalled();
      expect(mocks.eventsInsert).not.toHaveBeenCalled();
    },
  );

  it("preserves entry resolver uncertainty before any booking side effect", async () => {
    const error = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "database unavailable",
    });
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(error);

    await expect(book()).rejects.toBe(error);

    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("reserves before Google, tags the event, and confirms the reservation", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_event_id: "google-event-1",
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });

    await expect(book()).resolves.toEqual({
      eventId: "google-event-1",
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      1,
      "reserve_calendar_booking",
      {
        p_business_id: BUSINESS_ID,
        p_contact_id: CONTACT_ID,
        p_conversation_id: CONVERSATION_ID,
        p_source_message_id: SOURCE_MESSAGE_ID,
        p_starts_at: STARTS_AT,
        p_ends_at: ENDS_AT,
        p_claim_token: CURRENT_CLAIM,
        p_google_calendar_id: CALENDAR_ID,
        p_event_summary: "Estimate - Jane Customer",
        p_request_fingerprint: REQUEST_FINGERPRINT,
      }
    );
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.eventsList.mock.invocationCallOrder[0]
    );
    expect(mocks.eventsList).toHaveBeenCalledWith({
      calendarId: CALENDAR_ID,
      maxResults: 1,
      showDeleted: false,
      singleEvents: true,
      privateExtendedProperty: [
        `simplassist_booking_id=${BOOKING_ID}`,
      ],
    });
    expect(mocks.eventsInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: CALENDAR_ID,
        sendUpdates: "all",
        requestBody: expect.objectContaining({
          id: BOOKING_ID.replaceAll("-", ""),
          extendedProperties: {
            private: {
              simplassist_booking_id: BOOKING_ID,
              simplassist_business_id: BUSINESS_ID,
              simplassist_contact_id: CONTACT_ID,
              simplassist_conversation_id: CONVERSATION_ID,
              simplassist_source_message_id: SOURCE_MESSAGE_ID,
            },
          },
        }),
      })
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "confirm_calendar_booking",
      {
        p_business_id: BUSINESS_ID,
        p_booking_id: BOOKING_ID,
        p_google_event_id: "google-event-1",
        p_starts_at: STARTS_AT,
        p_ends_at: ENDS_AT,
        p_claim_token: CURRENT_CLAIM,
      }
    );
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(
      mocks.assertBookingOperationallyAllowed.mock.invocationCallOrder[1],
    ).toBeLessThan(mocks.eventsInsert.mock.invocationCallOrder[0]);
  });

  it("maps a reservation fence denial to the fresh known booking block", async () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(blocked);
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "calendar booking business is not active" },
    });

    await expect(book()).rejects.toBe(blocked);

    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(mocks.eventsGet).not.toHaveBeenCalled();
    expect(mocks.eventsList).not.toHaveBeenCalled();
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("preserves resolver uncertainty while interpreting a reservation fence denial", async () => {
    const uncertain = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "database unavailable",
    });
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(uncertain);
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "calendar booking business is not active" },
    });

    await expect(book()).rejects.toBe(uncertain);

    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("fails a claimed reservation before Google when booking pauses after recovery search", async () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(blocked);
    mocks.rpc
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockResolvedValueOnce({
        data: bookingRow({
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "failed",
        }),
        error: null,
      });

    await expect(book()).rejects.toBe(blocked);

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "fail_calendar_booking", {
      p_business_id: BUSINESS_ID,
      p_booking_id: BOOKING_ID,
      p_claim_token: CURRENT_CLAIM,
      p_failure_reason:
        "Booking was blocked before Google Calendar submission.",
    });
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("leaves the claim pending for reconciliation when the final control read is indeterminate", async () => {
    const uncertain = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "database unavailable",
    });
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(uncertain);
    mocks.rpc.mockResolvedValueOnce({ data: bookingRow(), error: null });

    await expect(book()).rejects.toBe(uncertain);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "fail_calendar_booking",
      expect.anything(),
    );
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["database error", { data: null, error: { message: "database offline" } }],
    ["malformed row", { data: { status: "failed" }, error: null }],
    ["still-pending row", { data: bookingRow(), error: null }],
    [
      "failed row with a live claim",
      { data: bookingRow({ status: "failed" }), error: null },
    ],
    [
      "confirmed row without a provider ID",
      {
        data: bookingRow({
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      },
    ],
  ])(
    "surfaces typed retryable state uncertainty when pause cleanup returns a %s",
    async (_name, cleanupResult) => {
      const blocked = new BookingOperationalBlockedError(
        BUSINESS_ID,
        "bookings_paused",
      );
      mocks.assertBookingOperationallyAllowed
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(blocked);
      mocks.rpc
        .mockResolvedValueOnce({ data: bookingRow(), error: null })
        .mockResolvedValueOnce(cleanupResult);

      await expect(book()).rejects.toMatchObject({
        name: "BookingOperationalStateError",
        code: "booking_cleanup_failed",
        businessId: BUSINESS_ID,
        retryable: true,
      });

      expect(mocks.eventsInsert).not.toHaveBeenCalled();
    },
  );

  it("surfaces typed retryable state uncertainty when pause cleanup throws", async () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    const cleanupError = new Error("connection dropped");
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(blocked);
    mocks.rpc
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockRejectedValueOnce(cleanupError);

    await expect(book()).rejects.toMatchObject({
      name: "BookingOperationalStateError",
      code: "booking_cleanup_failed",
      businessId: BUSINESS_ID,
      retryable: true,
      cause: cleanupError,
    });

    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("returns a concurrent confirmed result when confirmation wins the pause-cleanup race", async () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "account_suspended",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(blocked);
    mocks.rpc
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_event_id: "concurrent-event",
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });

    await expect(book()).resolves.toEqual({
      eventId: "concurrent-event",
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("short-circuits with stored event details when a duplicate tool call changes input", async () => {
    const laterPause = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(laterPause);
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow({
        google_event_id: "existing-event",
        operation_claim_token: null,
        operation_claimed_at: null,
        status: "confirmed",
      }),
      error: null,
    });

    await expect(
      createBooking(
        BUSINESS_ID,
        {
          ...params,
          customerName: "Different Name",
          serviceName: "Different Service",
        },
        "UTC",
        linkage
      )
    ).resolves.toEqual({
      eventId: "existing-event",
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.eventsList).not.toHaveBeenCalled();
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(1);
  });

  it("refuses to create when pending source-message details change", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow(),
      error: null,
    });

    await expect(
      createBooking(
        BUSINESS_ID,
        { ...params, serviceName: "Different Service" },
        "UTC",
        linkage
      )
    ).rejects.toThrow("replayed with different booking details");

    expect(mocks.eventsGet).not.toHaveBeenCalled();
    expect(mocks.eventsList).not.toHaveBeenCalled();
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("recovers existing provider evidence after an allowed entry without applying the new-insert pause gate", async () => {
    const laterPause = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(laterPause);
    mocks.rpc
      .mockResolvedValueOnce({
        data: bookingRow({ operation_claim_token: OTHER_CLAIM }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_event_id: "recovered-event",
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });
    mocks.eventsList.mockResolvedValueOnce({
      data: { items: [googleEvent("recovered-event")] },
    });

    await expect(book()).resolves.toEqual({
      eventId: "recovered-event",
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.eventsInsert).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "confirm_calendar_booking",
      expect.objectContaining({ p_claim_token: OTHER_CLAIM })
    );
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(1);
  });

  it("recovers from the reservation's original calendar after selection changes", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: bookingRow({
          google_calendar_id: "original-calendar",
          operation_claim_token: OTHER_CLAIM,
        }),
        error: null,
      })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_calendar_id: "original-calendar",
          google_event_id: BOOKING_ID.replaceAll("-", ""),
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });
    mocks.eventsGet.mockResolvedValueOnce({
      data: googleEvent(BOOKING_ID.replaceAll("-", "")),
    });

    await expect(book()).resolves.toMatchObject({
      eventId: BOOKING_ID.replaceAll("-", ""),
    });

    expect(mocks.eventsGet).toHaveBeenCalledWith({
      calendarId: "original-calendar",
      eventId: BOOKING_ID.replaceAll("-", ""),
    });
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
  });

  it("does not insert when another caller owns a fresh pending claim", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow({ operation_claim_token: OTHER_CLAIM }),
      error: null,
    });

    await expect(book()).rejects.toEqual(
      new CalendarBookingInProgressError(BOOKING_ID)
    );

    expect(mocks.eventsList).toHaveBeenCalledTimes(1);
    expect(mocks.eventsInsert).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("fails only its claimed pending reservation for a definitive Google rejection", async () => {
    const providerError = Object.assign(
      new Error("Google rejected the event payload"),
      { response: { status: 400 } }
    );
    mocks.rpc
      .mockResolvedValueOnce({
        data: bookingRow(),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    mocks.eventsInsert.mockRejectedValueOnce(providerError);

    await expect(book()).rejects.toBe(providerError);

    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "fail_calendar_booking",
      {
        p_business_id: BUSINESS_ID,
        p_booking_id: BOOKING_ID,
        p_claim_token: CURRENT_CLAIM,
        p_failure_reason: providerError.message,
      }
    );
  });

  it("keeps an ambiguous Google failure pending when recovery finds no event", async () => {
    const providerError = new Error("Google insert timed out");
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow(),
      error: null,
    });
    mocks.eventsInsert.mockRejectedValueOnce(providerError);

    await expect(book()).rejects.toBe(providerError);

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "fail_calendar_booking",
      expect.anything()
    );
  });

  it("does not log provider details when insert recovery also fails", async () => {
    const insertError = new Error("Google insert timed out");
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow(),
      error: null,
    });
    mocks.eventsGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockRejectedValueOnce(
        new Error("jane@example.com authorization=secret")
      );
    mocks.eventsInsert.mockRejectedValueOnce(insertError);

    await expect(book()).rejects.toBe(insertError);

    const logged = JSON.stringify(
      vi.mocked(console.error).mock.calls
    );
    expect(logged).not.toContain("jane@example.com");
    expect(logged).not.toContain("authorization");
    expect(logged).not.toContain("secret");
    expect(console.error).toHaveBeenCalledWith(
      `[calendar] Could not reconcile ambiguous Google insert for booking ${BOOKING_ID}`
    );
  });

  it("recovers an ambiguous Google failure by deterministic event ID", async () => {
    const providerError = new Error("Google insert timed out");
    const pauseAfterProviderSubmission = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    mocks.assertBookingOperationallyAllowed
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(pauseAfterProviderSubmission);
    mocks.rpc
      .mockResolvedValueOnce({
        data: bookingRow(),
        error: null,
      })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_event_id: BOOKING_ID.replaceAll("-", ""),
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });
    mocks.eventsGet
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockResolvedValueOnce({
        data: googleEvent(BOOKING_ID.replaceAll("-", "")),
      });
    mocks.eventsInsert.mockRejectedValueOnce(providerError);

    await expect(book()).resolves.toEqual({
      eventId: BOOKING_ID.replaceAll("-", ""),
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.eventsInsert).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "confirm_calendar_booking",
      expect.objectContaining({
        p_google_event_id: BOOKING_ID.replaceAll("-", ""),
      })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "fail_calendar_booking",
      expect.anything()
    );
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
  });

  it("leaves a successful Google insert pending so a retry can recover it", async () => {
    mocks.randomUUID
      .mockReturnValueOnce(CURRENT_CLAIM)
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000008");
    mocks.rpc
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "database unavailable after Google insert" },
      })
      .mockResolvedValueOnce({ data: bookingRow(), error: null })
      .mockResolvedValueOnce({
        data: bookingRow({
          google_event_id: "google-event-1",
          operation_claim_token: null,
          operation_claimed_at: null,
          status: "confirmed",
        }),
        error: null,
      });
    mocks.eventsList
      .mockResolvedValueOnce({ data: { items: [] } })
      .mockResolvedValueOnce({
        data: { items: [googleEvent()] },
      });

    await expect(book()).rejects.toThrow(
      "Could not confirm calendar booking: database unavailable after Google insert"
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(2);

    await expect(book()).resolves.toEqual({
      eventId: "google-event-1",
      summary: "Estimate - Jane Customer",
      startTime: STARTS_AT,
      endTime: ENDS_AT,
    });

    expect(mocks.eventsInsert).toHaveBeenCalledTimes(1);
    expect(mocks.eventsList).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      4,
      "confirm_calendar_booking",
      expect.objectContaining({
        p_booking_id: BOOKING_ID,
        p_google_event_id: "google-event-1",
        p_claim_token: CURRENT_CLAIM,
      })
    );
    expect(mocks.rpc).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      name: "cancelled deterministic event",
      providerResult: {
        kind: "resolved" as const,
        value: {
          data: { ...googleEvent(), status: "cancelled" },
        },
      },
    },
    {
      name: "410-deleted deterministic event",
      providerResult: {
        kind: "rejected" as const,
        value: { response: { status: 410 } },
      },
    },
  ])(
    "does not confirm a $name during stale-claim recovery",
    async ({ providerResult }) => {
      const pending = bookingRow();
      if (providerResult.kind === "resolved") {
        mocks.eventsGet.mockResolvedValueOnce(providerResult.value);
      } else {
        mocks.eventsGet.mockRejectedValueOnce(providerResult.value);
      }
      mocks.eventsList.mockResolvedValueOnce({ data: { items: [] } });

      await expect(
        recoverCalendarBookingConfirmation(pending)
      ).resolves.toBe(false);

      expect(mocks.rpc).not.toHaveBeenCalledWith(
        "confirm_calendar_booking",
        expect.anything()
      );
    }
  );

  it("releases a stale reservation whose Google event is still missing", async () => {
    const pending = bookingRow();
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow({
        operation_claim_token: null,
        operation_claimed_at: null,
        status: "failed",
      }),
      error: null,
    });

    await expect(
      failCalendarBookingRecovery(pending)
    ).resolves.toBe("failed");

    expect(mocks.rpc).toHaveBeenCalledWith("fail_calendar_booking", {
      p_business_id: BUSINESS_ID,
      p_booking_id: BOOKING_ID,
      p_claim_token: CURRENT_CLAIM,
      p_failure_reason:
        "Google Calendar event was not found during booking reconciliation.",
    });
  });

  it("atomically renews a stale claim before provider reconciliation", async () => {
    const pending = bookingRow();
    mocks.rpc.mockResolvedValueOnce({
      data: bookingRow({
        operation_claimed_at: "2026-08-01T14:10:00.000Z",
        reconciliation_attempt_count: 1,
        reconciliation_attempted_at: "2026-08-01T14:10:00.000Z",
      }),
      error: null,
    });

    await expect(
      claimCalendarBookingReconciliation(pending)
    ).resolves.toMatchObject({
      status: "pending",
      reconciliation_attempt_count: 1,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "claim_calendar_booking_reconciliation",
      {
        p_business_id: BUSINESS_ID,
        p_booking_id: BOOKING_ID,
        p_claim_token: CURRENT_CLAIM,
      }
    );
  });
});
