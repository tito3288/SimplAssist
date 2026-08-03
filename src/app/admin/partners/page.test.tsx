import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PARTNER_COLUMNS } from "@/lib/admin/partnerValidation";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  result: { data: [] as unknown[], error: null as { message: string } | null },
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
vi.mock("./PartnerForm", () => ({
  PartnerForm: () => <div>Partner create form</div>,
}));

import AdminPartnersPage from "./page";

function storedPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-a000-000000000043",
    name: "Alpha Dog Agency",
    slug: "alpha-dog",
    custom_domain: "app.alphadogagency.ai",
    domain_status: "connected",
    logo_light_url: "https://assets.example.com/logo-light.png",
    logo_dark_url: "https://assets.example.com/logo-dark.png",
    favicon_url: "https://assets.example.com/favicon.png",
    brand_primary: "#ea580c",
    brand_primary_hover: "#c2410c",
    brand_primary_active: "#9a3412",
    brand_accent: "#c2410c",
    brand_primary_dark: "#ff914d",
    brand_primary_hover_dark: "#f57f33",
    brand_primary_active_dark: "#e8752c",
    brand_accent_dark: "#ff914d",
    email_from: "notifications@alphadogagency.ai",
    email_from_status: "verified",
    email_from_verified_at: "2026-08-03T02:00:00.000Z",
    email_from_verified_by: "10000000-0000-4000-a000-000000000099",
    status: "active",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({
    id: "admin-1",
    email: "admin@simplassist.test",
  });
  mocks.result = { data: [], error: null };
  mocks.from.mockImplementation(() => {
    const query = {
      select: vi.fn(),
      order: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.order.mockImplementation(async () => mocks.result);
    return query;
  });
});

describe("AdminPartnersPage", () => {
  it("authorizes before the service-role list read and renders all list actions", async () => {
    mocks.result = { data: [storedPartner()], error: null };

    const html = renderToStaticMarkup(await AdminPartnersPage());

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    expect(mocks.from).toHaveBeenCalledWith("partners");
    const query = mocks.from.mock.results[0]?.value;
    expect(query.select).toHaveBeenCalledWith(ADMIN_PARTNER_COLUMNS);
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(html).toContain("Alpha Dog Agency");
    expect(html).toContain("alpha-dog");
    expect(html).toContain("app.alphadogagency.ai");
    expect(html).toContain("Connected");
    expect(html).toContain("notifications@alphadogagency.ai");
    expect(html).toContain("Verified");
    expect(html).toContain("Active");
    expect(html).toContain(
      'href="/admin/partners/10000000-0000-4000-a000-000000000043"',
    );
    expect(html).toContain('href="/login?brand=alpha-dog"');
    expect(html).toContain('href="#create-partner"');
    expect(html).toContain("Partner create form");
    expect(html.toLowerCase()).not.toContain("delete");
  });

  it("omits stored rows that fail shared read-boundary validation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.result = {
      data: [
        storedPartner(),
        storedPartner({
          id: "20000000-0000-4000-a000-000000000043",
          name: "Unsafe Partner",
          favicon_url: "javascript:alert(1)",
        }),
      ],
      error: null,
    };

    const html = renderToStaticMarkup(await AdminPartnersPage());

    expect(html).toContain("Alpha Dog Agency");
    expect(html).not.toContain("Unsafe Partner");
    expect(html).toContain(
      "1 stored partner record was hidden because its values failed validation.",
    );
  });
});
