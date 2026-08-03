import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { AdminFlagForm } from "./AdminFlagForm";

const initial = {
  billing_pilot: false,
  billing_comped: true,
  billing_exempt: false,
  telnyx_submission_disabled: false,
  sms_overage_opt_in: false,
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

describe("AdminFlagForm partner bridge protection", () => {
  it.each(["invoiced", "comped"] as const)(
    "disables Comped and explains partner ownership in %s mode",
    (billingMode) => {
      const html = renderForm(billingMode);

      expect(html).toMatch(
        /<input(?=[^>]*type="checkbox")(?=[^>]*checked="")(?=[^>]*disabled="")[^>]*\/>Comped/
      );
      expect(html).toContain(
        "Partner billing owns the temporary Comped flag."
      );
      expect(html).toContain(
        "Return the business to Stripe mode before changing it manually."
      );
    }
  );

  it("keeps Comped editable in Stripe mode", () => {
    const html = renderForm("stripe");

    expect(html).not.toMatch(
      /<input(?=[^>]*type="checkbox")(?=[^>]*checked="")(?=[^>]*disabled="")[^>]*\/>Comped/
    );
    expect(html).not.toContain(
      "Partner billing owns the temporary Comped flag."
    );
  });
});
