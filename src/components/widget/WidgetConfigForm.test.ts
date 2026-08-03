import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./WidgetConfigForm.tsx", import.meta.url),
  "utf8",
);
const ORANGE_PRESET = "{ name: 'Orange', value: '#F97316' },";
const DIRECT_BRAND_COLOR =
  /#(?:fff7ed|ffedd5|fed7aa|fdba74|fb923c|f97316|ea580c|c2410c|9a3412|7c2d12|431407|ff8c42|ff914d|f57f33|e8752c|ffb07a|ffd7bf|ffd5bc|fdf1e7|f5dcc4|fbe6d4|fbe7d4|291b13|e4a677|fffaf5|fff7ef|efc5a3|e9ad7b|f0e2d0|fdf3ea|e6cdb0|e8a878)(?:[0-9a-f]{2})?\b/i;
const DIRECT_BRAND_RGB =
  /rgba?\(\s*(?:234(?:\s*,\s*|\s+)88(?:\s*,\s*|\s+)12|194(?:\s*,\s*|\s+)65(?:\s*,\s*|\s+)12|154(?:\s*,\s*|\s+)52(?:\s*,\s*|\s+)18|255(?:\s*,\s*|\s+)145(?:\s*,\s*|\s+)77|249(?:\s*,\s*|\s+)115(?:\s*,\s*|\s+)22)\b/i;

describe("WidgetConfigForm Phase 2 branding", () => {
  it("preserves the exact user-selectable orange preset and no other direct brand orange", () => {
    expect(source.match(new RegExp(ORANGE_PRESET.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);

    const chromeSource = source.replace(ORANGE_PRESET, "");
    expect(chromeSource).not.toMatch(/\borange-[0-9]{2,3}\b/i);
    expect(chromeSource).not.toMatch(DIRECT_BRAND_COLOR);
    expect(chromeSource).not.toMatch(DIRECT_BRAND_RGB);
  });

  it("uses static request-brand tokens for action, focus, and selection chrome", () => {
    expect(source).toContain("border-[var(--brand-primary)]");
    expect(source).toContain("ring-[rgb(var(--brand-primary-rgb)/.25)]");
    expect(source).toContain("bg-[var(--brand-accent-soft)]");
    expect(source).toContain("text-[var(--brand-accent)]");
    expect(source).toContain("bg-[var(--brand-primary)]");
    expect(source).toContain("hover:bg-[var(--brand-primary-hover)]");
    expect(source).toContain("active:bg-[var(--brand-primary-active)]");
    expect(source).toContain("dark:bg-[var(--brand-primary-dark)]");
    expect(source).toContain("dark:hover:bg-[var(--brand-primary-hover-dark)]");
  });

  it("keeps widget-selected colors and semantic success/error colors independent", () => {
    expect(source).toContain("style={{ backgroundColor: brandColor }}");
    expect(source).toContain("style={{ backgroundColor: color.value }}");
    expect(source).toContain("isActive ? statusSuccess : statusWarning");
    expect(source).toContain("isActive ? 'bg-green-500'");
    expect(source).toContain("text-red-600 dark:text-red-400");
  });

  it("does not add host-dependent embed or attribution behavior", () => {
    expect(source).not.toContain("scriptOrigin");
    expect(source).not.toContain("/widget/embed.js");
    expect(source).not.toContain("poweredBy");
    expect(source).not.toContain("X-Forwarded-Host");
    expect(source).not.toContain("SimplAssist");
  });
});
