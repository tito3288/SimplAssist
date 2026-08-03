import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";

const mocks = vi.hoisted(() => ({
  getRequestBrand: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/font/local", () => ({
  default: () => ({ variable: "font-test-variable" }),
}));
vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));

import RootLayout, { generateMetadata } from "./layout";

const PARTNER_PREVIEW: RequestBrand = {
  source: "admin_preview",
  isPreview: true,
  brand: {
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
    publicOrigin: "https://partner.example",
    logoLightUrl: "https://cdn.partner.example/logo-light.png",
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
  },
};

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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRequestBrand.mockResolvedValue(PARTNER_PREVIEW);
});

describe("RootLayout branding", () => {
  it("resolves branding before render and writes validated variables on html", async () => {
    const layout = await RootLayout({
      children: <main>Request content</main>,
    });
    const html = renderToStaticMarkup(layout);

    expect(mocks.getRequestBrand).toHaveBeenCalledOnce();
    expect(html).toMatch(/^<html lang="en" style="[^"]*--brand-primary:#112233/);
    expect(html).toContain("--brand-primary-rgb:17 34 51");
    expect(html).toContain("--brand-accent-soft:#e7e9eb");
    expect(html).toContain("--brand-primary-soft-dark:#808c99");
    expect(html).toContain("Request content");
  });

  it("renders the preview notice from the public request-brand value", async () => {
    const layout = await RootLayout({ children: <main /> });
    const html = renderToStaticMarkup(layout);

    expect(html).toContain("Previewing <strong>Alpha Dog Agency</strong>");
    expect(html).toContain('href="?brand="');
  });
});

describe("generateMetadata branding", () => {
  it("preserves the exact existing SimplAssist metadata", async () => {
    mocks.getRequestBrand.mockResolvedValue(DEFAULT_REQUEST);

    await expect(generateMetadata()).resolves.toEqual({
      metadataBase: new URL(
        process.env.NEXT_PUBLIC_APP_URL || "https://simplassist.com",
      ),
      title: "SimplAssist",
      description: "AI-powered customer support assistant",
      openGraph: {
        title: "SimplAssist",
        description: "AI-powered customer support assistant",
        type: "website",
        images: [
          {
            url: "/social-preview.png",
            width: 1200,
            height: 630,
            alt: "SimplAssist",
          },
        ],
      },
      twitter: {
        card: "summary_large_image",
        title: "SimplAssist",
        description: "AI-powered customer support assistant",
        images: ["/social-preview.png"],
      },
      icons: {
        icon: [{ url: "/favicon-2.png", type: "image/png" }],
        apple: [{ url: "/favicon-2.png", type: "image/png" }],
      },
    });
  });

  it("uses a connected partner origin, title, and configured favicon", async () => {
    mocks.getRequestBrand.mockResolvedValue({
      ...PARTNER_PREVIEW,
      source: "partner_host",
      isPreview: false,
      brand: {
        ...PARTNER_PREVIEW.brand,
        faviconUrl: "https://cdn.partner.example/favicon.png",
      },
    });

    const metadata = await generateMetadata();

    expect(metadata).toMatchObject({
      metadataBase: new URL("https://partner.example"),
      title: "Alpha Dog Agency",
      openGraph: { title: "Alpha Dog Agency" },
      twitter: { title: "Alpha Dog Agency" },
      icons: {
        icon: [{ url: "https://cdn.partner.example/favicon.png" }],
        apple: [{ url: "https://cdn.partner.example/favicon.png" }],
      },
    });
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
    expect(metadata).not.toHaveProperty("robots");
    expect(JSON.stringify(metadata)).not.toContain("/social-preview.png");
    expect(JSON.stringify(metadata)).not.toContain("/favicon-2.png");
  });

  it("marks a pending partner preview private without default asset fallbacks", async () => {
    mocks.getRequestBrand.mockResolvedValue({
      ...PARTNER_PREVIEW,
      brand: {
        ...PARTNER_PREVIEW.brand,
        publicOrigin: null,
        faviconUrl: null,
      },
    });

    const metadata = await generateMetadata();

    expect(metadata).toMatchObject({
      metadataBase: new URL(
        process.env.NEXT_PUBLIC_APP_URL || "https://simplassist.com",
      ),
      title: "Alpha Dog Agency",
      openGraph: { title: "Alpha Dog Agency" },
      twitter: { title: "Alpha Dog Agency" },
      robots: { index: false, follow: false },
    });
    expect(metadata).not.toHaveProperty("icons");
    expect(metadata.openGraph).not.toHaveProperty("images");
    expect(metadata.twitter).not.toHaveProperty("images");
    expect(JSON.stringify(metadata)).not.toContain("SimplAssist");
    expect(JSON.stringify(metadata)).not.toContain("social-preview.png");
    expect(JSON.stringify(metadata)).not.toContain("favicon-2.png");
  });

  it("keeps default assets but noindexes an unknown-brand preview", async () => {
    mocks.getRequestBrand.mockResolvedValue({
      ...DEFAULT_REQUEST,
      source: "admin_preview",
      isPreview: true,
    });

    const metadata = await generateMetadata();

    expect(metadata.title).toBe("SimplAssist");
    expect(metadata.openGraph).toHaveProperty("images", [
      expect.objectContaining({ url: "/social-preview.png" }),
    ]);
    expect(metadata).toMatchObject({
      icons: {
        icon: [{ url: "/favicon-2.png", type: "image/png" }],
      },
      robots: { index: false, follow: false },
    });
  });
});
