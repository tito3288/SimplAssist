import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
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

import AdminTicketsPage from "./page";

function emptyTicketsQuery() {
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    returns: vi.fn(),
  };
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.returns.mockResolvedValue({ data: [], error: null });
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.from.mockReturnValue(emptyTicketsQuery());
});

describe("AdminTicketsPage", () => {
  it("authenticates before loading tickets and links back to admin", async () => {
    const html = renderToStaticMarkup(await AdminTicketsPage());

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    expect(mocks.from).toHaveBeenCalledWith("support_requests");
    expect(html).toContain('href="/admin"');
    expect(html).toContain('aria-label="Back to admin"');
    expect(html).toContain("Back</a>");
    expect(html).toContain("Support tickets");
    expect(html).toContain("No tickets yet.");
  });
});
