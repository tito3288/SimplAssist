import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AdminAccountActivityEvent } from "@/lib/admin/accountActivity.server";
import { AdminAccountActivityTimeline } from "./AdminAccountActivityTimeline";

const CAPTION =
  "Recorded activity only. Partner assignment, billing-mode, and billing-flag changes were not historically recorded.";

function event(
  id: string,
  category: AdminAccountActivityEvent["category"],
  occurredAt: string,
  overrides: Partial<AdminAccountActivityEvent> = {},
): AdminAccountActivityEvent {
  return {
    id,
    category,
    occurredAt,
    title: `${category} event`,
    detail: `${category} detail`,
    actor: `${category} actor`,
    ...overrides,
  } as AdminAccountActivityEvent;
}

describe("AdminAccountActivityTimeline", () => {
  it("renders every normalized category newest-first with semantic time values", () => {
    const events = [
      event("lifecycle:1", "lifecycle", "2026-08-01T12:00:00.000Z"),
      event("admin:1", "admin", "2026-08-07T12:00:00.000Z"),
      event("risk:1", "risk_review", "2026-08-06T12:00:00.000Z"),
      event("registration:1", "registration", "2026-08-05T12:00:00.000Z"),
      event("brand:1", "brand", "2026-08-04T12:00:00.000Z"),
      event("rejection:1", "rejection", "2026-08-03T12:00:00.000Z"),
      event("calendar:1", "calendar", "2026-08-02T12:00:00.000Z"),
    ];

    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={events} />,
    );

    expect(html).toContain('<ol aria-label="Recorded account activity"');
    for (const label of [
      "Lifecycle",
      "Admin action",
      "Risk review",
      "Registration",
      "Brand",
      "Rejection",
      "Calendar",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain(
      '<time dateTime="2026-08-07T12:00:00.000Z"',
    );
    expect(html).toContain("Aug 7, 2026, 12:00 PM UTC");
    expect(html.indexOf("admin event")).toBeLessThan(
      html.indexOf("lifecycle event"),
    );
  });

  it("omits absent detail and actor instead of inventing attribution", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline
        events={[
          event("calendar:1", "calendar", "2026-08-04T12:00:00.000Z", {
            title: "Calendar connected",
            detail: null,
            actor: null,
          }),
        ]}
      />,
    );

    expect(html).toContain("Calendar connected");
    expect(html).not.toContain("calendar detail");
    expect(html).not.toContain("Actor:");
    expect(html).not.toContain("Unknown actor");
  });

  it("uses event IDs as deterministic tie-breakers and caps output at 100", () => {
    const events = Array.from({ length: 102 }, (_, index) =>
      event(
        `registration:${String(index).padStart(3, "0")}`,
        "registration",
        "2026-08-04T12:00:00.000Z",
        { title: `Event ${String(index).padStart(3, "0")}` },
      ),
    ).reverse();

    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={events} />,
    );

    expect(html.match(/<li /g)).toHaveLength(100);
    expect(html.indexOf("Event 000")).toBeLessThan(html.indexOf("Event 099"));
    expect(html).not.toContain("Event 100");
    expect(html).not.toContain("Event 101");
  });

  it("renders an explicit empty recorded-activity state", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline events={[]} />,
    );

    expect(html).toContain("No recorded activity is available for this account.");
    expect(html).not.toContain('<ol aria-label="Recorded account activity"');
  });

  it("renders Timeline unavailable without presenting supplied partial events", () => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline
        unavailable
        events={[
          event("risk:partial", "risk_review", "2026-08-04T12:00:00.000Z", {
            title: "Partial event must stay hidden",
          }),
        ]}
      />,
    );

    expect(html).toContain("Timeline unavailable");
    expect(html).toContain("No partial timeline is shown.");
    expect(html).not.toContain("Partial event must stay hidden");
    expect(html).not.toContain('<ol aria-label="Recorded account activity"');
  });

  it.each([
    { events: [], unavailable: false },
    { events: [], unavailable: true },
    {
      events: [
        event("lifecycle:1", "lifecycle", "2026-08-04T12:00:00.000Z"),
      ],
      unavailable: false,
    },
  ])("always renders the recorded-activity limitation caption", (props) => {
    const html = renderToStaticMarkup(
      <AdminAccountActivityTimeline {...props} />,
    );

    expect(html).toContain(CAPTION);
  });
});
