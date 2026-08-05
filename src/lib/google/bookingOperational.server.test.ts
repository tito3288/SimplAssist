import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveBusinessOperationalControls: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));
vi.mock("@/lib/account/operationalControls.server", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/lib/account/operationalControls.server")
    >();
  return {
    ...actual,
    resolveBusinessOperationalControls:
      mocks.resolveBusinessOperationalControls,
  };
});

import { OperationalControlsResolutionError } from "@/lib/account/operationalControls.server";
import {
  assertBookingOperationallyAllowed,
  BookingOperationalBlockedError,
  BookingOperationalStateError,
  isBookingOperationalBlockedError,
  isBookingOperationalStateError,
} from "./bookingOperational.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

function controls(
  overrides: Partial<{
    operationsSuspendedAt: string | null;
    aiRepliesPausedAt: string | null;
    textingPausedAt: string | null;
    bookingsPausedAt: string | null;
  }> = {},
) {
  return {
    businessId: BUSINESS_ID,
    operationsSuspendedAt: null,
    aiRepliesPausedAt: null,
    textingPausedAt: null,
    bookingsPausedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveBusinessOperationalControls.mockResolvedValue(controls());
});

describe("booking operational enforcement", () => {
  it("allows booking while the account and booking service are active", async () => {
    await expect(
      assertBookingOperationallyAllowed(BUSINESS_ID),
    ).resolves.toBeUndefined();
    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledWith(
      BUSINESS_ID,
    );
  });

  it("returns account suspension ahead of an independent booking pause", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      controls({
        operationsSuspendedAt: "2026-08-04T12:00:00.000Z",
        bookingsPausedAt: "2026-08-04T12:01:00.000Z",
      }),
    );

    await expect(
      assertBookingOperationallyAllowed(BUSINESS_ID),
    ).rejects.toEqual(
      new BookingOperationalBlockedError(BUSINESS_ID, "account_suspended"),
    );
  });

  it("returns a typed independent booking pause", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      controls({ bookingsPausedAt: "2026-08-04T12:01:00.000Z" }),
    );

    await expect(
      assertBookingOperationallyAllowed(BUSINESS_ID),
    ).rejects.toMatchObject({
      name: "BookingOperationalBlockedError",
      businessId: BUSINESS_ID,
      reason: "bookings_paused",
    });
  });

  it("does not treat AI or texting pauses as booking blocks", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      controls({
        aiRepliesPausedAt: "2026-08-04T12:01:00.000Z",
        textingPausedAt: "2026-08-04T12:02:00.000Z",
      }),
    );

    await expect(
      assertBookingOperationallyAllowed(BUSINESS_ID),
    ).resolves.toBeUndefined();
  });

  it("preserves resolver uncertainty for retry-safe callers", async () => {
    const error = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "database unavailable",
    });
    mocks.resolveBusinessOperationalControls.mockRejectedValue(error);

    await expect(
      assertBookingOperationallyAllowed(BUSINESS_ID),
    ).rejects.toBe(error);
  });

  it("exposes strict predicates for known blocks and state uncertainty", () => {
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    const uncertain = new BookingOperationalStateError({
      businessId: BUSINESS_ID,
      code: "booking_cleanup_failed",
      message: "cleanup failed",
    });

    expect(isBookingOperationalBlockedError(blocked)).toBe(true);
    expect(isBookingOperationalBlockedError(uncertain)).toBe(false);
    expect(isBookingOperationalStateError(uncertain)).toBe(true);
    expect(isBookingOperationalStateError(blocked)).toBe(false);
  });
});
