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
