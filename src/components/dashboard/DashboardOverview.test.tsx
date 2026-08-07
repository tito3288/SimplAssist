import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestBrand } from "@/lib/branding/types";

const mocks = vi.hoisted(() => ({
  stateIndex: 0,
  stateValues: [] as unknown[],
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: <Value,>(initialValue: Value) => {
      const index = mocks.stateIndex++;
      const value =
        index < mocks.stateValues.length
          ? (mocks.stateValues[index] as Value)
          : initialValue;
      return [value, vi.fn()] as const;
    },
  };
});

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

vi.mock("@/components/phone/PhoneNumberSelector", () => ({
  default: () => <div>Phone number selector</div>,
}));
vi.mock("@/components/dashboard/A2pStatusCard", () => ({
  default: () => null,
}));
vi.mock("@/components/dashboard/CallForwardingNudge", () => ({
  default: () => null,
}));

import { BrandProvider } from "@/components/branding/BrandProvider";
import DashboardOverview from "./DashboardOverview";

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

const PARTNER_REQUEST_BRAND: RequestBrand = {
  ...DEFAULT_REQUEST_BRAND,
  source: "partner_host",
  brand: {
    ...DEFAULT_REQUEST_BRAND.brand,
    kind: "partner",
    partnerId: "11111111-1111-4111-8111-111111111111",
    slug: "alpha-dog",
    name: "Alpha Dog Agency",
  },
};

const a2pStatus = {
  brandStatus: null,
  brandStatusUpdatedAt: null,
  brandRejectionReason: null,
  campaignStatus: null,
  campaignStatusUpdatedAt: null,
  campaignRejectionReason: null,
  assignmentStatus: null,
  assignmentFailureReason: null,
  smsReady: false,
  smsBlockReason: null,
} as const;

function renderOverview(args: {
  requestBrand: RequestBrand;
  phoneNumber: string | null;
  billingMode?: "stripe" | "invoiced" | "comped";
  isPartnerManagedBilling?: boolean;
  stateValues?: unknown[];
}): string {
  mocks.stateIndex = 0;
  mocks.stateValues = args.stateValues ?? [];

  return renderToStaticMarkup(
    <BrandProvider requestBrand={args.requestBrand}>
      <DashboardOverview
        stats={{
          totalConversations: 0,
          activeConversations: 0,
          totalContacts: 0,
          messagesThisWeek: 0,
        }}
        recentConversations={[]}
        hotLeads={[]}
        phoneNumber={args.phoneNumber}
        a2pStatus={a2pStatus}
        showCallForwardingNudge={false}
        billingMode={args.billingMode ?? "stripe"}
        isPartnerManagedBilling={args.isPartnerManagedBilling}
      />
    </BrandProvider>
  );
}

describe("DashboardOverview visible brand copy", () => {
  it("preserves the default account name", () => {
    const html = renderOverview({
      requestBrand: DEFAULT_REQUEST_BRAND,
      phoneNumber: null,
    });

    expect(html).toContain("Your SimplAssist account");
  });

  it("uses the partner name in all three scoped dashboard references", () => {
    const missingNumberHtml = renderOverview({
      requestBrand: PARTNER_REQUEST_BRAND,
      phoneNumber: null,
    });
    const activeNumberHtml = renderOverview({
      requestBrand: PARTNER_REQUEST_BRAND,
      phoneNumber: "+13175550123",
    });
    const modalHtml = renderOverview({
      requestBrand: PARTNER_REQUEST_BRAND,
      phoneNumber: null,
      stateValues: [true, false],
    });

    expect(missingNumberHtml).toContain("Your Alpha Dog Agency account");
    expect(activeNumberHtml).toContain("Your Alpha Dog Agency Number");
    expect(modalHtml).toContain("set it up for Alpha Dog Agency.");
    expect(
      `${missingNumberHtml}${activeNumberHtml}${modalHtml}`
    ).not.toContain("SimplAssist");
  });
});

describe("DashboardOverview billing copy", () => {
  it("preserves the exact Billing link and subscription-management copy by default for direct Stripe billing", () => {
    const html = renderOverview({
      requestBrand: DEFAULT_REQUEST_BRAND,
      phoneNumber: null,
      billingMode: "stripe",
    });

    expect(html.match(/href="\/billing"/g)).toHaveLength(1);
    expect(html).toContain(">Billing</h4>");
    expect(html).toContain(
      "Manage your plan, payment method, and subscription details."
    );
    expect(html).not.toContain("partner-managed billing");
  });

  it.each(["invoiced", "comped"] as const)(
    "preserves the exact Billing link and existing copy for direct %s billing",
    (billingMode) => {
      const html = renderOverview({
        requestBrand: DEFAULT_REQUEST_BRAND,
        phoneNumber: null,
        billingMode,
        isPartnerManagedBilling: false,
      });

      expect(html.match(/href="\/billing"/g)).toHaveLength(1);
      expect(html).toContain(">Billing</h4>");
      expect(html).toContain("View your partner-managed billing details");
      expect(html).not.toContain(
        "Manage your plan, payment method, and subscription details."
      );
    }
  );

  it.each(["stripe", "invoiced", "comped"] as const)(
    "hides the whole Billing quick action for partner-managed %s billing",
    (billingMode) => {
      const html = renderOverview({
        requestBrand: PARTNER_REQUEST_BRAND,
        phoneNumber: null,
        billingMode,
        isPartnerManagedBilling: true,
      });

      expect(html).toContain('href="/conversations"');
      expect(html).toContain('href="/settings"');
      expect(html).not.toContain('href="/billing"');
      expect(html).not.toContain(">Billing</h4>");
      expect(html).not.toContain(
        "Manage your plan, payment method, and subscription details."
      );
      expect(html).not.toContain("View your partner-managed billing details");
    }
  );
});
