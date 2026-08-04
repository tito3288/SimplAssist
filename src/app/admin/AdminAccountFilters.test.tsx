import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminAccountFilters } from "./AdminAccountFilters";

const PARTNER_ID = "9c3c5b98-bda7-48ea-a972-22c1ab4d2f71";
const INACTIVE_PARTNER_ID = "5cb75e6c-1262-4850-a381-7aaac51cb911";

describe("AdminAccountFilters", () => {
  it("renders a native GET form with every supported filter", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: null,
          ownership: null,
          partnerId: null,
          plan: null,
          query: null,
        }}
        partners={[]}
      />,
    );

    expect(html).toContain(
      '<form action="/admin" method="get" aria-label="Filter accounts"',
    );
    expect(html).toContain('name="lifecycle"');
    expect(html).toContain('name="ownership"');
    expect(html).toContain('name="partner"');
    expect(html).toContain('name="plan"');
    expect(html).toContain('type="search" name="q"');
    expect(html).toContain('pattern="\\s*[\\s\\S]{0,100}\\s*"');
    expect(html).not.toContain("maxLength=");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Apply filters");
    expect(html).toContain("Clear filters");
    expect(html).toContain(
      "Filters combine to narrow the newest 75 accounts.",
    );
  });

  it("offers only the specified lifecycle, ownership, and plan predicates", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: null,
          ownership: null,
          partnerId: null,
          plan: null,
          query: null,
        }}
        partners={[]}
      />,
    );

    for (const value of [
      "live",
      "onboarding",
      "past_due",
      "pending_deletion",
      "failed_setup",
      "direct",
      "partner",
      "sms_only",
      "sms_and_chat",
      "full",
    ]) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).not.toContain('value="terminal"');
    expect(html).not.toContain('value="suspended"');
  });

  it("preserves parsed selections and escaped search text in the form", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: "failed_setup",
          ownership: "partner",
          partnerId: PARTNER_ID,
          plan: "full",
          query: "Dental &amp; Co",
        }}
        partners={[{ id: PARTNER_ID, name: "Agency One" }]}
      />,
    );

    expect(html).toMatch(
      /<option value="failed_setup" selected="">Failed setup<\/option>/,
    );
    expect(html).toMatch(
      /<option value="partner" selected="">Partner<\/option>/,
    );
    expect(html).toMatch(
      new RegExp(`<option value="${PARTNER_ID}" selected="">Agency One</option>`),
    );
    expect(html).toMatch(/<option value="full" selected="">Full<\/option>/);
    expect(html).toContain('value="Dental &amp;amp; Co"');
  });

  it("includes supplied partners regardless of status and explains ownership coupling", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: null,
          ownership: "partner",
          partnerId: INACTIVE_PARTNER_ID,
          plan: null,
          query: null,
        }}
        partners={[
          { id: PARTNER_ID, name: "Active Agency" },
          {
            id: INACTIVE_PARTNER_ID,
            name: "Retired Agency",
          },
        ]}
      />,
    );

    expect(html).toContain("Active Agency");
    expect(html).toContain("Retired Agency");
    expect(html).toContain("Applied only when ownership is Partner.");
    expect(html).toContain(
      `<option value="${INACTIVE_PARTNER_ID}" selected="">Retired Agency</option>`,
    );
  });

  it("preserves a valid selected partner even if its option becomes unavailable", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: null,
          ownership: "partner",
          partnerId: PARTNER_ID,
          plan: null,
          query: null,
        }}
        partners={[]}
      />,
    );

    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Selected partner unavailable</option>`,
    );
  });
});
