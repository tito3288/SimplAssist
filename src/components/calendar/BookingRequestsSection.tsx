"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  body,
  btnPrimaryCompact,
  card,
  ink,
  statusNeutral,
  statusWarning,
  tile,
} from "@/lib/theme-v2/theme";
import { formatPhoneNumber } from "@/lib/utils";

export interface BookingRequestContact {
  name: string | null;
  phone_number: string | null;
  email: string | null;
}

export interface BookingRequestListItem {
  id: string;
  conversation_id: string | null;
  requested_service: string;
  requested_time_text: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  status: "new" | "handled";
  handled_at: string | null;
  created_at: string;
  contact: BookingRequestContact | null;
}

interface BookingRequestsSectionProps {
  initialRequests: BookingRequestListItem[];
  initialNewCount: number | null;
  listLoadFailed: boolean;
  timeZone: string;
}

const HANDLE_ERROR_MESSAGE =
  "Could not mark this request handled. Please try again.";

export default function BookingRequestsSection({
  initialRequests,
  initialNewCount,
  listLoadFailed,
  timeZone,
}: BookingRequestsSectionProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [newCount, setNewCount] = useState(initialNewCount);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const inFlightIds = useRef(new Set<string>());
  const requestStatuses = useRef(
    new Map(initialRequests.map((request) => [request.id, request.status]))
  );

  async function markHandled(request: BookingRequestListItem) {
    if (
      requestStatuses.current.get(request.id) !== "new" ||
      inFlightIds.current.has(request.id)
    ) {
      return;
    }

    inFlightIds.current.add(request.id);
    setPendingIds((current) => [...current, request.id]);
    setRowErrors((current) => omitKey(current, request.id));

    try {
      const response = await fetch(
        `/api/booking-requests/${encodeURIComponent(request.id)}/handle`,
        { method: "POST" }
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            request?: {
              id?: unknown;
              status?: unknown;
              handledAt?: unknown;
            };
          }
        | null;
      const handledAt = payload?.request?.handledAt;

      if (
        !response.ok ||
        payload?.request?.id !== request.id ||
        payload.request.status !== "handled" ||
        typeof handledAt !== "string" ||
        handledAt.length === 0 ||
        Number.isNaN(Date.parse(handledAt))
      ) {
        throw new Error("Invalid handle response");
      }

      if (requestStatuses.current.get(request.id) === "new") {
        requestStatuses.current.set(request.id, "handled");
        setRequests((current) =>
          current.map((item) =>
            item.id === request.id && item.status === "new"
              ? { ...item, status: "handled", handled_at: handledAt }
              : item
          )
        );
        setNewCount((current) =>
          typeof current === "number" ? Math.max(0, current - 1) : null
        );
      }
    } catch {
      setRowErrors((current) => ({
        ...current,
        [request.id]: HANDLE_ERROR_MESSAGE,
      }));
    } finally {
      inFlightIds.current.delete(request.id);
      setPendingIds((current) =>
        current.filter((requestId) => requestId !== request.id)
      );
    }
  }

  return (
    <section aria-labelledby="appointment-requests-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="appointment-requests-heading"
            className={`text-xl font-bold ${ink}`}
          >
            Appointment requests
          </h2>
          <p className={`mt-1 text-sm ${body}`}>
            Review the details customers asked your team to confirm.
          </p>
        </div>
        <div
          className={`${card} min-w-36 px-4 py-3 sm:text-right`}
          aria-label="New requests"
        >
          <p className={`text-xs font-medium ${body}`}>New requests</p>
          <p className={`mt-0.5 text-2xl font-bold ${ink}`}>
            {newCount ?? "\u2014"}
          </p>
        </div>
      </div>

      {listLoadFailed ? (
        <div
          role="alert"
          className={`${card} border-red-200 px-5 py-6 dark:border-red-500/25`}
        >
          <p className="font-semibold text-red-700 dark:text-red-300">
            Appointment requests could not be loaded.
          </p>
          <p className={`mt-1 text-sm ${body}`}>Refresh the page to try again.</p>
        </div>
      ) : requests.length === 0 ? (
        <div className={`${card} px-5 py-8 text-center text-sm ${body}`}>
          {typeof newCount === "number" && newCount > 0
            ? "Appointment request details are temporarily unavailable. Refresh the page to try again."
            : "No appointment requests yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {requests.map((request) => {
            const pending = pendingIds.includes(request.id);
            const rowError = rowErrors[request.id];
            return (
              <article key={request.id} className={`${card} p-5 sm:p-6`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className={`font-semibold ${ink}`}>
                      {contactDisplay(request)}
                    </p>
                    <p className={`mt-1 text-xs ${body}`}>
                      <time dateTime={request.created_at}>
                        {formatSystemTimestamp(request.created_at, timeZone)}
                      </time>
                    </p>
                  </div>
                  <div className="shrink-0 sm:text-right">
                    <span
                      className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                        request.status === "new" ? statusWarning : statusNeutral
                      }`}
                    >
                      {request.status === "new" ? "New request" : "Handled"}
                    </span>
                    {request.status === "handled" && request.handled_at && (
                      <p className={`mt-1 text-xs ${body}`}>
                        <time dateTime={request.handled_at}>
                          {formatSystemTimestamp(request.handled_at, timeZone)}
                        </time>
                      </p>
                    )}
                  </div>
                </div>

                <dl className={`mt-4 space-y-3 ${tile} p-4`}>
                  <div>
                    <dt className={`text-xs font-medium ${body}`}>
                      Requested service
                    </dt>
                    <dd className={`mt-1 whitespace-pre-wrap break-words text-sm ${ink}`}>
                      {request.requested_service}
                    </dd>
                  </div>
                  <div>
                    <dt className={`text-xs font-medium ${body}`}>
                      Requested time
                    </dt>
                    <dd className={`mt-1 whitespace-pre-wrap break-words text-sm ${ink}`}>
                      {request.requested_time_text}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  {request.conversation_id ? (
                    <Link
                      href={`/conversations?conversation=${encodeURIComponent(request.conversation_id)}`}
                      className="text-sm font-medium text-[var(--brand-accent)] transition-colors hover:text-[var(--brand-primary-active)] dark:text-[var(--brand-accent-dark)] dark:hover:text-[var(--brand-primary-soft-dark)]"
                    >
                      View conversation
                    </Link>
                  ) : (
                    <span className={`text-sm ${body}`}>
                      Conversation unavailable
                    </span>
                  )}

                  {request.status === "new" && (
                    <button
                      type="button"
                      className={`${btnPrimaryCompact} disabled:cursor-not-allowed disabled:opacity-60 disabled:active:translate-y-0`}
                      disabled={pending}
                      aria-busy={pending}
                      onClick={() => markHandled(request)}
                    >
                      Mark handled
                    </button>
                  )}
                </div>

                {rowError && (
                  <p
                    role="alert"
                    className="mt-3 text-sm text-red-700 dark:text-red-300"
                  >
                    {rowError}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function nonBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !/\S/.test(value)) return null;
  return value.trim();
}

function contactDisplay(request: BookingRequestListItem): string {
  const capturedName = nonBlank(request.customer_name);
  if (capturedName) return capturedName;

  const linkedName = nonBlank(request.contact?.name);
  if (linkedName) return linkedName;

  const capturedPhone = nonBlank(request.customer_phone);
  if (capturedPhone) return formatPhoneNumber(capturedPhone);

  const linkedPhone = nonBlank(request.contact?.phone_number);
  if (linkedPhone) return formatPhoneNumber(linkedPhone);

  const capturedEmail = nonBlank(request.customer_email);
  if (capturedEmail) return capturedEmail;

  const linkedEmail = nonBlank(request.contact?.email);
  if (linkedEmail) return linkedEmail;

  return "Contact unavailable";
}

function formatSystemTimestamp(value: string, requestedTimeZone: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "Time unavailable";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: validTimeZone(requestedTimeZone),
  }).format(instant);
}

function validTimeZone(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return value;
  } catch {
    return "UTC";
  }
}

function omitKey(
  values: Record<string, string>,
  key: string
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).filter(([entryKey]) => entryKey !== key)
  );
}
