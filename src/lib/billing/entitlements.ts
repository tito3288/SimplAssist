import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BillingMode,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@/types/database";
import {
  canPlanUseFeature,
  isSubscriptionPlan,
  requiredPlanForFeature,
  type FeatureKey,
} from "./features";

export type EntitlementSource =
  | "subscription"
  | "partner_billing"
  | "billing_override";
export type EntitlementStatus =
  | SubscriptionStatus
  | "partner_billing"
  | "billing_override";

export interface BusinessEntitlements {
  businessId: string;
  plan: SubscriptionPlan;
  status: EntitlementStatus;
  source: EntitlementSource;
  active: boolean;
  cancelAtPeriodEnd: boolean;
}

export type EntitlementResolutionErrorCode =
  | "invalid_business_id"
  | "business_lookup_failed"
  | "business_not_found"
  | "subscription_lookup_failed"
  | "subscription_missing"
  | "malformed_business"
  | "malformed_subscription";

/**
 * An indeterminate entitlement result. Callers at provider webhook boundaries
 * should convert this error to a retryable 5xx, never to a known plan denial.
 */
export class EntitlementResolutionError extends Error {
  readonly code: EntitlementResolutionErrorCode;
  readonly businessId: string;
  readonly retryable = true;
  override readonly cause?: unknown;

  constructor(args: {
    code: EntitlementResolutionErrorCode;
    businessId: string;
    message: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "EntitlementResolutionError";
    this.code = args.code;
    this.businessId = args.businessId;
    this.cause = args.cause;
  }
}

export type FeatureAccessDecision =
  | {
      outcome: "resolved";
      allowed: true;
      feature: FeatureKey;
      requiredPlan: SubscriptionPlan;
      currentPlan: SubscriptionPlan;
      status: EntitlementStatus;
    }
  | {
      outcome: "not_entitled";
      allowed: false;
      reason: "inactive_subscription" | "plan";
      feature: FeatureKey;
      requiredPlan: SubscriptionPlan;
      currentPlan: SubscriptionPlan;
      status: EntitlementStatus;
    };

interface BusinessEntitlementRow {
  id: string;
  billing_mode: unknown;
  partner_plan: unknown;
  billing_pilot: unknown;
  billing_comped: unknown;
  billing_exempt: unknown;
}

interface SubscriptionEntitlementRow {
  plan: unknown;
  status: unknown;
  cancel_at_period_end: unknown;
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set<SubscriptionStatus>([
  "active",
  "trialing",
  "past_due",
]);

/**
 * Resolve a business's authoritative local billing state.
 *
 * This intentionally never calls Stripe. Stripe webhooks own synchronization;
 * feature execution reads that durable local state and fails retryably when it
 * cannot determine an answer.
 */
export async function resolveBusinessEntitlements(
  businessId: string
): Promise<BusinessEntitlements> {
  if (typeof businessId !== "string" || businessId.trim() === "") {
    throw new EntitlementResolutionError({
      code: "invalid_business_id",
      businessId,
      message: "Cannot resolve entitlements without a business ID.",
    });
  }

  const [businessQuery, subscriptionQuery] = await Promise.allSettled([
    supabaseAdmin
      .from("businesses")
      .select(
        "id, billing_mode, partner_plan, billing_pilot, billing_comped, billing_exempt"
      )
      .eq("id", businessId)
      .maybeSingle<BusinessEntitlementRow>(),
    supabaseAdmin
      .from("subscriptions")
      .select("plan, status, cancel_at_period_end")
      .eq("business_id", businessId)
      .maybeSingle<SubscriptionEntitlementRow>(),
  ]);

  if (businessQuery.status === "rejected") {
    throw new EntitlementResolutionError({
      code: "business_lookup_failed",
      businessId,
      message: `Failed to read billing flags for business ${businessId}: ${errorMessage(businessQuery.reason)}`,
      cause: businessQuery.reason,
    });
  }
  if (subscriptionQuery.status === "rejected") {
    throw new EntitlementResolutionError({
      code: "subscription_lookup_failed",
      businessId,
      message: `Failed to read the subscription for business ${businessId}: ${errorMessage(subscriptionQuery.reason)}`,
      cause: subscriptionQuery.reason,
    });
  }

  const businessResult = businessQuery.value;
  const subscriptionResult = subscriptionQuery.value;

  if (businessResult.error) {
    throw new EntitlementResolutionError({
      code: "business_lookup_failed",
      businessId,
      message: `Failed to read billing flags for business ${businessId}: ${errorMessage(businessResult.error)}`,
      cause: businessResult.error,
    });
  }
  if (!businessResult.data) {
    throw new EntitlementResolutionError({
      code: "business_not_found",
      businessId,
      message: `Business ${businessId} was not found while resolving entitlements.`,
    });
  }
  if (businessResult.data.id !== businessId) {
    throw new EntitlementResolutionError({
      code: "malformed_business",
      businessId,
      message: `Business entitlement lookup returned an unexpected row for ${businessId}.`,
    });
  }

  if (subscriptionResult.error) {
    throw new EntitlementResolutionError({
      code: "subscription_lookup_failed",
      businessId,
      message: `Failed to read the subscription for business ${businessId}: ${errorMessage(subscriptionResult.error)}`,
      cause: subscriptionResult.error,
    });
  }

  if (subscriptionResult.data) {
    return entitlementsFromSubscription(businessId, subscriptionResult.data);
  }

  const business = businessResult.data;
  if (
    !isBillingMode(business.billing_mode) ||
    typeof business.billing_pilot !== "boolean" ||
    typeof business.billing_comped !== "boolean" ||
    typeof business.billing_exempt !== "boolean"
  ) {
    throw new EntitlementResolutionError({
      code: "malformed_business",
      businessId,
      message: `Business ${businessId} has malformed billing authority fields.`,
    });
  }

  if (
    business.billing_mode === "invoiced" ||
    business.billing_mode === "comped"
  ) {
    if (!isSubscriptionPlan(business.partner_plan)) {
      throw new EntitlementResolutionError({
        code: "malformed_business",
        businessId,
        message: `Business ${businessId} has malformed partner billing state.`,
      });
    }

    return {
      businessId,
      plan: business.partner_plan,
      status: "partner_billing",
      source: "partner_billing",
      active: true,
      cancelAtPeriodEnd: false,
    };
  }

  if (business.partner_plan !== null) {
    throw new EntitlementResolutionError({
      code: "malformed_business",
      businessId,
      message: `Business ${businessId} has malformed Stripe billing state.`,
    });
  }

  if (
    business.billing_pilot ||
    business.billing_comped ||
    business.billing_exempt
  ) {
    return {
      businessId,
      plan: "full",
      status: "billing_override",
      source: "billing_override",
      active: true,
      cancelAtPeriodEnd: false,
    };
  }

  throw new EntitlementResolutionError({
    code: "subscription_missing",
    businessId,
    message: `Business ${businessId} has no synchronized subscription or billing override.`,
  });
}

export function canUseFeature(
  entitlements: BusinessEntitlements,
  feature: FeatureKey
): boolean {
  return (
    entitlements.active && canPlanUseFeature(entitlements.plan, feature)
  );
}

export function decideFeatureAccess(
  entitlements: BusinessEntitlements,
  feature: FeatureKey
): FeatureAccessDecision {
  const requiredPlan = requiredPlanForFeature(feature);
  const base = {
    feature,
    requiredPlan,
    currentPlan: entitlements.plan,
    status: entitlements.status,
  };

  if (!entitlements.active) {
    return {
      ...base,
      outcome: "not_entitled",
      allowed: false,
      reason: "inactive_subscription",
    };
  }

  if (!canPlanUseFeature(entitlements.plan, feature)) {
    return {
      ...base,
      outcome: "not_entitled",
      allowed: false,
      reason: "plan",
    };
  }

  return { ...base, outcome: "resolved", allowed: true };
}

export function isEntitlementResolutionError(
  error: unknown
): error is EntitlementResolutionError {
  return error instanceof EntitlementResolutionError;
}

export { requiredPlanForFeature } from "./features";
export type { FeatureKey } from "./features";

function entitlementsFromSubscription(
  businessId: string,
  subscription: SubscriptionEntitlementRow
): BusinessEntitlements {
  if (
    !isSubscriptionPlan(subscription.plan) ||
    !isSubscriptionStatus(subscription.status) ||
    typeof subscription.cancel_at_period_end !== "boolean"
  ) {
    throw new EntitlementResolutionError({
      code: "malformed_subscription",
      businessId,
      message: `Business ${businessId} has a malformed synchronized subscription.`,
    });
  }

  return {
    businessId,
    plan: subscription.plan,
    status: subscription.status,
    source: "subscription",
    active: ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return (
    value === "active" ||
    value === "trialing" ||
    value === "past_due" ||
    value === "canceled"
  );
}

function isBillingMode(value: unknown): value is BillingMode {
  return value === "stripe" || value === "invoiced" || value === "comped";
}

function errorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return "unknown database error";
}
