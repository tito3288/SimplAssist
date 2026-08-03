import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { BusinessPartnerBillingForm } from "./BusinessPartnerBillingForm";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const PARTNER_ID = "00000000-0000-4000-8000-000000000456";

describe("BusinessPartnerBillingForm", () => {
  it("shows current assignment, active choices, modes, and both transition warnings", () => {
    const html = renderToStaticMarkup(
      <BusinessPartnerBillingForm
        businessId={BUSINESS_ID}
        initialPartnerId={PARTNER_ID}
        initialBillingMode="invoiced"
        initialPartnerPlan="full"
        currentPartner={{
          id: PARTNER_ID,
          name: "Alpha Dog Agency",
          status: "active",
        }}
        activePartners={[
          { id: PARTNER_ID, name: "Alpha Dog Agency" },
          {
            id: "00000000-0000-4000-8000-000000000457",
            name: "Beta Partner",
          },
        ]}
      />
    );

    expect(html).toContain("Current partner");
    expect(html).toContain("Alpha Dog Agency");
    expect(html).toContain("Current billing mode");
    expect(html).toContain("invoiced");
    expect(html).toContain("Current partner plan");
    expect(html).toMatch(
      /Current partner plan<\/dt><dd class="text-right">Full<\/dd>/
    );
    expect(html).toContain("Unassigned");
    expect(html).toContain("Partner invoiced");
    expect(html).toContain("Partner comped");
    expect(html).toContain("Starter — 500 included SMS parts");
    expect(html).toContain("Growth — 1,500 included SMS parts");
    expect(html).toContain("Full — 2,500 included SMS parts");
    expect(html).toContain("New partner assignments default to Growth.");
    expect(html).toContain(
      "Partner plans use the same feature matrix and included SMS allowances as Stripe plans."
    );
    expect(html).toContain(
      "Non-Stripe assignment is refused while any subscription row exists"
    );
    expect(html).toContain("Returning to Stripe clears the partner plan.");
    expect(html).toContain(
      "The business will require checkout before access continues."
    );
  });

  it("shows an inactive current assignment but does not offer it as active", () => {
    const html = renderToStaticMarkup(
      <BusinessPartnerBillingForm
        businessId={BUSINESS_ID}
        initialPartnerId={PARTNER_ID}
        initialBillingMode="comped"
        initialPartnerPlan="sms_only"
        currentPartner={{
          id: PARTNER_ID,
          name: "Retired Partner",
          status: "inactive",
        }}
        activePartners={[]}
      />
    );

    expect(html).toContain("Retired Partner (inactive)");
    expect(html).toMatch(
      /<option value="00000000-0000-4000-8000-000000000456" disabled="" selected="">Retired Partner \(inactive\)<\/option>/
    );
  });

  it("distinguishes a missing assigned row from an unassigned business", () => {
    const html = renderToStaticMarkup(
      <BusinessPartnerBillingForm
        businessId={BUSINESS_ID}
        initialPartnerId={PARTNER_ID}
        initialBillingMode="invoiced"
        initialPartnerPlan="sms_and_chat"
        currentPartner={{
          id: PARTNER_ID,
          name: "Assigned partner",
          status: "unavailable",
        }}
        activePartners={[]}
      />
    );

    expect(html).toContain("Assigned partner unavailable");
    expect(html).not.toContain("Current partner</dt><dd class=\"text-right\">Unassigned");
  });

  it("shows Stripe businesses as not partner-managed and defaults the disabled selector to Growth", () => {
    const html = renderToStaticMarkup(
      <BusinessPartnerBillingForm
        businessId={BUSINESS_ID}
        initialPartnerId={null}
        initialBillingMode="stripe"
        initialPartnerPlan={null}
        currentPartner={null}
        activePartners={[]}
      />
    );

    expect(html).toMatch(
      /Current partner plan<\/dt><dd class="text-right">Not partner-managed<\/dd>/
    );
    expect(html).toMatch(
      /<select[^>]*disabled=""[^>]*><option value="sms_only">Starter — 500 included SMS parts<\/option><option value="sms_and_chat" selected="">Growth — 1,500 included SMS parts<\/option>/
    );
  });
});
