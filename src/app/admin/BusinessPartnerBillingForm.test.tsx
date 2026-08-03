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
    expect(html).toContain("Unassigned");
    expect(html).toContain("Partner invoiced");
    expect(html).toContain("Partner comped");
    expect(html).toContain(
      "Non-Stripe assignment is refused while any subscription row exists"
    );
    expect(html).toContain(
      "Returning to Stripe removes the temporary comp bridge"
    );
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
});
