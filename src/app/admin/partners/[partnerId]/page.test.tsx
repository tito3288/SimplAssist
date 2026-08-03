import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_PARTNER_COLUMNS } from "@/lib/admin/partnerValidation";

const mocks = vi.hoisted(() => ({
  requireAdminUser: vi.fn(),
  from: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  result: { data: null as unknown, error: null as { message: string } | null },
}));

vi.mock("@/lib/admin/auth", () => ({
  requireAdminUser: mocks.requireAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
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
vi.mock("../PartnerForm", () => ({
  PartnerForm: ({ partner }: { partner: { name: string } }) => (
    <div>Editing {partner.name}</div>
  ),
}));

import AdminPartnerDetailPage from "./page";

function storedPartner(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-a000-000000000043",
    name: "Alpha Dog Agency",
    slug: "alpha-dog",
    custom_domain: "app.alphadogagency.ai",
    domain_status: "pending",
    logo_light_url: null,
    logo_dark_url: null,
    favicon_url: null,
    brand_primary: "#ea580c",
    brand_primary_hover: "#c2410c",
    brand_primary_active: "#9a3412",
    brand_accent: "#c2410c",
    brand_primary_dark: "#ff914d",
    brand_primary_hover_dark: "#f57f33",
    brand_primary_active_dark: "#e8752c",
    brand_accent_dark: "#ff914d",
    email_from: null,
    email_from_status: "unconfigured",
    email_from_verified_at: null,
    email_from_verified_by: null,
    status: "active",
    created_at: "2026-08-03T00:00:00.000Z",
    updated_at: "2026-08-03T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdminUser.mockResolvedValue({ id: "admin-1", email: null });
  mocks.result = { data: storedPartner(), error: null };
  mocks.from.mockImplementation(() => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.maybeSingle.mockImplementation(async () => mocks.result);
    return query;
  });
});

describe("AdminPartnerDetailPage", () => {
  it("authorizes before its exact service-role read and renders the DNS checklist", async () => {
    const html = renderToStaticMarkup(
      await AdminPartnerDetailPage({
        params: { partnerId: "10000000-0000-4000-a000-000000000043" },
      }),
    );

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.requireAdminUser.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.from.mock.invocationCallOrder[0],
    );
    const query = mocks.from.mock.results[0]?.value;
    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(query.select).toHaveBeenCalledWith(ADMIN_PARTNER_COLUMNS);
    expect(query.eq).toHaveBeenCalledWith(
      "id",
      "10000000-0000-4000-a000-000000000043",
    );
    expect(html).toContain("Editing Alpha Dog Agency");
    expect(html).toContain("sender verification");
    expect(html).toContain('href="/login?brand=alpha-dog"');
    expect(html).toContain("app.alphadogagency.ai");
    expect(html).toContain("Custom Domains panel");
    expect(html).toContain("Wait for Railway to finish issuing TLS");
    expect(html).toContain("Manually verify DNS, HTTPS, and the exact hostname");
    expect(html).toContain("Mark Connected");
    expect(html).toContain("intentionally not hardcoded");
    expect(html.toLowerCase()).not.toContain("delete");
  });

  it("refuses to render malformed stored values", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.result = {
      data: storedPartner({ custom_domain: "https://evil.example" }),
      error: null,
    };

    await expect(
      AdminPartnerDetailPage({
        params: { partnerId: "10000000-0000-4000-a000-000000000043" },
      }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("authorizes, then rejects a malformed partner id before the service-role query", async () => {
    await expect(
      AdminPartnerDetailPage({ params: { partnerId: "not-a-uuid" } }),
    ).rejects.toThrow("NOT_FOUND");

    expect(mocks.requireAdminUser).toHaveBeenCalledOnce();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
