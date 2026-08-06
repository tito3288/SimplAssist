import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Conversations loading state", () => {
  it("renders an accessible, inert inbox silhouette", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading conversations…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("rounded-[28px]");

    expect(html).toContain('data-skeleton-section="conversation-inbox"');
    expect(html).toContain('data-skeleton-section="conversation-search"');
    expect(html).toContain('data-skeleton-section="conversation-filters"');
    expect(html.match(/data-skeleton-filter="true"/g)).toHaveLength(3);
    expect(html).toContain('data-skeleton-section="conversation-list"');
    expect(html.match(/data-skeleton-conversation="true"/g)).toHaveLength(6);
    expect(html).toContain('data-skeleton-section="conversation-preview"');
    expect(html).toContain("md:w-[350px]");

    expect(html).not.toContain("<main");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });
});
