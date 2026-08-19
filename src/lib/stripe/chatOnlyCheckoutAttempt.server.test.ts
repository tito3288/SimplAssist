import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { PlanFamilyTransitionNotSupportedError } from "@/lib/billing/planFamilyLock.server";
import {
  acquireChatOnlyCheckoutAttempt,
  ChatOnlyCheckoutAttemptConflictError,
  ChatOnlyCheckoutAttemptRecoveryRequiredError,
  ChatOnlyCheckoutAttemptStateError,
  ChatOnlyCheckoutAttemptUnavailableError,
  completeChatOnlyCheckoutAttempt,
  expireChatOnlyCheckoutAttempt,
  recordChatOnlyCheckoutSession,
  releaseChatOnlyCheckoutAttemptClaim,
} from "./chatOnlyCheckoutAttempt.server";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const ATTEMPT_ID = "20000000-0000-4000-a000-000000000002";
const CLAIM_TOKEN = "30000000-0000-4000-a000-000000000003";
const OTHER_CLAIM_TOKEN = "40000000-0000-4000-a000-000000000004";
const SESSION_ID = "cs_test_checkout_attempt_123";
const CUSTOMER_ID = "cus_CheckoutAttempt123";
const SUBSCRIPTION_ID = "sub_checkout_attempt_123";
const PRICE_ID = "price_chat_only_test";
const FINGERPRINT = "a".repeat(64);
const EXPIRES_AT = "2026-08-19T15:00:00.000Z";
const CHECKOUT_URL = "https://checkout.stripe.test/session/123";

const acquireArgs = {
  businessId: BUSINESS_ID,
  stripePriceId: PRICE_ID,
  requestFingerprint: FINGERPRINT,
  claimToken: CLAIM_TOKEN,
};

function createResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "create",
    attempt_id: ATTEMPT_ID,
    claim_token: CLAIM_TOKEN,
    stripe_customer_id: null,
    checkout_session_expires_at: EXPIRES_AT,
    ...overrides,
  };
}

function openResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "open",
    attempt_id: ATTEMPT_ID,
    stripe_checkout_session_id: SESSION_ID,
    stripe_customer_id: CUSTOMER_ID,
    checkout_session_expires_at: EXPIRES_AT,
    ...overrides,
  };
}

function inProgressResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "in_progress",
    attempt_id: ATTEMPT_ID,
    stripe_customer_id: null,
    retry_after_seconds: 5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("acquireChatOnlyCheckoutAttempt", () => {
  it("forwards the exact request and accepts only its echoed create claim token", async () => {
    mocks.rpc.mockResolvedValue({ data: createResponse(), error: null });

    await expect(acquireChatOnlyCheckoutAttempt(acquireArgs)).resolves.toEqual({
      outcome: "create",
      attemptId: ATTEMPT_ID,
      claimToken: CLAIM_TOKEN,
      customerId: null,
      sessionExpiresAt: EXPIRES_AT,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_chat_only_checkout_attempt",
      {
        p_business_id: BUSINESS_ID,
        p_stripe_price_id: PRICE_ID,
        p_request_fingerprint: FINGERPRINT,
        p_claim_token: CLAIM_TOKEN,
      },
    );
  });

  it("accepts a fully aligned open attempt", async () => {
    mocks.rpc.mockResolvedValue({ data: openResponse(), error: null });

    await expect(acquireChatOnlyCheckoutAttempt(acquireArgs)).resolves.toEqual({
      outcome: "open",
      attemptId: ATTEMPT_ID,
      sessionId: SESSION_ID,
      customerId: CUSTOMER_ID,
      sessionExpiresAt: EXPIRES_AT,
    });
  });

  it.each([1, 300])(
    "accepts an in-progress retry boundary of %s seconds",
    async (retryAfterSeconds) => {
      mocks.rpc.mockResolvedValue({
        data: inProgressResponse({
          stripe_customer_id: CUSTOMER_ID,
          retry_after_seconds: retryAfterSeconds,
        }),
        error: null,
      });

      await expect(acquireChatOnlyCheckoutAttempt(acquireArgs)).resolves.toEqual({
        outcome: "in_progress",
        attemptId: ATTEMPT_ID,
        customerId: CUSTOMER_ID,
        retryAfterSeconds,
      });
    },
  );

  it.each([
    ["a null response", null],
    ["a missing status", { attempt_id: ATTEMPT_ID }],
    ["an unknown status", { status: "complete" }],
    ["an invalid attempt UUID", createResponse({ attempt_id: "attempt-1" })],
    ["an invalid claim UUID", createResponse({ claim_token: "claim-1" })],
    [
      "a different echoed claim token",
      createResponse({ claim_token: OTHER_CLAIM_TOKEN }),
    ],
    [
      "an invalid Stripe customer ID",
      createResponse({ stripe_customer_id: "customer_123" }),
    ],
    [
      "a non-second-aligned expiry",
      createResponse({
        checkout_session_expires_at: "2026-08-19T15:00:00.123Z",
      }),
    ],
    [
      "an invalid Stripe Checkout Session ID",
      openResponse({ stripe_checkout_session_id: "sess_123" }),
    ],
    [
      "an overlong Stripe customer ID",
      openResponse({ stripe_customer_id: `cus_${"a".repeat(252)}` }),
    ],
    [
      "an unparseable open expiry",
      openResponse({ checkout_session_expires_at: "not-a-timestamp" }),
    ],
    [
      "an invalid in-progress attempt UUID",
      inProgressResponse({ attempt_id: "attempt-1" }),
    ],
    [
      "an invalid in-progress customer ID",
      inProgressResponse({ stripe_customer_id: "cus_bad-value" }),
    ],
  ])("fails closed on %s", async (_label, data) => {
    mocks.rpc.mockResolvedValue({ data, error: null });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toMatchObject({
      name: "ChatOnlyCheckoutAttemptStateError",
      message: "[stripe:chat-checkout] acquire returned an invalid response.",
    });
  });

  it.each([0, 301, 1.5, "5", null])(
    "rejects the invalid retry-after shape %j",
    async (retryAfterSeconds) => {
      mocks.rpc.mockResolvedValue({
        data: inProgressResponse({ retry_after_seconds: retryAfterSeconds }),
        error: null,
      });

      await expect(
        acquireChatOnlyCheckoutAttempt(acquireArgs),
      ).rejects.toBeInstanceOf(ChatOnlyCheckoutAttemptStateError);
    },
  );

  it("maps an unavailable acquisition response", async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: "unavailable" },
      error: null,
    });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toBeInstanceOf(ChatOnlyCheckoutAttemptUnavailableError);
  });

  it("maps an aged unknown attempt to support-only recovery", async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: "recovery_required", attempt_id: ATTEMPT_ID },
      error: null,
    });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toBeInstanceOf(ChatOnlyCheckoutAttemptRecoveryRequiredError);
  });

  it("rejects malformed support-recovery evidence", async () => {
    mocks.rpc.mockResolvedValue({
      data: { status: "recovery_required", attempt_id: "attempt-1" },
      error: null,
    });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toBeInstanceOf(ChatOnlyCheckoutAttemptStateError);
  });

  it("maps a durable-attempt conflict from any database error text", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "database rejected request",
        details: "chat_only_checkout_attempt_conflict",
      },
    });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toBeInstanceOf(ChatOnlyCheckoutAttemptConflictError);
  });

  it("maps a cross-family database error to the shared stable error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "database rejected request",
        hint: "plan_family_transition_not_supported",
      },
    });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toBeInstanceOf(PlanFamilyTransitionNotSupportedError);
  });

  it("retains a generic database failure as state-error cause", async () => {
    const databaseError = { message: "connection unavailable" };
    mocks.rpc.mockResolvedValue({ data: null, error: databaseError });

    await expect(
      acquireChatOnlyCheckoutAttempt(acquireArgs),
    ).rejects.toMatchObject({
      name: "ChatOnlyCheckoutAttemptStateError",
      message:
        "[stripe:chat-checkout] acquire failed: connection unavailable",
      cause: databaseError,
    });
  });
});

const mutationCases = [
  {
    operation: "record",
    rpcName: "record_chat_only_checkout_session",
    invoke: () =>
      recordChatOnlyCheckoutSession({
        attemptId: ATTEMPT_ID,
        claimToken: CLAIM_TOKEN,
        sessionId: SESSION_ID,
        customerId: CUSTOMER_ID,
        checkoutUrl: CHECKOUT_URL,
        sessionExpiresAt: EXPIRES_AT,
      }),
    params: {
      p_attempt_id: ATTEMPT_ID,
      p_claim_token: CLAIM_TOKEN,
      p_stripe_checkout_session_id: SESSION_ID,
      p_stripe_customer_id: CUSTOMER_ID,
      p_checkout_url: CHECKOUT_URL,
      p_checkout_session_expires_at: EXPIRES_AT,
    },
  },
  {
    operation: "release",
    rpcName: "release_chat_only_checkout_attempt_claim",
    invoke: () =>
      releaseChatOnlyCheckoutAttemptClaim({
        attemptId: ATTEMPT_ID,
        claimToken: CLAIM_TOKEN,
      }),
    params: {
      p_attempt_id: ATTEMPT_ID,
      p_claim_token: CLAIM_TOKEN,
    },
  },
  {
    operation: "complete",
    rpcName: "complete_chat_only_checkout_attempt",
    invoke: () =>
      completeChatOnlyCheckoutAttempt({
        businessId: BUSINESS_ID,
        attemptId: ATTEMPT_ID,
        sessionId: SESSION_ID,
        customerId: CUSTOMER_ID,
        subscriptionId: SUBSCRIPTION_ID,
        requestFingerprint: FINGERPRINT,
        sessionExpiresAt: EXPIRES_AT,
      }),
    params: {
      p_business_id: BUSINESS_ID,
      p_attempt_id: ATTEMPT_ID,
      p_stripe_checkout_session_id: SESSION_ID,
      p_stripe_customer_id: CUSTOMER_ID,
      p_stripe_subscription_id: SUBSCRIPTION_ID,
      p_request_fingerprint: FINGERPRINT,
      p_checkout_session_expires_at: EXPIRES_AT,
    },
  },
  {
    operation: "expire",
    rpcName: "expire_chat_only_checkout_attempt",
    invoke: () =>
      expireChatOnlyCheckoutAttempt({
        businessId: BUSINESS_ID,
        attemptId: ATTEMPT_ID,
        sessionId: SESSION_ID,
        requestFingerprint: FINGERPRINT,
        sessionExpiresAt: EXPIRES_AT,
      }),
    params: {
      p_business_id: BUSINESS_ID,
      p_attempt_id: ATTEMPT_ID,
      p_stripe_checkout_session_id: SESSION_ID,
      p_request_fingerprint: FINGERPRINT,
      p_checkout_session_expires_at: EXPIRES_AT,
    },
  },
] as const;

describe.each(mutationCases)("$operation attempt RPC", (testCase) => {
  it("forwards the exact parameters and requires true", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    await expect(testCase.invoke()).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith(testCase.rpcName, testCase.params);
  });

  it("fails closed when the database returns false", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(testCase.invoke()).rejects.toMatchObject({
      name: "ChatOnlyCheckoutAttemptStateError",
      message: `[stripe:chat-checkout] ${testCase.operation} did not confirm the exact attempt.`,
    });
  });

  it("maps a database error before accepting a true result", async () => {
    const databaseError = {
      message: `${testCase.operation} database unavailable`,
    };
    mocks.rpc.mockResolvedValue({ data: true, error: databaseError });

    await expect(testCase.invoke()).rejects.toMatchObject({
      name: "ChatOnlyCheckoutAttemptStateError",
      message: `[stripe:chat-checkout] ${testCase.operation} failed: ${testCase.operation} database unavailable`,
      cause: databaseError,
    });
  });
});
