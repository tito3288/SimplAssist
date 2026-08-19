"use client";

import { useState, useEffect, useRef } from "react";
import { Modal } from "@/components/ui/Modal";
import { inputField, btnPrimaryWide, body } from "@/lib/theme-v2/theme";
import { Loader2 } from "lucide-react";
import { nextCalendarMutationOperationId } from "./calendarMutationIdentity";

interface CreateEventModalProps {
  open: boolean;
  onClose: () => void;
  selectedDate: Date;
  onEventCreated: () => void;
  onCreationUnavailable: (state: EventCreationUnavailableState) => void;
}

export type EventCreationUnavailableState =
  | "account_suspended"
  | "bookings_paused"
  | "state_unavailable";

type CreateEventErrorPayload = {
  error?: unknown;
  reason?: unknown;
  retryable?: unknown;
};

export function eventCreationStateFromApiFailure(
  status: number,
  payload: unknown
): EventCreationUnavailableState | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as CreateEventErrorPayload;

  if (
    status === 403 &&
    candidate.error === "booking_creation_unavailable" &&
    (candidate.reason === "account_suspended" ||
      candidate.reason === "bookings_paused")
  ) {
    return candidate.reason;
  }

  if (
    status === 503 &&
    candidate.error === "service_state_unavailable" &&
    candidate.retryable === true
  ) {
    return "state_unavailable";
  }

  return null;
}

function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getDefaultStartTime(date: Date): string {
  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    // Next half-hour from now
    const minutes = now.getMinutes();
    const roundedMinutes = minutes < 30 ? 30 : 0;
    const hours = minutes < 30 ? now.getHours() : now.getHours() + 1;
    return `${String(hours).padStart(2, "0")}:${String(roundedMinutes).padStart(2, "0")}`;
  }
  return "09:00";
}

function addOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const newH = Math.min(h + 1, 23);
  return `${String(newH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function CreateEventModal({
  open,
  onClose,
  selectedDate,
  onEventCreated,
  onCreationUnavailable,
}: CreateEventModalProps) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const operationIdRef = useRef("");
  const submittedPayloadRef = useRef<string | null>(null);

  // Reset form when modal opens or date changes
  useEffect(() => {
    if (open) {
      const start = getDefaultStartTime(selectedDate);
      setTitle("");
      setStartTime(start);
      setEndTime(addOneHour(start));
      setDescription("");
      setError("");
      setSubmitting(false);
      operationIdRef.current = globalThis.crypto.randomUUID();
      submittedPayloadRef.current = null;
    }
  }, [open, selectedDate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (endTime <= startTime) {
      setError("End time must be after start time.");
      return;
    }

    // Build ISO datetime strings from selectedDate + time inputs
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const day = selectedDate.getDate();

    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);

    const startDate = new Date(year, month, day, startH, startM);
    const endDate = new Date(year, month, day, endH, endM);

    setSubmitting(true);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
      };
      const payloadKey = JSON.stringify(payload);
      operationIdRef.current = nextCalendarMutationOperationId(
        operationIdRef.current,
        submittedPayloadRef.current,
        payloadKey
      );
      submittedPayloadRef.current = payloadKey;

      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: operationIdRef.current,
          ...payload,
        }),
      });

      if (!res.ok) {
        const data: unknown = await res.json().catch(() => ({}));
        const unavailableState = eventCreationStateFromApiFailure(
          res.status,
          data
        );
        if (unavailableState) {
          onCreationUnavailable(unavailableState);
          onClose();
          return;
        }
        if (res.status === 409) {
          operationIdRef.current = globalThis.crypto.randomUUID();
          submittedPayloadRef.current = null;
        }
        setError("We couldn't create this event. Please try again.");
        return;
      }

      onEventCreated();
      onClose();
    } catch {
      setError("We couldn't create this event. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Event" description={formatDateDisplay(selectedDate)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${body}`}>
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className={inputField}
            autoFocus
          />
        </div>

        {/* Time inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${body}`}>
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={`${inputField} [color-scheme:light] dark:[color-scheme:dark]`}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${body}`}>
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={`${inputField} [color-scheme:light] dark:[color-scheme:dark]`}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${body}`}>
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description..."
            rows={3}
            className={`${inputField} resize-none`}
          />
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className={btnPrimaryWide}
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating...
            </>
          ) : (
            "Create Event"
          )}
        </button>
      </form>
    </Modal>
  );
}
