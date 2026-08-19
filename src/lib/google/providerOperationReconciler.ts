import "server-only";

import type { calendar_v3 } from "googleapis";
import { getAuthenticatedClient, getCalendarService } from "./client";
import {
  buildCalendarProviderEvidence,
  claimNextCalendarProviderOperationReconciliation,
  failCalendarProviderOperation,
  finalizeCalendarProviderOperation,
  hasCalendarProviderOperationMarker,
  markCalendarProviderDeleteApplied,
  markCalendarProviderOperationApplied,
  resolveCalendarProviderOperationAbsent,
  type CalendarProviderOperation,
} from "./calendarProviderOperations.server";

// The existing cleanup caller has a 30-second deadline. Two single-read
// attempts at five seconds each leave room for database/token work and the
// rest of account cleanup. Hidden googleapis retries are explicitly disabled.
const RECONCILIATION_BATCH_SIZE = 2;
const PROVIDER_READ_TIMEOUT_MS = 5_000;
const CREDENTIAL_TIMEOUT_MS = 5_000;

export type CalendarProviderReconciliationCounts = {
  attempted: number;
  finalized: number;
  failed: number;
  deferred: number;
};

export async function reconcileCalendarProviderOperations(): Promise<CalendarProviderReconciliationCounts> {
  const counts: CalendarProviderReconciliationCounts = {
    attempted: 0,
    finalized: 0,
    failed: 0,
    deferred: 0,
  };

  for (let index = 0; index < RECONCILIATION_BATCH_SIZE; index++) {
    let claimed;
    try {
      claimed = await claimNextCalendarProviderOperationReconciliation();
    } catch {
      counts.deferred++;
      console.error("[calendar:provider-reconciler] Claim failed");
      break;
    }
    if (!claimed) break;

    counts.attempted++;
    try {
      await reconcileOneCalendarProviderOperation(
        claimed.operation,
        claimed.claimToken,
        counts
      );
    } catch {
      counts.deferred++;
      console.error("[calendar:provider-reconciler] Operation deferred", {
        kind: claimed.operation.operation_kind,
        status: claimed.operation.status,
      });
    }
  }

  return counts;
}

async function reconcileOneCalendarProviderOperation(
  operation: CalendarProviderOperation,
  claimToken: string,
  counts: CalendarProviderReconciliationCounts
): Promise<void> {
  // Content-free provider evidence already persisted is authoritative. Local
  // finalization does not depend on a current credential or on an old marker
  // surviving later provider edits.
  if (operation.status === "provider_applied") {
    await finalizeCalendarProviderOperation(operation.business_id, operation.id);
    counts.finalized++;
    return;
  }
  if (operation.status !== "holding") {
    counts.deferred++;
    return;
  }

  // A worker that never crossed the provider side-effect fence can be retired
  // without a provider read. This keeps abandoned preflight/freebusy failures
  // from becoming permanent slot or cleanup blockers.
  if (!operation.provider_submission_started_at) {
    await failCalendarProviderOperation(
      operation.business_id,
      operation.id,
      claimToken,
      "Provider submission was never started."
    );
    counts.failed++;
    return;
  }

  const providerEventId = operation.provider_target_event_id;
  if (!providerEventId) {
    counts.deferred++;
    return;
  }

  const client = await withDeadline(
    getAuthenticatedClient(operation.business_id),
    CREDENTIAL_TIMEOUT_MS
  );
  if (!client) {
    counts.deferred++;
    return;
  }
  const calendar = getCalendarService(client);
  const event = await findCalendarEvent(
    calendar,
    operation.google_calendar_id,
    providerEventId
  );

  if (operation.operation_kind === "delete") {
    if (event) {
      // The one durable read proves the timed-out delete did not apply. Do not
      // perform a new background mutation or send duplicate notifications.
      await failCalendarProviderOperation(
        operation.business_id,
        operation.id,
        claimToken,
        "Provider delete did not apply."
      );
      counts.failed++;
      return;
    }

    await markCalendarProviderDeleteApplied(
      operation.business_id,
      operation.id,
      claimToken,
      providerEventId
    );
    await finalizeCalendarProviderOperation(operation.business_id, operation.id);
    counts.finalized++;
    return;
  }

  if (!event) {
    if (operation.operation_kind === "update") {
      await resolveCalendarProviderOperationAbsent(
        operation.business_id,
        operation.id,
        claimToken
      );
    } else {
      await failCalendarProviderOperation(
        operation.business_id,
        operation.id,
        claimToken,
        "Provider create did not apply."
      );
    }
    counts.failed++;
    return;
  }

  if (!hasCalendarProviderOperationMarker(event, operation.id)) {
    // The target still exists but the exact requested mutation is not current.
    // After the five-minute no-retry window this is definitive non-application.
    await failCalendarProviderOperation(
      operation.business_id,
      operation.id,
      claimToken,
      "Provider mutation did not apply."
    );
    counts.failed++;
    return;
  }

  const startsAt = event.start?.dateTime ?? event.start?.date;
  const endsAt = event.end?.dateTime ?? event.end?.date;
  if (!validInterval(startsAt, endsAt)) {
    counts.deferred++;
    return;
  }

  await markCalendarProviderOperationApplied({
    businessId: operation.business_id,
    operationId: operation.id,
    claimToken,
    providerEventId,
    providerStartsAt: startsAt,
    providerEndsAt: endsAt!,
    evidence: buildCalendarProviderEvidence(event, operation.id),
  });
  await finalizeCalendarProviderOperation(operation.business_id, operation.id);
  counts.finalized++;
}

async function findCalendarEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<calendar_v3.Schema$Event | null> {
  try {
    const response = await calendar.events.get(
      { calendarId, eventId },
      { timeout: PROVIDER_READ_TIMEOUT_MS, retry: false }
    );
    if (response.data.id !== eventId) {
      throw new Error("Calendar provider returned an invalid event identity.");
    }
    return response.data.status === "cancelled" ? null : response.data;
  } catch (error) {
    if (isEventAbsent(error)) return null;
    throw error;
  }
}

function validInterval(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined
): startsAt is string {
  return Boolean(
    startsAt &&
      endsAt &&
      Number.isFinite(Date.parse(startsAt)) &&
      Number.isFinite(Date.parse(endsAt)) &&
      Date.parse(endsAt) > Date.parse(startsAt)
  );
}

function isEventAbsent(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    response?: { status?: unknown };
  };
  return (
    candidate.code === 404 ||
    candidate.code === "404" ||
    candidate.code === 410 ||
    candidate.code === "410" ||
    candidate.response?.status === 404 ||
    candidate.response?.status === 410
  );
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The underlying refresh cannot be force-cancelled, so drain a late reject.
  // Only this bounded race can continue into a provider event read/mutation.
  promise.catch(() => undefined);
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Calendar credential lookup timed out.")),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
