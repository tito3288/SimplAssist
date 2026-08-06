import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Contacts loading state", () => {
  it("renders an accessible, inert contacts table silhouette", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading contacts…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("rounded-[28px]");
    expect(html).toContain("rounded-[22px]");

    expect(html).toContain('data-skeleton-section="contacts-header"');
    expect(html).toContain('data-skeleton-section="contact-stats"');
    expect(html.match(/data-skeleton-stat="true"/g)).toHaveLength(4);
    expect(html).toContain('data-skeleton-section="contacts-toolbar"');
    expect(html).toContain('data-skeleton-section="contact-filters"');
    expect(html.match(/data-skeleton-filter="true"/g)).toHaveLength(4);
    expect(html).toContain('data-skeleton-section="contacts-table"');
    expect(html.match(/data-skeleton-column="true"/g)).toHaveLength(7);
    expect(html.match(/data-skeleton-contact="true"/g)).toHaveLength(5);

    expect(html).not.toContain("<main");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });
});
