import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  claimCalendarBookingReconciliation,
  failCalendarBookingRecovery,
  recoverCalendarBookingConfirmation,
  type RecoverableCalendarBooking,
} from "./calendar";

const STALE_BOOKING_CLAIM_MS = 5 * 60 * 1000;
const RECONCILIATION_BATCH_SIZE = 10;
const BOOKING_SELECT =
  "id,business_id,contact_id,conversation_id,source_message_id,google_calendar_id,google_event_id,event_summary,request_fingerprint,operation_claim_token,operation_claimed_at,reconciliation_attempt_count,reconciliation_attempted_at,status,starts_at,ends_at,businesses!inner(owner_id,deleted_at)";

type PendingCalendarBooking = {
  id: string;
  business_id: string;
  contact_id: string;
  conversation_id: string;
  source_message_id: string;
  google_calendar_id: string;
  google_event_id: string | null;
  event_summary: string;
  request_fingerprint: string;
  operation_claim_token: string | null;
  operation_claimed_at: string | null;
  reconciliation_attempt_count: number;
  reconciliation_attempted_at: string | null;
  status: "pending";
  starts_at: string;
  ends_at: string;
};

export type CalendarBookingReconciliationCounts = {
  confirmed: number;
  notFound: number;
  failed: number;
};

export async function reconcilePendingCalendarBookings(): Promise<CalendarBookingReconciliationCounts> {
  const staleBefore = new Date(
    Date.now() - STALE_BOOKING_CLAIM_MS
  ).toISOString();
  const { data, error } = await supabaseAdmin
    .from("calendar_bookings")
    .select(BOOKING_SELECT)
    .eq("status", "pending")
    .not("operation_claim_token", "is", null)
    .not("businesses.owner_id", "is", null)
    .is("businesses.deleted_at", null)
    .lt("operation_claimed_at", staleBefore)
    .order("reconciliation_attempted_at", {
      ascending: true,
      nullsFirst: true,
    })
    .order("operation_claimed_at", { ascending: true })
    .limit(RECONCILIATION_BATCH_SIZE);

  if (error) {
    throw new Error(
      `Could not query pending calendar bookings: ${error.message}`
    );
  }

  const counts: CalendarBookingReconciliationCounts = {
    confirmed: 0,
    notFound: 0,
    failed: 0,
  };

  for (const booking of (data ?? []) as PendingCalendarBooking[]) {
    let claimed: RecoverableCalendarBooking;
    try {
      claimed = await claimCalendarBookingReconciliation(booking);
    } catch {
      counts.failed++;
      console.error(
        `[calendar:reconciler] Booking ${booking.id} claim failed`
      );
      continue;
    }

    if (claimed.status === "confirmed") {
      counts.confirmed++;
      continue;
    }
    if (claimed.status !== "pending") {
      counts.failed++;
      continue;
    }

    try {
      const confirmed =
        await recoverCalendarBookingConfirmation(claimed);
      if (confirmed) {
        counts.confirmed++;
      } else {
        const releasedStatus =
          await failCalendarBookingRecovery(claimed);
        if (releasedStatus === "confirmed") {
          counts.confirmed++;
        } else {
          counts.notFound++;
        }
      }
    } catch {
      counts.failed++;
      console.error(
        `[calendar:reconciler] Booking ${booking.id} reconciliation failed`
      );
    }
  }

  return counts;
}
