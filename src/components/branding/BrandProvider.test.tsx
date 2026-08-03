import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";
import { BrandPreviewBanner } from "./BrandPreviewBanner";
import { BrandProvider } from "./BrandProvider";

const DEFAULT_PREVIEW: RequestBrand = {
  source: "admin_preview",
  isPreview: true,
  brand: {
    kind: "default",
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
  },
};

function renderBanner(requestBrand: RequestBrand): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <BrandPreviewBanner />
    </BrandProvider>,
  );
}

describe("BrandProvider and BrandPreviewBanner", () => {
  it("renders nothing outside an authorized preview", () => {
    expect(
      renderBanner({
        ...DEFAULT_PREVIEW,
        source: "default",
        isPreview: false,
      }),
    ).toBe("");
  });

  it("identifies a known public partner brand and offers the clear query", () => {
    const html = renderBanner({
      ...DEFAULT_PREVIEW,
      brand: {
        ...DEFAULT_PREVIEW.brand,
        kind: "partner",
        partnerId: "11111111-1111-4111-8111-111111111111",
        slug: "alpha-dog",
        name: "Alpha Dog Agency",
      },
    });

    expect(html).toContain("Previewing <strong>Alpha Dog Agency</strong>");
    expect(html).toContain('href="?brand="');
    expect(html).toContain("Clear preview");
  });

  it("keeps the clear affordance when an unknown slug resolves to defaults", () => {
    const html = renderBanner(DEFAULT_PREVIEW);

    expect(html).toContain("brand preview is unavailable");
    expect(html).toContain("default branding");
    expect(html).toContain('href="?brand="');
  });
});
