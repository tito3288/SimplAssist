import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = {
  data?: unknown;
  error?: unknown;
  reject?: unknown;
};

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  results: [] as QueryResult[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  decideOperationalAccess,
  isOperationalControlsResolutionError,
  OperationalControlsResolutionError,
  resolveBusinessOperationalControls,
  resolveBusinessOperationalControlsFromSnapshot,
  resolveOperationalBlockReason,
  type BusinessOperationalControlsSnapshot,
} from "./operationalControls.server";
import type {
  AdminActionEventAction,
  BusinessOperationalControls,
} from "@/types/database";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000041";
const ACTIVE_ROW = {
  id: BUSINESS_ID,
  operations_suspended_at: null,
  ai_replies_paused_at: null,
  texting_paused_at: null,
  bookings_paused_at: null,
};

const ACTIVE_CONTROLS: BusinessOperationalControls = {
  businessId: BUSINESS_ID,
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
};

const OPERATIONAL_AUDIT_ACTIONS = [
  "account_operations_suspended",
  "account_operations_reactivated",
  "account_service_paused",
  "account_service_resumed",
] as const satisfies readonly AdminActionEventAction[];

function queueResults(...results: QueryResult[]): void {
  mocks.results.length = 0;
  mocks.results.push(...results);
}

function snapshot(
  overrides: Partial<NonNullable<BusinessOperationalControlsSnapshot["business"]>> = {},
): BusinessOperationalControlsSnapshot {
  return { business: { ...ACTIVE_ROW, ...overrides } };
}

beforeEach(() => {
  vi.clearAllMocks();
  queueResults({ data: ACTIVE_ROW, error: null });
  mocks.from.mockImplementation(() => {
    const result = mocks.results.shift() ?? { data: null, error: null };
    const chain = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    chain.maybeSingle.mockImplementation(() => {
      if (result.reject !== undefined) {
        return Promise.reject(result.reject);
      }
      return Promise.resolve({
        data: result.data ?? null,
        error: result.error ?? null,
      });
    });
    return chain;
  });
});

describe("resolveBusinessOperationalControls", () => {
  it("selects only the authoritative control columns and maps an active row", async () => {
    await expect(
      resolveBusinessOperationalControls(BUSINESS_ID),
    ).resolves.toEqual(ACTIVE_CONTROLS);

    expect(mocks.from).toHaveBeenCalledWith("businesses");
    const query = mocks.from.mock.results[0]?.value as {
      select: ReturnType<typeof vi.fn>;
      eq: ReturnType<typeof vi.fn>;
    };
    expect(query.select).toHaveBeenCalledWith(
      "id, operations_suspended_at, ai_replies_paused_at, texting_paused_at, bookings_paused_at",
    );
    expect(query.eq).toHaveBeenCalledWith("id", BUSINESS_ID);
  });

  it("maps all four valid timestamp controls without normalizing them", async () => {
    const row = {
      ...ACTIVE_ROW,
      operations_suspended_at: "2026-08-04T12:30:00Z",
      ai_replies_paused_at: "2026-08-04T12:31:00.1+00:00",
      texting_paused_at: "2026-08-04T12:32:00.123-05:00",
      bookings_paused_at: "2026-08-04T12:33:00.123456+05:30",
    };
    queueResults({ data: row, error: null });

    await expect(
      resolveBusinessOperationalControls(BUSINESS_ID),
    ).resolves.toEqual({
      businessId: BUSINESS_ID,
      operationsSuspendedAt: row.operations_suspended_at,
      aiRepliesPausedAt: row.ai_replies_paused_at,
      textingPausedAt: row.texting_paused_at,
      bookingsPausedAt: row.bookings_paused_at,
    });
  });

  it("performs a fresh read on every invocation", async () => {
    queueResults(
      { data: ACTIVE_ROW, error: null },
      {
        data: {
          ...ACTIVE_ROW,
          texting_paused_at: "2026-08-04T13:00:00Z",
        },
        error: null,
      },
    );

    const first = await resolveBusinessOperationalControls(BUSINESS_ID);
    const second = await resolveBusinessOperationalControls(BUSINESS_ID);

    expect(first.textingPausedAt).toBeNull();
    expect(second.textingPausedAt).toBe("2026-08-04T13:00:00Z");
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["database error", { data: null, error: { message: "database offline" } }],
    ["rejected query", { reject: new Error("transport disconnected") }],
  ])("throws a retryable typed error for a %s", async (_label, result) => {
    queueResults(result);

    const promise = resolveBusinessOperationalControls(BUSINESS_ID);
    await expect(promise).rejects.toBeInstanceOf(
      OperationalControlsResolutionError,
    );
    await expect(promise).rejects.toMatchObject({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      retryable: true,
    });
  });

  it("treats a missing business as indeterminate rather than active", async () => {
    queueResults({ data: null, error: null });

    await expect(
      resolveBusinessOperationalControls(BUSINESS_ID),
    ).rejects.toMatchObject({
      code: "business_not_found",
      retryable: true,
    });
  });

  it("rejects an absent business ID before querying", async () => {
    const promise = resolveBusinessOperationalControls(" ");
    await expect(promise).rejects.toMatchObject({
      code: "invalid_business_id",
      retryable: true,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

describe("resolveBusinessOperationalControlsFromSnapshot", () => {
  it.each([
    "2024-02-29T23:59:59Z",
    "2026-08-04T12:30:00.123456+00:00",
    "2026-08-04T12:30:00-05:00",
  ])("accepts a strict timezone-qualified timestamp: %s", (timestamp) => {
    expect(
      resolveBusinessOperationalControlsFromSnapshot(
        BUSINESS_ID,
        snapshot({ operations_suspended_at: timestamp }),
      ).operationsSuspendedAt,
    ).toBe(timestamp);
  });

  it.each([
    undefined,
    42,
    "",
    "2026-08-04",
    "2026-08-04T12:30:00",
    "2026-02-30T12:30:00Z",
    "2025-02-29T12:30:00Z",
    "2026-08-04T24:00:00Z",
    "2026-08-04T12:60:00Z",
    "2026-08-04T12:30:60Z",
    "2026-08-04T12:30:00.1234567Z",
  ])("fails closed for a malformed timestamp: %s", (timestamp) => {
    expect(() =>
      resolveBusinessOperationalControlsFromSnapshot(
        BUSINESS_ID,
        snapshot({ ai_replies_paused_at: timestamp }),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "malformed_business",
        retryable: true,
      }),
    );
  });

  it("fails closed for a mismatched row identity", () => {
    expect(() =>
      resolveBusinessOperationalControlsFromSnapshot(
        BUSINESS_ID,
        snapshot({ id: "another-business" }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "malformed_business", retryable: true }),
    );
  });

  it("exposes a type guard for resolution failures", () => {
    let caught: unknown;
    try {
      resolveBusinessOperationalControlsFromSnapshot(BUSINESS_ID, {
        business: null,
      });
    } catch (error) {
      caught = error;
    }

    expect(isOperationalControlsResolutionError(caught)).toBe(true);
    expect(isOperationalControlsResolutionError(new Error("other"))).toBe(
      false,
    );
  });
});

describe("operational access decisions", () => {
  it("keeps every operational audit action in the shared database union", () => {
    expect(OPERATIONAL_AUDIT_ACTIONS).toEqual([
      "account_operations_suspended",
      "account_operations_reactivated",
      "account_service_paused",
      "account_service_resumed",
    ]);
  });

  it("allows active controls when every requested service is active", () => {
    expect(
      decideOperationalAccess(ACTIVE_CONTROLS, [
        "texting",
        "ai_replies",
        "bookings",
      ]),
    ).toEqual({ outcome: "resolved", allowed: true });
  });

  it.each([
    ["ai_replies", "aiRepliesPausedAt", "ai_replies_paused"],
    ["texting", "textingPausedAt", "texting_paused"],
    ["bookings", "bookingsPausedAt", "bookings_paused"],
  ] as const)(
    "returns the typed %s block only when that service is requested",
    (service, field, reason) => {
      const controls = {
        ...ACTIVE_CONTROLS,
        [field]: "2026-08-04T14:00:00Z",
      };

      expect(resolveOperationalBlockReason(controls, [service])).toBe(reason);
      expect(resolveOperationalBlockReason(controls, [])).toBeNull();
    },
  );

  it("uses caller service order for independent pause precedence", () => {
    const controls = {
      ...ACTIVE_CONTROLS,
      aiRepliesPausedAt: "2026-08-04T14:00:00Z",
      textingPausedAt: "2026-08-04T14:00:00Z",
    };

    expect(
      resolveOperationalBlockReason(controls, ["texting", "ai_replies"]),
    ).toBe("texting_paused");
    expect(
      resolveOperationalBlockReason(controls, ["ai_replies", "texting"]),
    ).toBe("ai_replies_paused");
  });

  it("always gives full suspension precedence, including full-only checks", () => {
    const controls = {
      ...ACTIVE_CONTROLS,
      operationsSuspendedAt: "2026-08-04T15:00:00Z",
      aiRepliesPausedAt: "2026-08-04T14:00:00Z",
      textingPausedAt: "2026-08-04T14:00:00Z",
      bookingsPausedAt: "2026-08-04T14:00:00Z",
    };

    expect(resolveOperationalBlockReason(controls, [])).toBe(
      "account_suspended",
    );
    expect(
      decideOperationalAccess(controls, ["bookings", "texting"]),
    ).toEqual({
      outcome: "blocked",
      allowed: false,
      reason: "account_suspended",
    });
  });
});
