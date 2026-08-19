import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { PlanFamilyTransitionNotSupportedError } from "@/lib/billing/planFamilyLock.server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class ChatOnlyCheckoutAttemptConflictError extends Error {
  constructor() {
    super("chat_only_checkout_attempt_conflict");
    this.name = "ChatOnlyCheckoutAttemptConflictError";
  }
}

export class ChatOnlyCheckoutAttemptUnavailableError extends Error {
  constructor() {
    super("chat_only_checkout_attempt_unavailable");
    this.name = "ChatOnlyCheckoutAttemptUnavailableError";
  }
}

export class ChatOnlyCheckoutAttemptRecoveryRequiredError extends Error {
  constructor() {
    super("chat_only_checkout_attempt_recovery_required");
    this.name = "ChatOnlyCheckoutAttemptRecoveryRequiredError";
  }
}

export class ChatOnlyCheckoutAttemptStateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ChatOnlyCheckoutAttemptStateError";
  }
}

export type ChatOnlyCheckoutAttemptDecision =
  | {
      outcome: "create";
      attemptId: string;
      claimToken: string;
      customerId: string | null;
      sessionExpiresAt: string;
    }
  | {
      outcome: "open";
      attemptId: string;
      sessionId: string;
      customerId: string | null;
      sessionExpiresAt: string;
    }
  | {
      outcome: "in_progress";
      attemptId: string;
      customerId: string | null;
      retryAfterSeconds: number;
    };

export async function acquireChatOnlyCheckoutAttempt(args: {
  businessId: string;
  stripePriceId: string;
  requestFingerprint: string;
  claimToken: string;
}): Promise<ChatOnlyCheckoutAttemptDecision> {
  const { data, error } = await supabaseAdmin.rpc(
    "acquire_chat_only_checkout_attempt",
    {
      p_business_id: args.businessId,
      p_stripe_price_id: args.stripePriceId,
      p_request_fingerprint: args.requestFingerprint,
      p_claim_token: args.claimToken,
    },
  );

  if (error) throwAttemptRpcError("acquire", error);
  if (!isRecord(data) || typeof data.status !== "string") {
    throw invalidResponse("acquire");
  }

  if (data.status === "unavailable") {
    throw new ChatOnlyCheckoutAttemptUnavailableError();
  }

  if (data.status === "recovery_required" && isUuid(data.attempt_id)) {
    throw new ChatOnlyCheckoutAttemptRecoveryRequiredError();
  }

  if (
    data.status === "create" &&
    isUuid(data.attempt_id) &&
    isUuid(data.claim_token) &&
    data.claim_token.toLowerCase() === args.claimToken.toLowerCase() &&
    isNullableStripeCustomerId(data.stripe_customer_id) &&
    isSecondAlignedTimestamp(data.checkout_session_expires_at)
  ) {
    return {
      outcome: "create",
      attemptId: data.attempt_id,
      claimToken: data.claim_token,
      customerId: data.stripe_customer_id,
      sessionExpiresAt: data.checkout_session_expires_at,
    };
  }

  if (
    data.status === "open" &&
    isUuid(data.attempt_id) &&
    isStripeSessionId(data.stripe_checkout_session_id) &&
    isNullableStripeCustomerId(data.stripe_customer_id) &&
    isSecondAlignedTimestamp(data.checkout_session_expires_at)
  ) {
    return {
      outcome: "open",
      attemptId: data.attempt_id,
      sessionId: data.stripe_checkout_session_id,
      customerId: data.stripe_customer_id,
      sessionExpiresAt: data.checkout_session_expires_at,
    };
  }

  if (
    data.status === "in_progress" &&
    isUuid(data.attempt_id) &&
    isNullableStripeCustomerId(data.stripe_customer_id) &&
    Number.isInteger(data.retry_after_seconds) &&
    (data.retry_after_seconds as number) >= 1 &&
    (data.retry_after_seconds as number) <= 300
  ) {
    return {
      outcome: "in_progress",
      attemptId: data.attempt_id,
      customerId: data.stripe_customer_id,
      retryAfterSeconds: data.retry_after_seconds as number,
    };
  }

  throw invalidResponse("acquire");
}

export async function recordChatOnlyCheckoutSession(args: {
  attemptId: string;
  claimToken: string;
  sessionId: string;
  customerId: string | null;
  checkoutUrl: string;
  sessionExpiresAt: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "record_chat_only_checkout_session",
    {
      p_attempt_id: args.attemptId,
      p_claim_token: args.claimToken,
      p_stripe_checkout_session_id: args.sessionId,
      p_stripe_customer_id: args.customerId,
      p_checkout_url: args.checkoutUrl,
      p_checkout_session_expires_at: args.sessionExpiresAt,
    },
  );

  requireTrue("record", data, error);
}

export async function releaseChatOnlyCheckoutAttemptClaim(args: {
  attemptId: string;
  claimToken: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "release_chat_only_checkout_attempt_claim",
    {
      p_attempt_id: args.attemptId,
      p_claim_token: args.claimToken,
    },
  );

  requireTrue("release", data, error);
}

export async function completeChatOnlyCheckoutAttempt(args: {
  businessId: string;
  attemptId: string;
  sessionId: string;
  customerId: string;
  subscriptionId: string;
  requestFingerprint: string;
  sessionExpiresAt: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "complete_chat_only_checkout_attempt",
    {
      p_business_id: args.businessId,
      p_attempt_id: args.attemptId,
      p_stripe_checkout_session_id: args.sessionId,
      p_stripe_customer_id: args.customerId,
      p_stripe_subscription_id: args.subscriptionId,
      p_request_fingerprint: args.requestFingerprint,
      p_checkout_session_expires_at: args.sessionExpiresAt,
    },
  );

  requireTrue("complete", data, error);
}

export async function expireChatOnlyCheckoutAttempt(args: {
  businessId: string;
  attemptId: string;
  sessionId: string;
  requestFingerprint: string;
  sessionExpiresAt: string;
}): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    "expire_chat_only_checkout_attempt",
    {
      p_business_id: args.businessId,
      p_attempt_id: args.attemptId,
      p_stripe_checkout_session_id: args.sessionId,
      p_request_fingerprint: args.requestFingerprint,
      p_checkout_session_expires_at: args.sessionExpiresAt,
    },
  );

  requireTrue("expire", data, error);
}

function requireTrue(
  operation: string,
  data: unknown,
  error: unknown,
): void {
  if (error) throwAttemptRpcError(operation, error);
  if (data !== true) {
    throw new ChatOnlyCheckoutAttemptStateError(
      `[stripe:chat-checkout] ${operation} did not confirm the exact attempt.`,
    );
  }
}

function throwAttemptRpcError(operation: string, error: unknown): never {
  const message = databaseErrorText(error);
  if (/\bchat_only_checkout_attempt_conflict\b/.test(message)) {
    throw new ChatOnlyCheckoutAttemptConflictError();
  }
  if (/\bplan_family_transition_not_supported\b/.test(message)) {
    throw new PlanFamilyTransitionNotSupportedError();
  }
  throw new ChatOnlyCheckoutAttemptStateError(
    `[stripe:chat-checkout] ${operation} failed: ${message}`,
    { cause: error },
  );
}

function invalidResponse(operation: string): ChatOnlyCheckoutAttemptStateError {
  return new ChatOnlyCheckoutAttemptStateError(
    `[stripe:chat-checkout] ${operation} returned an invalid response.`,
  );
}

function databaseErrorText(error: unknown): string {
  if (!isRecord(error)) return "database_error";
  return [error.message, error.details, error.hint]
    .filter((value): value is string => typeof value === "string")
    .join(" ") || "database_error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isSecondAlignedTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 20 &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value)) &&
    Date.parse(value) % 1_000 === 0
  );
}

function isStripeSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 4 &&
    value.length <= 255 &&
    /^cs_[A-Za-z0-9_]+$/.test(value)
  );
}

function isNullableStripeCustomerId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length >= 5 &&
      value.length <= 255 &&
      /^cus_[A-Za-z0-9]+$/.test(value))
  );
}
