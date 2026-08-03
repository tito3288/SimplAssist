import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/branding/BrandProvider";
import type { RequestBrand } from "@/lib/branding/types";
import { SignupConfirmation } from "./SignupConfirmation";

const DEFAULT_REQUEST: RequestBrand = {
  source: "default",
  isPreview: false,
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

function renderConfirmation(requestBrand: RequestBrand): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <SignupConfirmation icon={null} onGoBack={vi.fn()} />
    </BrandProvider>,
  );
}

describe("SignupConfirmation identity", () => {
  it("preserves the SimplAssist confirmation copy by default", () => {
    expect(renderConfirmation(DEFAULT_REQUEST)).toContain(
      "start using SimplAssist.",
    );
  });

  it("uses the partner name without leaking SimplAssist", () => {
    const html = renderConfirmation({
      ...DEFAULT_REQUEST,
      source: "partner_host",
      brand: {
        ...DEFAULT_REQUEST.brand,
        kind: "partner",
        partnerId: "11111111-1111-4111-8111-111111111111",
        slug: "alpha-dog",
        name: "Alpha Dog Agency",
      },
    });

    expect(html).toContain("start using Alpha Dog Agency.");
    expect(html).not.toContain("SimplAssist");
  });
});
