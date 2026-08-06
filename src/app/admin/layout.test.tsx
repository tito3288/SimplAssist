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
vi.mock("./AdminNavigation", () => ({
  AdminNavigation: () => (
    <nav aria-label="Admin sections">Admin navigation</nav>
  ),
}));

import AdminLayout from "./layout";

describe("AdminLayout navigation", () => {
  it("renders the authenticated admin masthead and navigation", async () => {
    mocks.getAdminGateState.mockResolvedValue({
      state: "admin",
      admin: { id: "admin-1", email: null },
    });

    const html = renderToStaticMarkup(
      await AdminLayout({ children: <main>Admin content</main> }),
    );

    expect(html).toContain("Admin console");
    expect(html).toContain('href="/admin"');
    expect(html).toContain(">SimplAssist Admin</a>");
    expect(html).toContain("bg-[#fffaf6]");
    expect(html).toContain("items-center");
    expect(html).toContain("text-center");
    expect(html).toContain("lg:text-left");
    expect(html).not.toContain("Internal operations workspace");
    expect(html).not.toContain("lucide-shield-check");
    expect(html).toContain('aria-label="Admin sections"');
    expect(html).toContain("Admin navigation");
    expect(html).toContain("Admin content");
  });

  it("does not expose admin navigation before authentication", async () => {
    mocks.getAdminGateState.mockResolvedValue({ state: "unauthenticated" });

    const html = renderToStaticMarkup(
      await AdminLayout({ children: <main>Private admin content</main> }),
    );

    expect(html).toContain("Admin login");
    expect(html).not.toContain("Private admin content");
    expect(html).not.toContain("Admin console");
    expect(html).not.toContain('aria-label="Admin sections"');
  });
});
