import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  reconcile: vi.fn(),
  requireWorkspaceRouteAccess: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe/accountDeletionReconciler", () => ({
  reconcileAccountDeletionStripeAction: mocks.reconcile,
}));
vi.mock("@/lib/customer/workspaceRouteResponse.server", () => ({
  requireWorkspaceRouteAccess: mocks.requireWorkspaceRouteAccess,
}));

import { DELETE as deleteAccount } from "./route";
import { POST as reactivateAccount } from "./reactivate/route";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const GENERATION = 4;
const REACTIVATION_RESERVATION_TOKEN = "00000000-0000-4000-8000-000000000014";

function scheduledDeletion(
  status: "pending" | "applied" | "blocked" = "pending",
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
      applied_action: status === "applied" ? "pause" : null,
    },
  };
}

function partnerScheduledDeletion() {
  return {
    business_id: BUSINESS_ID,
    deleted_at: "2026-07-14T16:00:00.000Z",
    deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
    stripe_action: null,
  };
}

function preparedReactivation(
  status: "pending" | "applied" | "blocked" = "pending",
  appliedAction: "pause" | "resume" | "cancel" | null = null,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.requireWorkspaceRouteAccess.mockResolvedValue({
    ok: true,
    access: {
      status: "resolved",
      user: { id: USER_ID },
      business: {
        id: BUSINESS_ID,
        partner_id: null,
        billing_mode: "stripe",
      },
      hostKind: "canonical",
    },
  });
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

  it.each(["invoiced", "comped"])(
    "schedules %s partner deletion without loading Stripe work",
    async (billingMode) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: true,
        access: {
          status: "resolved",
          user: { id: USER_ID },
          business: {
            id: BUSINESS_ID,
            partner_id: "00000000-0000-4000-8000-000000000020",
            billing_mode: billingMode,
          },
          hostKind: "partner",
        },
      });
      mocks.rpc.mockResolvedValue({
        data: partnerScheduledDeletion(),
        error: null,
      });

      const response = await deleteAccount();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        success: true,
        deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
      });
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );

  it("fails closed without Stripe when a partner schedule contains an action", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: USER_ID },
        business: {
          id: BUSINESS_ID,
          partner_id: "00000000-0000-4000-8000-000000000020",
          billing_mode: "invoiced",
        },
        hostKind: "partner",
      },
    });
    mocks.rpc.mockResolvedValue({ data: scheduledDeletion(), error: null });

    const response = await deleteAccount();

    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    "provisioning_in_progress",
    "provisioning_outcome_unknown",
    "partner_subscription_conflict",
    "stripe_action_in_progress",
    "stripe_action_outcome_unknown",
  ])("maps %s to a stable safe conflict", async (code) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: `Database rejected operation: ${code}`,
        details: "customer@example.com +15555550100 must not escape",
      },
    });

    const response = await deleteAccount();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ error: code, code });
    expect(JSON.stringify(body)).not.toContain("customer@example.com");
    expect(JSON.stringify(body)).not.toContain("+15555550100");
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
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await deleteAccount();

    expect(response.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])(
    "returns workspace %i before scheduling or Stripe work",
    async (status, body) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(body, { status }),
      });

      const response = await deleteAccount();

      expect(response.status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );
});

describe("POST /api/account/reactivate", () => {
  it.each(["invoiced", "comped"])(
    "reactivates %s partner billing with a null Stripe generation",
    async (billingMode) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: true,
        access: {
          status: "resolved",
          user: { id: USER_ID },
          business: {
            id: BUSINESS_ID,
            partner_id: "00000000-0000-4000-8000-000000000020",
            billing_mode: billingMode,
          },
          hostKind: "partner",
        },
      });
      mocks.rpc.mockImplementation(async (name: string) => {
        if (name === "prepare_account_reactivation") {
          return {
            data: {
              business_id: BUSINESS_ID,
              already_active: false,
              deletion_scheduled_for: "2026-09-12T16:00:00.000Z",
              reactivation_reservation_token: REACTIVATION_RESERVATION_TOKEN,
              reactivation_reservation_expires_at: "2099-09-12T16:30:00.000Z",
              stripe_action: null,
            },
            error: null,
          };
        }
        return { data: true, error: null };
      });

      const response = await reactivateAccount();

      expect(response.status).toBe(200);
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.rpc).toHaveBeenCalledWith("complete_account_reactivation", {
        p_business_id: BUSINESS_ID,
        p_owner_id: USER_ID,
        p_generation: null,
        p_reactivation_reservation_token: REACTIVATION_RESERVATION_TOKEN,
      });
    },
  );

  it("does not misreport a partner consistency conflict as permanent deletion", async () => {
    mocks.requireWorkspaceRouteAccess.mockResolvedValue({
      ok: true,
      access: {
        status: "resolved",
        user: { id: USER_ID },
        business: {
          id: BUSINESS_ID,
          partner_id: "00000000-0000-4000-8000-000000000020",
          billing_mode: "invoiced",
        },
        hostKind: "partner",
      },
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "55000", message: "partner_subscription_conflict" },
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "partner_subscription_conflict",
      code: "partner_subscription_conflict",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
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

  it.each([
    [401, { error: "Unauthorized" }],
    [403, { error: "workspace_access_denied" }],
    [503, { error: "workspace_access_unavailable", retryable: true }],
  ])(
    "returns workspace %i before reactivation or Stripe work",
    async (status, body) => {
      mocks.requireWorkspaceRouteAccess.mockResolvedValue({
        ok: false,
        response: NextResponse.json(body, { status }),
      });

      const response = await reactivateAccount();

      expect(response.status).toBe(status);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing reactivation reservation before calling Stripe", async () => {
    const invalidPreparation = { ...preparedReactivation() };
    Reflect.deleteProperty(
      invalidPreparation,
      "reactivation_reservation_token",
    );
    mocks.rpc.mockResolvedValue({ data: invalidPreparation, error: null });

    const response = await reactivateAccount();

    expect(response.status).toBe(500);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.anything(),
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
        : { data: true, error: null },
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
      expect.objectContaining({ p_generation: GENERATION }),
    );
  });

  it.each(["pending", "not_claimed", "stale"])(
    "keeps the account deleted for a %s resume result",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: preparedReactivation(),
        error: null,
      });
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
        expect.anything(),
      );
    },
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
      expect.anything(),
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
      expect.anything(),
    );
  });

  it("retries only DB completion when resume was already applied", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "prepare_account_reactivation"
        ? { data: preparedReactivation("applied", "resume"), error: null }
        : { data: true, error: null },
    );

    const response = await reactivateAccount();

    expect(response.status).toBe(200);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "complete_account_reactivation",
      expect.objectContaining({ p_generation: GENERATION }),
    );
  });

  it("keeps the tombstone when completion fails after Stripe resumed", async () => {
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "prepare_account_reactivation"
        ? { data: preparedReactivation(), error: null }
        : { data: false, error: null },
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
      expect.anything(),
    );
  });

  it("lets the authoritative preparation RPC reject an expired grace period", async () => {
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

  it("preserves 410 after Telnyx resources cross the point of no return", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "55000",
        message: `business ${BUSINESS_ID} Telnyx resources can no longer be automatically reactivated`,
      },
    });

    const response = await reactivateAccount();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: "Account has been permanently deleted and cannot be reactivated",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });
});
