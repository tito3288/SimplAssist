import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const CONVERTED_UI_FILES = [
  "../../app/(auth)/signup/page.tsx",
  "../../app/(onboarding)/onboarding/page.tsx",
  "../../app/(public)/support/page.tsx",
  "../../components/auth/auth-password-field.tsx",
  "../../components/onboarding/AIPersonalityForm.tsx",
  "../../components/onboarding/BrandVerificationForm.tsx",
  "../../components/onboarding/BusinessHoursForm.tsx",
  "../../components/onboarding/BusinessInfoForm.tsx",
  "../../components/onboarding/DirectPlanSelection.tsx",
  "../../components/onboarding/PlanSelectionOption.tsx",
  "../../components/onboarding/ReviewAndLaunch.tsx",
  "../../components/onboarding/ServicesAndFaqsForm.tsx",
  "../../components/onboarding/SmsUseCaseForm.tsx",
  "../../components/onboarding/StepProgress.tsx",
  "../../components/phone/PhoneNumberSelector.tsx",
  "../../components/ui/pulsing-dot.tsx",
  "../theme-v2/ui.tsx",
] as const;

const DIRECT_BRAND_COLOR =
  /#(?:fff7ed|ffedd5|fed7aa|fdba74|fb923c|f97316|ea580c|c2410c|9a3412|7c2d12|431407|ff8c42|ff914d|f57f33|e8752c|ffb07a|ffd7bf|ffd5bc|fdf1e7|f5dcc4|fbe6d4|fbe7d4|291b13|e4a677|fffaf5|fff7ef|efc5a3|e9ad7b|f0e2d0|fdf3ea|e6cdb0|e8a878)(?:[0-9a-f]{2})?\b/i;
const DIRECT_BRAND_RGB =
  /rgba?\(\s*(?:234(?:\s*,\s*|\s+)88(?:\s*,\s*|\s+)12|194(?:\s*,\s*|\s+)65(?:\s*,\s*|\s+)12|154(?:\s*,\s*|\s+)52(?:\s*,\s*|\s+)18|255(?:\s*,\s*|\s+)145(?:\s*,\s*|\s+)77|249(?:\s*,\s*|\s+)115(?:\s*,\s*|\s+)22)\b/i;
const CARRIER_CONSENT_FILE =
  "../../components/phone/PhoneNumberSelector.tsx";

describe("Phase 2 Diff 6 theme inventory", () => {
  it.each([
    "#ff914d",
    "#ff914d1f",
    "rgba(255,145,77,.12)",
    "rgb(255 145 77 / .12)",
    "rgb(234 88 12)",
  ])("recognizes direct brand-color syntax %s", (directColor) => {
    expect(
      DIRECT_BRAND_COLOR.test(directColor) || DIRECT_BRAND_RGB.test(directColor),
    ).toBe(true);
  });

  it.each(CONVERTED_UI_FILES)(
    "uses runtime brand tokens instead of direct orange values in %s",
    (relativePath) => {
      const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

      expect(source).not.toMatch(/\borange-[0-9]{2,3}\b/i);
      expect(source).not.toMatch(DIRECT_BRAND_COLOR);
      expect(source).not.toMatch(DIRECT_BRAND_RGB);
    },
  );

  it.each(
    CONVERTED_UI_FILES.filter(
      (relativePath) => relativePath !== CARRIER_CONSENT_FILE,
    ),
  )("does not hardcode ordinary SimplAssist UI copy in %s", (relativePath) => {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");

    expect(source).not.toContain("SimplAssist");
  });

  it("preserves the explicitly approved carrier-consent identity", () => {
    const source = readFileSync(
      new URL(CARRIER_CONSENT_FILE, import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "SimplAssist will send automated text messages on my",
    );
    expect(source).toContain("SimplAssist&apos;s");
    expect(source.match(/SimplAssist/g)).toHaveLength(2);
    expect(source).toContain("replaceDefaultBrandName(error, brand.name)");
  });
});
