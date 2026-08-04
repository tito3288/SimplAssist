import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BusinessOperationalControls,
  OperationalBlockReason,
  OperationalService,
} from "@/types/database";

export interface BusinessOperationalControlsSnapshot {
  business: {
    id: unknown;
    operations_suspended_at: unknown;
    ai_replies_paused_at: unknown;
    texting_paused_at: unknown;
    bookings_paused_at: unknown;
  } | null;
}

export type OperationalControlsResolutionErrorCode =
  | "invalid_business_id"
  | "business_lookup_failed"
  | "business_not_found"
  | "malformed_business";

/**
 * An indeterminate operational-control result. Execution boundaries must fail
 * closed and translate this to their retryable error convention rather than
 * treating it as a known pause or an allow decision.
 */
export class OperationalControlsResolutionError extends Error {
  readonly code: OperationalControlsResolutionErrorCode;
  readonly businessId: string;
  readonly retryable = true;
  override readonly cause?: unknown;

  constructor(args: {
    code: OperationalControlsResolutionErrorCode;
    businessId: string;
    message: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "OperationalControlsResolutionError";
    this.code = args.code;
    this.businessId = args.businessId;
    this.cause = args.cause;
  }
}

export type OperationalAccessDecision =
  | { outcome: "resolved"; allowed: true }
  | {
      outcome: "blocked";
      allowed: false;
      reason: OperationalBlockReason;
    };

type BusinessOperationalControlsRow = NonNullable<
  BusinessOperationalControlsSnapshot["business"]
>;

const OPERATIONAL_CONTROL_COLUMNS = [
  "id",
  "operations_suspended_at",
  "ai_replies_paused_at",
  "texting_paused_at",
  "bookings_paused_at",
].join(", ");

/**
 * Reads current operational controls directly from the business row. This is
 * intentionally uncached so callers can enforce a newly applied pause at each
 * execution boundary.
 */
export async function resolveBusinessOperationalControls(
  businessId: string,
): Promise<BusinessOperationalControls> {
  assertBusinessId(businessId);

  let result;
  try {
    result = await supabaseAdmin
      .from("businesses")
      .select(OPERATIONAL_CONTROL_COLUMNS)
      .eq("id", businessId)
      .maybeSingle<BusinessOperationalControlsRow>();
  } catch (error) {
    throw resolutionError(
      "business_lookup_failed",
      businessId,
      `Failed to read operational controls for business ${businessId}: ${errorMessage(error)}`,
      error,
    );
  }

  if (result.error) {
    throw resolutionError(
      "business_lookup_failed",
      businessId,
      `Failed to read operational controls for business ${businessId}: ${errorMessage(result.error)}`,
      result.error,
    );
  }

  return resolveBusinessOperationalControlsFromSnapshot(businessId, {
    business: result.data,
  });
}

/**
 * Validates an already-loaded row with the same fail-closed rules as the live
 * resolver. This avoids weakening enforcement when another read model already
 * selected the four control timestamps.
 */
export function resolveBusinessOperationalControlsFromSnapshot(
  businessId: string,
  snapshot: BusinessOperationalControlsSnapshot,
): BusinessOperationalControls {
  assertBusinessId(businessId);

  const business = snapshot.business;
  if (!business) {
    throw resolutionError(
      "business_not_found",
      businessId,
      `Business ${businessId} was not found while resolving operational controls.`,
    );
  }
  if (business.id !== businessId) {
    throw resolutionError(
      "malformed_business",
      businessId,
      `Operational-control lookup returned an unexpected row for business ${businessId}.`,
    );
  }

  if (
    !isNullableTimestamp(business.operations_suspended_at) ||
    !isNullableTimestamp(business.ai_replies_paused_at) ||
    !isNullableTimestamp(business.texting_paused_at) ||
    !isNullableTimestamp(business.bookings_paused_at)
  ) {
    throw resolutionError(
      "malformed_business",
      businessId,
      `Business ${businessId} has malformed operational-control timestamps.`,
    );
  }

  return {
    businessId,
    operationsSuspendedAt: business.operations_suspended_at,
    aiRepliesPausedAt: business.ai_replies_paused_at,
    textingPausedAt: business.texting_paused_at,
    bookingsPausedAt: business.bookings_paused_at,
  };
}

/**
 * Returns the authoritative typed reason for a requested execution. Account
 * suspension always wins; service order determines precedence only when more
 * than one requested service is independently paused.
 */
export function resolveOperationalBlockReason(
  controls: BusinessOperationalControls,
  requiredServices: readonly OperationalService[] = [],
): OperationalBlockReason | null {
  if (controls.operationsSuspendedAt !== null) {
    return "account_suspended";
  }

  for (const service of requiredServices) {
    if (service === "ai_replies" && controls.aiRepliesPausedAt !== null) {
      return "ai_replies_paused";
    }
    if (service === "texting" && controls.textingPausedAt !== null) {
      return "texting_paused";
    }
    if (service === "bookings" && controls.bookingsPausedAt !== null) {
      return "bookings_paused";
    }
  }

  return null;
}

export function decideOperationalAccess(
  controls: BusinessOperationalControls,
  requiredServices: readonly OperationalService[] = [],
): OperationalAccessDecision {
  const reason = resolveOperationalBlockReason(controls, requiredServices);
  return reason === null
    ? { outcome: "resolved", allowed: true }
    : { outcome: "blocked", allowed: false, reason };
}

export function isOperationalControlsResolutionError(
  error: unknown,
): error is OperationalControlsResolutionError {
  return error instanceof OperationalControlsResolutionError;
}

function assertBusinessId(businessId: string): void {
  if (typeof businessId !== "string" || businessId.trim() === "") {
    throw resolutionError(
      "invalid_business_id",
      businessId,
      "Cannot resolve operational controls without a business ID.",
    );
  }
}

function resolutionError(
  code: OperationalControlsResolutionErrorCode,
  businessId: string,
  message: string,
  cause?: unknown,
): OperationalControlsResolutionError {
  return new OperationalControlsResolutionError({
    code,
    businessId,
    message,
    cause,
  });
}

// Supabase returns timestamptz values as RFC 3339 strings. Requiring an
// explicit time zone prevents ambiguous local timestamps from becoming an
// accidental allow/deny decision.
const RFC3339_TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

function isNullableTimestamp(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;

  const match = RFC3339_TIMESTAMP.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);

  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return String(error);
}
