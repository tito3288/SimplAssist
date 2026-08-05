import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CalendarView from "./CalendarView";

const DIRECT_BRAND_COLOR =
  /#(?:f97316|ea580c|c2410c|9a3412|ff914d|f57f33|e8752c|ffb07a|fdf1e7|f0e2d0|fdf3ea|e6cdb0|e8a878)\b|rgba?\(\s*(?:234\s*,\s*88\s*,\s*12|194\s*,\s*65\s*,\s*12|154\s*,\s*52\s*,\s*18|255\s*,\s*145\s*,\s*77|249\s*,\s*115\s*,\s*22)/i;

describe("CalendarView Google OAuth availability", () => {
  it("shows the settings connect prompt for every resolved workspace", () => {
    const html = renderToStaticMarkup(
      <CalendarView isConnected={false} googleEmail={null} />
    );

    expect(html).toContain("Connect your Google Calendar");
    expect(html).toContain('href="/settings"');
  });
});

describe("CalendarView event creation controls", () => {
  const event = {
    id: "event-1",
    title: "Existing estimate",
    start: new Date().toISOString(),
    end: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    allDay: false,
    description: "Already committed",
  };

  it("keeps event creation available by default, including demo callers", () => {
    const html = renderToStaticMarkup(
      <CalendarView
        isConnected
        googleEmail="owner@example.com"
        demoEvents={[event]}
      />
    );

    expect(html).toContain('aria-label="Create event"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*aria-label="Create event"/);
    expect(html).toContain("Existing estimate");
  });

  it.each([
    [
      "account_suspended",
      "New event creation is unavailable while your account is suspended.",
    ],
    ["bookings_paused", "New event creation is paused."],
    [
      "state_unavailable",
      "New event creation is temporarily unavailable while we check booking status.",
    ],
  ] as const)(
    "disables only new-event creation for %s and preserves existing events",
    (eventCreationState, expectedCopy) => {
      const html = renderToStaticMarkup(
        <CalendarView
          isConnected
          googleEmail="owner@example.com"
          eventCreationState={eventCreationState}
          demoEvents={[event]}
        />
      );

      expect(html).toContain(expectedCopy);
      expect(html).toContain(
        "Existing events can still be viewed, edited, or deleted."
      );
      expect(html).toContain("Existing estimate");
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Create event"/);
    }
  );

  it.each([
    [
      "account_suspended",
      "New event creation is unavailable while your account is suspended.",
    ],
    ["bookings_paused", "New event creation is paused."],
    [
      "state_unavailable",
      "New event creation is temporarily unavailable while we check booking status.",
    ],
  ] as const)(
    "renders %s context even when Google Calendar is disconnected",
    (eventCreationState, expectedCopy) => {
      const html = renderToStaticMarkup(
        <CalendarView
          isConnected={false}
          googleEmail={null}
          eventCreationState={eventCreationState}
        />
      );

      expect(html).toContain(expectedCopy);
      expect(html).toContain("Connect your Google Calendar");
      expect(html).toContain(
        "You can still connect or manage Google Calendar in Settings."
      );
      expect(html).not.toContain(
        "Existing events can still be viewed, edited, or deleted."
      );
    }
  );

  it("does not apply the creation state to edit or delete controls", () => {
    const source = readFileSync(
      new URL("./CalendarView.tsx", import.meta.url),
      "utf8"
    );

    expect(source.match(/disabled={!canCreateEvents}/g)).toHaveLength(1);
    expect(source).toContain("<EditEventModal");
    expect(source).toContain("Edit Event");
    expect(source).toContain("Delete Event");
    expect(source).toContain("setRuntimeEventCreationState(state)");
    expect(source).toContain(
      "onCreationUnavailable={handleEventCreationUnavailable}"
    );
  });
});

describe("Calendar Phase 2 branding", () => {
  it("uses runtime tokens for calendar accents and event surfaces", () => {
    const source = readFileSync(
      new URL("./CalendarView.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toMatch(/\borange-[0-9]{2,3}\b/i);
    expect(source).not.toMatch(DIRECT_BRAND_COLOR);
    expect(source).toContain("bg-[rgb(var(--brand-primary-rgb)/.12)]");
    expect(source).toContain("border-[var(--brand-calendar-border)]");
    expect(source).toContain("bg-[var(--brand-calendar-wash)]");
    expect(source).toContain("dark:text-[var(--brand-calendar-accent)]");
  });

  it("uses the request brand in ordinary dashboard copy", () => {
    const source = readFileSync(
      new URL("../../app/(dashboard)/calendar/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("SimplAssist");
    expect(source).toContain("requestBrand.brand.name");
  });
  it("does not disable Calendar OAuth on a partner workspace page", () => {
    const calendarPage = readFileSync(
      new URL("../../app/(dashboard)/calendar/page.tsx", import.meta.url),
      "utf8"
    );
    const settingsPage = readFileSync(
      new URL("../../app/(dashboard)/settings/page.tsx", import.meta.url),
      "utf8"
    );

    expect(calendarPage).toContain("await requireWorkspacePageAccess()");
    expect(settingsPage).toContain("await requireWorkspacePageAccess()");
    expect(calendarPage).not.toContain("oauthConnectSupported");
    expect(settingsPage).not.toContain("googleOAuthSupported");
    expect(calendarPage).not.toContain('hostKind === "canonical"');
    expect(settingsPage).not.toContain("hostKind === 'canonical'");
  });
});
