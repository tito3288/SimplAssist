import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BrandProvider } from "@/components/branding/BrandProvider";
import type { RequestBrand } from "@/lib/branding/types";
import BusinessInfoEditor from "./BusinessInfoEditor";
import CallForwardingForm, {
  presentCallForwardingError,
} from "./CallForwardingForm";
import { BUSINESS_ADDRESS_LOCK_COPY } from "@/lib/settings/registrationLockCopy";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

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

function renderSettingsCopy(
  name: string,
  registrationLocked = false
): string {
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
      <BusinessInfoEditor
        registrationLocked={registrationLocked}
        initialPhoneNumber={null}
        initialAddress={null}
        initialCity={null}
        initialState={null}
        initialZip={null}
      />
      <CallForwardingForm
        initialEnabled={false}
        initialForwardToNumber="+13175550123"
        smsPhoneNumber="+13175550123"
      />
    </BrandProvider>
  );
}

describe("settings editor visible brand copy", () => {
  const stableServerError =
    "Forward-to number cannot be your SimplAssist number";

  it("preserves both exact SimplAssist defaults", () => {
    const html = renderSettingsCopy("SimplAssist");

    expect(html).toContain("from your SimplAssist texting number.");
    expect(html).toContain(
      "Forward-to number cannot be your SimplAssist number"
    );
    expect(
      presentCallForwardingError(stableServerError, "SimplAssist")
    ).toBe(stableServerError);
  });

  it("uses the request partner in both ordinary phone-number messages", () => {
    const html = renderSettingsCopy("Alpha Dog Agency");

    expect(html).toContain("from your Alpha Dog Agency texting number.");
    expect(html).toContain(
      "Forward-to number cannot be your Alpha Dog Agency number"
    );
    expect(html).not.toContain("SimplAssist");
    expect(
      presentCallForwardingError(stableServerError, "Alpha Dog Agency")
    ).toBe("Forward-to number cannot be your Alpha Dog Agency number");
  });

  it("keeps contact phone editable while locking the filed address fields", () => {
    const html = renderSettingsCopy("SimplAssist", true);
    const visibleText = html.replace(/<[^>]+>/g, "");
    const phoneInput = html.match(
      /<input id="business-contact-phone"[^>]*>/
    )?.[0];

    expect(phoneInput).toBeDefined();
    expect(phoneInput).not.toMatch(/\sdisabled=/);
    expect(html).toContain(
      '<fieldset disabled="" aria-describedby="business-address-registration-lock"'
    );
    expect(visibleText).toContain(BUSINESS_ADDRESS_LOCK_COPY.message);
    expect(html).toContain('href="/support?category=number_registration"');
    expect(visibleText).toContain("Business Contact Phone");
    expect(visibleText).toContain("Business Address");
    expect(visibleText).toContain("Save Contact Phone");
    expect(visibleText).not.toContain("Save Contact &amp; Address");
  });

  it("leaves the complete address editor available before registration", () => {
    const html = renderSettingsCopy("SimplAssist");

    expect(html).not.toContain("<fieldset disabled");
    expect(html).not.toContain(BUSINESS_ADDRESS_LOCK_COPY.supportText);
    expect(html).toContain("Save Contact &amp; Address");
    expect(html).toContain(
      "Enter a complete address, or leave all address fields blank."
    );
  });
});
