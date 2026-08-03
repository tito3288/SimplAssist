import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { BrandProvider } from "@/components/branding/BrandProvider";
import CallForwardingNudge from "./CallForwardingNudge";

const DEFAULT_REQUEST_BRAND: RequestBrand = {
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

function renderNudge(name: string): string {
  const requestBrand: RequestBrand = {
    ...DEFAULT_REQUEST_BRAND,
    brand: {
      ...DEFAULT_REQUEST_BRAND.brand,
      kind: name === "SimplAssist" ? "default" : "partner",
      partnerId:
        name === "SimplAssist"
          ? null
          : "11111111-1111-4111-8111-111111111111",
      slug: name === "SimplAssist" ? null : "alpha-dog",
      name,
    },
  };

  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <CallForwardingNudge />
    </BrandProvider>
  )
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("CallForwardingNudge visible brand copy", () => {
  it("preserves SimplAssist for the default brand", () => {
    expect(renderNudge("SimplAssist")).toContain(
      "SimplAssist will still send the automatic follow-up."
    );
  });

  it("uses the partner name for the automatic follow-up", () => {
    const text = renderNudge("Alpha Dog Agency");

    expect(text).toContain(
      "Alpha Dog Agency will still send the automatic follow-up."
    );
    expect(text).not.toContain("SimplAssist");
  });
});
