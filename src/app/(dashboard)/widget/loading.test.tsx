import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("Widget loading state", () => {
  it("mirrors the configuration and preview columns with an inert skeleton", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading widget settings…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("lg:grid-cols-5");
    expect(html).toContain("lg:col-span-3");
    expect(html).toContain("lg:col-span-2");
    expect(html).toContain("h-72");
    expect(html.match(/<section/g)).toHaveLength(3);
    expect(html).not.toMatch(/<(?:a|button|input|select|textarea)\b/);
    expect(html).not.toContain("min-h-screen");
  });
});
