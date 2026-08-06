import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AdminBackLink } from "./AdminBackLink";

describe("AdminBackLink", () => {
  it("renders the compact arrow control to the admin root by default", () => {
    const html = renderToStaticMarkup(<AdminBackLink />);

    expect(html).toContain('href="/admin"');
    expect(html).toContain('aria-label="Back to admin"');
    expect(html).toContain("rounded-full");
    expect(html).toContain("px-3");
    expect(html).toContain("py-1.5");
    expect(html).toContain("lucide-arrow-left");
    expect(html).toContain("Back</a>");
  });

  it("supports a deterministic nested admin parent", () => {
    const html = renderToStaticMarkup(
      <AdminBackLink href="/admin/metrics" ariaLabel="Back to admin metrics" />,
    );

    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain('aria-label="Back to admin metrics"');
  });
});
