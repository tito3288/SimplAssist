import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  deleteUser: vi.fn(),
  reconcile: vi.fn(),
  reconcileProvider: vi.fn(),
  reconcileBookings: vi.fn(),
  purgeOAuthAttempts: vi.fn(),
  graceEq: vi.fn(),
  graceIn: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { admin: { deleteUser: mocks.deleteUser } },
  },
}));
vi.mock("@/lib/stripe/accountDeletionReconciler", () => ({
  reconcileAccountDeletionStripeAction: mocks.reconcile,
}));
vi.mock("@/lib/google/bookingReconciler", () => ({
  reconcilePendingCalendarBookings: mocks.reconcileBookings,
}));
vi.mock("@/lib/google/providerOperationReconciler", () => ({
  reconcileCalendarProviderOperations: mocks.reconcileProvider,
}));
vi.mock("@/lib/google/oauthAttempt.server", () => ({
  purgeExpiredGoogleCalendarOAuthAttempts: mocks.purgeOAuthAttempts,
}));

import { POST as cleanupAccounts } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const AUTH_USER_ID = "00000000-0000-4000-8000-000000000010";
const GENERATION = 9;

type SetupOptions = {
  expiredBusinesses?: Array<{ id: string }> | null;
  queryError?: { message: string } | null;
  claimed?: Array<{ id: string }> | null;
  claimError?: { message: string } | null;
  action?: Record<string, unknown> | null;
  actionError?: { message: string } | null;
  graceActions?: Array<Record<string, unknown>> | null;
  graceActionError?: { message: string } | null;
  pendingAuthUserId?: string | null;
  cleanupError?: { message: string } | null;
  completed?: unknown;
  completionError?: { message: string } | null;
};

function cancelAction(
  status: "pending" | "applied" | "blocked" = "pending",
  appliedAction: "pause" | "resume" | "cancel" | null = null,
) {
  return {
    business_id: BUSINESS_ID,
    desired_action: "cancel",
    generation: GENERATION,
    status,
    applied_action: appliedAction,
    last_error_code:
      status === "blocked" ? "stripe_authentication_error" : null,
  };
}

function graceAction(status: "pending" | "blocked" = "pending") {
  return {
    business_id: BUSINESS_ID,
    desired_action: "pause",
    generation: GENERATION,
    status,
    last_error_code:
      status === "blocked" ? "stripe_authentication_error" : null,
  };
}

function installDatabase(options: SetupOptions = {}) {
  const expiredBusinesses =
    options.expiredBusinesses === undefined
      ? [{ id: BUSINESS_ID }]
      : options.expiredBusinesses;
  const claimed =
    options.claimed === undefined ? [{ id: BUSINESS_ID }] : options.claimed;
  const action = options.action === undefined ? cancelAction() : options.action;
  const graceActions = options.graceActions ?? [];

  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") {
      return {
        select: vi.fn().mockReturnValue({
          not: vi.fn().mockReturnValue({
            lt: vi.fn().mockResolvedValue({
              data: expiredBusinesses,
              error: options.queryError ?? null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            or: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({
                data: claimed,
                error: options.claimError ?? null,
              }),
            }),
          }),
        }),
      };
    }

    if (table === "account_deletion_stripe_actions") {
      const graceQuery = {
        eq: mocks.graceEq,
        in: mocks.graceIn,
      };
      mocks.graceEq.mockReturnValue(graceQuery);
      mocks.graceIn.mockResolvedValue({
        data: graceActions,
        error: options.graceActionError ?? null,
      });

      return {
        select: vi.fn().mockImplementation((columns: string) =>
          columns.includes("applied_action")
            ? {
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: action,
                    error: options.actionError ?? null,
                  }),
                }),
              }
            : graceQuery,
        ),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  });

  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "cleanup_expired_business") {
      return {
        data:
          options.pendingAuthUserId === undefined
            ? AUTH_USER_ID
            : options.pendingAuthUserId,
        error: options.cleanupError ?? null,
      };
    }
    if (name === "complete_expired_business_cleanup") {
      return {
        data: options.completed === undefined ? true : options.completed,
        error: options.completionError ?? null,
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
}

function request(token = "cron-test-secret") {
  return new NextRequest("http://localhost/api/account/cleanup", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  mocks.deleteUser.mockResolvedValue({ data: null, error: null });
  mocks.reconcileBookings.mockResolvedValue({
    confirmed: 0,
    notFound: 0,
    failed: 0,
  });
  mocks.reconcileProvider.mockResolvedValue({
    attempted: 0,
    finalized: 0,
    failed: 0,
    deferred: 0,
  });
  mocks.purgeOAuthAttempts.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/account/cleanup", () => {
  it("requires the exact cron bearer token", async () => {
    const response = await cleanupAccounts(request("wrong-token"));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.reconcileProvider).not.toHaveBeenCalled();
    expect(mocks.reconcileBookings).not.toHaveBeenCalled();
    expect(mocks.purgeOAuthAttempts).not.toHaveBeenCalled();
  });

  it("purges expired private OAuth attempts on an authorized heartbeat", async () => {
    installDatabase({ expiredBusinesses: [] });

    const response = await cleanupAccounts(request());

    expect(response.status).toBe(200);
    expect(mocks.purgeOAuthAttempts).toHaveBeenCalledTimes(1);
  });

  it("keeps account cleanup available when OAuth attempt purging fails", async () => {
    installDatabase({ action: null, pendingAuthUserId: null });
    mocks.purgeOAuthAttempts.mockRejectedValueOnce(new Error("private detail"));

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[cleanup] Google OAuth attempt purge failed",
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("private detail"),
    );
  });

  it("runs calendar booking reconciliation on an authorized maintenance heartbeat", async () => {
    installDatabase({ expiredBusinesses: [] });

    const response = await cleanupAccounts(request());

    expect(response.status).toBe(200);
    expect(mocks.reconcileBookings).toHaveBeenCalledTimes(1);
  });

  it("runs durable provider reconciliation before legacy booking reconciliation", async () => {
    installDatabase({ expiredBusinesses: [] });

    const response = await cleanupAccounts(request());

    expect(response.status).toBe(200);
    expect(mocks.reconcileProvider).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileProvider).toHaveBeenCalledBefore(
      mocks.reconcileBookings,
    );
  });

  it("caps the combined reconciliation prelude so core cleanup cannot be starved", async () => {
    vi.useFakeTimers();
    try {
      installDatabase({ expiredBusinesses: [] });
      mocks.reconcileProvider.mockReturnValue(new Promise(() => undefined));
      mocks.reconcileBookings.mockReturnValue(new Promise(() => undefined));

      const responsePromise = cleanupAccounts(request());
      await vi.advanceTimersByTimeAsync(5_000);
      expect(mocks.reconcileBookings).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_000);

      const response = await responsePromise;
      await expect(response.json()).resolves.toMatchObject({
        success: true,
        calendar_provider_reconciliation: { deferred: 1 },
        calendar_booking_reconciliation: { failed: 1 },
      });
      expect(mocks.from).toHaveBeenCalledWith("businesses");
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues account cleanup when calendar booking reconciliation fails", async () => {
    installDatabase({ action: null, pendingAuthUserId: null });
    mocks.reconcileBookings.mockRejectedValueOnce(
      new Error("calendar provider unavailable"),
    );

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
      failed_count: 0,
      failed_ids: [],
    });
    expect(mocks.reconcileBookings).toHaveBeenCalledTimes(1);
    expect(mocks.reconcileBookings.mock.invocationCallOrder[0]).toBeLessThan(
      Math.min(...mocks.rpc.mock.invocationCallOrder),
    );
    expect(console.error).toHaveBeenCalledWith(
      "[cleanup] Calendar booking reconciliation failed",
    );
  });

  it("retries a durable pause during grace even when no account has expired", async () => {
    installDatabase({ expiredBusinesses: [], graceActions: [graceAction()] });
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "pause",
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 0,
      failed_count: 0,
      failed_ids: [],
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });
    expect(mocks.graceEq).toHaveBeenCalledWith("desired_action", "pause");
    expect(mocks.graceIn).toHaveBeenCalledWith("status", [
      "pending",
      "blocked",
    ]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("reports a transient grace-period pause instead of silently losing it", async () => {
    installDatabase({ expiredBusinesses: [], graceActions: [graceAction()] });
    mocks.reconcile.mockResolvedValue({
      outcome: "pending",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      errorCode: "stripe_connection_error",
      errorMessage: "offline",
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deleted_count: 0,
      failed_count: 1,
      failed_ids: [BUSINESS_ID],
    });
  });

  it("surfaces a blocked grace-period action without retrying Stripe", async () => {
    installDatabase({
      expiredBusinesses: [],
      graceActions: [graceAction("blocked")],
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      failed_ids: [BUSINESS_ID],
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("skips a grace action once the business is eligible for terminal cleanup", async () => {
    installDatabase({ graceActions: [graceAction()] });
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "cancel",
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
    });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });
  });

  it("orders cancellation before auth deletion and exact-generation completion", async () => {
    installDatabase();
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "cancel",
    });

    const response = await cleanupAccounts(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
      failed_count: 0,
      failed_ids: [],
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });
    expect(mocks.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_expired_business_cleanup",
      { p_business_id: BUSINESS_ID, p_generation: GENERATION },
    );

    const completionIndex = mocks.rpc.mock.calls.findIndex(
      ([name]) => name === "complete_expired_business_cleanup",
    );
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteUser.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[completionIndex],
    );
  });

  it.each(["pending", "not_claimed", "stale"])(
    "retains external linkages when cancellation reconciliation is %s",
    async (outcome) => {
      installDatabase();
      mocks.reconcile.mockResolvedValue({
        outcome,
        businessId: BUSINESS_ID,
        generation: GENERATION,
        errorCode: "stripe_connection_error",
        errorMessage: "offline",
      });

      const response = await cleanupAccounts(request());

      await expect(response.json()).resolves.toMatchObject({
        success: false,
        deleted_count: 0,
        failed_count: 1,
        failed_ids: [BUSINESS_ID],
      });
      expect(mocks.deleteUser).not.toHaveBeenCalled();
      expect(mocks.rpc).not.toHaveBeenCalledWith(
        "complete_expired_business_cleanup",
        expect.anything(),
      );
    },
  );

  it("does not retry a durably blocked cancellation or delete auth", async () => {
    installDatabase({ action: cancelAction("blocked") });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      failed_ids: [BUSINESS_ID],
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  it("recovers after a crash by skipping an already-applied cancel and finishing linkage cleanup", async () => {
    installDatabase({ action: cancelAction("applied", "cancel") });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.deleteUser).toHaveBeenCalledWith(AUTH_USER_ID);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_expired_business_cleanup",
      expect.objectContaining({ p_generation: GENERATION }),
    );
  });

  it("treats an already-missing auth user as complete", async () => {
    installDatabase({ action: cancelAction("applied", "cancel") });
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: { status: 404, message: "User not found" },
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
    });
  });

  it("retains auth and Stripe linkage when auth deletion fails", async () => {
    installDatabase({ action: cancelAction("applied", "cancel") });
    mocks.deleteUser.mockResolvedValue({
      data: null,
      error: { status: 503, message: "GoTrue unavailable" },
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deleted_count: 0,
      failed_ids: [BUSINESS_ID],
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_expired_business_cleanup",
      expect.anything(),
    );
  });

  it("reports completion failure so the already-applied work can retry", async () => {
    installDatabase({
      action: cancelAction("applied", "cancel"),
      completed: false,
    });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      deleted_count: 0,
      failed_ids: [BUSINESS_ID],
    });
  });

  it("completes with a null generation when the business had no subscription", async () => {
    installDatabase({ action: null, pendingAuthUserId: null });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 1,
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_expired_business_cleanup",
      { p_business_id: BUSINESS_ID, p_generation: null },
    );
  });

  it("skips a business claimed by an overlapping cleanup run without reporting failure", async () => {
    installDatabase({ claimed: [] });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      deleted_count: 0,
      failed_count: 0,
      failed_ids: [],
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("fails safely before mutation when the expired-account query fails", async () => {
    installDatabase({ queryError: { message: "database unavailable" } });

    const response = await cleanupAccounts(request());

    expect(response.status).toBe(500);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("retains all external work when the atomic scrub RPC fails", async () => {
    installDatabase({ cleanupError: { message: "poisoned rollback" } });

    const response = await cleanupAccounts(request());

    await expect(response.json()).resolves.toMatchObject({
      success: false,
      failed_ids: [BUSINESS_ID],
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
