import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/branding/BrandProvider";
import type { RequestBrand } from "@/lib/branding/types";
import { SignupConfirmation } from "./SignupConfirmation";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import SignupPage from "./page";

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
  ...DEFAULT_REQUEST,
  source: "partner_host",
  brand: {
    ...DEFAULT_REQUEST.brand,
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
    publicOrigin: "https://app.alphadogagency.ai",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBrowserClient.mockReturnValue({
    auth: { signUp: mocks.signUp },
  });
});

function renderConfirmation(requestBrand: RequestBrand): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <SignupConfirmation icon={null} onGoBack={vi.fn()} />
    </BrandProvider>,
  );
}

function renderPage(requestBrand: RequestBrand): string {
  return renderToStaticMarkup(
    <BrandProvider requestBrand={requestBrand}>
      <SignupPage />
    </BrandProvider>
  );
}

describe("SignupPage host policy", () => {
  it("keeps the canonical public signup form", () => {
    const html = renderPage(DEFAULT_REQUEST);

    expect(html).toContain("Create your account");
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
    expect(html).toContain("Create account");
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();
  });

  it("replaces actual partner-host signup with dynamic concierge access copy", () => {
    const html = renderPage(PARTNER_REQUEST);

    expect(html).toContain("Request access to Alpha Dog Agency");
    expect(html).toContain(
      "New accounts are set up for you by Alpha Dog Agency."
    );
    expect(html).toContain("concierge access");
    expect(html).toContain('href="/login"');
    expect(html).toContain("Log in to Alpha Dog Agency");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("Create account");
    expect(html).not.toContain("SimplAssist");
    expect(mocks.createBrowserClient).not.toHaveBeenCalled();
    expect(mocks.signUp).not.toHaveBeenCalled();
  });

  it("keeps signup enabled during an authorized partner-brand preview", () => {
    const html = renderPage({
      ...PARTNER_REQUEST,
      source: "admin_preview",
      isPreview: true,
    });

    expect(html).toContain("Create your account");
    expect(html).toContain("<form");
    expect(html).toContain("Create account");
    expect(html).not.toContain("concierge access");
    expect(mocks.createBrowserClient).toHaveBeenCalledOnce();
  });
});

describe("SignupConfirmation identity", () => {
  it("preserves the SimplAssist confirmation copy by default", () => {
    expect(renderConfirmation(DEFAULT_REQUEST)).toContain(
      "start using SimplAssist.",
    );
  });

  it("uses the partner name without leaking SimplAssist", () => {
    const html = renderConfirmation(PARTNER_REQUEST);

    expect(html).toContain("start using Alpha Dog Agency.");
    expect(html).not.toContain("SimplAssist");
  });
});
