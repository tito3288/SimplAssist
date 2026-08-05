import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminGateState: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  getAdminGateState: mocks.getAdminGateState,
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
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
vi.mock("./AdminLoginForm", () => ({ default: () => <div>Admin login</div> }));
vi.mock("./AdminSignOutButton", () => ({
  default: () => <button>Sign out</button>,
}));

import AdminLayout from "./layout";

describe("AdminLayout navigation", () => {
  it("links authenticated admins to clients, metrics, and partner management", async () => {
    mocks.getAdminGateState.mockResolvedValue({
      state: "admin",
      admin: { id: "admin-1", email: null },
    });

    const html = renderToStaticMarkup(
      await AdminLayout({ children: <main>Admin content</main> }),
    );

    expect(html).toContain('href="/admin/clients"');
    expect(html).toContain(">Clients</a>");
    expect(html).not.toContain('href="/admin/clients/new"');
    expect(html).toContain('href="/admin/metrics"');
    expect(html).toContain(">Metrics</a>");
    expect(html).toContain("flex-wrap");
    expect(html).toContain('href="/admin/partners"');
    expect(html).toContain(">Partners</a>");
  });

  it("does not expose admin navigation before authentication", async () => {
    mocks.getAdminGateState.mockResolvedValue({ state: "unauthenticated" });

    const html = renderToStaticMarkup(
      await AdminLayout({ children: <main>Private admin content</main> }),
    );

    expect(html).toContain("Admin login");
    expect(html).not.toContain("Private admin content");
    expect(html).not.toContain('href="/admin/metrics"');
  });
});
