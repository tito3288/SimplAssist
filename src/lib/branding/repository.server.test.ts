import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  findPartnerBrandByHostname,
  findPartnerBrandBySlug,
} from "./repository.server";

const PARTNER_ID = "11111111-1111-4111-8111-111111111111";

function partnerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PARTNER_ID,
    name: "Alpha Dog Agency",
    slug: "alpha-dog",
    custom_domain: "app.partner.example",
    domain_status: "connected",
    logo_light_url: "https://cdn.partner.example/logo-light.png",
    logo_dark_url: "https://cdn.partner.example/logo-dark.png",
    favicon_url: "https://cdn.partner.example/favicon.png",
    brand_primary: "#ABCDEF",
    brand_primary_hover: "#123456",
    brand_primary_active: "#234567",
    brand_accent: "#345678",
    brand_primary_dark: "#456789",
    brand_primary_hover_dark: "#56789A",
    brand_primary_active_dark: "#6789AB",
    brand_accent_dark: "#789ABC",
    ...overrides,
  };
}

function mockQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  mocks.from.mockReset();
});

describe("findPartnerBrandByHostname", () => {
  it("uses exact active/connected filters and maps only public fields", async () => {
    const query = mockQuery({ data: partnerRow(), error: null });

    const brand = await findPartnerBrandByHostname("app.partner.example");

    expect(mocks.from).toHaveBeenCalledWith("partners");
    expect(query.eq.mock.calls).toEqual([
      ["custom_domain", "app.partner.example"],
      ["status", "active"],
      ["domain_status", "connected"],
    ]);
    const projection = query.select.mock.calls[0][0] as string;
    expect(projection.split(",")).not.toContain("email_from");
    expect(projection.split(",")).not.toContain("status");
    expect(projection.split(",")).not.toContain("created_at");
    expect(projection.split(",")).not.toContain("updated_at");

    expect(brand).toEqual({
      kind: "partner",
      partnerId: PARTNER_ID,
      slug: "alpha-dog",
      name: "Alpha Dog Agency",
      publicOrigin: "https://app.partner.example",
      logoLightUrl: "https://cdn.partner.example/logo-light.png",
      logoDarkUrl: "https://cdn.partner.example/logo-dark.png",
      faviconUrl: "https://cdn.partner.example/favicon.png",
      colors: {
        primary: "#abcdef",
        primaryHover: "#123456",
        primaryActive: "#234567",
        accent: "#345678",
        primaryDark: "#456789",
        primaryHoverDark: "#56789a",
        primaryActiveDark: "#6789ab",
        accentDark: "#789abc",
      },
    });
    expect(brand).not.toHaveProperty("email_from");
    expect(brand).not.toHaveProperty("status");
  });

  it("returns null for no exact match", async () => {
    mockQuery({ data: null, error: null });
    await expect(
      findPartnerBrandByHostname("unknown.partner.example"),
    ).resolves.toBeNull();
  });

  it("rejects non-canonical input before querying", async () => {
    await expect(
      findPartnerBrandByHostname("APP.PARTNER.EXAMPLE"),
    ).resolves.toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("throws on a database lookup failure", async () => {
    mockQuery({ data: null, error: { message: "database unavailable" } });
    await expect(
      findPartnerBrandByHostname("app.partner.example"),
    ).rejects.toThrow("Partner hostname lookup failed");
  });
});

describe("findPartnerBrandBySlug", () => {
  it("looks up preview by exact slug without active/connected filters", async () => {
    const query = mockQuery({
      data: partnerRow({
        custom_domain: null,
        domain_status: "pending",
      }),
      error: null,
    });

    const brand = await findPartnerBrandBySlug("alpha-dog");

    expect(query.eq.mock.calls).toEqual([["slug", "alpha-dog"]]);
    expect(brand).toMatchObject({
      kind: "partner",
      slug: "alpha-dog",
      publicOrigin: null,
    });
  });

  it("does not query for a malformed preview slug", async () => {
    await expect(findPartnerBrandBySlug("Alpha-Dog")).resolves.toBeNull();
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("throws on a database lookup failure", async () => {
    mockQuery({ data: null, error: { message: "database unavailable" } });
    await expect(findPartnerBrandBySlug("alpha-dog")).rejects.toThrow(
      "Partner preview lookup failed",
    );
  });
});

describe("partner brand read-boundary validation", () => {
  it("drops unsafe optional assets instead of leaking them to the client", async () => {
    mockQuery({
      data: partnerRow({
        logo_light_url: "http://cdn.partner.example/logo.png",
        logo_dark_url: "https://user:secret@cdn.partner.example/logo.png",
        favicon_url: "https://127.0.0.1/favicon.png",
      }),
      error: null,
    });

    const brand = await findPartnerBrandBySlug("alpha-dog");
    expect(brand).toMatchObject({
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
    });
  });

  it.each([
    ["blank name", { name: "   " }],
    ["invalid id", { id: "not-a-uuid" }],
    ["invalid slug", { slug: "Alpha-Dog" }],
    ["invalid status", { domain_status: "ready" }],
    ["non-canonical domain", { custom_domain: "APP.PARTNER.EXAMPLE" }],
    ["connected missing domain", { custom_domain: null }],
    ["invalid color", { brand_primary: "orange" }],
  ])("fails safely for a core %s", async (_, overrides) => {
    mockQuery({ data: partnerRow(overrides), error: null });
    await expect(findPartnerBrandBySlug("alpha-dog")).rejects.toThrow();
  });
});
