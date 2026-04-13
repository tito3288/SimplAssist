"use client";

import { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Clock,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import CreateEventModal from "./CreateEventModal";
import EditEventModal from "./EditEventModal";
import { Modal } from "@/components/ui/Modal";
import {
  glassCard,
  textPrimary,
  textSecondary,
  orangeAccentIcon,
  primaryCtaClass,
} from "@/lib/glass";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string | null;
}

interface CalendarViewProps {
  isConnected: boolean;
  googleEmail: string | null;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getDaysInMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = firstDay.getDay();
  const days: Date[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    days.push(new Date(year, month, -i));
  }

  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(new Date(year, month, d));
  }

  while (days.length < 42) {
    const next = days.length - startOffset - lastDay.getDate() + 1;
    days.push(new Date(year, month + 1, next));
  }

  return days;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatFullDate(date: Date): string {
  return date.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatMonthYear(date: Date): string {
  return date.toLocaleDateString([], { month: "long", year: "numeric" });
}

export default function CalendarView({
  isConnected: initialConnected,
  googleEmail,
}: CalendarViewProps) {
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(initialConnected);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewEvent, setViewEvent] = useState<CalendarEvent | null>(null);
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  async function handleDeleteEvent() {
    if (!deleteEventId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/calendar/events?eventId=${encodeURIComponent(deleteEventId)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchEvents();
      }
    } catch {
      // Handle silently
    } finally {
      setDeleting(false);
      setDeleteEventId(null);
    }
  }

  const fetchEvents = useCallback(async () => {
    if (!connected) return;
    setLoading(true);
    try {
      const start = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth(),
        1
      ).toISOString();
      const end = new Date(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + 1,
        1
      ).toISOString();

      const res = await fetch(
        `/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
      );
      const data = await res.json();

      if (data.connected === false) {
        setConnected(false);
        setEvents([]);
      } else {
        setEvents(data.events ?? []);
      }
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [currentMonth, connected]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const days = getDaysInMonthGrid(
    currentMonth.getFullYear(),
    currentMonth.getMonth()
  );

  function getEventsForDate(date: Date): CalendarEvent[] {
    return events.filter((e) => {
      const eventDate = new Date(e.start);
      return isSameDay(eventDate, date);
    });
  }

  function hasEvents(date: Date): boolean {
    return getEventsForDate(date).length > 0;
  }

  const selectedEvents = getEventsForDate(selectedDate);

  function goToPrevMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    );
  }

  function goToNextMonth() {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    );
  }

  function goToToday() {
    const now = new Date();
    setCurrentMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(now);
  }

  // Not connected state
  if (!connected) {
    return (
      <div className={`p-10 text-center ${glassCard}`}>
        <div
          className={`w-16 h-16 mx-auto mb-4 grid place-items-center ${orangeAccentIcon}`}
        >
          <CalendarDays className="w-8 h-8 text-[#ff914d]" />
        </div>
        <h3 className={`text-lg font-bold mb-2 ${textPrimary}`}>
          Connect your Google Calendar
        </h3>
        <p className={`mb-6 max-w-md mx-auto ${textSecondary}`}>
          Link your Google Calendar to see your appointments and bookings here.
          Go to Settings and enable Direct Scheduling to connect.
          {googleEmail && (
            <span className="block mt-1 text-sm">
              Previously connected: {googleEmail}
            </span>
          )}
        </p>
        <a
          href="/settings"
          className={primaryCtaClass.replace("w-full", "").trim() + " w-auto px-8"}
        >
          Go to Settings
        </a>
      </div>
    );
  }

  return (
    <div className={`p-5 sm:p-6 ${glassCard}`}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Calendar grid */}
        <div className="lg:col-span-2">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevMonth}
                className={`w-9 h-9 grid place-items-center rounded-xl border border-slate-200 dark:border-white/[0.10] hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors ${textSecondary}`}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goToNextMonth}
                className={`w-9 h-9 grid place-items-center rounded-xl border border-slate-200 dark:border-white/[0.10] hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors ${textSecondary}`}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <h2 className={`text-lg font-bold ml-2 ${textPrimary}`}>
                {formatMonthYear(currentMonth)}
              </h2>
            </div>
            <button
              onClick={goToToday}
              className={`text-sm font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-white/[0.10] hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors ${textSecondary}`}
            >
              Today
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_LABELS.map((day) => (
              <div
                key={day}
                className={`text-center text-xs font-medium uppercase tracking-wider py-2 ${textSecondary}`}
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {days.map((date, i) => {
              const isCurrentMonth =
                date.getMonth() === currentMonth.getMonth();
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const dateHasEvents = hasEvents(date);

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDate(date)}
                  className={`
                    aspect-square p-1 flex flex-col items-center justify-center gap-1
                    rounded-xl transition-all text-sm relative
                    ${!isCurrentMonth ? "opacity-35" : ""}
                    ${isSelected ? "bg-[rgba(255,145,77,.18)] border border-[#ff914d]" : "border border-transparent hover:bg-slate-100 dark:hover:bg-white/[0.06]"}
                    ${isToday && !isSelected ? "bg-[rgba(255,145,77,.08)]" : ""}
                  `}
                >
                  <span
                    className={`
                      w-7 h-7 grid place-items-center rounded-full font-medium
                      ${
                        isToday
                          ? "bg-[#ff914d] text-white font-bold"
                          : dateHasEvents
                            ? "text-[#ff914d] font-semibold"
                            : textPrimary
                      }
                    `}
                  >
                    {date.getDate()}
                  </span>
                  {dateHasEvents && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#ff914d] absolute bottom-1.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Loading overlay */}
          {loading && (
            <div className="flex items-center justify-center py-4">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-[#ff914d] animate-spin" />
                <span className={`text-sm ${textSecondary}`}>
                  Loading events...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: Day detail panel */}
        <div className="lg:col-span-1">
          <div className="p-4 rounded-[22px] bg-white/50 dark:bg-white/[0.04] border border-slate-200 dark:border-white/[0.08] h-full">
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-sm font-bold ${textPrimary}`}>
                {formatFullDate(selectedDate)}
              </h3>
              <button
                onClick={() => setCreateModalOpen(true)}
                className="w-7 h-7 grid place-items-center rounded-lg bg-[#ff914d] text-white hover:bg-[#e87d3a] transition-colors"
                title="Create event"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {selectedEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CalendarDays className="w-8 h-8 mb-2 text-slate-300 dark:text-white/[0.15]" />
                <p className={`text-sm ${textSecondary}`}>
                  No events scheduled
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {selectedEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => setViewEvent(event)}
                    className="
                      p-3.5 rounded-[22px] cursor-pointer
                      border border-[#ff914d]/25 dark:border-[#ff914d]/35
                      bg-gradient-to-br from-[rgba(255,145,77,.2)] via-[rgba(255,145,77,.1)] to-[rgba(255,145,77,.04)]
                      dark:from-[rgba(255,145,77,.22)] dark:via-[rgba(255,145,77,.1)] dark:to-[rgba(255,145,77,.04)]
                      shadow-[0_4px_24px_rgba(255,145,77,.12)] dark:shadow-[0_8px_32px_rgba(255,145,77,.1)]
                      border-l-[3px] border-l-[#ff914d]
                      hover:shadow-[0_6px_28px_rgba(255,145,77,.18)] dark:hover:shadow-[0_10px_36px_rgba(255,145,77,.14)] transition-shadow
                    "
                  >
                    <div className="flex items-center gap-1.5 mb-1">
                      <Clock className="w-3.5 h-3.5 text-[#e07a35] dark:text-[#ffb07a]" />
                      <span className="text-xs font-medium text-[#b85a28] dark:text-[#e8a878]">
                        {event.allDay
                          ? "All day"
                          : `${formatTime(event.start)} – ${formatTime(event.end)}`}
                      </span>
                    </div>
                    <p className={`text-sm font-semibold ${textPrimary}`}>
                      {event.title}
                    </p>
                    {event.description && (
                      <p
                        className={`text-xs mt-1 line-clamp-2 text-slate-600 dark:text-[#c8c8cc]`}
                      >
                        {event.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreateEventModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        selectedDate={selectedDate}
        onEventCreated={fetchEvents}
      />

      <EditEventModal
        open={!!editEvent}
        onClose={() => setEditEvent(null)}
        event={editEvent}
        onEventUpdated={fetchEvents}
      />

      {/* Event Detail Modal */}
      <Modal
        open={!!viewEvent}
        onClose={() => setViewEvent(null)}
        title={viewEvent?.title || ""}
        description={formatFullDate(selectedDate)}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className={`w-4 h-4 ${textSecondary}`} />
            <span className={`text-sm font-medium ${textPrimary}`}>
              {viewEvent?.allDay
                ? "All day"
                : viewEvent
                  ? `${formatTime(viewEvent.start)} – ${formatTime(viewEvent.end)}`
                  : ""}
            </span>
          </div>

          {viewEvent?.description && (
            <div>
              <p className={`text-xs font-medium uppercase mb-1 ${textSecondary}`}>Description</p>
              <p className={`text-sm whitespace-pre-wrap ${textPrimary}`}>
                {viewEvent.description}
              </p>
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 dark:border-white/[0.10] flex items-center justify-between">
            <button
              onClick={() => {
                setEditEvent(viewEvent);
                setViewEvent(null);
              }}
              className="flex items-center gap-2 text-sm text-[#ff914d] hover:text-[#e07a35] transition-colors"
            >
              <Pencil className="w-4 h-4" />
              Edit Event
            </button>
            <button
              onClick={() => {
                setDeleteEventId(viewEvent?.id || null);
                setViewEvent(null);
              }}
              className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete Event
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={!!deleteEventId}
        onClose={() => setDeleteEventId(null)}
        title="Delete Event"
        description="Are you sure? This will remove the event from your Google Calendar and notify any attendees."
      >
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => setDeleteEventId(null)}
            disabled={deleting}
            className="flex-1 rounded-full border border-slate-200 dark:border-white/[0.12] px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-[#bdbdbf] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteEvent}
            disabled={deleting}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
