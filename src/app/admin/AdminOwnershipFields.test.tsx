import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AdminOwnershipFields,
  nextOwnershipFieldsState,
} from "./AdminOwnershipFields";

const PARTNER_ID = "9c3c5b98-bda7-48ea-a972-22c1ab4d2f71";

function renderFieldsHtml(
  initialOwnership: "direct" | "partner" | null,
  initialPartnerId: string | null = null,
): string {
  return renderToStaticMarkup(
    <AdminOwnershipFields
      controlClass="control"
      initialOwnership={initialOwnership}
      initialPartnerId={initialPartnerId}
      partners={[{ id: PARTNER_ID, name: "Agency One" }]}
    />,
  );
}

describe("AdminOwnershipFields", () => {
  it("preserves the current partner when Ownership remains Partner", () => {
    expect(
      nextOwnershipFieldsState(
        { ownership: "partner", partnerId: PARTNER_ID },
        "partner",
      ),
    ).toEqual({ ownership: "partner", partnerId: PARTNER_ID });
  });

  it.each(["direct", ""] as const)(
    "clears the current partner when Ownership changes to %s",
    (nextOwnership) => {
      expect(
        nextOwnershipFieldsState(
          { ownership: "partner", partnerId: PARTNER_ID },
          nextOwnership,
        ),
      ).toEqual({ ownership: nextOwnership, partnerId: "" });
    },
  );

  it("keeps the partner empty when Ownership returns to Partner", () => {
    const directState = nextOwnershipFieldsState(
      { ownership: "partner", partnerId: PARTNER_ID },
      "direct",
    );

    expect(nextOwnershipFieldsState(directState, "partner")).toEqual({
      ownership: "partner",
      partnerId: "",
    });
  });

  it.each([null, "direct"] as const)(
    "omits the partner control for %s ownership",
    (ownership) => {
      const html = renderFieldsHtml(ownership);

      expect(html).not.toContain('name="partner"');
      expect(html).not.toContain("Specific partner");
    },
  );

  it("shows and preserves the parsed partner selection for Partner ownership", () => {
    const html = renderFieldsHtml("partner", PARTNER_ID);

    expect(html).toContain('name="partner"');
    expect(html).toContain("Specific partner");
    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Agency One</option>`,
    );
  });

  it("renders the SimplAssist Direct ownership label", () => {
    const html = renderFieldsHtml(null);

    expect(html).toContain(
      '<option value="direct">SimplAssist Direct</option>',
    );
    expect(html).not.toContain('<option value="direct">Direct</option>');
  });
});
