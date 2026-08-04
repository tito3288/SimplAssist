import type { AdminAccountActivityEvent } from "@/lib/admin/accountActivity.server";
import {
  bodyFaint,
  card,
  statusNeutral,
  statusWarning,
} from "@/lib/theme-v2/theme";

interface AdminAccountActivityTimelineProps {
  events: readonly AdminAccountActivityEvent[];
  unavailable?: boolean;
}

const CAPTION =
  "Recorded activity only. Partner assignment, billing-mode, and billing-flag changes were not historically recorded.";

const CATEGORY_LABELS: Record<AdminAccountActivityEvent["category"], string> = {
  lifecycle: "Lifecycle",
  admin: "Admin action",
  risk_review: "Risk review",
  registration: "Registration",
  brand: "Brand",
  rejection: "Rejection",
  calendar: "Calendar",
};

export function AdminAccountActivityTimeline({
  events,
  unavailable = false,
}: AdminAccountActivityTimelineProps) {
  const visibleEvents = unavailable ? [] : newestEvents(events);

  return (
    <section
      className={`${card} p-5 sm:p-6`}
      aria-labelledby="account-activity-heading"
    >
      <div>
        <h2 id="account-activity-heading" className="text-lg font-semibold">
          Account activity
        </h2>
        <p className={`mt-1 text-sm ${bodyFaint}`}>
          Read-only account milestones and recorded operational changes.
        </p>
      </div>

      {unavailable ? (
        <div className={`mt-5 rounded-2xl px-4 py-3 ${statusWarning}`}>
          <h3 className="text-sm font-semibold">Timeline unavailable</h3>
          <p className="mt-1 text-xs">
            Recorded activity could not be loaded. No partial timeline is
            shown.
          </p>
        </div>
      ) : visibleEvents.length === 0 ? (
        <p className={`mt-5 rounded-2xl px-4 py-5 text-sm ${statusNeutral}`}>
          No recorded activity is available for this account.
        </p>
      ) : (
        <ol
          aria-label="Recorded account activity"
          className="mt-5 divide-y divide-[#ece4d8] dark:divide-white/[0.1]"
        >
          {visibleEvents.map((event) => (
            <li key={event.id} className="relative py-4 first:pt-0 last:pb-0">
              <article className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${statusNeutral}`}
                    >
                      {CATEGORY_LABELS[event.category]}
                    </span>
                    <h3 className="font-semibold">{event.title}</h3>
                  </div>
                  {event.detail ? (
                    <p className={`mt-2 text-sm ${bodyFaint}`}>
                      {event.detail}
                    </p>
                  ) : null}
                  {event.actor ? (
                    <p className={`mt-1 break-all text-xs ${bodyFaint}`}>
                      Actor: {event.actor}
                    </p>
                  ) : null}
                </div>
                <time
                  dateTime={event.occurredAt}
                  className={`text-xs sm:text-right ${bodyFaint}`}
                >
                  {formatTimestamp(event.occurredAt)}
                </time>
              </article>
            </li>
          ))}
        </ol>
      )}

      <p className={`mt-5 border-t border-[#ece4d8] pt-4 text-xs dark:border-white/[0.1] ${bodyFaint}`}>
        {CAPTION}
      </p>
    </section>
  );
}

function newestEvents(
  events: readonly AdminAccountActivityEvent[],
): AdminAccountActivityEvent[] {
  return [...events]
    .sort(
      (left, right) =>
        Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 100);
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}
