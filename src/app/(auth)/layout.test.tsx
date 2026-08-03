import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";

const mocks = vi.hoisted(() => ({
  getRequestBrand: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));
vi.mock("@/lib/theme-v2/ui", () => ({
  ThemeToggleV2: () => <button type="button">Theme</button>,
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
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

import { BrandProvider } from "@/components/branding/BrandProvider";
import AuthLayout from "./layout";

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
    logoLightUrl: "https://cdn.partner.example/logo.png",
    logoDarkUrl: null,
    faviconUrl: null,
  },
};

async function renderAuthLayout(requestBrand: RequestBrand): Promise<string> {
  mocks.getRequestBrand.mockResolvedValue(requestBrand);
  const layout = await AuthLayout({ children: <main>Auth form</main> });

  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>{layout}</BrandProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthLayout identity", () => {
  it("preserves the existing default identity and home links", async () => {
    const html = await renderAuthLayout(DEFAULT_REQUEST);

    expect(html).toContain("Back to home");
    expect(html).toContain("Learn more");
    expect(html).toContain('src="/logo-light.png"');
    expect(html).toContain('src="/logo-dark.png"');
    expect(html).toContain(`© ${new Date().getFullYear()} SimplAssist`);
  });

  it("uses partner identity without canonical-home affordances", async () => {
    const html = await renderAuthLayout(PARTNER_REQUEST);

    expect(html).not.toContain("Back to home");
    expect(html).not.toContain("Learn more");
    expect(html).not.toContain('href="/"');
    expect(html).not.toContain("/logo-light.png");
    expect(html).not.toContain("/logo-dark.png");
    expect(html).toContain('src="https://cdn.partner.example/logo.png"');
    expect(html).toContain('alt="Alpha Dog Agency"');
    expect(html).toContain(`© ${new Date().getFullYear()} Alpha Dog Agency`);
  });
});
