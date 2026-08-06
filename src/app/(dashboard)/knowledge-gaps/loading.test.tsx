import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Knowledge gaps loading state", () => {
  it("renders an accessible, reduced-motion-safe content skeleton", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading knowledge gaps…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("bg-[#eee7dc]");
    expect(html).toContain("dark:bg-white/[0.10]");
  });

  it("mirrors the header, summary, filters, and knowledge-gap rows", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('data-skeleton-section="knowledge-gaps-header"');
    expect(html).toContain('data-skeleton-section="knowledge-gaps-summary"');
    expect(html.match(/data-skeleton-summary-card="true"/g)).toHaveLength(3);
    expect(html).toContain('data-skeleton-section="knowledge-gaps-filters"');
    expect(html.match(/data-skeleton-filter="true"/g)).toHaveLength(4);
    expect(html).toContain('data-skeleton-section="knowledge-gaps-list"');
    expect(html.match(/data-skeleton-gap-row="true"/g)).toHaveLength(4);
    expect(html).toContain("rounded-[28px]");
  });

  it("stays inert and inside the dashboard content area", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).not.toContain("min-h-screen");
    expect(html).not.toContain("<main");
    expect(html).not.toMatch(/<(?:a|button|input|select|form)(?:\s|>)/);
  });
});
