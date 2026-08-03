import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import {
  deriveEmailFromDisplayState,
  PartnerForm,
  type AdminPartnerView,
} from "./PartnerForm";

const partner: AdminPartnerView = {
  id: "10000000-0000-4000-a000-000000000043",
  name: "Alpha Dog Agency",
  slug: "alpha-dog",
  customDomain: "app.alphadogagency.ai",
  domainStatus: "connected",
  logoLightUrl: "https://assets.example.com/logo-light.png",
  logoDarkUrl: "https://assets.example.com/logo-dark.png",
  faviconUrl: "https://assets.example.com/favicon.png",
  emailFrom: "notifications@alphadogagency.ai",
  emailFromStatus: "pending",
  emailFromVerifiedAt: null,
  emailFromVerifiedBy: null,
  status: "active",
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
  createdAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
};

describe("PartnerForm", () => {
  it("does not present stale verification while a saved sender edit is pending", () => {
    expect(
      deriveEmailFromDisplayState(
        "new@alphadogagency.ai",
        "notifications@alphadogagency.ai",
        "verified",
      ),
    ).toMatchObject({
      displayedStatus: "pending",
      hasUnsavedChanges: true,
      showPersistedAudit: false,
    });
    expect(
      deriveEmailFromDisplayState(
        "   ",
        "notifications@alphadogagency.ai",
        "verified",
      ),
    ).toMatchObject({
      displayedStatus: "unconfigured",
      hasUnsavedChanges: true,
      showPersistedAudit: false,
    });
  });

  it("renders the complete create profile with pending enforced by the server contract", () => {
    const html = renderToStaticMarkup(<PartnerForm mode="create" />);

    expect(html).toContain("Create partner");
    expect(html).toContain("New partners always start with a Pending domain.");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="slug"');
    expect(html).toContain('name="customDomain"');
    expect(html).toContain('name="status"');
    expect(html).toContain('name="logoLightUrl"');
    expect(html).toContain('name="logoDarkUrl"');
    expect(html).toContain('name="faviconUrl"');
    expect(html.match(/name="colors\.[^"]+"/g)).toHaveLength(8);
    expect(html).not.toContain("Mark Connected");
    expect(html).not.toContain('name="domainStatus"');
    expect(html.toLowerCase()).not.toContain("delete");
    expect(html).toContain('name="emailFrom"');
    expect(html).toContain("Unconfigured");
    expect(html).not.toContain("Mark verified");
  });

  it("renders validated edit values and distinct profile/domain actions", () => {
    const html = renderToStaticMarkup(
      <PartnerForm mode="edit" partner={partner} />,
    );

    expect(html).toContain("Alpha Dog Agency");
    expect(html).toContain("alpha-dog");
    expect(html).toContain("app.alphadogagency.ai");
    expect(html).toContain("Save profile");
    expect(html).toContain("Mark Pending");
    expect(html).toContain("Mark Connected");
    expect(html).toContain("Current status: Connected");
    expect(html).toContain("notifications@alphadogagency.ai");
    expect(html).toContain("Pending");
    expect(html).toContain("Mark verified");
    expect(html.toLowerCase()).not.toContain("delete");
  });

  it("does not enable Connected when the stored partner has no domain", () => {
    const html = renderToStaticMarkup(
      <PartnerForm
        mode="edit"
        partner={{ ...partner, customDomain: null, domainStatus: "pending" }}
      />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Mark Connected<\/button>/);
  });

  it("disables sender verification without a saved address or after verification", () => {
    const unconfigured = renderToStaticMarkup(
      <PartnerForm
        mode="edit"
        partner={{
          ...partner,
          emailFrom: null,
          emailFromStatus: "unconfigured",
        }}
      />,
    );
    const verified = renderToStaticMarkup(
      <PartnerForm
        mode="edit"
        partner={{
          ...partner,
          emailFromStatus: "verified",
          emailFromVerifiedAt: "2026-08-03T02:00:00.000Z",
          emailFromVerifiedBy: "10000000-0000-4000-a000-000000000099",
        }}
      />,
    );

    expect(unconfigured).toMatch(
      /<button[^>]*disabled=""[^>]*>Mark verified<\/button>/,
    );
    expect(verified).toContain("Verified");
    expect(verified).toMatch(
      /<button[^>]*disabled=""[^>]*>Mark verified<\/button>/,
    );
  });
});
