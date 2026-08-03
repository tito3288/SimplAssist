import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandProvider } from "@/components/branding/BrandProvider";
import type { RequestBrand } from "@/lib/branding/types";
import PhoneNumberSelector, { canonicalLegalUrl } from "./PhoneNumberSelector";

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

function renderPhoneNumberSelector(): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={DEFAULT_REQUEST_BRAND}>
      <PhoneNumberSelector />
    </BrandProvider>,
  );
}

describe("PhoneNumberSelector canonical legal links", () => {
  it("builds absolute legal URLs from the validated canonical origin", () => {
    expect(
      canonicalLegalUrl("/terms", "https://simplassist.com/a/path?ignored=1"),
    ).toBe("https://simplassist.com/terms");
    expect(
      canonicalLegalUrl("/privacy", "http://localhost:3000/anything"),
    ).toBe("http://localhost:3000/privacy");
  });

  it.each([
    "not a URL",
    "ftp://simplassist.com",
    "https://user:password@simplassist.com",
  ])("falls back to the canonical SimplAssist origin for %s", (configured) => {
    expect(canonicalLegalUrl("/terms", configured)).toBe(
      "https://simplassist.com/terms",
    );
  });

  it("preserves carrier-consent SimplAssist language and uses absolute links", () => {
    const markup = renderPhoneNumberSelector();

    expect(markup).toContain(
      "SimplAssist will send automated text messages on my business&#x27;s behalf",
    );
    expect(markup).toContain("SimplAssist&#x27;s");
    expect(markup).toContain(`href="${canonicalLegalUrl("/terms")}"`);
    expect(markup).toContain(`href="${canonicalLegalUrl("/privacy")}"`);
    expect(markup).not.toContain('href="/terms"');
    expect(markup).not.toContain('href="/privacy"');
    expect(markup).toContain("accent-[var(--brand-primary-dark)]");
    expect(markup).toContain("text-[var(--brand-primary-dark)]");
    expect(markup).toContain("hover:text-[var(--brand-primary-soft-dark)]");
    expect(markup).toContain("focus:border-[var(--brand-primary-dark)]");
    expect(markup).toContain("bg-[var(--brand-primary-alt)]");
  });
});
