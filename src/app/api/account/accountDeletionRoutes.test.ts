import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("@/lib/stripe/accountDeletionReconciler", () => ({
  reconcileAccountDeletionStripeAction: mocks.reconcile,
}));

import { DELETE as deleteAccount } from "./route";
import { POST as reactivateAccount } from "./reactivate/route";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const GENERATION = 4;
const REACTIVATION_RESERVATION_TOKEN =
  "00000000-0000-4000-8000-000000000014";

function userClient(
  business: Record<string, unknown> | null,
  user: { id: string } | null = { id: USER_ID }
) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: business, error: null }),
        }),
      }),
    }),
  };
}

function scheduledDeletion(
  status: "pending" | "applied" | "blocked" = "pending"
) {
  return {
    business_id: BUSINESS_ID,
    deleted_at: "2026-07-14T16:00:00.000Z",
    deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
    stripe_action: {
      business_id: BUSINESS_ID,
      desired_action: "pause",
      generation: GENERATION,
      status,
    },
  };
}

function preparedReactivation(
  status: "pending" | "applied" | "blocked" = "pending",
  appliedAction: "pause" | "resume" | "cancel" | null = null
) {
  return {
    business_id: BUSINESS_ID,
    already_active: false,
    deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
    reactivation_reservation_token: REACTIVATION_RESERVATION_TOKEN,
    reactivation_reservation_expires_at: "2099-09-12T16:30:00.000Z",
    stripe_action: {
      business_id: BUSINESS_ID,
      desired_action: "resume",
      generation: GENERATION,
      status,
      applied_action: appliedAction,
    },
  };
}

function futureDeletedBusiness() {
  return {
    id: BUSINESS_ID,
    deleted_at: "2026-07-14T16:00:00.000Z",
    deletion_scheduled_for: "2099-09-12T16:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.createClient.mockResolvedValue(userClient({ id: BUSINESS_ID }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DELETE /api/account", () => {
  it("schedules deletion atomically and returns success after a Stripe outage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T16:00:00.000Z"));
    mocks.rpc.mockResolvedValue({
      data: scheduledDeletion(),
      error: null,
    });
    mocks.reconcile.mockRejectedValue(new Error("Stripe offline"));

    const response = await deleteAccount();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("schedule_account_deletion", {
      p_business_id: BUSINESS_ID,
      p_owner_id: USER_ID,
      p_deleted_at: "2026-07-14T16:00:00.000Z",
      p_deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
    });
    expect(mocks.reconcile).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });
  });

  it("returns success while a transient pause remains durably pending", async () => {
    mocks.rpc.mockResolvedValue({ data: scheduledDeletion(), error: null });
    mocks.reconcile.mockResolvedValue({
      outcome: "pending",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      errorCode: "stripe_connection_error",
      errorMessage: "offline",
    });

    const response = await deleteAccount();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it("does not duplicate Stripe work when deletion scheduling returns applied", async () => {
    mocks.rpc.mockResolvedValue({
      data: scheduledDeletion("applied"),
      error: null,
    });

    const response = await deleteAccount();

    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("blocks the route when the atomic deletion schedule fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "transaction rolled back" },
    });

    const response = await deleteAccount();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to delete account",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects an invalid scheduling payload without calling Stripe", async () => {
    mocks.rpc.mockResolvedValue({
      data: { ...scheduledDeletion(), business_id: "wrong-business" },
      error: null,
    });

    const response = await deleteAccount();

    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("requires an authenticated account owner", async () => {
    mocks.createClient.mockResolvedValue(userClient(null, null));

    const response = await deleteAccount();

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("POST /api/account/reactivate", () => {
  beforeEach(() => {
    mocks.createClient.mockResolvedValue(userClient(futureDeletedBusiness()));
  });

  it("completes reactivation only after the exact resume generation applies", async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === "prepare_account_reactivation") {
        return { data: preparedReactivation(), error: null };
      }
      if (name === "complete_account_reactivation") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "resume",
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.rpc).toHaveBeenCalledWith("complete_account_reactivation", {
      p_business_id: BUSINESS_ID,
      p_owner_id: USER_ID,
      p_generation: GENERATION,
      p_reactivation_reservation_token: REACTIVATION_RESERVATION_TOKEN,
    });
  });

  it("rejects a missing reactivation reservation before calling Stripe", async () => {
    const {
      reactivation_reservation_token: _reservationToken,
      ...invalidPreparation
    } = preparedReactivation();
    mocks.rpc.mockResolvedValue({ data: invalidPreparation, error: null });

    const response = await reactivateAccount();

    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.anything()
    );
  });

  it("rejects a malformed reactivation reservation before calling Stripe", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...preparedReactivation(),
        reactivation_reservation_token: "not-a-uuid",
      },
      error: null,
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("accepts terminal cancel as applied when Stripe reports the subscription missing", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "prepare_account_reactivation"
        ? { data: preparedReactivation(), error: null }
        : { data: true, error: null }
    );
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "cancel",
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.objectContaining({ p_generation: GENERATION })
    );
  });

  it.each(["pending", "not_claimed", "stale"])(
    "keeps the account deleted for a %s resume result",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({ data: preparedReactivation(), error: null });
      mocks.reconcile.mockResolvedValue({
        outcome,
        businessId: BUSINESS_ID,
        generation: GENERATION,
        errorCode: "stripe_connection_error",
        errorMessage: "offline",
      });

      const response = await reactivateAccount();

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "stripe_resume_retryable",
      });
      expect(mocks.rpc).not.toHaveBeenCalledWith(
        "complete_account_reactivation",
        expect.anything()
      );
    }
  );

  it("returns the blocked contract and leaves deletion intact", async () => {
    mocks.rpc.mockResolvedValue({ data: preparedReactivation(), error: null });
    mocks.reconcile.mockResolvedValue({
      outcome: "blocked",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      errorCode: "stripe_authentication_error",
      errorMessage: "bad key",
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "stripe_resume_blocked",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.anything()
    );
  });

  it("does not invoke Stripe again for a durably blocked resume", async () => {
    mocks.rpc.mockResolvedValue({
      data: preparedReactivation("blocked"),
      error: null,
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "stripe_resume_blocked",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("turns a thrown Stripe/persistence failure into a retryable contract", async () => {
    mocks.rpc.mockResolvedValue({ data: preparedReactivation(), error: null });
    mocks.reconcile.mockRejectedValue(new Error("finish RPC failed"));

    const response = await reactivateAccount();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "stripe_resume_retryable",
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.anything()
    );
  });

  it("retries only DB completion when resume was already applied", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "prepare_account_reactivation"
        ? { data: preparedReactivation("applied", "resume"), error: null }
        : { data: true, error: null }
    );

    const response = await reactivateAccount();

    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.objectContaining({ p_generation: GENERATION })
    );
  });

  it("keeps the tombstone when completion fails after Stripe resumed", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "prepare_account_reactivation"
        ? { data: preparedReactivation(), error: null }
        : { data: false, error: null }
    );
    mocks.reconcile.mockResolvedValue({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "resume",
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to reactivate account",
    });
  });

  it("returns success idempotently when the account is already active", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        business_id: BUSINESS_ID,
        already_active: true,
        stripe_action: null,
      },
      error: null,
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.anything()
    );
  });

  it("lets the authoritative preparation RPC reject an expired grace period", async () => {
    mocks.createClient.mockResolvedValue(
      userClient({
        id: BUSINESS_ID,
        deleted_at: "2025-01-01T00:00:00.000Z",
        deletion_scheduled_for: "2025-03-02T00:00:00.000Z",
      })
    );
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "outside grace period" },
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(410);
    expect(mocks.rpc).toHaveBeenCalledWith("prepare_account_reactivation", {
      p_business_id: BUSINESS_ID,
      p_owner_id: USER_ID,
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
