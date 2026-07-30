import type { WaitlistSignup } from "@/types/database";

export const WAITLIST_CLAIM_REVIEW_AFTER_MS = 5 * 60 * 1000;

export type WaitlistRow = Pick<
  WaitlistSignup,
  | "id"
  | "email"
  | "created_at"
  | "notified_at"
  | "unsubscribed_at"
  | "launch_send_claimed_at"
>;

export type WaitlistStatus = "Unsubscribed" | "Notified" | "Pending";
export type WaitlistClaimIndicator =
  | "Sending"
  | "Delivery review needed"
  | null;

export function waitlistStatus(row: WaitlistRow): WaitlistStatus {
  if (row.unsubscribed_at) return "Unsubscribed";
  if (row.notified_at) return "Notified";
  return "Pending";
}

export function waitlistClaimIndicator(
  row: WaitlistRow,
  nowMs = Date.now()
): WaitlistClaimIndicator {
  if (waitlistStatus(row) !== "Pending" || !row.launch_send_claimed_at) {
    return null;
  }

  const claimedAtMs = Date.parse(row.launch_send_claimed_at);
  if (
    Number.isFinite(claimedAtMs) &&
    nowMs - claimedAtMs < WAITLIST_CLAIM_REVIEW_AFTER_MS
  ) {
    return "Sending";
  }

  return "Delivery review needed";
}
