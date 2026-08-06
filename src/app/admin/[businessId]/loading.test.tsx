import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Loading from "./loading";

describe("Admin account detail loading state", () => {
  it("renders an accessible, reduced-motion-safe skeleton inside the admin shell", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading account details…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("rounded-[28px]");
    expect(html).not.toContain("min-h-screen");
  });
});
