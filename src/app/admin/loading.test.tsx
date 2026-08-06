import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Loading from "./loading";

describe("Admin loading state", () => {
  it("renders an accessible, inert skeleton inside the admin shell", () => {
    const html = renderToStaticMarkup(<Loading />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Loading admin page…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).toContain("rounded-[28px]");
    expect(html).not.toContain("min-h-screen");
    expect(html).not.toContain("<a");
    expect(html).not.toContain("<button");
  });
});
