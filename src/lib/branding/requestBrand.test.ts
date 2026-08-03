import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentHeaders: new Headers(),
  headers: vi.fn(),
  noStore: vi.fn(),
  findByHostname: vi.fn(),
  findBySlug: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: (fn: unknown) => fn,
}));
vi.mock("./repository.server", () => ({
  findPartnerBrandByHostname: mocks.findByHostname,
  findPartnerBrandBySlug: mocks.findBySlug,
}));

import { DEFAULT_BRAND, getCanonicalAppHostname } from "./defaultBrand";
import { getRequestBrand } from "./requestBrand.server";
import type { PublicBrand } from "./types";

const PARTNER_ID = "11111111-1111-4111-8111-111111111111";

function partnerBrand(overrides: Partial<PublicBrand> = {}): PublicBrand {
  return {
    kind: "partner",
    partnerId: PARTNER_ID,
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
    publicOrigin: "https://app.partner.example",
    logoLightUrl: "https://cdn.partner.example/logo-light.png",
    logoDarkUrl: "https://cdn.partner.example/logo-dark.png",
    faviconUrl: "https://cdn.partner.example/favicon.png",
    colors: {
      primary: "#111111",
      primaryHover: "#222222",
      primaryActive: "#333333",
      accent: "#444444",
      primaryDark: "#555555",
      primaryHoverDark: "#666666",
      primaryActiveDark: "#777777",
      accentDark: "#888888",
    },
    ...overrides,
  };
}

function setHeaders(values: Record<string, string>) {
  mocks.currentHeaders = new Headers(values);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.currentHeaders = new Headers();
  mocks.headers.mockImplementation(() => mocks.currentHeaders);
  mocks.findByHostname.mockResolvedValue(null);
  mocks.findBySlug.mockResolvedValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DEFAULT_BRAND", () => {
  it("preserves the exact current SimplAssist assets and eight colors", () => {
    expect(DEFAULT_BRAND).toEqual({
      kind: "default",
      partnerId: null,
      slug: null,
      name: "SimplAssist",
      publicOrigin: new URL(
        process.env.NEXT_PUBLIC_APP_URL || "https://simplassist.com",
      ).origin,
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
    });
  });
});

describe("getRequestBrand host resolution", () => {
  it("short-circuits the canonical Host without a database lookup", async () => {
    setHeaders({
      host: `${getCanonicalAppHostname()}:443`,
      "x-forwarded-host": "app.partner.example",
      forwarded: "host=app.partner.example",
    });

    const result = await getRequestBrand();

    expect(result).toEqual({
      source: "default",
      isPreview: false,
      brand: DEFAULT_BRAND,
    });
    expect(mocks.findByHostname).not.toHaveBeenCalled();
    expect(mocks.noStore).toHaveBeenCalledOnce();
  });

  it("normalizes Host and performs one exact partner lookup", async () => {
    const brand = partnerBrand();
    mocks.findByHostname.mockResolvedValue(brand);
    setHeaders({ host: "APP.PARTNER.EXAMPLE.:8443" });

    await expect(getRequestBrand()).resolves.toEqual({
      source: "partner_host",
      isPreview: false,
      brand,
    });
    expect(mocks.findByHostname).toHaveBeenCalledWith("app.partner.example");
  });

  it.each([
    ["unknown exact Host", { host: "unknown.partner.example" }],
    ["absent Host", {}],
    ["malformed Host", { host: "app.partner.example,evil.test" }],
    [
      "forwarded host only",
      {
        "x-forwarded-host": "app.partner.example",
        forwarded: "host=app.partner.example",
      },
    ],
  ])("uses the default brand for %s", async (_, requestHeaders) => {
    setHeaders(requestHeaders);

    const result = await getRequestBrand();

    expect(result).toMatchObject({ source: "default", isPreview: false });
    expect(result.brand).toBe(DEFAULT_BRAND);
  });

  it("fails safely to the default brand when the host lookup errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.findByHostname.mockRejectedValue(new Error("database unavailable"));
    setHeaders({ host: "app.partner.example" });

    const result = await getRequestBrand();

    expect(result.brand).toBe(DEFAULT_BRAND);
    expect(result.source).toBe("default");
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("hostname lookup failed"),
      expect.any(Error),
    );
  });
});

describe("getRequestBrand authorized preview resolution", () => {
  it("lets the trusted preview slug override Host and preview pending partners", async () => {
    const brand = partnerBrand({ publicOrigin: null });
    mocks.findBySlug.mockResolvedValue(brand);
    setHeaders({
      host: "unrelated.example",
      "x-sa-brand-preview": "alpha-dog",
    });

    await expect(getRequestBrand()).resolves.toEqual({
      source: "admin_preview",
      isPreview: true,
      brand,
    });
    expect(mocks.findBySlug).toHaveBeenCalledWith("alpha-dog");
    expect(mocks.findByHostname).not.toHaveBeenCalled();
  });

  it("preserves preview state for an unknown valid slug with default branding", async () => {
    setHeaders({ "x-sa-brand-preview": "unknown-partner" });

    const result = await getRequestBrand();

    expect(result).toEqual({
      source: "admin_preview",
      isPreview: true,
      brand: DEFAULT_BRAND,
    });
  });

  it("fails closed for a malformed trusted header without using Host", async () => {
    setHeaders({
      host: "app.partner.example",
      "x-sa-brand-preview": "Alpha-Dog,other",
    });

    const result = await getRequestBrand();

    expect(result).toEqual({
      source: "default",
      isPreview: false,
      brand: DEFAULT_BRAND,
    });
    expect(mocks.findBySlug).not.toHaveBeenCalled();
    expect(mocks.findByHostname).not.toHaveBeenCalled();
  });

  it("fails safely but retains preview state when the slug lookup errors", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    mocks.findBySlug.mockRejectedValue(new Error("database unavailable"));
    setHeaders({ "x-sa-brand-preview": "alpha-dog" });

    const result = await getRequestBrand();

    expect(result).toEqual({
      source: "admin_preview",
      isPreview: true,
      brand: DEFAULT_BRAND,
    });
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("preview lookup failed"),
      expect.any(Error),
    );
  });
});

describe("getRequestBrand request isolation", () => {
  it("does not retain a previous partner across sequential requests", async () => {
    const brand = partnerBrand();
    mocks.findByHostname.mockImplementation(async (hostname: string) =>
      hostname === "app.partner.example" ? brand : null,
    );

    setHeaders({ host: "app.partner.example" });
    const partnerResult = await getRequestBrand();

    setHeaders({ host: "unknown.partner.example" });
    const defaultResult = await getRequestBrand();

    expect(partnerResult.brand).toBe(brand);
    expect(defaultResult.brand).toBe(DEFAULT_BRAND);
    expect(defaultResult.source).toBe("default");
  });

  it("keeps concurrent hostname lookups associated with their own requests", async () => {
    const firstBrand = partnerBrand({
      partnerId: "11111111-1111-4111-8111-111111111111",
      slug: "first",
      name: "First Partner",
    });
    const secondBrand = partnerBrand({
      partnerId: "22222222-2222-4222-8222-222222222222",
      slug: "second",
      name: "Second Partner",
    });
    mocks.findByHostname.mockImplementation(async (hostname: string) => {
      await Promise.resolve();
      if (hostname === "first.partner.example") return firstBrand;
      if (hostname === "second.partner.example") return secondBrand;
      return null;
    });

    setHeaders({ host: "first.partner.example" });
    const firstPromise = getRequestBrand();
    setHeaders({ host: "unknown.partner.example" });
    const defaultPromise = getRequestBrand();
    setHeaders({ host: "second.partner.example" });
    const secondPromise = getRequestBrand();

    const [first, defaultResult, second] = await Promise.all([
      firstPromise,
      defaultPromise,
      secondPromise,
    ]);

    expect(first.brand).toBe(firstBrand);
    expect(defaultResult.brand).toBe(DEFAULT_BRAND);
    expect(second.brand).toBe(secondBrand);
  });
});
