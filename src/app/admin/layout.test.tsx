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
  it("links authenticated admins to partner management", async () => {
    mocks.getAdminGateState.mockResolvedValue({
      state: "admin",
      admin: { id: "admin-1", email: null },
    });

    const html = renderToStaticMarkup(
      await AdminLayout({ children: <main>Admin content</main> }),
    );

    expect(html).toContain('href="/admin/partners"');
    expect(html).toContain(">Partners</a>");
  });
});
