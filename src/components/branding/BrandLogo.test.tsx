import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";
import { BrandLogo, resolvePartnerLogoSources } from "./BrandLogo";
import { BrandProvider } from "./BrandProvider";

vi.mock("next/image", () => ({
  default: ({
    alt,
    priority,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement> & { priority?: boolean }) => {
    void priority;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img alt={alt} {...props} data-next-image="true" />
    );
  },
}));

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

const PARTNER_REQUEST: RequestBrand = {
  source: "partner_host",
  isPreview: false,
  brand: {
    ...DEFAULT_REQUEST.brand,
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
    publicOrigin: "https://app.partner.example",
    logoLightUrl: "https://cdn.partner.example/logo-light.png",
    logoDarkUrl: "https://cdn.partner.example/logo-dark.png",
    faviconUrl: null,
  },
};

function renderLogo(requestBrand: RequestBrand): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <BrandLogo width={180} height={48} className="h-10 w-auto" />
    </BrandProvider>,
  );
}

describe("BrandLogo", () => {
  it("uses the two existing next/image assets for the default brand", () => {
    const html = renderLogo(DEFAULT_REQUEST);

    expect(html.match(/data-next-image="true"/g)).toHaveLength(2);
    expect(html).toContain('src="/logo-light.png"');
    expect(html).toContain('src="/logo-dark.png"');
    expect(html).toContain('alt="SimplAssist"');
  });

  it("uses raw public HTTPS assets and the partner name as alt text", () => {
    const html = renderLogo(PARTNER_REQUEST);

    expect(html).not.toContain("data-next-image");
    expect(html).toContain('src="https://cdn.partner.example/logo-light.png"');
    expect(html).toContain('src="https://cdn.partner.example/logo-dark.png"');
    expect(html).toContain('alt="Alpha Dog Agency"');
  });

  it("reuses the configured partner logo when the other mode is missing", () => {
    const html = renderLogo({
      ...PARTNER_REQUEST,
      brand: { ...PARTNER_REQUEST.brand, logoDarkUrl: null },
    });

    expect(html.match(/src="https:\/\/cdn\.partner\.example\/logo-light\.png"/g)).toHaveLength(2);
    expect(html).not.toContain("/logo-dark.png");
  });

  it("reuses the surviving mode after one external logo fails", () => {
    const brandKey = PARTNER_REQUEST.brand.partnerId;
    const resolved = resolvePartnerLogoSources(PARTNER_REQUEST.brand, [
      `${brandKey}:https://cdn.partner.example/logo-light.png`,
    ]);

    expect(resolved).toMatchObject({
      lightLogo: "https://cdn.partner.example/logo-dark.png",
      darkLogo: "https://cdn.partner.example/logo-dark.png",
    });
  });

  it("returns no usable source after both external logos fail", () => {
    const brandKey = PARTNER_REQUEST.brand.partnerId;
    const resolved = resolvePartnerLogoSources(PARTNER_REQUEST.brand, [
      `${brandKey}:https://cdn.partner.example/logo-light.png`,
      `${brandKey}:https://cdn.partner.example/logo-dark.png`,
    ]);

    expect(resolved).toMatchObject({ lightLogo: null, darkLogo: null });
  });

  it.each([
    [null, null],
    ["http://cdn.partner.example/logo.png", null],
    ["https://user:secret@cdn.partner.example/logo.png", null],
    ["https://localhost/logo.png", null],
    ["https://192.168.1.20/logo.png", null],
    ["https://assets.partner.internal/logo.png", null],
    ["https://assets..partner.example/logo.png", null],
    ["https://assets.partner.example./logo.png", null],
  ])(
    "uses a partner-name wordmark instead of SimplAssist assets for unusable logos",
    (logoLightUrl, logoDarkUrl) => {
      const html = renderLogo({
        ...PARTNER_REQUEST,
        brand: { ...PARTNER_REQUEST.brand, logoLightUrl, logoDarkUrl },
      });

      expect(html).toContain('data-brand-wordmark="partner"');
      expect(html).toContain("Alpha Dog Agency");
      expect(html).not.toContain("<img");
      expect(html).not.toContain("/logo-light.png");
      expect(html).not.toContain("/logo-dark.png");
    },
  );
});
