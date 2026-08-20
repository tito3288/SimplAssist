import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getRequestBrand: vi.fn(),
  homePage: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("./(public)/home/page", () => ({
  default: (props: Record<string, never>) => {
    mocks.homePage(props);
    return <main data-testid="canonical-home">Canonical homepage</main>;
  },
}));

import Page from "./page";

const DEFAULT_BRAND = {
  kind: "default" as const,
  partnerId: null,
  slug: null,
  name: "SimplAssist",
  publicOrigin: "https://simplassist.com",
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

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CHAT_ONLY_DIRECT_SALES_ENABLED", "0");
  vi.stubEnv("STRIPE_PRICE_CHAT_ONLY", "");
  mocks.getRequestBrand.mockReset();
  mocks.homePage.mockReset();
  mocks.redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("root page branding redirect", () => {
  it("redirects an exact partner-host request to the relative login path", async () => {
    mocks.getRequestBrand.mockResolvedValue({
      source: "partner_host",
      isPreview: false,
      brand: { ...DEFAULT_BRAND, kind: "partner", partnerId: "partner-id" },
    });

    await expect(Page()).rejects.toThrow("redirect:/login");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it.each(["default", "admin_preview"] as const)(
    "keeps the canonical homepage for %s branding",
    async (source) => {
      mocks.getRequestBrand.mockResolvedValue({
        source,
        isPreview: source === "admin_preview",
        brand: DEFAULT_BRAND,
      });

      const html = renderToStaticMarkup(await Page());

      expect(html).toContain("Canonical homepage");
      expect(mocks.homePage).toHaveBeenCalledWith({});
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );

  it("leaves the server public-launch decision inside the canonical homepage route", async () => {
    vi.stubEnv("CHAT_ONLY_DIRECT_SALES_ENABLED", "1");
    vi.stubEnv("STRIPE_PRICE_CHAT_ONLY", "price_live_chat_only");
    mocks.getRequestBrand.mockResolvedValue({
      source: "default",
      isPreview: false,
      brand: DEFAULT_BRAND,
    });

    renderToStaticMarkup(await Page());

    expect(mocks.homePage).toHaveBeenCalledWith({});
  });
});
