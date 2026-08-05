import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertBookingOperationallyAllowed: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
  from: vi.fn(),
  tokenSelect: vi.fn(),
  tokenEq: vi.fn(),
  tokenSingle: vi.fn(),
  hoursSelect: vi.fn(),
  hoursEq: vi.fn(),
  hoursSingle: vi.fn(),
  freeBusyQuery: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./bookingOperational.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./bookingOperational.server")>();
  return {
    ...actual,
    assertBookingOperationallyAllowed:
      mocks.assertBookingOperationallyAllowed,
  };
});
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("./client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  BookingOperationalBlockedError,
} from "./bookingOperational.server";
import { checkAvailability } from "./calendar";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CALENDAR_ID = "connected-calendar";
const BUSINESS_HOURS = {
  id: "00000000-0000-4000-8000-000000000002",
  business_id: BUSINESS_ID,
  day_of_week: 1,
  open_time: "09:00:00",
  close_time: "10:00:00",
  is_closed: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();

  const tokenQuery = {
    select: mocks.tokenSelect,
    eq: mocks.tokenEq,
    single: mocks.tokenSingle,
  };
  mocks.tokenSelect.mockReturnValue(tokenQuery);
  mocks.tokenEq.mockReturnValue(tokenQuery);
  mocks.tokenSingle.mockResolvedValue({
    data: { calendar_id: CALENDAR_ID },
    error: null,
  });

  const hoursQuery = {
    select: mocks.hoursSelect,
    eq: mocks.hoursEq,
    single: mocks.hoursSingle,
  };
  mocks.hoursSelect.mockReturnValue(hoursQuery);
  mocks.hoursEq.mockReturnValue(hoursQuery);
  mocks.hoursSingle.mockResolvedValue({
    data: BUSINESS_HOURS,
    error: null,
  });

  mocks.from.mockImplementation((table: string) => {
    if (table === "google_calendar_tokens") return tokenQuery;
    if (table === "business_hours") return hoursQuery;
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
    freebusy: { query: mocks.freeBusyQuery },
  });
  mocks.freeBusyQuery.mockResolvedValue({
    data: { calendars: { [CALENDAR_ID]: { busy: [] } } },
  });
  mocks.assertBookingOperationallyAllowed.mockResolvedValue(undefined);
});

describe("availability operational races", () => {
  it("rechecks before returning closed-hours availability", async () => {
    const hoursRead = deferred<{
      data: typeof BUSINESS_HOURS;
      error: null;
    }>();
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    let paused = false;
    mocks.hoursSingle.mockReturnValueOnce(hoursRead.promise);
    mocks.assertBookingOperationallyAllowed.mockImplementation(async () => {
      if (paused) throw blocked;
    });

    const availability = checkAvailability(
      BUSINESS_ID,
      "2026-08-03",
      "UTC",
    );
    await vi.waitFor(() => {
      expect(mocks.hoursSingle).toHaveBeenCalledOnce();
    });

    paused = true;
    hoursRead.resolve({
      data: { ...BUSINESS_HOURS, is_closed: true },
      error: null,
    });

    await expect(availability).rejects.toBe(blocked);
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(mocks.freeBusyQuery).not.toHaveBeenCalled();
  });

  it("blocks a pause that lands after entry but before Google free/busy", async () => {
    const hoursRead = deferred<{
      data: typeof BUSINESS_HOURS;
      error: null;
    }>();
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "bookings_paused",
    );
    let paused = false;
    mocks.hoursSingle.mockReturnValueOnce(hoursRead.promise);
    mocks.assertBookingOperationallyAllowed.mockImplementation(async () => {
      if (paused) throw blocked;
    });

    const availability = checkAvailability(
      BUSINESS_ID,
      "2026-08-03",
      "UTC",
    );
    await vi.waitFor(() => {
      expect(mocks.hoursSingle).toHaveBeenCalledOnce();
    });

    paused = true;
    hoursRead.resolve({ data: BUSINESS_HOURS, error: null });

    await expect(availability).rejects.toBe(blocked);
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(2);
    expect(mocks.freeBusyQuery).not.toHaveBeenCalled();
  });

  it("blocks stale availability when a pause lands during Google free/busy", async () => {
    const providerRead = deferred<{
      data: { calendars: Record<string, { busy: never[] }> };
    }>();
    const blocked = new BookingOperationalBlockedError(
      BUSINESS_ID,
      "account_suspended",
    );
    let paused = false;
    mocks.freeBusyQuery.mockReturnValueOnce(providerRead.promise);
    mocks.assertBookingOperationallyAllowed.mockImplementation(async () => {
      if (paused) throw blocked;
    });

    const availability = checkAvailability(
      BUSINESS_ID,
      "2026-08-03",
      "UTC",
    );
    await vi.waitFor(() => {
      expect(mocks.freeBusyQuery).toHaveBeenCalledOnce();
    });

    paused = true;
    providerRead.resolve({
      data: { calendars: { [CALENDAR_ID]: { busy: [] } } },
    });

    await expect(availability).rejects.toBe(blocked);
    expect(mocks.assertBookingOperationallyAllowed).toHaveBeenCalledTimes(3);
    expect(mocks.freeBusyQuery).toHaveBeenCalledOnce();
  });
});
