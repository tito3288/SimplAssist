import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));
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
vi.mock("./AdminSignOutButton", () => ({
  default: () => <button type="button">Sign out</button>,
}));

import { AdminNavigation } from "./AdminNavigation";

function renderedLinks() {
  const html = renderToStaticMarkup(<AdminNavigation />);
  const links = Array.from(
    html.matchAll(/<a\b([^>]*)>([^<]+)<\/a>/g),
    ([, attributes, label]) => ({ attributes, label }),
  );

  return { html, links };
}

beforeEach(() => {
  mocks.pathname = "/admin";
});

describe("AdminNavigation", () => {
  it("renders every section as plain text without a redundant Overview link", () => {
    const { html, links } = renderedLinks();

    expect(html).toContain('aria-label="Admin sections"');
    expect(html).toContain("justify-start");
    expect(html).toContain("md:justify-end");
    expect(links.map(({ label }) => label)).toEqual([
      "Clients",
      "Metrics",
      "Partners",
      "Tickets",
      "Waitlist",
    ]);
    expect(
      links.every(
        ({ attributes }) =>
          attributes.includes("inline-flex") &&
          attributes.includes("border-b-2") &&
          attributes.includes("px-0.5") &&
          attributes.includes("py-2") &&
          !attributes.includes("rounded-full"),
      ),
    ).toBe(true);
    expect(html).not.toContain(">Overview</a>");
    expect(html).toContain("Sign out</button>");
  });

  it.each([
    ["/admin/clients", "Clients"],
    ["/admin/clients/new", "Clients"],
    ["/admin/clients/provisioning-1", "Clients"],
    ["/admin/metrics", "Metrics"],
    ["/admin/metrics/settings", "Metrics"],
    ["/admin/metrics/business-1", "Metrics"],
    ["/admin/partners", "Partners"],
    ["/admin/partners/partner-1", "Partners"],
    ["/admin/tickets", "Tickets"],
    ["/admin/waitlist", "Waitlist"],
  ])("marks %s as the %s section", (pathname, expectedLabel) => {
    mocks.pathname = pathname;

    const { links } = renderedLinks();
    const currentLinks = links.filter(({ attributes }) =>
      attributes.includes('aria-current="page"'),
    );

    expect(currentLinks).toHaveLength(1);
    expect(currentLinks[0]?.label).toBe(expectedLabel);
    expect(currentLinks[0]?.attributes).toContain(
      "border-[var(--brand-primary)]",
    );
    expect(currentLinks[0]?.attributes).not.toContain(
      "bg-[var(--brand-primary)]",
    );
  });

  it.each(["/admin", "/admin/10000000-0000-4000-a045-000000000001"])(
    "leaves section links inactive on %s",
    (pathname) => {
      mocks.pathname = pathname;

      const { links } = renderedLinks();

      expect(
        links.some(({ attributes }) => attributes.includes("aria-current")),
      ).toBe(false);
    },
  );
});
