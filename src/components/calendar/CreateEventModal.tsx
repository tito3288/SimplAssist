"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { authInputClass, primaryCtaClass, textSecondary } from "@/lib/glass";
import { Loader2 } from "lucide-react";

interface CreateEventModalProps {
  open: boolean;
  onClose: () => void;
  selectedDate: Date;
  onEventCreated: () => void;
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
}: CreateEventModalProps) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create event");
      }

      onEventCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create event");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Event" description={formatDateDisplay(selectedDate)}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Title */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            className={authInputClass}
            autoFocus
          />
        </div>

        {/* Time inputs */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className={`${authInputClass} [color-scheme:dark]`}
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={`${authInputClass} [color-scheme:dark]`}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className={`block text-xs font-medium mb-1.5 ${textSecondary}`}>
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a description..."
            rows={3}
            className={`${authInputClass} resize-none`}
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
          className={primaryCtaClass}
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
