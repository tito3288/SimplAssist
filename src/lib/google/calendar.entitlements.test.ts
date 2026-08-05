import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
  from: vi.fn(),
  assertBookingOperationallyAllowed: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/entitlements", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/billing/entitlements")>();
  return {
    ...actual,
    resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
    canUseFeature: mocks.canUseFeature,
  };
});
vi.mock("./client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
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

import { EntitlementResolutionError } from "@/lib/billing/entitlements";
import { BookingOperationalBlockedError } from "./bookingOperational.server";
import {
  checkAvailability,
  createBooking,
  DirectBookingNotEntitledError,
} from "./calendar";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const STARTER = {
  businessId: BUSINESS_ID,
  plan: "sms_only",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER);
  mocks.canUseFeature.mockReturnValue(false);
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
});

describe("direct booking entitlement boundary", () => {
  it("blocks availability at the fresh operational boundary before entitlement or Google access", async () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused"
    );
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(blocked);

    await expect(
      checkAvailability(BUSINESS_ID, "2026-07-20", "UTC")
    ).rejects.toBe(blocked);

    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.getCalendarService).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["availability", () => checkAvailability(BUSINESS_ID, "2026-07-20", "UTC")],
    [
      "booking",
      () =>
        createBooking(
          BUSINESS_ID,
          {
            customerName: "Jane",
            serviceName: "Estimate",
            startTime: "2026-07-20T10:00:00Z",
          },
          "UTC",
          {
            contactId: "00000000-0000-4000-8000-000000000002",
            conversationId: "00000000-0000-4000-8000-000000000003",
            sourceMessageId: "00000000-0000-4000-8000-000000000004",
          }
        ),
    ],
  ])("blocks %s before token or Google access", async (_name, operation) => {
    await expect(operation()).rejects.toBeInstanceOf(
      DirectBookingNotEntitledError
    );
    expect(mocks.canUseFeature).toHaveBeenCalledWith(STARTER, "direct_booking");
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.getCalendarService).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledWith(
      BUSINESS_ID
    );
  });

  it("preserves an indeterminate entitlement error for retry-safe callers", async () => {
    const error = new EntitlementResolutionError({
      code: "subscription_lookup_failed",
      businessId: BUSINESS_ID,
      message: "database unavailable",
    });
    mocks.resolveBusinessEntitlements.mockRejectedValue(error);

    await expect(
      checkAvailability(BUSINESS_ID, "2026-07-20", "UTC")
    ).rejects.toBe(error);
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
  });

  it("preserves an indeterminate operational read before availability side effects", async () => {
    const error = new Error("operational state unavailable");
    mocks.assertBookingOperationallyAllowed.mockRejectedValueOnce(error);

    await expect(
      checkAvailability(BUSINESS_ID, "2026-07-20", "UTC")
    ).rejects.toBe(error);
    expect(mocks.resolveBusinessEntitlements).not.toHaveBeenCalled();
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
  });
});
