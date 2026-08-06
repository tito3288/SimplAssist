import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Dashboard loading state", () => {
  it("renders an accessible, inert skeleton that mirrors the dashboard content", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading dashboard…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("rounded-[28px]");
    expect(html).toContain("rounded-[22px]");

    expect(html).toContain('data-skeleton-section="dashboard-header"');
    expect(html).toContain('data-skeleton-section="dashboard-stats"');
    expect(html.match(/data-skeleton-stat="true"/g)).toHaveLength(4);
    expect(html).toContain('data-skeleton-section="dashboard-lists"');
    expect(html.match(/data-skeleton-list="true"/g)).toHaveLength(2);
    expect(html.match(/data-skeleton-row="true"/g)).toHaveLength(6);
    expect(html).toContain('data-skeleton-section="quick-actions"');

    expect(html).not.toContain("min-h-screen");
    expect(html).not.toContain("<main");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });
});
