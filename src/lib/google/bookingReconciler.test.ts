import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  not: vi.fn(),
  is: vi.fn(),
  lt: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  claim: vi.fn(),
  recover: vi.fn(),
  failMissing: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("./calendar", () => ({
  claimCalendarBookingReconciliation: mocks.claim,
  recoverCalendarBookingConfirmation: mocks.recover,
  failCalendarBookingRecovery: mocks.failMissing,
}));

import { reconcilePendingCalendarBookings } from "./bookingReconciler";

const NOW = "2026-08-01T15:00:00.000Z";
const STALE_BEFORE = "2026-08-01T14:55:00.000Z";
const BOOKING_SELECT =
  "id,business_id,contact_id,conversation_id,source_message_id,google_calendar_id,google_event_id,event_summary,request_fingerprint,operation_claim_token,operation_claimed_at,reconciliation_attempt_count,reconciliation_attempted_at,status,starts_at,ends_at,businesses!inner(owner_id,deleted_at)";

function booking(id: string) {
  return {
    id,
    business_id: `business-${id}`,
    contact_id: `contact-${id}`,
    conversation_id: `conversation-${id}`,
    source_message_id: `message-${id}`,
    google_calendar_id: `calendar-${id}`,
    google_event_id: null,
    event_summary: `Estimate - Customer ${id}`,
    request_fingerprint:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    operation_claim_token: `claim-${id}`,
    operation_claimed_at: "2026-08-01T14:58:00.000Z",
    reconciliation_attempt_count: 0,
    reconciliation_attempted_at: null,
    status: "pending",
    starts_at: "2026-08-02T14:00:00.000Z",
    ends_at: "2026-08-02T14:30:00.000Z",
  };
}

function installQuery(
  data: ReturnType<typeof booking>[] = [],
  error: { message: string } | null = null
) {
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    not: mocks.not,
    is: mocks.is,
    lt: mocks.lt,
    order: mocks.order,
    limit: mocks.limit,
  };
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.not.mockReturnValue(query);
  mocks.is.mockReturnValue(query);
  mocks.lt.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.limit.mockResolvedValue({ data, error });
  mocks.from.mockReturnValue(query);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.claim.mockImplementation(async (value) => value);
  mocks.failMissing.mockResolvedValue("failed");
  installQuery();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reconcilePendingCalendarBookings", () => {
  it("queries stale claimed rows for active businesses, oldest first, in a bounded batch", async () => {
    await expect(reconcilePendingCalendarBookings()).resolves.toEqual({
      confirmed: 0,
      notFound: 0,
      failed: 0,
    });

    expect(mocks.from).toHaveBeenCalledWith("calendar_bookings");
    expect(mocks.select).toHaveBeenCalledWith(BOOKING_SELECT);
    expect(mocks.eq).toHaveBeenCalledWith("status", "pending");
    expect(mocks.not).toHaveBeenCalledWith(
      "operation_claim_token",
      "is",
      null
    );
    expect(mocks.not).toHaveBeenCalledWith(
      "businesses.owner_id",
      "is",
      null
    );
    expect(mocks.is).toHaveBeenCalledWith(
      "businesses.deleted_at",
      null
    );
    expect(mocks.lt).toHaveBeenCalledWith(
      "operation_claimed_at",
      STALE_BEFORE
    );
    expect(mocks.order.mock.calls).toEqual([
      [
        "reconciliation_attempted_at",
        { ascending: true, nullsFirst: true },
      ],
      ["operation_claimed_at", { ascending: true }],
    ]);
    expect(mocks.limit).toHaveBeenCalledWith(10);
  });

  it("isolates each row and counts confirmed, missing, and failed recovery", async () => {
    const confirmed = booking("confirmed");
    const notFound = booking("not-found");
    const failed = booking("failed");
    installQuery([confirmed, notFound, failed]);
    mocks.recover
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("provider response contained PII"));

    await expect(reconcilePendingCalendarBookings()).resolves.toEqual({
      confirmed: 1,
      notFound: 1,
      failed: 1,
    });

    expect(mocks.recover.mock.calls).toEqual([
      [confirmed],
      [notFound],
      [failed],
    ]);
    expect(mocks.claim.mock.calls).toEqual([
      [confirmed],
      [notFound],
      [failed],
    ]);
    expect(mocks.failMissing).toHaveBeenCalledWith(notFound);
    expect(console.error).toHaveBeenCalledWith(
      "[calendar:reconciler] Booking failed reconciliation failed"
    );
  });

  it("counts a concurrent confirmation while releasing a missing event", async () => {
    const raced = booking("raced");
    installQuery([raced]);
    mocks.recover.mockResolvedValueOnce(false);
    mocks.failMissing.mockResolvedValueOnce("confirmed");

    await expect(reconcilePendingCalendarBookings()).resolves.toEqual({
      confirmed: 1,
      notFound: 0,
      failed: 0,
    });
  });

  it("throws a batch query failure without attempting row recovery", async () => {
    installQuery([], { message: "database unavailable" });

    await expect(reconcilePendingCalendarBookings()).rejects.toThrow(
      "Could not query pending calendar bookings: database unavailable"
    );
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.failMissing).not.toHaveBeenCalled();
  });
});
