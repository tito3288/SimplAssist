import "server-only";

import type { PublicBrand } from "./types";

const FALLBACK_APP_URL = "https://simplassist.com";

export function getCanonicalAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || FALLBACK_APP_URL;
  const url = new URL(configured);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_APP_URL must use HTTP or HTTPS");
  }

  return url.origin;
}

export const DEFAULT_BRAND_SUPPORT_COLORS = {
  accentSoft: "#fdf1e7",
  accentSoftBorder: "#f5dcc4",
  accentSoftDark: "#ffd7bf",
  primarySoftDark: "#ffb07a",
} as const;

export const DEFAULT_BRAND: PublicBrand = {
  kind: "default",
  partnerId: null,
  slug: null,
  name: "SimplAssist",
  publicOrigin: getCanonicalAppOrigin(),
  logoLightUrl: "/logo-light.png",
  logoDarkUrl: "/logo-dark.png",
  faviconUrl: "/favicon-2.png",
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
};

export function getCanonicalAppHostname(): string {
  return new URL(DEFAULT_BRAND.publicOrigin!).hostname.toLowerCase();
}
