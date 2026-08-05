import "server-only";

import {
  decideOperationalAccess,
  resolveBusinessOperationalControls,
} from "@/lib/account/operationalControls.server";

export type BookingOperationalBlockReason =
  | "account_suspended"
  | "bookings_paused";

export class BookingOperationalBlockedError extends Error {
  readonly businessId: string;
  readonly reason: BookingOperationalBlockReason;

  constructor(
    businessId: string,
    reason: BookingOperationalBlockReason,
  ) {
    super("Booking is currently unavailable.");
    this.name = "BookingOperationalBlockedError";
    this.businessId = businessId;
    this.reason = reason;
  }
}

export type BookingOperationalStateErrorCode =
  | "booking_cleanup_failed"
  | "invalid_booking_control";

/**
 * A retryable local-state uncertainty after a booking reservation has been
 * claimed. Callers must fail closed and must not turn this into ordinary tool
 * output because the provider-submission boundary was not durably resolved.
 */
export class BookingOperationalStateError extends Error {
  readonly businessId: string;
  readonly code: BookingOperationalStateErrorCode;
  readonly retryable = true;
  override readonly cause?: unknown;

  constructor(args: {
    businessId: string;
    code: BookingOperationalStateErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(args.message);
    this.name = "BookingOperationalStateError";
    this.businessId = args.businessId;
    this.code = args.code;
    this.cause = args.cause;
  }
}

export async function assertBookingOperationallyAllowed(
  businessId: string,
): Promise<void> {
  const controls = await resolveBusinessOperationalControls(businessId);
  const decision = decideOperationalAccess(controls, ["bookings"]);
  if (decision.outcome === "resolved") return;

  if (
    decision.reason !== "account_suspended" &&
    decision.reason !== "bookings_paused"
  ) {
    throw new BookingOperationalStateError({
      businessId,
      code: "invalid_booking_control",
      message: "Booking operational controls returned an invalid block state.",
    });
  }

  throw new BookingOperationalBlockedError(businessId, decision.reason);
}

export function isBookingOperationalBlockedError(
  error: unknown,
): error is BookingOperationalBlockedError {
  return error instanceof BookingOperationalBlockedError;
}

export function isBookingOperationalStateError(
  error: unknown,
): error is BookingOperationalStateError {
  return error instanceof BookingOperationalStateError;
}
