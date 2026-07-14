import "server-only";

import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { supabaseAdmin } from "@/lib/supabase/admin";

const STRIPE_ACTION_LEASE_SECONDS = 300;
const MAX_ERROR_MESSAGE_LENGTH = 1000;

export type AccountDeletionStripeAction = "pause" | "resume" | "cancel";

export type AccountDeletionStripeReconcileResult =
  | {
      outcome: "applied";
      businessId: string;
      generation: number;
      appliedAction: AccountDeletionStripeAction;
    }
  | {
      outcome: "pending" | "blocked";
      businessId: string;
      generation: number;
      errorCode: string;
      errorMessage: string;
    }
  | {
      outcome: "not_claimed" | "stale";
      businessId: string;
      generation: number;
    };

type ReconcileInput = {
  businessId: string;
  generation: number;
  leaseOwner?: string;
};

type ClaimedAction = {
  businessId: string;
  stripeSubscriptionId: string;
  desiredAction: AccountDeletionStripeAction;
  generation: number;
  idempotencyKey: string;
  leaseToken: string;
};

type ActionResolution =
  | {
      status: "applied";
      appliedAction: AccountDeletionStripeAction;
    }
  | {
      status: "pending" | "blocked";
      errorCode: string;
      errorMessage: string;
    };

class StripeStateMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeStateMismatchError";
  }
}

export class AccountDeletionStripePersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountDeletionStripePersistenceError";
  }
}

export async function reconcileAccountDeletionStripeAction({
  businessId,
  generation,
  leaseOwner: requestedLeaseOwner,
}: ReconcileInput): Promise<AccountDeletionStripeReconcileResult> {
  if (!businessId) {
    throw new TypeError("businessId is required");
  }
  if (!Number.isSafeInteger(generation) || generation < 1) {
    throw new TypeError("generation must be a positive safe integer");
  }
  if (requestedLeaseOwner !== undefined && !requestedLeaseOwner.trim()) {
    throw new TypeError("leaseOwner cannot be empty");
  }

  const leaseOwner =
    requestedLeaseOwner ?? `account-deletion-stripe:${randomUUID()}`;
  const action = await claimAction(businessId, generation, leaseOwner);

  if (!action) {
    return { outcome: "not_claimed", businessId, generation };
  }

  let resolution: ActionResolution;
  try {
    resolution = {
      status: "applied",
      appliedAction: await applyStripeAction(action),
    };
  } catch (error) {
    resolution = isMissingStripeSubscription(error)
      ? { status: "applied", appliedAction: "cancel" }
      : classifyStripeFailure(error);
  }

  const finished = await finishClaimedAction(action, resolution);
  if (!finished) {
    return {
      outcome: "stale",
      businessId: action.businessId,
      generation: action.generation,
    };
  }

  if (resolution.status === "applied") {
    return {
      outcome: "applied",
      businessId: action.businessId,
      generation: action.generation,
      appliedAction: resolution.appliedAction,
    };
  }

  return {
    outcome: resolution.status,
    businessId: action.businessId,
    generation: action.generation,
    errorCode: resolution.errorCode,
    errorMessage: resolution.errorMessage,
  };
}

async function claimAction(
  businessId: string,
  generation: number,
  leaseOwner: string
): Promise<ClaimedAction | null> {
  const { data, error } = await supabaseAdmin.rpc(
    "claim_account_deletion_stripe_action",
    {
      p_business_id: businessId,
      p_generation: generation,
      p_lease_owner: leaseOwner,
      p_lease_seconds: STRIPE_ACTION_LEASE_SECONDS,
    }
  );

  if (error) {
    throw new AccountDeletionStripePersistenceError(
      `[stripe:account-deletion] Failed to claim generation ${generation} for business ${businessId}: ${error.message}`
    );
  }
  if (data === null) {
    return null;
  }

  return parseClaimedAction(data, businessId, generation, leaseOwner);
}

function parseClaimedAction(
  value: unknown,
  businessId: string,
  generation: number,
  leaseOwner: string
): ClaimedAction {
  if (
    !isRecord(value) ||
    value.business_id !== businessId ||
    value.generation !== generation ||
    value.lease_owner !== leaseOwner ||
    value.status !== "pending" ||
    typeof value.stripe_subscription_id !== "string" ||
    !value.stripe_subscription_id ||
    !isAccountDeletionStripeAction(value.desired_action) ||
    typeof value.idempotency_key !== "string" ||
    !value.idempotency_key ||
    typeof value.lease_token !== "string" ||
    !value.lease_token
  ) {
    throw new AccountDeletionStripePersistenceError(
      `[stripe:account-deletion] Claim generation ${generation} for business ${businessId} returned an invalid action`
    );
  }

  return {
    businessId: value.business_id,
    stripeSubscriptionId: value.stripe_subscription_id,
    desiredAction: value.desired_action,
    generation: value.generation,
    idempotencyKey: value.idempotency_key,
    leaseToken: value.lease_token,
  };
}

async function applyStripeAction(
  action: ClaimedAction
): Promise<AccountDeletionStripeAction> {
  // Load after the durable claim so a missing Stripe configuration can be
  // classified and persisted as blocked instead of failing at module import.
  const { getStripeClient } = await import("./client");
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(
    action.stripeSubscriptionId
  );

  if (subscription.status === "canceled") {
    return "cancel";
  }

  const requestOptions = { idempotencyKey: action.idempotencyKey };

  if (action.desiredAction === "pause") {
    if (isVoidPausedWithoutResume(subscription)) {
      return "pause";
    }

    const updated = await stripe.subscriptions.update(
      action.stripeSubscriptionId,
      { pause_collection: { behavior: "void" } },
      requestOptions
    );
    if (!isVoidPausedWithoutResume(updated)) {
      throw new StripeStateMismatchError(
        `Stripe subscription ${action.stripeSubscriptionId} did not enter the required void pause state`
      );
    }
    return "pause";
  }

  if (action.desiredAction === "resume") {
    if (subscription.pause_collection === null) {
      return "resume";
    }

    const updated = await stripe.subscriptions.update(
      action.stripeSubscriptionId,
      { pause_collection: "" },
      requestOptions
    );
    if (updated.pause_collection !== null) {
      throw new StripeStateMismatchError(
        `Stripe subscription ${action.stripeSubscriptionId} remained collection-paused after resume`
      );
    }
    return "resume";
  }

  const canceled = await stripe.subscriptions.cancel(
    action.stripeSubscriptionId,
    { invoice_now: false, prorate: false },
    requestOptions
  );
  if (canceled.status !== "canceled") {
    throw new StripeStateMismatchError(
      `Stripe subscription ${action.stripeSubscriptionId} was not canceled`
    );
  }
  return "cancel";
}

function isVoidPausedWithoutResume(subscription: Stripe.Subscription): boolean {
  return (
    subscription.pause_collection?.behavior === "void" &&
    subscription.pause_collection.resumes_at == null
  );
}

function isMissingStripeSubscription(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.code === "resource_missing" &&
    error.statusCode === 404
  );
}

function classifyStripeFailure(error: unknown): ActionResolution {
  const errorMessage = messageForError(error);

  if (error instanceof StripeStateMismatchError) {
    return {
      status: "pending",
      errorCode: "stripe_state_mismatch",
      errorMessage,
    };
  }

  if (errorMessage === "STRIPE_SECRET_KEY is required") {
    return {
      status: "blocked",
      errorCode: "stripe_configuration_error",
      errorMessage,
    };
  }

  if (error instanceof Stripe.errors.StripeError) {
    if (error instanceof Stripe.errors.StripeConnectionError) {
      return {
        status: "pending",
        errorCode: "stripe_connection_error",
        errorMessage,
      };
    }
    if (error instanceof Stripe.errors.StripeRateLimitError) {
      return {
        status: "pending",
        errorCode: "stripe_rate_limit_error",
        errorMessage,
      };
    }
    if (
      error instanceof Stripe.errors.StripeAPIError ||
      (error.statusCode !== undefined && error.statusCode >= 500)
    ) {
      return {
        status: "pending",
        errorCode: "stripe_api_error",
        errorMessage,
      };
    }
    if (error instanceof Stripe.errors.StripeAuthenticationError) {
      return {
        status: "blocked",
        errorCode: "stripe_authentication_error",
        errorMessage,
      };
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      return {
        status: "blocked",
        errorCode: "stripe_permission_error",
        errorMessage,
      };
    }
    if (error instanceof Stripe.errors.StripeIdempotencyError) {
      return {
        status: "blocked",
        errorCode: "stripe_idempotency_error",
        errorMessage,
      };
    }
    if (error instanceof Stripe.errors.StripeInvalidRequestError) {
      return {
        status: "blocked",
        errorCode: "stripe_invalid_request_error",
        errorMessage,
      };
    }
    if (
      error.statusCode !== undefined &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return {
        status: "blocked",
        errorCode: "stripe_client_error",
        errorMessage,
      };
    }
  }

  // Unknown failures remain retryable so durable cancellation work is never
  // silently dead-lettered without a definite permanent Stripe response.
  return {
    status: "pending",
    errorCode: "stripe_unexpected_error",
    errorMessage,
  };
}

async function finishClaimedAction(
  action: ClaimedAction,
  resolution: ActionResolution
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "finish_account_deletion_stripe_action",
    {
      p_business_id: action.businessId,
      // Both CAS values come from this worker's claim response. Caller input
      // can never complete a displaced lease or a newer generation.
      p_generation: action.generation,
      p_lease_token: action.leaseToken,
      p_status: resolution.status,
      p_applied_action:
        resolution.status === "applied" ? resolution.appliedAction : null,
      p_error_code:
        resolution.status === "applied" ? null : resolution.errorCode,
      p_error_message:
        resolution.status === "applied" ? null : resolution.errorMessage,
    }
  );

  if (error) {
    throw new AccountDeletionStripePersistenceError(
      `[stripe:account-deletion] Failed to finish claimed generation ${action.generation} for business ${action.businessId}: ${error.message}`
    );
  }

  return data === true;
}

function messageForError(error: unknown): string {
  const message =
    error instanceof Error && error.message
      ? error.message
      : "Unknown Stripe reconciliation failure";
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAccountDeletionStripeAction(
  value: unknown
): value is AccountDeletionStripeAction {
  return value === "pause" || value === "resume" || value === "cancel";
}
