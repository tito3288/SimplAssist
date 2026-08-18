import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdminAccountFilters } from "./AdminAccountFilters";

const PARTNER_ID = "9c3c5b98-bda7-48ea-a972-22c1ab4d2f71";
const INACTIVE_PARTNER_ID = "5cb75e6c-1262-4850-a381-7aaac51cb911";

describe("AdminAccountFilters", () => {
  it("uses document navigation for Clear and renders cleared defaults", () => {
    const source = readFileSync(
      new URL("./AdminAccountFilters.tsx", import.meta.url),
      "utf8",
    );
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
        visibleCount={0}
      />,
    );

    expect(source).not.toContain('from "next/link"');
    expect(source).toContain('href="/admin"');
    expect(html).toMatch(
      /<option value="" selected="">All account states<\/option>/,
    );
    expect(html).toMatch(
      /<option value="" selected="">All ownership<\/option>/,
    );
    expect(html).not.toContain('name="partner"');
    expect(html).not.toContain("Specific partner");
    expect(html).toMatch(/<option value="" selected="">All plans<\/option>/);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*value=""/);
    expect(html).toContain("No filters applied");
  });

  it("renders a search-first native GET form with every always-visible filter", () => {
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
        visibleCount={12}
      />,
    );

    expect(html).toContain(
      '<form action="/admin" method="get" aria-label="Filter accounts"',
    );
    expect(html).toContain('name="lifecycle"');
    expect(html).toContain("Account state");
    expect(html).toContain("All account states");
    expect(html).toContain('name="ownership"');
    expect(html).not.toContain('name="partner"');
    expect(html).toContain('name="plan"');
    expect(html).toContain('type="search" name="q"');
    expect(html).toContain(
      'placeholder="Search by business name or contact email"',
    );
    expect(html).toContain('pattern="\\s*[\\s\\S]{0,100}\\s*"');
    expect(html).not.toContain("maxLength=");
    expect(html).toContain('href="/admin"');
    expect(html).toContain("Find accounts");
    expect(html).toContain("12</span> visible accounts");
    expect(html.indexOf("Search")).toBeLessThan(html.indexOf("Account state"));
    expect(html).toContain("Apply filters");
    expect(html).toContain("Clear all");
    expect(html).toContain("Filters combine to narrow the newest 75 accounts.");
  });

  it("offers only the specified account-state, ownership, and plan predicates", () => {
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
        visibleCount={0}
      />,
    );

    for (const value of [
      "live",
      "onboarding",
      "past_due",
      "suspended",
      "pending_deletion",
      "failed_setup",
      "direct",
      "partner",
      "chat_only",
      "sms_only",
      "sms_and_chat",
      "full",
    ]) {
      expect(html).toContain(`value="${value}"`);
    }
    expect(html).not.toContain('value="terminal"');
    expect(html).toContain(
      '<option value="direct">SimplAssist Direct</option>',
    );
    expect(html).not.toContain('<option value="direct">Direct</option>');
  });

  it("preserves the suspended account-state selection", () => {
    const html = renderToStaticMarkup(
      <AdminAccountFilters
        filters={{
          lifecycle: "suspended",
          ownership: null,
          partnerId: null,
          plan: null,
          query: null,
        }}
        partners={[]}
        visibleCount={1}
      />,
    );

    expect(html).toMatch(
      /<option value="suspended" selected="">Suspended<\/option>/,
    );
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
        visibleCount={1}
      />,
    );

    expect(html).toMatch(
      /<option value="failed_setup" selected="">Failed setup<\/option>/,
    );
    expect(html).toMatch(
      /<option value="partner" selected="">Partner<\/option>/,
    );
    expect(html).toContain("Specific partner");
    expect(html).toContain('name="partner"');
    expect(html).toMatch(
      new RegExp(
        `<option value="${PARTNER_ID}" selected="">Agency One</option>`,
      ),
    );
    expect(html).toMatch(/<option value="full" selected="">Full<\/option>/);
    expect(html).toContain('value="Dental &amp;amp; Co"');
    expect(html).toContain("Active:");
    expect(html).toContain("Failed setup");
    expect(html).toContain("Partner: Agency One");
    expect(html).toContain("Search: “Dental &amp;amp; Co”");
    expect(html).toContain('aria-label="Remove Failed setup filter"');
    expect(html).toContain('aria-label="Remove Partner: Agency One filter"');
    expect(html).toContain('aria-label="Remove Full filter"');
    expect(html).toContain(
      'aria-label="Remove Search: “Dental &amp;amp; Co” filter"',
    );
    expect(html).toContain(
      `href="/admin?ownership=partner&amp;partner=${PARTNER_ID}&amp;plan=full&amp;q=Dental+%26amp%3B+Co"`,
    );
    expect(html).toContain(
      'href="/admin?lifecycle=failed_setup&amp;plan=full&amp;q=Dental+%26amp%3B+Co"',
    );
  });

  it("includes supplied partners regardless of status without redundant ownership copy", () => {
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
        visibleCount={1}
      />,
    );

    expect(html).toContain("Active Agency");
    expect(html).toContain("Retired Agency");
    expect(html).not.toContain("Applied only when ownership is Partner.");
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
        visibleCount={1}
      />,
    );

    expect(html).toContain(
      `<option value="${PARTNER_ID}" selected="">Selected partner unavailable</option>`,
    );
  });
});
