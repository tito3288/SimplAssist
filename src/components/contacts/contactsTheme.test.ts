import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONTACT_COMPONENTS = [
  "./ContactDetail.tsx",
  "./ContactStats.tsx",
  "./ContactsTable.tsx",
] as const;

const DIRECT_BRAND_COLOR =
  /#(?:f97316|ea580c|c2410c|9a3412|ff914d|f57f33|e8752c|ffb07a|fdf1e7)\b|rgba?\(\s*(?:234\s*,\s*88\s*,\s*12|194\s*,\s*65\s*,\s*12|154\s*,\s*52\s*,\s*18|255\s*,\s*145\s*,\s*77|249\s*,\s*115\s*,\s*22)/i;

describe("Contacts Phase 2 branding", () => {
  it.each(CONTACT_COMPONENTS)(
    "uses runtime brand tokens instead of direct orange in %s",
    (relativePath) => {
      const source = readFileSync(
        new URL(relativePath, import.meta.url),
        "utf8",
      );

      expect(source).not.toMatch(/\borange-[0-9]{2,3}\b/i);
      expect(source).not.toMatch(DIRECT_BRAND_COLOR);
    },
  );

  it("brands stat and channel icons through the accent tokens", () => {
    const stats = readFileSync(
      new URL("./ContactStats.tsx", import.meta.url),
      "utf8",
    );
    const table = readFileSync(
      new URL("./ContactsTable.tsx", import.meta.url),
      "utf8",
    );

    expect(stats).toContain(
      "text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]",
    );
    expect(table).toContain(
      "text-[var(--brand-accent)] dark:text-[var(--brand-accent-dark)]",
    );
  });

  it("brands selected filters, focus rings, and conversation hover states", () => {
    const table = readFileSync(
      new URL("./ContactsTable.tsx", import.meta.url),
      "utf8",
    );
    const detail = readFileSync(
      new URL("./ContactDetail.tsx", import.meta.url),
      "utf8",
    );

    expect(table).toContain("bg-[var(--brand-primary)]");
    expect(table).toContain("focus:ring-[rgb(var(--brand-primary-rgb)/.25)]");
    expect(detail).toContain("hover:bg-[var(--brand-accent-soft)]");
    expect(detail).toContain(
      "dark:hover:bg-[rgb(var(--brand-primary-dark-rgb)/.08)]",
    );
  });
});
