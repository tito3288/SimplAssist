import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_BRAND } from "./defaultBrand";
import { buildBrandCssProperties } from "./cssVariables.server";
import type { PublicBrand } from "./types";

const PARTNER_BRAND: PublicBrand = {
  kind: "partner",
  partnerId: "11111111-1111-4111-8111-111111111111",
  slug: "example-partner",
  name: "Example Partner",
  publicOrigin: "https://partner.example",
  logoLightUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
  colors: {
    primary: "#112233",
    primaryHover: "#223344",
    primaryActive: "#334455",
    accent: "#445566",
    primaryDark: "#556677",
    primaryHoverDark: "#667788",
    primaryActiveDark: "#778899",
    accentDark: "#8899aa",
  },
};

describe("buildBrandCssProperties", () => {
  it("preserves every exact SimplAssist core and supporting color", () => {
    expect(buildBrandCssProperties(DEFAULT_BRAND)).toEqual({
      "--brand-primary": "#ea580c",
      "--brand-primary-rgb": "234 88 12",
      "--brand-primary-hover": "#c2410c",
      "--brand-primary-hover-rgb": "194 65 12",
      "--brand-primary-active": "#9a3412",
      "--brand-primary-active-rgb": "154 52 18",
      "--brand-accent": "#c2410c",
      "--brand-accent-rgb": "194 65 12",
      "--brand-primary-dark": "#ff914d",
      "--brand-primary-dark-rgb": "255 145 77",
      "--brand-primary-hover-dark": "#f57f33",
      "--brand-primary-hover-dark-rgb": "245 127 51",
      "--brand-primary-active-dark": "#e8752c",
      "--brand-primary-active-dark-rgb": "232 117 44",
      "--brand-accent-dark": "#ff914d",
      "--brand-accent-dark-rgb": "255 145 77",
      "--brand-accent-soft": "#fdf1e7",
      "--brand-accent-soft-border": "#f5dcc4",
      "--brand-accent-soft-dark": "#ffd7bf",
      "--brand-primary-soft-dark": "#ffb07a",
    });
  });

  it("derives partner RGB channels and supporting colors deterministically", () => {
    expect(buildBrandCssProperties(PARTNER_BRAND)).toEqual({
      "--brand-primary": "#112233",
      "--brand-primary-rgb": "17 34 51",
      "--brand-primary-hover": "#223344",
      "--brand-primary-hover-rgb": "34 51 68",
      "--brand-primary-active": "#334455",
      "--brand-primary-active-rgb": "51 68 85",
      "--brand-accent": "#445566",
      "--brand-accent-rgb": "68 85 102",
      "--brand-primary-dark": "#556677",
      "--brand-primary-dark-rgb": "85 102 119",
      "--brand-primary-hover-dark": "#667788",
      "--brand-primary-hover-dark-rgb": "102 119 136",
      "--brand-primary-active-dark": "#778899",
      "--brand-primary-active-dark-rgb": "119 136 153",
      "--brand-accent-dark": "#8899aa",
      "--brand-accent-dark-rgb": "136 153 170",
      "--brand-accent-soft": "#e7e9eb",
      "--brand-accent-soft-border": "#cfd3d6",
      "--brand-accent-soft-dark": "#cfd6dd",
      "--brand-primary-soft-dark": "#808c99",
    });
  });

  it("falls back to the complete exact default for an injection-shaped color", () => {
    const unsafeStyle = buildBrandCssProperties({
      ...PARTNER_BRAND,
      colors: {
        ...PARTNER_BRAND.colors,
        primary: "red; background: url(https://attacker.example)",
      },
    });

    expect(unsafeStyle).toEqual(buildBrandCssProperties(DEFAULT_BRAND));
    expect(JSON.stringify(unsafeStyle)).not.toContain("attacker.example");
  });
});
