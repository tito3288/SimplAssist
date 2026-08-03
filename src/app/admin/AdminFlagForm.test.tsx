import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AdminFlagForm } from "./AdminFlagForm";

const initial = {
  billing_pilot: true,
  billing_comped: true,
  billing_exempt: true,
  telnyx_submission_disabled: false,
  sms_overage_opt_in: true,
  billing_admin_notes: null,
};

function renderForm(billingMode: "stripe" | "invoiced" | "comped") {
  return renderToStaticMarkup(
    <AdminFlagForm
      businessId="00000000-0000-4000-8000-000000000123"
      billingMode={billingMode}
      initial={initial}
    />
  );
}

describe("AdminFlagForm native partner-billing protection", () => {
  it.each(["invoiced", "comped"] as const)(
    "disables every legacy entitlement control in %s mode",
    (billingMode) => {
      const html = renderForm(billingMode);

      for (const label of [
        "Pilot",
        "Comped",
        "Billing exempt",
        "Overage opt-in",
      ]) {
        expect(html).toMatch(
          new RegExp(
            `<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*\\/>${label}`
          )
        );
      }
      expect(html).not.toMatch(
        /<input(?=[^>]*type="checkbox")(?=[^>]*disabled="")[^>]*\/>No Telnyx submit/
      );
      expect(html).toContain("Partner billing owns Pilot, Comped");
      expect(html).toContain(
        "Its selected plan controls entitlements and the SMS allowance."
      );
    }
  );

  it("keeps all legacy controls editable in Stripe mode", () => {
    const html = renderForm("stripe");

    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("Partner billing owns Pilot, Comped");
  });
});
