import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SETTINGS_FILES = [
  "../../components/settings/AISettingsForm.tsx",
  "../../components/settings/BusinessEmailForm.tsx",
  "../../components/settings/BusinessHoursEditor.tsx",
  "../../components/settings/BusinessInfoEditor.tsx",
  "../../components/settings/CallForwardingForm.tsx",
  "../../components/settings/CompliancePanel.tsx",
  "../../components/settings/DeleteAccountModal.tsx",
  "../../components/settings/FAQManager.tsx",
  "../../components/settings/ServicesManager.tsx",
  "../../components/settings/TimezoneSelector.tsx",
  "../../components/widget/WidgetConfigForm.tsx",
] as const;

const COMPLIANCE_FILE = "../../components/settings/CompliancePanel.tsx";
const WIDGET_CONFIG_FILE = "../../components/widget/WidgetConfigForm.tsx";
const WIDGET_ORANGE_PRESET =
  /\{\s*name:\s*["']Orange["'],\s*value:\s*["']#F97316["']\s*\}/g;

const DIRECT_BRAND_COLOR =
  /#(?:fff7ed|ffedd5|fed7aa|fdba74|fb923c|f97316|ea580c|c2410c|9a3412|7c2d12|431407|ff8c42|ff914d|f57f33|e8752c|ffb07a|ffd7bf|ffd5bc|fdf1e7|f5dcc4|fbe6d4|fbe7d4|291b13|e4a677|fffaf5|fff7ef|efc5a3|e9ad7b|f0e2d0|fdf3ea|e6cdb0|e8a878)(?:[0-9a-f]{2})?\b/i;
const DIRECT_BRAND_RGB =
  /rgba?\(\s*(?:234(?:\s*,\s*|\s+)88(?:\s*,\s*|\s+)12|194(?:\s*,\s*|\s+)65(?:\s*,\s*|\s+)12|154(?:\s*,\s*|\s+)52(?:\s*,\s*|\s+)18|255(?:\s*,\s*|\s+)145(?:\s*,\s*|\s+)77|249(?:\s*,\s*|\s+)115(?:\s*,\s*|\s+)22)\b/i;

function source(relativePath: (typeof SETTINGS_FILES)[number]): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function withoutAllowedFunctionalColor(
  relativePath: (typeof SETTINGS_FILES)[number],
  fileSource: string,
): string {
  return relativePath === WIDGET_CONFIG_FILE
    ? fileSource.replace(WIDGET_ORANGE_PRESET, "")
    : fileSource;
}

describe("Phase 2 Diff 8 settings theme inventory", () => {
  it.each([
    "#f97316",
    "#ff914d1a",
    "rgba(234,88,12,.25)",
    "rgb(255 145 77 / .30)",
    "rgb(194 65 12)",
  ])("recognizes direct settings brand-color syntax %s", (directColor) => {
    expect(
      DIRECT_BRAND_COLOR.test(directColor) || DIRECT_BRAND_RGB.test(directColor),
    ).toBe(true);
  });

  it.each(SETTINGS_FILES)(
    "uses runtime brand tokens instead of direct presentation colors in %s",
    (relativePath) => {
      const fileSource = withoutAllowedFunctionalColor(
        relativePath,
        source(relativePath),
      );

      expect(fileSource).not.toMatch(/\borange-[0-9]{2,3}\b/i);
      expect(fileSource).not.toMatch(DIRECT_BRAND_COLOR);
      expect(fileSource).not.toMatch(DIRECT_BRAND_RGB);
    },
  );

  it("preserves exactly one functional Orange widget-color preset", () => {
    const widgetSource = source(WIDGET_CONFIG_FILE);

    expect(widgetSource.match(WIDGET_ORANGE_PRESET)).toHaveLength(1);
  });

  it.each(
    SETTINGS_FILES.filter((relativePath) => relativePath !== COMPLIANCE_FILE),
  )("does not hardcode ordinary SimplAssist UI copy in %s", (relativePath) => {
    expect(source(relativePath)).not.toContain("SimplAssist");
  });

  it("preserves only the approved SimplAssist-hosted compliance identity", () => {
    const complianceSource = source(COMPLIANCE_FILE);

    expect(complianceSource).toContain('title="SimplAssist-hosted (default)"');
    expect(complianceSource).toContain(
      "We generate and host your privacy policy and terms at SimplAssist URLs.",
    );
    expect(complianceSource.match(/SimplAssist/g)).toHaveLength(2);
  });
});
