import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  AIReplyIdempotencyConflictError,
  AIReplyMeteringStateError,
  AnthropicCallIdempotencyConflictError,
  finalizeAIReplyUnit,
  getCompletedAIReply,
  getCurrentAIReplyUsage,
  reapExpiredAIReplyReservations,
  recordAnthropicProviderCall,
  releaseAIReplyUnit,
  reserveAIReplyUnit,
} from "./aiReplyMeter.server";

const BUSINESS_ID = "10000000-0000-4000-a060-000000000001";
const SOURCE_MESSAGE_ID = "20000000-0000-4000-a060-000000000001";
const ASSISTANT_MESSAGE_ID = "20000000-0000-4000-a060-000000000002";
const CONVERSATION_ID = "30000000-0000-4000-a060-000000000001";
const RESERVATION_ID = "40000000-0000-4000-a060-000000000001";
const ATTEMPT_TOKEN = "50000000-0000-4000-a060-000000000001";
const PERIOD_ID = "60000000-0000-4000-a060-000000000001";
const PROVIDER_CALL_ID = "70000000-0000-4000-a060-000000000001";
const FINGERPRINT = "a".repeat(64);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCurrentAIReplyUsage", () => {
  it("maps the authoritative current Chat Only allowance", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "current",
        usage_period_id: PERIOD_ID,
        billing_source: "subscription",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 83,
        active_reservations: 2,
        remaining_replies: 115,
        period_start: "2026-08-10T12:34:56+00:00",
        period_end: "2026-09-10T12:34:56+00:00",
        reset_at: "2026-09-10T12:34:56+00:00",
        allowance_renewal: "scheduled",
      },
      error: null,
    });

    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).resolves.toEqual({
      outcome: "current",
      usagePeriodId: PERIOD_ID,
      billingSource: "subscription",
      plan: "chat_only",
      allowance: 200,
      completedReplies: 83,
      activeReservations: 2,
      remainingReplies: 115,
      periodStart: "2026-08-10T12:34:56+00:00",
      periodEnd: "2026-09-10T12:34:56+00:00",
      resetAt: "2026-09-10T12:34:56+00:00",
      allowanceRenewal: "scheduled",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("get_current_ai_reply_usage", {
      p_business_id: BUSINESS_ID,
    });
  });

  it("represents an entitled account with no ledger row as zero usage", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "no_period",
        usage_period_id: null,
        billing_source: "partner_billing",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 0,
        active_reservations: 0,
        remaining_replies: 200,
        period_start: "2026-08-01T00:00:00+00:00",
        period_end: "2026-09-01T00:00:00+00:00",
        reset_at: "2026-09-01T00:00:00+00:00",
        allowance_renewal: "scheduled",
      },
      error: null,
    });

    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).resolves.toMatchObject({
      outcome: "no_period",
      usagePeriodId: null,
      completedReplies: 0,
      activeReservations: 0,
      remainingReplies: 200,
    });
  });

  it("preserves an uncapped existing-plan read", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "current",
        usage_period_id: PERIOD_ID,
        billing_source: "billing_override",
        plan: "full",
        allowance: null,
        completed_replies: 4500,
        active_reservations: 4,
        remaining_replies: null,
        period_start: "2026-08-01T00:00:00+00:00",
        period_end: "2026-09-01T00:00:00+00:00",
        reset_at: "2026-09-01T00:00:00+00:00",
        allowance_renewal: "scheduled",
      },
      error: null,
    });

    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).resolves.toMatchObject({
      outcome: "current",
      plan: "full",
      allowance: null,
      remainingReplies: null,
    });
  });

  it("represents a frozen past-due Chat Only allowance without a reset promise", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "current",
        usage_period_id: PERIOD_ID,
        billing_source: "subscription",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 199,
        active_reservations: 0,
        remaining_replies: 1,
        period_start: "2026-06-01T00:00:00Z",
        period_end: "2026-07-01T00:00:00Z",
        reset_at: null,
        allowance_renewal: "frozen_past_due",
      },
      error: null,
    });

    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).resolves.toMatchObject({
      outcome: "current",
      plan: "chat_only",
      remainingReplies: 1,
      resetAt: null,
      allowanceRenewal: "frozen_past_due",
    });
  });

  it("returns a typed not-entitled result", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "not_entitled", reason: "plan", plan: "sms_only" },
      error: null,
    });

    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).resolves.toEqual({
      outcome: "not_entitled",
      reason: "plan",
      plan: "sms_only",
    });
  });

  it("fails closed on database errors or malformed usage facts", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).rejects.toBeInstanceOf(
      AIReplyMeteringStateError,
    );

    mocks.rpc.mockResolvedValueOnce({
      data: {
        outcome: "no_period",
        usage_period_id: null,
        billing_source: "subscription",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 1,
        active_reservations: 0,
        remaining_replies: 199,
        period_start: "2026-08-01T00:00:00Z",
        period_end: "2026-09-01T00:00:00Z",
        reset_at: "2026-09-01T00:00:00Z",
        allowance_renewal: "scheduled",
      },
      error: null,
    });
    await expect(getCurrentAIReplyUsage(BUSINESS_ID)).rejects.toBeInstanceOf(
      AIReplyMeteringStateError,
    );
  });
});

describe("getCompletedAIReply", () => {
  it("returns exact durable persistence proof without creating usage", async () => {
    mocks.rpc.mockResolvedValue({ data: completedRpcResult(), error: null });

    await expect(completedLookup()).resolves.toEqual(completedResult());
    expect(mocks.rpc).toHaveBeenCalledWith("get_completed_ai_reply", {
      p_business_id: BUSINESS_ID,
      p_channel: "web_chat",
      p_client_message_id: "client-1",
      p_request_fingerprint: FINGERPRINT,
    });
  });

  it.each([
    [{ outcome: "not_found" }, { outcome: "not_found" }],
    [
      {
        outcome: "not_completed",
        reservation_id: RESERVATION_ID,
        source_message_id: SOURCE_MESSAGE_ID,
        status: "released",
      },
      {
        outcome: "not_completed",
        reservationId: RESERVATION_ID,
        sourceMessageId: SOURCE_MESSAGE_ID,
        status: "released",
      },
    ],
  ] as const)("maps a non-completed lookup result", async (data, expected) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(completedLookup()).resolves.toEqual(expected);
  });

  it("fails safely on a mismatched fingerprint or malformed proof", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "ai_reply_idempotency_conflict" },
    });
    await expect(completedLookup()).rejects.toBeInstanceOf(
      AIReplyIdempotencyConflictError,
    );

    mocks.rpc.mockResolvedValueOnce({
      data: {
        outcome: "not_completed",
        reservation_id: RESERVATION_ID,
        source_message_id: SOURCE_MESSAGE_ID,
        status: "completed",
      },
      error: null,
    });
    await expect(completedLookup()).rejects.toBeInstanceOf(
      AIReplyMeteringStateError,
    );
  });
});

describe("reserveAIReplyUnit", () => {
  it("keeps preview replies outside the billable RPC", async () => {
    await expect(reserveAIReplyUnit({ mode: "preview" })).resolves.toEqual({
      outcome: "not_metered",
      reason: "preview",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a fresh Chat Only reservation and its remaining allowance", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "reserved",
        reservation_id: RESERVATION_ID,
        attempt_token: ATTEMPT_TOKEN,
        attempt_count: 1,
        source_message_id: SOURCE_MESSAGE_ID,
        usage_period_id: PERIOD_ID,
        period_start: "2026-08-01T00:00:00+00:00",
        period_end: "2026-09-01T00:00:00+00:00",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 198,
        active_reservations: 1,
        remaining_replies: 1,
        allowance_renewal: "scheduled",
        reset_at: "2026-09-01T00:00:00+00:00",
        expires_at: "2026-08-18T16:10:00+00:00",
      },
      error: null,
    });

    await expect(
      reserveAIReplyUnit({
        mode: "live",
        businessId: BUSINESS_ID,
        clientMessageId: "client-1",
        requestFingerprint: FINGERPRINT,
        sourceMessageId: SOURCE_MESSAGE_ID,
      }),
    ).resolves.toEqual({
      outcome: "reserved",
      reservationId: RESERVATION_ID,
      attemptToken: ATTEMPT_TOKEN,
      attemptCount: 1,
      sourceMessageId: SOURCE_MESSAGE_ID,
      usagePeriodId: PERIOD_ID,
      periodStart: "2026-08-01T00:00:00+00:00",
      periodEnd: "2026-09-01T00:00:00+00:00",
      plan: "chat_only",
      allowance: 200,
      completedReplies: 198,
      activeReservations: 1,
      remainingReplies: 1,
      allowanceRenewal: "scheduled",
      resetAt: "2026-09-01T00:00:00+00:00",
      expiresAt: "2026-08-18T16:10:00+00:00",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_ai_reply", {
      p_business_id: BUSINESS_ID,
      p_channel: "web_chat",
      p_client_message_id: "client-1",
      p_request_fingerprint: FINGERPRINT,
      p_source_message_id: SOURCE_MESSAGE_ID,
    });
  });

  it("preserves an uncapped existing-plan result without inventing a limit", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "reserved",
        reservation_id: RESERVATION_ID,
        attempt_token: ATTEMPT_TOKEN,
        attempt_count: 2,
        source_message_id: SOURCE_MESSAGE_ID,
        usage_period_id: PERIOD_ID,
        period_start: "2026-08-01T00:00:00Z",
        period_end: "2026-09-01T00:00:00Z",
        plan: "full",
        allowance: null,
        completed_replies: 5000,
        active_reservations: 8,
        remaining_replies: null,
        allowance_renewal: "scheduled",
        reset_at: "2026-09-01T00:00:00Z",
        expires_at: "2026-08-18T16:10:00Z",
      },
      error: null,
    });

    await expect(liveReservation()).resolves.toMatchObject({
      outcome: "reserved",
      plan: "full",
      allowance: null,
      remainingReplies: null,
    });
  });

  it("returns an in-progress reference without leaking its worker token", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "in_progress",
        reservation_id: RESERVATION_ID,
        source_message_id: SOURCE_MESSAGE_ID,
        usage_period_id: PERIOD_ID,
        expires_at: "2026-08-18T16:10:00Z",
        attempt_count: 1,
      },
      error: null,
    });

    const result = await liveReservation();
    expect(result).toEqual({
      outcome: "in_progress",
      reservationId: RESERVATION_ID,
      sourceMessageId: SOURCE_MESSAGE_ID,
      usagePeriodId: PERIOD_ID,
      expiresAt: "2026-08-18T16:10:00Z",
      attemptCount: 1,
    });
    expect(result).not.toHaveProperty("attemptToken");
  });

  it("returns exact durable assistant proof for a completed retry", async () => {
    mocks.rpc.mockResolvedValue({
      data: completedRpcResult(),
      error: null,
    });

    await expect(liveReservation()).resolves.toEqual(completedResult());
  });

  it("maps a hard allowance denial", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "limit_reached",
        usage_period_id: PERIOD_ID,
        period_start: "2026-08-01T00:00:00Z",
        period_end: "2026-09-01T00:00:00Z",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 199,
        active_reservations: 1,
        remaining_replies: 0,
        allowance_renewal: "scheduled",
        reset_at: "2026-09-01T00:00:00Z",
      },
      error: null,
    });

    await expect(liveReservation()).resolves.toMatchObject({
      outcome: "limit_reached",
      allowance: 200,
      completedReplies: 199,
      activeReservations: 1,
      remainingReplies: 0,
      allowanceRenewal: "scheduled",
      resetAt: "2026-09-01T00:00:00Z",
    });
  });

  it("maps frozen past-due exhaustion without inventing a reset date", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        outcome: "limit_reached",
        usage_period_id: PERIOD_ID,
        period_start: "2026-06-01T00:00:00Z",
        period_end: "2026-07-01T00:00:00Z",
        plan: "chat_only",
        allowance: 200,
        completed_replies: 200,
        active_reservations: 0,
        remaining_replies: 0,
        allowance_renewal: "frozen_past_due",
        reset_at: null,
      },
      error: null,
    });

    await expect(liveReservation()).resolves.toMatchObject({
      outcome: "limit_reached",
      remainingReplies: 0,
      allowanceRenewal: "frozen_past_due",
      resetAt: null,
    });
  });

  it.each([
    [{ outcome: "blocked", reason: "account_suspended" }, "blocked"],
    [{ outcome: "blocked", reason: "ai_replies_paused" }, "blocked"],
    [
      { outcome: "not_entitled", reason: "inactive_subscription", plan: "chat_only" },
      "not_entitled",
    ],
    [{ outcome: "not_entitled", reason: "plan", plan: "sms_only" }, "not_entitled"],
    [{ outcome: "not_entitled", reason: "billing_required" }, "not_entitled"],
  ] as const)("maps %j", async (data, outcome) => {
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(liveReservation()).resolves.toMatchObject({ outcome });
  });

  it("raises a typed conflict when a client id is reused for different identity", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "ai_reply_idempotency_conflict" },
    });

    await expect(liveReservation()).rejects.toBeInstanceOf(
      AIReplyIdempotencyConflictError,
    );
  });

  it("fails closed on database errors and malformed RPC output", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(liveReservation()).rejects.toMatchObject({
      name: "AIReplyMeteringStateError",
      retryable: true,
    });

    mocks.rpc.mockResolvedValueOnce({
      data: { outcome: "reserved", reservation_id: "not-a-uuid" },
      error: null,
    });
    await expect(liveReservation()).rejects.toBeInstanceOf(
      AIReplyMeteringStateError,
    );
  });
});

describe("finalizeAIReplyUnit and releaseAIReplyUnit", () => {
  it("returns completed persistence proof from finalization", async () => {
    mocks.rpc.mockResolvedValue({ data: completedRpcResult(), error: null });
    await expect(
      finalizeAIReplyUnit({
        reservationId: RESERVATION_ID,
        attemptToken: ATTEMPT_TOKEN,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
      }),
    ).resolves.toEqual(completedResult());
  });

  it.each(["stale_attempt", "not_ready"] as const)(
    "preserves the %s finalization outcome",
    async (outcome) => {
      mocks.rpc.mockResolvedValue({
        data: { outcome, reservation_id: RESERVATION_ID },
        error: null,
      });
      await expect(
        finalizeAIReplyUnit({
          reservationId: RESERVATION_ID,
          attemptToken: ATTEMPT_TOKEN,
          assistantMessageId: ASSISTANT_MESSAGE_ID,
        }),
      ).resolves.toEqual({ outcome, reservationId: RESERVATION_ID });
    },
  );

  it("treats a missing finalization reservation as retryable state uncertainty", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "not_found" }, error: null });
    await expect(
      finalizeAIReplyUnit({
        reservationId: RESERVATION_ID,
        attemptToken: ATTEMPT_TOKEN,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
      }),
    ).rejects.toBeInstanceOf(AIReplyMeteringStateError);
  });

  it("releases a failed attempt using a bounded content-free reason code", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "released", reservation_id: RESERVATION_ID },
      error: null,
    });
    await expect(
      releaseAIReplyUnit({
        reservationId: RESERVATION_ID,
        attemptToken: ATTEMPT_TOKEN,
        reason: "anthropic_error",
      }),
    ).resolves.toEqual({ outcome: "released", reservationId: RESERVATION_ID });
    expect(mocks.rpc).toHaveBeenCalledWith("release_ai_reply", {
      p_reservation_id: RESERVATION_ID,
      p_attempt_token: ATTEMPT_TOKEN,
      p_reason: "anthropic_error",
    });
  });

  it("surfaces completion when persistence wins a release race", async () => {
    mocks.rpc.mockResolvedValue({ data: completedRpcResult(), error: null });
    await expect(
      releaseAIReplyUnit({
        reservationId: RESERVATION_ID,
        attemptToken: ATTEMPT_TOKEN,
        reason: "post_persist_error",
      }),
    ).resolves.toEqual(completedResult());
  });
});

describe("maintenance and provider-call accounting", () => {
  it("returns the exact number reaped", async () => {
    mocks.rpc.mockResolvedValue({ data: 17, error: null });
    await expect(reapExpiredAIReplyReservations(50)).resolves.toBe(17);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "reap_expired_ai_reply_reservations",
      { p_limit: 50 },
    );
  });

  it("sends only content-free provider-call dimensions", async () => {
    mocks.rpc.mockResolvedValue({ data: PROVIDER_CALL_ID, error: null });
    const call = providerCall();

    await expect(recordAnthropicProviderCall(call)).resolves.toBe(
      PROVIDER_CALL_ID,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_anthropic_provider_call",
      {
        p_business_id: BUSINESS_ID,
        p_reservation_id: RESERVATION_ID,
        p_attempt_token: ATTEMPT_TOKEN,
        p_call_idempotency_key: "reply:client-1:attempt-1:call-1",
        p_operation: "live_web_chat_reply",
        p_channel: "web_chat",
        p_is_preview: false,
        p_model: "claude-haiku-4-5-20251001",
        p_provider_request_id: "msg_anthropic_1",
        p_input_tokens: 120,
        p_output_tokens: 40,
        p_cache_creation_input_tokens: 10,
        p_cache_read_input_tokens: 20,
        p_latency_ms: 350,
        p_stop_reason: "end_turn",
        p_tool_use_count: 0,
        p_tool_result_count: 0,
        p_succeeded: true,
        p_error_code: null,
      },
    );

    const payload = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(payload)).not.toEqual(
      expect.arrayContaining([
        "content",
        "message",
        "prompt",
        "response",
        "tool_input",
        "tool_result",
        "metadata",
      ]),
    );
  });

  it("accounts preview calls without a reservation or reply unit", async () => {
    mocks.rpc.mockResolvedValue({ data: PROVIDER_CALL_ID, error: null });
    await recordAnthropicProviderCall({
      ...providerCall(),
      reservationId: null,
      attemptToken: null,
      callIdempotencyKey: "preview:workspace-1:call-1",
      operation: "preview_web_chat_reply",
      isPreview: true,
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_anthropic_provider_call",
      expect.objectContaining({
        p_reservation_id: null,
        p_attempt_token: null,
        p_is_preview: true,
      }),
    );
  });

  it("maps provider-call idempotency conflicts and malformed identifiers", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "anthropic_provider_call_idempotency_conflict" },
    });
    await expect(recordAnthropicProviderCall(providerCall())).rejects.toBeInstanceOf(
      AnthropicCallIdempotencyConflictError,
    );

    mocks.rpc.mockResolvedValueOnce({ data: "bad-id", error: null });
    await expect(recordAnthropicProviderCall(providerCall())).rejects.toBeInstanceOf(
      AIReplyMeteringStateError,
    );
  });
});

function liveReservation() {
  return reserveAIReplyUnit({
    mode: "live",
    businessId: BUSINESS_ID,
    clientMessageId: "client-1",
    requestFingerprint: FINGERPRINT,
    sourceMessageId: SOURCE_MESSAGE_ID,
  });
}

function completedLookup() {
  return getCompletedAIReply({
    businessId: BUSINESS_ID,
    clientMessageId: "client-1",
    requestFingerprint: FINGERPRINT,
  });
}

function completedRpcResult() {
  return {
    outcome: "completed",
    reservation_id: RESERVATION_ID,
    source_message_id: SOURCE_MESSAGE_ID,
    assistant_message_id: ASSISTANT_MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    usage_period_id: PERIOD_ID,
    completed_at: "2026-08-18T16:02:00Z",
  };
}

function completedResult() {
  return {
    outcome: "completed",
    reservationId: RESERVATION_ID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    assistantMessageId: ASSISTANT_MESSAGE_ID,
    conversationId: CONVERSATION_ID,
    usagePeriodId: PERIOD_ID,
    completedAt: "2026-08-18T16:02:00Z",
  };
}

function providerCall() {
  return {
    businessId: BUSINESS_ID,
    reservationId: RESERVATION_ID,
    attemptToken: ATTEMPT_TOKEN,
    callIdempotencyKey: "reply:client-1:attempt-1:call-1",
    operation: "live_web_chat_reply",
    channel: "web_chat" as const,
    isPreview: false,
    model: "claude-haiku-4-5-20251001",
    providerRequestId: "msg_anthropic_1",
    inputTokens: 120,
    outputTokens: 40,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 20,
    latencyMs: 350,
    stopReason: "end_turn",
    toolUseCount: 0,
    toolResultCount: 0,
    succeeded: true,
    errorCode: null,
  };
}
