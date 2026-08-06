import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("Billing loading state", () => {
  it("renders current-plan and pricing-card silhouettes accessibly", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading billing…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("max-w-5xl");
    expect(html).toContain("md:grid-cols-3");
    expect(html).toContain("rounded-[28px]");
    expect(html.match(/<section/g)).toHaveLength(4);
    expect(html).not.toMatch(/<(?:a|button|input|select|textarea)\b/);
    expect(html).not.toContain("min-h-screen");
  });
});
