"use client";

import { useState, useEffect } from "react";
import { Modal } from "@/components/ui/Modal";
import { inputField, btnPrimaryWide, body } from "@/lib/theme-v2/theme";
import { Loader2 } from "lucide-react";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string | null;
}

interface EditEventModalProps {
  open: boolean;
  onClose: () => void;
  event: CalendarEvent | null;
  onEventUpdated: () => void;
}

function formatDateDisplay(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function extractTime(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export default function EditEventModal({
  open,
  onClose,
  event,
  onEventUpdated,
}: EditEventModalProps) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Pre-populate form when modal opens with event data
  useEffect(() => {
    if (open && event) {
      setTitle(event.title);
      setStartTime(event.allDay ? "09:00" : extractTime(event.start));
      setEndTime(event.allDay ? "10:00" : extractTime(event.end));
      setDescription(event.description ?? "");
      setError("");
      setSubmitting(false);
    }
  }, [open, event]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!event) return;
    setError("");

    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    if (endTime <= startTime) {
      setError("End time must be after start time.");
      return;
    }

    // Build ISO datetime strings from the event's original date + new time inputs
    const eventDate = new Date(event.start);
    const year = eventDate.getFullYear();
    const month = eventDate.getMonth();
    const day = eventDate.getDate();

    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);

    const startDate = new Date(year, month, day, startH, startM);
    const endDate = new Date(year, month, day, endH, endM);

    setSubmitting(true);

    try {
      const res = await fetch("/api/calendar/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          title: title.trim(),
          description: description.trim(),
          startTime: startDate.toISOString(),
          endTime: endDate.toISOString(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update event");
      }

      onEventUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update event");
    } finally {
      setSubmitting(false);
    }
  }

  const eventDate = event ? new Date(event.start) : new Date();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Event"
      description={formatDateDisplay(eventDate)}
    >
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
              Saving...
            </>
          ) : (
            "Save Changes"
          )}
        </button>
      </form>
    </Modal>
  );
}
