import type { Metadata } from "next";
import CalendarView from "@/components/calendar/CalendarView";
import { ink, body } from "@/lib/theme-v2/theme";
import { assertDemoPagesEnabled } from "../_lib/guard";
import { DemoShell } from "../_components/demo-shell";
import { DEMO_BUSINESS } from "../_fixtures/business";
import { buildCalendarEvents } from "../_fixtures/calendar";

/**
 * /demo/calendar — the real calendar UI on fixture bookings, for marketing
 * screenshots. Dev-only (404s in production builds); zero network I/O.
 */

export const dynamic = "force-dynamic";

// Gating in generateMetadata (as well as the component) makes the 404 a true
// HTTP 404 — metadata resolves before streaming starts, so the status code
// can still be set.
export function generateMetadata(): Metadata {
  assertDemoPagesEnabled();
  return {
    title: "SimplAssist — Demo (dev only)",
    robots: { index: false, follow: false },
  };
}

export default function DemoCalendarPage() {
  assertDemoPagesEnabled();
  const events = buildCalendarEvents(new Date());

  return (
    <DemoShell activePath="/calendar">
      <div className="space-y-6">
        <div>
          <h1 className={`text-2xl font-bold ${ink}`}>Calendar</h1>
          <p className={`mt-1 ${body}`}>
            View your upcoming appointments and events
          </p>
        </div>
        <CalendarView
          isConnected={true}
          googleEmail={DEMO_BUSINESS.ownerEmail}
          demoEvents={events}
        />
      </div>
    </DemoShell>
  );
}
