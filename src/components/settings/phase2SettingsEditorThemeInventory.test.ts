import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONVERTED_FILES = [
  "./AISettingsForm.tsx",
  "./BusinessEmailForm.tsx",
  "./BusinessHoursEditor.tsx",
  "./BusinessInfoEditor.tsx",
  "./CallForwardingForm.tsx",
  "./TimezoneSelector.tsx",
] as const;

const DIRECT_BRAND_COLOR =
  /#(?:fff7ed|ffedd5|fed7aa|fdba74|fb923c|f97316|ea580c|c2410c|9a3412|7c2d12|431407|ff8c42|ff914d|f57f33|e8752c|ffb07a|ffd7bf|ffd5bc|fdf1e7|f5dcc4|fbe6d4|fbe7d4|291b13|e4a677|fffaf5|fff7ef|efc5a3|e9ad7b|f0e2d0|fdf3ea|e6cdb0|e8a878)(?:[0-9a-f]{2})?\b/i;
const DIRECT_BRAND_RGB =
  /rgba?\(\s*(?:234(?:\s*,\s*|\s+)88(?:\s*,\s*|\s+)12|194(?:\s*,\s*|\s+)65(?:\s*,\s*|\s+)12|154(?:\s*,\s*|\s+)52(?:\s*,\s*|\s+)18|255(?:\s*,\s*|\s+)145(?:\s*,\s*|\s+)77|249(?:\s*,\s*|\s+)115(?:\s*,\s*|\s+)22)\b/i;

describe("Phase 2 Diff 8 settings editor inventory", () => {
  it("maps the call-forwarding icon tile to the exact primary-alt support tokens", () => {
    const source = readFileSync(
      new URL("./CallForwardingForm.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("bg-[var(--brand-primary-alt-wash)]");
    expect(source).toContain(
      "dark:bg-[rgb(var(--brand-primary-alt-rgb)/.10)]",
    );
  });

  it.each(CONVERTED_FILES)(
    "uses runtime variables instead of direct brand colors in %s",
    (relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

      expect(source).not.toMatch(/\borange-[0-9]{2,3}\b/i);
      expect(source).not.toMatch(DIRECT_BRAND_COLOR);
      expect(source).not.toMatch(DIRECT_BRAND_RGB);
    }
  );

  it.each(CONVERTED_FILES)(
    "does not hardcode ordinary SimplAssist copy in %s",
    (relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

      expect(source).not.toContain("SimplAssist");
    }
  );
});
