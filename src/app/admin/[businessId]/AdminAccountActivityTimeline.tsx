"use client";

import { useReducer } from "react";
import type { AdminAccountActivityEvent } from "@/lib/admin/accountActivity.server";
import {
  bodyFaint,
  btnSecondaryCompact,
  card,
  statusNeutral,
  statusWarning,
} from "@/lib/theme-v2/theme";

interface AdminAccountActivityTimelineProps {
  events: readonly AdminAccountActivityEvent[];
  unavailable?: boolean;
}

const CAPTION =
  "Recorded activity only. Partner assignment, billing-mode, and billing-flag changes were not historically recorded. Historical provisioning actions are available only while a stored job association still links them to the account.";

const EMBEDDED_ISO_TIMESTAMP_PATTERN =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g;
const STRICT_ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

const CATEGORY_LABELS: Record<AdminAccountActivityEvent["category"], string> = {
  lifecycle: "Lifecycle",
  admin: "Admin action",
  risk_review: "Risk review",
  registration: "Registration",
  brand: "Brand",
  rejection: "Rejection",
  calendar: "Calendar",
};

export const ACTIVITY_WINDOW_SIZE = 15;

export const ACTIVITY_FILTERS = [
  { id: "all", label: "All" },
  { id: "lifecycle", label: "Lifecycle" },
  { id: "admin", label: "Admin actions" },
  { id: "registration", label: "Registration" },
] as const;

export type AdminAccountActivityFilter =
  (typeof ACTIVITY_FILTERS)[number]["id"];

export interface AdminAccountActivityViewState {
  filter: AdminAccountActivityFilter;
  visibleOptionalItems: number;
}

export type AdminAccountActivityViewAction =
  | { type: "filter"; filter: AdminAccountActivityFilter }
  | { type: "show_more" };

export type AdminAccountActivityTimelineItem =
  | {
      kind: "event";
      id: string;
      occurredAt: string;
      event: AdminAccountActivityEvent;
    }
  | {
      kind: "campaign_check_group";
      id: string;
      occurredAt: string;
      utcDate: string;
      events: AdminAccountActivityEvent[];
    };

export interface AdminAccountActivityTimelineView {
  items: AdminAccountActivityTimelineItem[];
  hiddenOptionalItems: number;
  totalTopLevelItems: number;
}

const INITIAL_VIEW_STATE: AdminAccountActivityViewState = {
  filter: "all",
  visibleOptionalItems: ACTIVITY_WINDOW_SIZE,
};

export function reduceAdminAccountActivityView(
  state: AdminAccountActivityViewState,
  action: AdminAccountActivityViewAction,
): AdminAccountActivityViewState {
  if (action.type === "filter") {
    if (action.filter === state.filter) return state;
    return {
      filter: action.filter,
      visibleOptionalItems: ACTIVITY_WINDOW_SIZE,
    };
  }
  return {
    ...state,
    visibleOptionalItems: state.visibleOptionalItems + ACTIVITY_WINDOW_SIZE,
  };
}

export function buildAdminAccountActivityTimelineView(
  events: readonly AdminAccountActivityEvent[],
  state: AdminAccountActivityViewState,
): AdminAccountActivityTimelineView {
  const sortedEvents = [...events].sort(compareEventsNewestFirst);

  if (state.filter === "lifecycle" || state.filter === "admin") {
    const facet = state.filter;
    const items = sortedEvents
      .filter((event) => event.facets.includes(facet))
      .map(eventItem);
    return {
      items,
      hiddenOptionalItems: 0,
      totalTopLevelItems: items.length,
    };
  }

  if (state.filter === "registration") {
    const allItems = groupCampaignStatusChecks(
      sortedEvents.filter((event) => event.facets.includes("registration")),
    );
    const items = allItems.slice(0, state.visibleOptionalItems);
    return {
      items,
      hiddenOptionalItems: allItems.length - items.length,
      totalTopLevelItems: allItems.length,
    };
  }

  const protectedEvents = sortedEvents.filter(isProtectedEvent);
  const optionalItems = groupCampaignStatusChecks(
    sortedEvents.filter((event) => !isProtectedEvent(event)),
  );
  const visibleOptionalItems = optionalItems.slice(
    0,
    state.visibleOptionalItems,
  );
  const items = [
    ...protectedEvents.map(eventItem),
    ...visibleOptionalItems,
  ].sort(compareTimelineItemsNewestFirst);

  return {
    items,
    hiddenOptionalItems: optionalItems.length - visibleOptionalItems.length,
    totalTopLevelItems: protectedEvents.length + optionalItems.length,
  };
}

export function AdminAccountActivityTimeline({
  events,
  unavailable = false,
}: AdminAccountActivityTimelineProps) {
  const [viewState, dispatch] = useReducer(
    reduceAdminAccountActivityView,
    INITIAL_VIEW_STATE,
  );
  const view = buildAdminAccountActivityTimelineView(events, viewState);

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
      ) : events.length === 0 ? (
        <p className={`mt-5 rounded-2xl px-4 py-5 text-sm ${statusNeutral}`}>
          No recorded activity is available for this account.
        </p>
      ) : (
        <>
          <div
            role="group"
            aria-label="Filter account activity"
            className="mt-5 flex flex-wrap gap-2"
          >
            {ACTIVITY_FILTERS.map((filter) => {
              const selected = viewState.filter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  aria-pressed={selected}
                  aria-controls="recorded-account-activity"
                  onClick={() =>
                    dispatch({ type: "filter", filter: filter.id })
                  }
                  className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                    selected
                      ? "bg-stone-900 text-white dark:bg-white dark:text-stone-950"
                      : statusNeutral
                  }`}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>

          {view.items.length === 0 ? (
            <p
              id="recorded-account-activity"
              className={`mt-5 rounded-2xl px-4 py-5 text-sm ${statusNeutral}`}
            >
              No recorded activity matches this filter.
            </p>
          ) : (
            <ol
              id="recorded-account-activity"
              aria-label="Recorded account activity"
              className="mt-5 divide-y divide-[#ece4d8] dark:divide-white/[0.1]"
            >
              {view.items.map((item) =>
                item.kind === "event" ? (
                  <li
                    key={item.id}
                    className="relative py-4 first:pt-0 last:pb-0"
                  >
                    <ActivityEvent event={item.event} />
                  </li>
                ) : (
                  <CampaignCheckGroup key={item.id} item={item} />
                ),
              )}
            </ol>
          )}

          {view.hiddenOptionalItems > 0 ? (
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                className={btnSecondaryCompact}
                onClick={() => dispatch({ type: "show_more" })}
              >
                Show more
              </button>
              <span className={`text-xs ${bodyFaint}`} aria-live="polite">
                {view.hiddenOptionalItems} more timeline{" "}
                {view.hiddenOptionalItems === 1 ? "item" : "items"}
              </span>
            </div>
          ) : (
            <p className="sr-only" aria-live="polite">
              All matching activity is shown.
            </p>
          )}
        </>
      )}

      <p
        className={`mt-5 border-t border-[#ece4d8] pt-4 text-xs dark:border-white/[0.1] ${bodyFaint}`}
      >
        {CAPTION}
      </p>
    </section>
  );
}

function CampaignCheckGroup({
  item,
}: {
  item: Extract<
    AdminAccountActivityTimelineItem,
    { kind: "campaign_check_group" }
  >;
}) {
  const dateLabel = formatUtcDate(item.utcDate);
  return (
    <li className="relative py-4 first:pt-0 last:pb-0">
      <details>
        <summary className="cursor-pointer list-none rounded-2xl px-3 py-2 font-semibold transition-colors hover:bg-stone-50 dark:hover:bg-white/[0.05]">
          <span>
            {item.events.length} campaign registration status checks · {dateLabel}
          </span>
        </summary>
        <ol
          aria-label={`Campaign registration status checks for ${dateLabel}`}
          className="ml-3 mt-3 divide-y divide-[#ece4d8] border-l border-[#ece4d8] pl-4 dark:divide-white/[0.1] dark:border-white/[0.1]"
        >
          {item.events.map((event) => (
            <li key={event.id} className="py-4 first:pt-1 last:pb-1">
              <ActivityEvent event={event} />
            </li>
          ))}
        </ol>
      </details>
    </li>
  );
}

function ActivityEvent({ event }: { event: AdminAccountActivityEvent }) {
  return (
    <article className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs ${statusNeutral}`}>
            {CATEGORY_LABELS[event.category]}
          </span>
          <h3 className="font-semibold">{event.title}</h3>
        </div>
        {event.detail ? (
          <p className={`mt-2 text-sm ${bodyFaint}`}>
            {formatEmbeddedTimestamps(event.detail)}
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
  );
}

function groupCampaignStatusChecks(
  events: readonly AdminAccountActivityEvent[],
): AdminAccountActivityTimelineItem[] {
  const checksByDate = new Map<string, AdminAccountActivityEvent[]>();
  for (const event of events) {
    if (event.registrationEventType !== "campaign_status_refreshed") continue;
    const utcDate = event.occurredAt.slice(0, 10);
    const checks = checksByDate.get(utcDate) ?? [];
    checks.push(event);
    checksByDate.set(utcDate, checks);
  }

  const emittedDates = new Set<string>();
  const items: AdminAccountActivityTimelineItem[] = [];
  for (const event of events) {
    if (event.registrationEventType === "campaign_status_refreshed") {
      const utcDate = event.occurredAt.slice(0, 10);
      const checks = checksByDate.get(utcDate) ?? [];
      if (checks.length >= 2) {
        if (!emittedDates.has(utcDate)) {
          const sortedChecks = [...checks].sort(compareEventsNewestFirst);
          items.push({
            kind: "campaign_check_group",
            id: `campaign-status-checks:${utcDate}`,
            occurredAt: sortedChecks[0].occurredAt,
            utcDate,
            events: sortedChecks,
          });
          emittedDates.add(utcDate);
        }
        continue;
      }
    }
    items.push(eventItem(event));
  }
  return items.sort(compareTimelineItemsNewestFirst);
}

function eventItem(
  event: AdminAccountActivityEvent,
): AdminAccountActivityTimelineItem {
  return {
    kind: "event",
    id: event.id,
    occurredAt: event.occurredAt,
    event,
  };
}

function isProtectedEvent(event: AdminAccountActivityEvent): boolean {
  return (
    event.facets.includes("lifecycle") || event.facets.includes("admin")
  );
}

function compareEventsNewestFirst(
  left: AdminAccountActivityEvent,
  right: AdminAccountActivityEvent,
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareTimelineItemsNewestFirst(
  left: AdminAccountActivityTimelineItem,
  right: AdminAccountActivityTimelineItem,
): number {
  return (
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.id.localeCompare(right.id)
  );
}

function formatUtcDate(utcDate: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${utcDate}T00:00:00.000Z`))} UTC`;
}

function formatTimestamp(value: string): string {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

function formatEmbeddedTimestamps(value: string): string {
  return value.replace(EMBEDDED_ISO_TIMESTAMP_PATTERN, (timestamp) =>
    isValidIsoTimestamp(timestamp) ? formatTimestamp(timestamp) : timestamp,
  );
}

function isValidIsoTimestamp(value: string): boolean {
  const match = STRICT_ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] =
    match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const numericDay = Number(day);
  const numericHour = Number(hour);
  const numericMinute = Number(minute);
  const numericSecond = Number(second);
  if (
    numericMonth < 1 ||
    numericMonth > 12 ||
    numericDay < 1 ||
    numericDay > daysInMonth(numericYear, numericMonth) ||
    numericHour > 23 ||
    numericMinute > 59 ||
    numericSecond > 59
  ) {
    return false;
  }
  if (offsetHour !== undefined && offsetMinute !== undefined) {
    const numericOffsetHour = Number(offsetHour);
    const numericOffsetMinute = Number(offsetMinute);
    if (
      numericOffsetHour > 14 ||
      numericOffsetMinute > 59 ||
      (numericOffsetHour === 14 && numericOffsetMinute !== 0)
    ) {
      return false;
    }
  }
  return Number.isFinite(Date.parse(value));
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
