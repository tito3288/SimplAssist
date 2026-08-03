import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRequestBrand: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("./(public)/home/page", () => ({
  default: () => <main data-testid="canonical-home">Canonical homepage</main>,
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
  mocks.getRequestBrand.mockReset();
  mocks.redirect.mockClear();
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
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
