import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getStripeClient: vi.fn(),
  retrieve: vi.fn(),
  update: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));
vi.mock("./client", () => ({
  getStripeClient: mocks.getStripeClient,
}));

import {
  AccountDeletionStripePersistenceError,
  reconcileAccountDeletionStripeAction,
} from "./accountDeletionReconciler";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const SUBSCRIPTION_ID = "sub_test_deletion";
const GENERATION = 7;
const IDEMPOTENCY_KEY = "account-delete-generation-7";
const LEASE_OWNER = "test-worker";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000007";

type DesiredAction = "pause" | "resume" | "cancel";

function claimedAction(
  desiredAction: DesiredAction,
  overrides: Record<string, unknown> = {}
) {
  return {
    business_id: BUSINESS_ID,
    stripe_subscription_id: SUBSCRIPTION_ID,
    desired_action: desiredAction,
    status: "pending",
    generation: GENERATION,
    idempotency_key: IDEMPOTENCY_KEY,
    lease_owner: LEASE_OWNER,
    lease_token: LEASE_TOKEN,
    ...overrides,
  };
}

function stripeSubscription(
  overrides: Record<string, unknown> = {}
): Stripe.Subscription {
  return {
    id: SUBSCRIPTION_ID,
    status: "active",
    pause_collection: null,
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function installRpc(
  action: unknown,
  options: {
    claimError?: { message: string } | null;
    finishData?: unknown;
    finishError?: { message: string } | null;
  } = {}
) {
  mocks.rpc.mockImplementation(
    async (name: string) => {
      if (name === "claim_account_deletion_stripe_action") {
        return { data: action, error: options.claimError ?? null };
      }
      if (name === "finish_account_deletion_stripe_action") {
        return {
          data: options.finishData ?? true,
          error: options.finishError ?? null,
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  );
}

function rawStripeError(
  type: Stripe.RawErrorType,
  message: string,
  statusCode?: number
): Stripe.StripeRawError {
  return { type, message, statusCode };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStripeClient.mockReturnValue({
    subscriptions: {
      retrieve: mocks.retrieve,
      update: mocks.update,
      cancel: mocks.cancel,
    },
  });
});

describe("reconcileAccountDeletionStripeAction", () => {
  it("rejects invalid claim inputs before touching persistence", async () => {
    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: "",
        generation: GENERATION,
      })
    ).rejects.toThrow("businessId is required");
    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: 0,
      })
    ).rejects.toThrow("generation must be a positive safe integer");
    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: "  ",
      })
    ).rejects.toThrow("leaseOwner cannot be empty");

    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns not_claimed without calling Stripe when another worker owns the action", async () => {
    installRpc(null);

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).resolves.toEqual({
      outcome: "not_claimed",
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });

    expect(mocks.getStripeClient).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("surfaces claim persistence failures without calling Stripe", async () => {
    installRpc(null, { claimError: { message: "database unavailable" } });

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).rejects.toBeInstanceOf(AccountDeletionStripePersistenceError);

    expect(mocks.getStripeClient).not.toHaveBeenCalled();
  });

  it("rejects a claim payload that does not match the requested generation and owner", async () => {
    installRpc(
      claimedAction("pause", {
        generation: GENERATION + 1,
        lease_owner: "displaced-worker",
      })
    );

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).rejects.toThrow("returned an invalid action");
  });

  it("recognizes an existing void pause and completes the exact claimed CAS", async () => {
    installRpc(claimedAction("pause"));
    mocks.retrieve.mockResolvedValue(
      stripeSubscription({
        pause_collection: { behavior: "void", resumes_at: null },
      })
    );

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).resolves.toEqual({
      outcome: "applied",
      businessId: BUSINESS_ID,
      generation: GENERATION,
      appliedAction: "pause",
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(
      2,
      "finish_account_deletion_stripe_action",
      {
        p_business_id: BUSINESS_ID,
        p_generation: GENERATION,
        p_lease_token: LEASE_TOKEN,
        p_status: "applied",
        p_applied_action: "pause",
        p_error_code: null,
        p_error_message: null,
      }
    );
  });

  it("pauses collection with void behavior, no resume date, and the durable idempotency key", async () => {
    installRpc(claimedAction("pause"));
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.update.mockResolvedValue(
      stripeSubscription({
        pause_collection: { behavior: "void", resumes_at: null },
      })
    );

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "pause" });
    expect(mocks.update).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      { pause_collection: { behavior: "void" } },
      { idempotencyKey: IDEMPOTENCY_KEY }
    );
  });

  it("keeps a pause pending when Stripe returns the wrong state", async () => {
    installRpc(claimedAction("pause"));
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.update.mockResolvedValue(stripeSubscription());

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({
      outcome: "pending",
      errorCode: "stripe_state_mismatch",
    });
  });

  it("recognizes an already resumed subscription without mutating Stripe", async () => {
    installRpc(claimedAction("resume"));
    mocks.retrieve.mockResolvedValue(stripeSubscription());

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "resume" });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("resumes by clearing pause_collection while preserving the durable idempotency key", async () => {
    installRpc(claimedAction("resume"));
    mocks.retrieve.mockResolvedValue(
      stripeSubscription({ pause_collection: { behavior: "void" } })
    );
    mocks.update.mockResolvedValue(stripeSubscription());

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "resume" });
    expect(mocks.update).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      { pause_collection: "" },
      { idempotencyKey: IDEMPOTENCY_KEY }
    );
  });

  it("keeps a resume pending when Stripe still reports paused collection", async () => {
    installRpc(claimedAction("resume"));
    mocks.retrieve.mockResolvedValue(
      stripeSubscription({ pause_collection: { behavior: "void" } })
    );
    mocks.update.mockResolvedValue(
      stripeSubscription({ pause_collection: { behavior: "void" } })
    );

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({
      outcome: "pending",
      errorCode: "stripe_state_mismatch",
    });
  });

  it("immediately cancels without a final invoice or proration", async () => {
    installRpc(claimedAction("cancel"));
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.cancel.mockResolvedValue(
      stripeSubscription({ status: "canceled" })
    );

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "cancel" });
    expect(mocks.cancel).toHaveBeenCalledWith(
      SUBSCRIPTION_ID,
      { invoice_now: false, prorate: false },
      { idempotencyKey: IDEMPOTENCY_KEY }
    );
  });

  it("treats an already canceled subscription as terminal without canceling twice", async () => {
    installRpc(claimedAction("cancel"));
    mocks.retrieve.mockResolvedValue(
      stripeSubscription({ status: "canceled" })
    );

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "cancel" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("treats a missing Stripe subscription as terminal cancellation", async () => {
    installRpc(claimedAction("cancel"));
    mocks.retrieve.mockRejectedValue(
      new Stripe.errors.StripeInvalidRequestError({
        type: "invalid_request_error",
        message: "No such subscription",
        code: "resource_missing",
        statusCode: 404,
      })
    );

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({ outcome: "applied", appliedAction: "cancel" });
  });

  it.each([
    [
      new Stripe.errors.StripeConnectionError(
        rawStripeError("api_error", "network down")
      ),
      "pending",
      "stripe_connection_error",
    ],
    [
      new Stripe.errors.StripeRateLimitError(
        rawStripeError("rate_limit_error", "too many requests", 429)
      ),
      "pending",
      "stripe_rate_limit_error",
    ],
    [
      new Stripe.errors.StripeAPIError(
        rawStripeError("api_error", "Stripe unavailable", 503)
      ),
      "pending",
      "stripe_api_error",
    ],
    [
      new Stripe.errors.StripeAuthenticationError(
        rawStripeError("authentication_error", "bad key", 401)
      ),
      "blocked",
      "stripe_authentication_error",
    ],
    [
      new Stripe.errors.StripePermissionError(
        rawStripeError("invalid_request_error", "forbidden", 403)
      ),
      "blocked",
      "stripe_permission_error",
    ],
    [
      new Stripe.errors.StripeIdempotencyError(
        rawStripeError("idempotency_error", "key conflict", 400)
      ),
      "blocked",
      "stripe_idempotency_error",
    ],
    [
      new Stripe.errors.StripeInvalidRequestError(
        rawStripeError("invalid_request_error", "invalid request", 400)
      ),
      "blocked",
      "stripe_invalid_request_error",
    ],
    [
      new Stripe.errors.StripeError(
        rawStripeError("card_error", "generic client failure", 402)
      ),
      "blocked",
      "stripe_client_error",
    ],
  ])(
    "classifies Stripe failure %# as %s/%s",
    async (error, expectedOutcome, expectedCode) => {
      installRpc(claimedAction("pause"));
      mocks.retrieve.mockRejectedValue(error);

      const result = await reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      });

      expect(result).toMatchObject({
        outcome: expectedOutcome,
        errorCode: expectedCode,
      });
      expect(mocks.rpc).toHaveBeenNthCalledWith(
        2,
        "finish_account_deletion_stripe_action",
        expect.objectContaining({
          p_generation: GENERATION,
          p_lease_token: LEASE_TOKEN,
          p_status: expectedOutcome,
          p_error_code: expectedCode,
        })
      );
    }
  );

  it("persists missing Stripe configuration as blocked", async () => {
    installRpc(claimedAction("pause"));
    mocks.getStripeClient.mockImplementation(() => {
      throw new Error("STRIPE_SECRET_KEY is required");
    });

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({
      outcome: "blocked",
      errorCode: "stripe_configuration_error",
    });
  });

  it("keeps unknown failures retryable and bounds persisted error text", async () => {
    installRpc(claimedAction("pause"));
    mocks.retrieve.mockRejectedValue(new Error("x".repeat(1200)));

    const result = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: LEASE_OWNER,
    });

    expect(result).toMatchObject({
      outcome: "pending",
      errorCode: "stripe_unexpected_error",
    });
    const finishArgs = mocks.rpc.mock.calls[1][1];
    expect(finishArgs.p_error_message).toHaveLength(1000);
  });

  it("returns stale when exact generation-plus-lease completion loses its CAS", async () => {
    installRpc(claimedAction("pause"), { finishData: false });
    mocks.retrieve.mockResolvedValue(
      stripeSubscription({
        pause_collection: { behavior: "void", resumes_at: null },
      })
    );

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).resolves.toEqual({
      outcome: "stale",
      businessId: BUSINESS_ID,
      generation: GENERATION,
    });
  });

  it("surfaces finish persistence failure after Stripe mutation so durable work retries", async () => {
    installRpc(claimedAction("cancel"), {
      finishError: { message: "commit failed" },
    });
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.cancel.mockResolvedValue(
      stripeSubscription({ status: "canceled" })
    );

    await expect(
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      })
    ).rejects.toThrow("Failed to finish claimed generation");
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("reuses the durable idempotency key when a transient mutation is retried", async () => {
    let claimNumber = 0;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_account_deletion_stripe_action") {
        claimNumber++;
        return {
          data: claimedAction("pause", {
            lease_owner: args.p_lease_owner,
            lease_token: `00000000-0000-4000-8000-00000000000${claimNumber}`,
          }),
          error: null,
        };
      }
      return { data: true, error: null };
    });
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.update
      .mockRejectedValueOnce(
        new Stripe.errors.StripeConnectionError(
          rawStripeError("api_error", "socket reset")
        )
      )
      .mockResolvedValueOnce(
        stripeSubscription({
          pause_collection: { behavior: "void", resumes_at: null },
        })
      );

    const first = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: "retry-worker-1",
    });
    const second = await reconcileAccountDeletionStripeAction({
      businessId: BUSINESS_ID,
      generation: GENERATION,
      leaseOwner: "retry-worker-2",
    });

    expect(first).toMatchObject({ outcome: "pending" });
    expect(second).toMatchObject({ outcome: "applied" });
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.update.mock.calls[0][2]).toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(mocks.update.mock.calls[1][2]).toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it("allows only one concurrent worker to mutate Stripe", async () => {
    let claimCount = 0;
    mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_account_deletion_stripe_action") {
        claimCount++;
        return claimCount === 1
          ? {
              data: claimedAction("cancel", {
                lease_owner: args.p_lease_owner,
              }),
              error: null,
            }
          : { data: null, error: null };
      }
      return { data: true, error: null };
    });
    mocks.retrieve.mockResolvedValue(stripeSubscription());
    mocks.cancel.mockResolvedValue(
      stripeSubscription({ status: "canceled" })
    );

    const results = await Promise.all([
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: LEASE_OWNER,
      }),
      reconcileAccountDeletionStripeAction({
        businessId: BUSINESS_ID,
        generation: GENERATION,
        leaseOwner: "second-worker",
      }),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "applied",
      "not_claimed",
    ]);
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });
});
