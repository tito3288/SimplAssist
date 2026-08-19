import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  AIReplyReservationStatus,
  Channel,
  SubscriptionPlan,
} from "@/types/database";

type UUID = string;
export type AIReplyAllowanceRenewal = "scheduled" | "frozen_past_due";

export class AIReplyIdempotencyConflictError extends Error {
  constructor(message = "ai_reply_idempotency_conflict") {
    super(message);
    this.name = "AIReplyIdempotencyConflictError";
  }
}

export class AnthropicCallIdempotencyConflictError extends Error {
  constructor() {
    super("anthropic_provider_call_idempotency_conflict");
    this.name = "AnthropicCallIdempotencyConflictError";
  }
}

export class AIReplyMeteringStateError extends Error {
  readonly retryable = true;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIReplyMeteringStateError";
  }
}

export type AIReplyReservationDecision =
  | { outcome: "not_metered"; reason: "preview" }
  | {
      outcome: "reserved";
      reservationId: UUID;
      attemptToken: UUID;
      attemptCount: number;
      sourceMessageId: UUID;
      usagePeriodId: UUID;
      periodStart: string;
      periodEnd: string;
      plan: SubscriptionPlan;
      allowance: number | null;
      completedReplies: number;
      activeReservations: number;
      remainingReplies: number | null;
      allowanceRenewal: AIReplyAllowanceRenewal;
      resetAt: string | null;
      expiresAt: string;
    }
  | {
      outcome: "in_progress";
      reservationId: UUID;
      sourceMessageId: UUID;
      usagePeriodId: UUID;
      expiresAt: string;
      attemptCount: number;
    }
  | {
      outcome: "completed";
      reservationId: UUID;
      sourceMessageId: UUID;
      assistantMessageId: UUID;
      conversationId: UUID;
      usagePeriodId: UUID;
      completedAt: string;
    }
  | {
      outcome: "limit_reached";
      usagePeriodId: UUID;
      periodStart: string;
      periodEnd: string;
      plan: SubscriptionPlan;
      allowance: number;
      completedReplies: number;
      activeReservations: number;
      remainingReplies: 0;
      allowanceRenewal: AIReplyAllowanceRenewal;
      resetAt: string | null;
    }
  | {
      outcome: "blocked";
      reason: "account_suspended" | "ai_replies_paused";
    }
  | {
      outcome: "not_entitled";
      reason:
        | "business_not_found"
        | "billing_required"
        | "inactive_subscription"
        | "plan";
      plan?: SubscriptionPlan;
    };

export type AIReplyFinalizeDecision =
  | {
      outcome: "completed";
      reservationId: UUID;
      sourceMessageId: UUID;
      assistantMessageId: UUID;
      conversationId: UUID;
      usagePeriodId: UUID;
      completedAt: string;
    }
  | {
      outcome: "stale_attempt" | "not_ready";
      reservationId: UUID;
    };

export type AIReplyCompletionLookupDecision =
  | Extract<AIReplyReservationDecision, { outcome: "completed" }>
  | { outcome: "not_found" }
  | {
      outcome: "not_completed";
      reservationId: UUID;
      sourceMessageId: UUID;
      status: Exclude<AIReplyReservationStatus, "completed">;
    };

export type AIReplyReleaseDecision =
  | {
      outcome: "released" | "expired" | "stale_attempt";
      reservationId: UUID;
    }
  | {
      outcome: "completed";
      reservationId: UUID;
      sourceMessageId: UUID;
      assistantMessageId: UUID;
      conversationId: UUID;
      usagePeriodId: UUID;
      completedAt: string;
    };

export type AIReplyMeteringRequest =
  | { mode: "preview" }
  | {
      mode: "live";
      businessId: UUID;
      clientMessageId: string;
      requestFingerprint: string;
      sourceMessageId: UUID;
    };

type AIReplyUsageFields = {
  billingSource: "subscription" | "partner_billing" | "billing_override";
  plan: Exclude<SubscriptionPlan, "sms_only">;
  allowance: number | null;
  completedReplies: number;
  activeReservations: number;
  remainingReplies: number | null;
  periodStart: string;
  periodEnd: string;
  resetAt: string | null;
  allowanceRenewal: AIReplyAllowanceRenewal;
};

export type AIReplyUsageDecision =
  | (AIReplyUsageFields & {
      outcome: "current";
      usagePeriodId: UUID;
    })
  | (AIReplyUsageFields & {
      outcome: "no_period";
      usagePeriodId: null;
    })
  | {
      outcome: "not_entitled";
      reason:
        | "business_not_found"
        | "billing_required"
        | "inactive_subscription"
        | "plan";
      plan?: SubscriptionPlan;
    };

/**
 * Read current authoritative reply usage without creating a usage period.
 * `no_period` is an entitled zero-usage state suitable for a 0/200 display.
 */
export async function getCurrentAIReplyUsage(
  businessId: UUID,
): Promise<AIReplyUsageDecision> {
  const { data, error } = await supabaseAdmin.rpc(
    "get_current_ai_reply_usage",
    { p_business_id: businessId },
  );

  if (error) throwMeteringRpcError("read-usage", error);
  return parseUsageDecision(data);
}

/**
 * Recover an exact durable assistant reply before mutable execution gates.
 * This lookup never creates a reservation or consumes allowance. Its request
 * fingerprint prevents a reused browser message id from replaying other text.
 */
export async function getCompletedAIReply(args: {
  businessId: UUID;
  clientMessageId: string;
  requestFingerprint: string;
}): Promise<AIReplyCompletionLookupDecision> {
  const { data, error } = await supabaseAdmin.rpc("get_completed_ai_reply", {
    p_business_id: args.businessId,
    p_channel: "web_chat",
    p_client_message_id: args.clientMessageId,
    p_request_fingerprint: args.requestFingerprint,
  });

  if (error) throwMeteringRpcError("recover-completed", error);
  return parseCompletionLookupDecision(data);
}

/**
 * Reserve at most one billable reply for one durable live web-chat inbound.
 * Preview callers are deliberately kept out of the database allowance path.
 */
export async function reserveAIReplyUnit(
  request: AIReplyMeteringRequest,
): Promise<AIReplyReservationDecision> {
  if (request.mode === "preview") {
    return { outcome: "not_metered", reason: "preview" };
  }

  const { data, error } = await supabaseAdmin.rpc("reserve_ai_reply", {
    p_business_id: request.businessId,
    p_channel: "web_chat",
    p_client_message_id: request.clientMessageId,
    p_request_fingerprint: request.requestFingerprint,
    p_source_message_id: request.sourceMessageId,
  });

  if (error) {
    throwMeteringRpcError("reserve", error);
  }

  return parseReservationDecision(data);
}

/**
 * Finalization succeeds only after the assistant row was durably inserted with
 * the reservation id and current opaque attempt token.
 */
export async function finalizeAIReplyUnit(args: {
  reservationId: UUID;
  attemptToken: UUID;
  assistantMessageId: UUID;
}): Promise<AIReplyFinalizeDecision> {
  const { data, error } = await supabaseAdmin.rpc("finalize_ai_reply", {
    p_reservation_id: args.reservationId,
    p_attempt_token: args.attemptToken,
    p_assistant_message_id: args.assistantMessageId,
  });

  if (error) {
    throwMeteringRpcError("finalize", error);
  }

  if (isRecord(data) && data.outcome === "not_found") {
    throw new AIReplyMeteringStateError(
      `[billing:ai-replies] Reservation ${args.reservationId} was not found while finalizing.`,
    );
  }
  return parseFinalizeDecision(data);
}

/** Release a failed attempt. A linked durable assistant wins and is completed. */
export async function releaseAIReplyUnit(args: {
  reservationId: UUID;
  attemptToken: UUID;
  reason: string;
}): Promise<AIReplyReleaseDecision> {
  const { data, error } = await supabaseAdmin.rpc("release_ai_reply", {
    p_reservation_id: args.reservationId,
    p_attempt_token: args.attemptToken,
    p_reason: args.reason,
  });

  if (error) {
    throwMeteringRpcError("release", error);
  }

  if (isRecord(data) && data.outcome === "not_found") {
    throw new AIReplyMeteringStateError(
      `[billing:ai-replies] Reservation ${args.reservationId} was not found while releasing.`,
    );
  }
  return parseReleaseDecision(data);
}

export async function reapExpiredAIReplyReservations(
  limit = 500,
): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc(
    "reap_expired_ai_reply_reservations",
    { p_limit: limit },
  );
  if (error) throwMeteringRpcError("reap", error);
  if (!isNonnegativeInteger(data)) {
    throw invalidRpcResponse("reap", data);
  }
  return data;
}

export interface AnthropicProviderCallAccounting {
  businessId: UUID;
  reservationId: UUID | null;
  attemptToken: UUID | null;
  callIdempotencyKey: string;
  operation: string;
  channel: Channel | null;
  isPreview: boolean;
  model: string;
  providerRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  latencyMs: number;
  stopReason: string | null;
  toolUseCount: number;
  toolResultCount: number;
  succeeded: boolean;
  errorCode: string | null;
}

/**
 * Record one Anthropic HTTP call without prompt, message, response, tool input,
 * tool result, or arbitrary metadata content. This never consumes a reply unit.
 */
export async function recordAnthropicProviderCall(
  call: AnthropicProviderCallAccounting,
): Promise<UUID> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_anthropic_provider_call",
    {
      p_business_id: call.businessId,
      p_reservation_id: call.reservationId,
      p_attempt_token: call.attemptToken,
      p_call_idempotency_key: call.callIdempotencyKey,
      p_operation: call.operation,
      p_channel: call.channel,
      p_is_preview: call.isPreview,
      p_model: call.model,
      p_provider_request_id: call.providerRequestId,
      p_input_tokens: call.inputTokens,
      p_output_tokens: call.outputTokens,
      p_cache_creation_input_tokens: call.cacheCreationInputTokens,
      p_cache_read_input_tokens: call.cacheReadInputTokens,
      p_latency_ms: call.latencyMs,
      p_stop_reason: call.stopReason,
      p_tool_use_count: call.toolUseCount,
      p_tool_result_count: call.toolResultCount,
      p_succeeded: call.succeeded,
      p_error_code: call.errorCode,
    },
  );

  if (error) {
    const message = databaseErrorText(error);
    if (/\banthropic_provider_call_idempotency_conflict\b/.test(message)) {
      throw new AnthropicCallIdempotencyConflictError();
    }
    throw new AIReplyMeteringStateError(
      `[billing:anthropic-calls] Failed to record ${call.callIdempotencyKey}: ${message}`,
      { cause: error },
    );
  }

  if (!isUuid(data)) throw invalidRpcResponse("provider-call", data);
  return data;
}

function parseReservationDecision(data: unknown): AIReplyReservationDecision {
  if (!isRecord(data) || typeof data.outcome !== "string") {
    throw invalidRpcResponse("reserve", data);
  }

  switch (data.outcome) {
    case "reserved":
      if (
        !isUuid(data.reservation_id) ||
        !isUuid(data.attempt_token) ||
        !isPositiveInteger(data.attempt_count) ||
        !isUuid(data.source_message_id) ||
        !isUuid(data.usage_period_id) ||
        !isTimestamp(data.period_start) ||
        !isTimestamp(data.period_end) ||
        !isSubscriptionPlan(data.plan) ||
        !isNullableNonnegativeInteger(data.allowance) ||
        !isNonnegativeInteger(data.completed_replies) ||
        !isNonnegativeInteger(data.active_reservations) ||
        !isNullableNonnegativeInteger(data.remaining_replies) ||
        !isAIReplyAllowanceRenewal(data.allowance_renewal) ||
        !isNullableTimestamp(data.reset_at) ||
        (data.allowance_renewal === "scheduled" && data.reset_at === null) ||
        (data.allowance_renewal === "frozen_past_due" &&
          (data.plan !== "chat_only" || data.reset_at !== null)) ||
        !isTimestamp(data.expires_at)
      ) {
        throw invalidRpcResponse("reserve", data);
      }
      return {
        outcome: "reserved",
        reservationId: data.reservation_id,
        attemptToken: data.attempt_token,
        attemptCount: data.attempt_count,
        sourceMessageId: data.source_message_id,
        usagePeriodId: data.usage_period_id,
        periodStart: data.period_start,
        periodEnd: data.period_end,
        plan: data.plan,
        allowance: data.allowance,
        completedReplies: data.completed_replies,
        activeReservations: data.active_reservations,
        remainingReplies: data.remaining_replies,
        allowanceRenewal: data.allowance_renewal,
        resetAt: data.reset_at,
        expiresAt: data.expires_at,
      };
    case "in_progress":
      if (
        !isUuid(data.reservation_id) ||
        !isUuid(data.source_message_id) ||
        !isUuid(data.usage_period_id) ||
        !isTimestamp(data.expires_at) ||
        !isPositiveInteger(data.attempt_count)
      ) {
        throw invalidRpcResponse("reserve", data);
      }
      return {
        outcome: "in_progress",
        reservationId: data.reservation_id,
        sourceMessageId: data.source_message_id,
        usagePeriodId: data.usage_period_id,
        expiresAt: data.expires_at,
        attemptCount: data.attempt_count,
      };
    case "completed":
      return parseCompleted(data, "reserve");
    case "limit_reached":
      if (
        !isUuid(data.usage_period_id) ||
        !isTimestamp(data.period_start) ||
        !isTimestamp(data.period_end) ||
        !isSubscriptionPlan(data.plan) ||
        !isNonnegativeInteger(data.allowance) ||
        !isNonnegativeInteger(data.completed_replies) ||
        !isNonnegativeInteger(data.active_reservations) ||
        data.remaining_replies !== 0 ||
        !isAIReplyAllowanceRenewal(data.allowance_renewal) ||
        !isNullableTimestamp(data.reset_at) ||
        (data.allowance_renewal === "scheduled" && data.reset_at === null) ||
        (data.allowance_renewal === "frozen_past_due" &&
          (data.plan !== "chat_only" || data.reset_at !== null))
      ) {
        throw invalidRpcResponse("reserve", data);
      }
      return {
        outcome: "limit_reached",
        usagePeriodId: data.usage_period_id,
        periodStart: data.period_start,
        periodEnd: data.period_end,
        plan: data.plan,
        allowance: data.allowance,
        completedReplies: data.completed_replies,
        activeReservations: data.active_reservations,
        remainingReplies: 0,
        allowanceRenewal: data.allowance_renewal,
        resetAt: data.reset_at,
      };
    case "blocked":
      if (
        data.reason !== "account_suspended" &&
        data.reason !== "ai_replies_paused"
      ) {
        throw invalidRpcResponse("reserve", data);
      }
      return { outcome: "blocked", reason: data.reason };
    case "not_entitled": {
      if (
        data.reason !== "business_not_found" &&
        data.reason !== "billing_required" &&
        data.reason !== "inactive_subscription" &&
        data.reason !== "plan"
      ) {
        throw invalidRpcResponse("reserve", data);
      }
      if (data.plan !== undefined && !isSubscriptionPlan(data.plan)) {
        throw invalidRpcResponse("reserve", data);
      }
      return data.plan === undefined
        ? { outcome: "not_entitled", reason: data.reason }
        : { outcome: "not_entitled", reason: data.reason, plan: data.plan };
    }
    default:
      throw invalidRpcResponse("reserve", data);
  }
}

function parseCompletionLookupDecision(
  data: unknown,
): AIReplyCompletionLookupDecision {
  if (!isRecord(data) || typeof data.outcome !== "string") {
    throw invalidRpcResponse("recover-completed", data);
  }
  if (data.outcome === "completed") {
    return parseCompleted(data, "recover-completed");
  }
  if (data.outcome === "not_found") return { outcome: "not_found" };
  if (
    data.outcome === "not_completed" &&
    isUuid(data.reservation_id) &&
    isUuid(data.source_message_id) &&
    isIncompleteReservationStatus(data.status)
  ) {
    return {
      outcome: "not_completed",
      reservationId: data.reservation_id,
      sourceMessageId: data.source_message_id,
      status: data.status,
    };
  }
  throw invalidRpcResponse("recover-completed", data);
}

function parseUsageDecision(data: unknown): AIReplyUsageDecision {
  if (!isRecord(data) || typeof data.outcome !== "string") {
    throw invalidRpcResponse("read-usage", data);
  }

  if (data.outcome === "not_entitled") {
    if (
      data.reason !== "business_not_found" &&
      data.reason !== "billing_required" &&
      data.reason !== "inactive_subscription" &&
      data.reason !== "plan"
    ) {
      throw invalidRpcResponse("read-usage", data);
    }
    if (data.plan !== undefined && !isSubscriptionPlan(data.plan)) {
      throw invalidRpcResponse("read-usage", data);
    }
    return data.plan === undefined
      ? { outcome: "not_entitled", reason: data.reason }
      : { outcome: "not_entitled", reason: data.reason, plan: data.plan };
  }

  if (data.outcome !== "current" && data.outcome !== "no_period") {
    throw invalidRpcResponse("read-usage", data);
  }
  if (
    !isAIReplyEligiblePlan(data.plan) ||
    !isAIReplyBillingSource(data.billing_source) ||
    !isNullableNonnegativeInteger(data.allowance) ||
    !isNonnegativeInteger(data.completed_replies) ||
    !isNonnegativeInteger(data.active_reservations) ||
    !isNullableNonnegativeInteger(data.remaining_replies) ||
    !isTimestamp(data.period_start) ||
    !isTimestamp(data.period_end) ||
    !isNullableTimestamp(data.reset_at) ||
    !isAIReplyAllowanceRenewal(data.allowance_renewal) ||
    (data.allowance_renewal === "scheduled" &&
      data.reset_at !== data.period_end) ||
    (data.allowance_renewal === "frozen_past_due" &&
      (data.plan !== "chat_only" || data.reset_at !== null)) ||
    (data.plan === "chat_only" && data.allowance !== 200) ||
    (data.plan !== "chat_only" && data.allowance !== null) ||
    (data.allowance === null && data.remaining_replies !== null) ||
    (data.allowance !== null && data.remaining_replies === null) ||
    (data.outcome === "current" && !isUuid(data.usage_period_id)) ||
    (data.outcome === "no_period" && data.usage_period_id !== null) ||
    (data.outcome === "no_period" &&
      (data.completed_replies !== 0 || data.active_reservations !== 0))
  ) {
    throw invalidRpcResponse("read-usage", data);
  }

  const fields: AIReplyUsageFields = {
    billingSource: data.billing_source,
    plan: data.plan,
    allowance: data.allowance,
    completedReplies: data.completed_replies,
    activeReservations: data.active_reservations,
    remainingReplies: data.remaining_replies,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    resetAt: data.reset_at,
    allowanceRenewal: data.allowance_renewal,
  };

  if (data.outcome === "current") {
    if (!isUuid(data.usage_period_id)) {
      throw invalidRpcResponse("read-usage", data);
    }
    return { outcome: "current", usagePeriodId: data.usage_period_id, ...fields };
  }
  return { outcome: "no_period", usagePeriodId: null, ...fields };
}

function parseFinalizeDecision(data: unknown): AIReplyFinalizeDecision {
  if (!isRecord(data) || typeof data.outcome !== "string") {
    throw invalidRpcResponse("finalize", data);
  }
  if (data.outcome === "completed") return parseCompleted(data, "finalize");
  if (
    (data.outcome === "stale_attempt" || data.outcome === "not_ready") &&
    isUuid(data.reservation_id)
  ) {
    return { outcome: data.outcome, reservationId: data.reservation_id };
  }
  throw invalidRpcResponse("finalize", data);
}

function parseReleaseDecision(data: unknown): AIReplyReleaseDecision {
  if (!isRecord(data) || typeof data.outcome !== "string") {
    throw invalidRpcResponse("release", data);
  }
  if (data.outcome === "completed") return parseCompleted(data, "release");
  if (
    (data.outcome === "released" ||
      data.outcome === "expired" ||
      data.outcome === "stale_attempt") &&
    isUuid(data.reservation_id)
  ) {
    return { outcome: data.outcome, reservationId: data.reservation_id };
  }
  throw invalidRpcResponse("release", data);
}

function parseCompleted(
  data: Record<string, unknown>,
  operation: string,
): Extract<AIReplyReservationDecision, { outcome: "completed" }> {
  if (
    !isUuid(data.reservation_id) ||
    !isUuid(data.source_message_id) ||
    !isUuid(data.assistant_message_id) ||
    !isUuid(data.conversation_id) ||
    !isUuid(data.usage_period_id) ||
    !isTimestamp(data.completed_at)
  ) {
    throw invalidRpcResponse(operation, data);
  }
  return {
    outcome: "completed",
    reservationId: data.reservation_id,
    sourceMessageId: data.source_message_id,
    assistantMessageId: data.assistant_message_id,
    conversationId: data.conversation_id,
    usagePeriodId: data.usage_period_id,
    completedAt: data.completed_at,
  };
}

function throwMeteringRpcError(operation: string, error: unknown): never {
  const message = databaseErrorText(error);
  if (
    /\b(?:ai_reply_idempotency_conflict|ai_reply_source_message_idempotency_conflict|ai_reply_finalize_idempotency_conflict)\b/.test(
      message,
    )
  ) {
    throw new AIReplyIdempotencyConflictError();
  }
  throw new AIReplyMeteringStateError(
    `[billing:ai-replies] ${operation} failed: ${message}`,
    { cause: error },
  );
}

function invalidRpcResponse(operation: string, data: unknown) {
  return new AIReplyMeteringStateError(
    `[billing:ai-replies] ${operation} returned an invalid response: ${describeValue(data)}`,
  );
}

function databaseErrorText(error: unknown): string {
  if (!isRecord(error)) return "unknown database error";
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ") || "unknown database error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || isNonnegativeInteger(value);
}

function isIncompleteReservationStatus(
  value: unknown,
): value is Exclude<AIReplyReservationStatus, "completed"> {
  return value === "reserved" || value === "released" || value === "expired";
}

function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return (
    value === "chat_only" ||
    value === "sms_only" ||
    value === "sms_and_chat" ||
    value === "full"
  );
}

function isAIReplyEligiblePlan(
  value: unknown,
): value is Exclude<SubscriptionPlan, "sms_only"> {
  return (
    value === "chat_only" || value === "sms_and_chat" || value === "full"
  );
}

function isAIReplyBillingSource(
  value: unknown,
): value is AIReplyUsageFields["billingSource"] {
  return (
    value === "subscription" ||
    value === "partner_billing" ||
    value === "billing_override"
  );
}

function isAIReplyAllowanceRenewal(
  value: unknown,
): value is AIReplyAllowanceRenewal {
  return value === "scheduled" || value === "frozen_past_due";
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
