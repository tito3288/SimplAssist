import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getDashboardEntitledContext: vi.fn(),
  canUseFeature: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  resolveConnectedBusinessPartner: vi.fn(),
  getCanonicalAppOrigin: vi.fn(),
  getRequestBrand: vi.fn(),
  widgetPageClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/dashboard/context", () => ({
  getDashboardEntitledContext: mocks.getDashboardEntitledContext,
}));
vi.mock("@/lib/billing/entitlements", () => ({
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("@/lib/branding/businessPartner.server", () => ({
  resolveConnectedBusinessPartner: mocks.resolveConnectedBusinessPartner,
}));
vi.mock("@/lib/branding/defaultBrand", () => ({
  getCanonicalAppOrigin: mocks.getCanonicalAppOrigin,
}));
vi.mock("@/lib/branding/requestBrand.server", () => ({
  getRequestBrand: mocks.getRequestBrand,
}));
vi.mock("./WidgetPageClient", () => ({
  default: (props: unknown) => {
    mocks.widgetPageClient(props);
    return null;
  },
}));
vi.mock("@/components/entitlements/LockedFeatureCard", () => ({
  LockedFeatureCard: () => null,
}));

import WidgetPage from "./page";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.canUseFeature.mockReturnValue(true);
  mocks.resolveConnectedBusinessPartner.mockResolvedValue(null);
  mocks.getCanonicalAppOrigin.mockReturnValue("https://simplassist.com");
  mocks.getRequestBrand.mockResolvedValue({
    source: "admin_preview",
    isPreview: true,
    brand: {
      kind: "partner",
      publicOrigin: "https://preview-only.example",
    },
  });
  mocks.getDashboardEntitledContext.mockResolvedValue({
    status: "resolved",
    supabase: { from: mocks.from },
    business: { id: BUSINESS_ID, name: "Acme" },
    entitlements: {
      businessId: BUSINESS_ID,
      plan: "sms_and_chat",
      status: "active",
      source: "subscription",
      active: true,
      cancelAtPeriodEnd: false,
    },
  });
});

describe("WidgetPage defaults", () => {
  it("creates only new widget configs as active", async () => {
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: null }),
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);

    const insertQuery = {
      insert: mocks.insert,
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { business_id: BUSINESS_ID, is_active: true },
      }),
    };
    mocks.insert.mockReturnValue(insertQuery);
    insertQuery.select.mockReturnValue(insertQuery);
    mocks.from
      .mockReturnValueOnce(existingQuery)
      .mockReturnValueOnce(insertQuery);

    const page = await WidgetPage();
    renderToStaticMarkup(page);

    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        business_id: BUSINESS_ID,
        is_active: true,
      })
    );
  });

  it("uses the connected stored business assignment for the script origin", async () => {
    const widgetConfig = {
      business_id: BUSINESS_ID,
      is_active: true,
    };
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: widgetConfig }),
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);
    mocks.from.mockReturnValue(existingQuery);
    mocks.resolveConnectedBusinessPartner.mockResolvedValue({
      partnerId: "11111111-1111-4111-8111-111111111111",
      name: "Alpha Dog Agency",
      customDomain: "app.partner.example",
      publicOrigin: "https://app.partner.example",
    });

    const page = await WidgetPage();
    renderToStaticMarkup(page);

    expect(mocks.resolveConnectedBusinessPartner).toHaveBeenCalledWith(
      BUSINESS_ID,
    );
    expect(mocks.widgetPageClient).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        scriptOrigin: "https://app.partner.example",
      }),
    );
    expect(mocks.getCanonicalAppOrigin).not.toHaveBeenCalled();
    expect(mocks.getRequestBrand).not.toHaveBeenCalled();
  });

  it("uses the canonical origin when assignment is absent despite admin preview", async () => {
    const widgetConfig = {
      business_id: BUSINESS_ID,
      is_active: true,
    };
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: widgetConfig }),
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);
    mocks.from.mockReturnValue(existingQuery);

    const page = await WidgetPage();
    renderToStaticMarkup(page);

    expect(mocks.widgetPageClient).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        scriptOrigin: "https://simplassist.com",
      }),
    );
    expect(mocks.getCanonicalAppOrigin).toHaveBeenCalledOnce();
    expect(mocks.getRequestBrand).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.widgetPageClient.mock.calls)).not.toContain(
      "preview-only.example",
    );
  });
});
