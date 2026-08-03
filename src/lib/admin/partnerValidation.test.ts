import { describe, expect, it } from "vitest";
import {
  parseAdminPartnerRow,
  partnerPatchInputSchema,
  partnerProfileInputSchema,
  partnerProfileToDatabaseWrite,
} from "./partnerValidation";

const colors = {
  primary: "#EA580C",
  primaryHover: "#C2410C",
  primaryActive: "#9A3412",
  accent: "#C2410C",
  primaryDark: "#FF914D",
  primaryHoverDark: "#F57F33",
  primaryActiveDark: "#E8752C",
  accentDark: "#FF914D",
};

const profile = {
  name: " Alpha Dog Agency ",
  slug: "ALPHA-DOG",
  customDomain: "APP.ALPHADOGAGENCY.AI",
  logoLightUrl: "https://cdn.example.com/logo-light.svg",
  logoDarkUrl: "https://cdn.example.com/logo-dark.svg",
  faviconUrl: "https://cdn.example.com/favicon.png",
  status: "active",
  colors,
};

const row = {
  id: "10000000-0000-4000-a000-000000000043",
  name: "Alpha Dog Agency",
  slug: "alpha-dog",
  custom_domain: "app.alphadogagency.ai",
  domain_status: "connected",
  logo_light_url: "https://cdn.example.com/logo-light.svg",
  logo_dark_url: "https://cdn.example.com/logo-dark.svg",
  favicon_url: "https://cdn.example.com/favicon.png",
  brand_primary: "#EA580C",
  brand_primary_hover: "#C2410C",
  brand_primary_active: "#9A3412",
  brand_accent: "#C2410C",
  brand_primary_dark: "#FF914D",
  brand_primary_hover_dark: "#F57F33",
  brand_primary_active_dark: "#E8752C",
  brand_accent_dark: "#FF914D",
  status: "active",
  created_at: "2026-08-03T00:00:00.000Z",
  updated_at: "2026-08-03T01:00:00.000Z",
};

describe("partnerProfileInputSchema", () => {
  it("normalizes the name, slug, domain, and all eight colors", () => {
    const parsed = partnerProfileInputSchema.parse(profile);

    expect(parsed).toMatchObject({
      name: "Alpha Dog Agency",
      slug: "alpha-dog",
      customDomain: "app.alphadogagency.ai",
      colors: {
        primary: "#ea580c",
        primaryHover: "#c2410c",
        primaryActive: "#9a3412",
        accent: "#c2410c",
        primaryDark: "#ff914d",
        primaryHoverDark: "#f57f33",
        primaryActiveDark: "#e8752c",
        accentDark: "#ff914d",
      },
    });
  });

  it.each([
    "https://app.example.com",
    "app.example.com:443",
    "app.example.com/path",
    "user@app.example.com",
    " app.example.com",
    "*.example.com",
    "app.example.com.",
    "app.example.com,evil.example",
  ])("rejects non-hostname custom domain %s", (customDomain) => {
    expect(
      partnerProfileInputSchema.safeParse({ ...profile, customDomain }).success,
    ).toBe(false);
  });

  it.each([
    "alpha dog",
    "alpha--dog",
    "-alpha-dog",
    "alpha-dog-",
    "alpha_dog",
  ])("rejects invalid slug %s", (slug) => {
    expect(partnerProfileInputSchema.safeParse({ ...profile, slug }).success).toBe(
      false,
    );
  });

  it.each([
    "#fff",
    "#ea580c00",
    "ea580c",
    "orange",
    "#gg580c",
  ])("rejects invalid six-digit color %s", (primary) => {
    expect(
      partnerProfileInputSchema.safeParse({
        ...profile,
        colors: { ...colors, primary },
      }).success,
    ).toBe(false);
  });

  it.each([
    "http://cdn.example.com/logo.svg",
    "https://user:pass@cdn.example.com/logo.svg",
    "https://localhost/logo.svg",
    "https://assets.local/logo.svg",
    "https://assets.internal/logo.svg",
    "https://127.0.0.1/logo.svg",
    "https://10.0.0.1/logo.svg",
    "https://192.168.1.1/logo.svg",
    "https://198.51.100.1/logo.svg",
    "//cdn.example.com/logo.svg",
    " https://cdn.example.com/logo.svg",
  ])("rejects non-public asset URL %s", (logoLightUrl) => {
    expect(
      partnerProfileInputSchema.safeParse({ ...profile, logoLightUrl }).success,
    ).toBe(false);
  });

  it("normalizes empty optional domain and asset fields to null", () => {
    expect(
      partnerProfileInputSchema.parse({
        ...profile,
        customDomain: "",
        logoLightUrl: "",
        logoDarkUrl: null,
        faviconUrl: "",
      }),
    ).toMatchObject({
      customDomain: null,
      logoLightUrl: null,
      logoDarkUrl: null,
      faviconUrl: null,
    });
  });

  it("strips no unknown profile fields", () => {
    expect(
      partnerProfileInputSchema.safeParse({
        ...profile,
        domainStatus: "connected",
      }).success,
    ).toBe(false);
  });
});

describe("partnerPatchInputSchema", () => {
  it("keeps profile and domain-status changes as distinct actions", () => {
    expect(
      partnerPatchInputSchema.safeParse({ action: "update", ...profile }).success,
    ).toBe(true);
    expect(
      partnerPatchInputSchema.safeParse({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: "APP.ALPHADOGAGENCY.AI",
      }).success,
    ).toBe(true);
    expect(
      partnerPatchInputSchema.safeParse({
        action: "set_domain_status",
        domainStatus: "connected",
        expectedCustomDomain: "app.alphadogagency.ai",
        customDomain: "new.example.com",
      }).success,
    ).toBe(false);

    expect(
      partnerPatchInputSchema.safeParse({
        action: "set_domain_status",
        domainStatus: "connected",
      }).success,
    ).toBe(false);
  });
});

describe("partner read-boundary validation", () => {
  it("validates and maps the database row into the admin DTO", () => {
    const partner = parseAdminPartnerRow(row);

    expect(partner).toEqual({
      id: row.id,
      name: "Alpha Dog Agency",
      slug: "alpha-dog",
      customDomain: "app.alphadogagency.ai",
      domainStatus: "connected",
      logoLightUrl: row.logo_light_url,
      logoDarkUrl: row.logo_dark_url,
      faviconUrl: row.favicon_url,
      status: "active",
      colors: {
        primary: "#ea580c",
        primaryHover: "#c2410c",
        primaryActive: "#9a3412",
        accent: "#c2410c",
        primaryDark: "#ff914d",
        primaryHoverDark: "#f57f33",
        primaryActiveDark: "#e8752c",
        accentDark: "#ff914d",
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  });

  it("rejects a connected row with no domain and malformed returned assets", () => {
    expect(() =>
      parseAdminPartnerRow({ ...row, custom_domain: null }),
    ).toThrow();
    expect(() =>
      parseAdminPartnerRow({ ...row, logo_light_url: "http://localhost/logo" }),
    ).toThrow();
  });

  it("projects only explicit writable columns", () => {
    const parsed = partnerProfileInputSchema.parse(profile);
    expect(partnerProfileToDatabaseWrite(parsed)).toEqual({
      name: "Alpha Dog Agency",
      slug: "alpha-dog",
      custom_domain: "app.alphadogagency.ai",
      logo_light_url: profile.logoLightUrl,
      logo_dark_url: profile.logoDarkUrl,
      favicon_url: profile.faviconUrl,
      status: "active",
      brand_primary: "#ea580c",
      brand_primary_hover: "#c2410c",
      brand_primary_active: "#9a3412",
      brand_accent: "#c2410c",
      brand_primary_dark: "#ff914d",
      brand_primary_hover_dark: "#f57f33",
      brand_primary_active_dark: "#e8752c",
      brand_accent_dark: "#ff914d",
    });
  });
});
