import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Calendar loading state", () => {
  it("renders an accessible, reduced-motion-safe content skeleton", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading calendar…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("bg-[#eee7dc]");
    expect(html).toContain("dark:bg-white/[0.10]");
  });

  it("mirrors the full calendar controls and panels", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('data-skeleton-section="calendar-header"');
    expect(html).toContain(
      'data-skeleton-section="appointment-requests"'
    );
    expect(html).toContain(
      'data-skeleton-section="appointment-request-count"'
    );
    expect(html.match(/data-skeleton-request="true"/g)).toHaveLength(2);
    expect(html).toContain('data-skeleton-section="calendar-view"');
    expect(html).toContain('data-skeleton-section="calendar-controls"');
    expect(html).toContain('data-skeleton-section="calendar-month-grid"');
    expect(html.match(/data-skeleton-weekday="true"/g)).toHaveLength(7);
    expect(html.match(/data-skeleton-day="true"/g)).toHaveLength(42);
    expect(html).toContain('data-skeleton-section="calendar-day-panel"');
    expect(html.match(/data-skeleton-event="true"/g)).toHaveLength(3);
    expect(html).toContain("rounded-[28px]");
    expect(html).toContain("rounded-[22px]");
  });

  it("places a responsive request queue before the Calendar skeleton", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html.indexOf('data-skeleton-section="calendar-header"')).toBeLessThan(
      html.indexOf('data-skeleton-section="appointment-requests"')
    );
    expect(
      html.indexOf('data-skeleton-section="appointment-requests"')
    ).toBeLessThan(html.indexOf('data-skeleton-section="calendar-view"'));
    expect(html).toContain("sm:flex-row");
    expect(html).toContain("xl:grid-cols-2");
    expect(html).toContain("max-w-full");
  });

  it("stays inert and inside the dashboard content area", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).not.toContain("min-h-screen");
    expect(html).not.toContain("<main");
    expect(html).not.toMatch(/<(?:a|button|input|select|form)(?:\s|>)/);
  });
});
