import { describe, expect, it } from "vitest";
import {
  DIRECT_CHAT_ONBOARDING_STEPS,
  LEGACY_SMS_ONBOARDING_STEPS,
  ONBOARDING_STEPS,
  onboardingStepNumber,
  onboardingStepsForPlan,
} from "./types";

describe("plan-aware onboarding progress", () => {
  it("keeps existing paid direct and partner SMS progress at nine steps", () => {
    const paidDirect = onboardingStepsForPlan({
      includePlanSelection: false,
      effectivePlan: "sms_and_chat",
    });
    const partner = onboardingStepsForPlan({
      includePlanSelection: false,
      effectivePlan: "sms_only",
    });

    expect(paidDirect).toEqual(LEGACY_SMS_ONBOARDING_STEPS);
    expect(partner).toEqual(LEGACY_SMS_ONBOARDING_STEPS);
    expect(onboardingStepNumber("ai_settings", paidDirect)).toBe(4);
    expect(onboardingStepNumber("carrier_review", paidDirect)).toBe(9);
  });

  it("adds the selection step only to new direct SMS acquisition", () => {
    expect(
      onboardingStepsForPlan({
        includePlanSelection: true,
        effectivePlan: "sms_and_chat",
      }),
    ).toEqual(ONBOARDING_STEPS);
    expect(onboardingStepNumber("ai_settings", ONBOARDING_STEPS)).toBe(5);
  });

  it("uses the compact no-SMS path for Chat Only", () => {
    expect(
      onboardingStepsForPlan({
        includePlanSelection: true,
        effectivePlan: "chat_only",
      }),
    ).toEqual(DIRECT_CHAT_ONBOARDING_STEPS);
    expect(
      onboardingStepsForPlan({
        includePlanSelection: false,
        effectivePlan: "chat_only",
      }),
    ).toEqual(
      DIRECT_CHAT_ONBOARDING_STEPS.filter(
        (step) => step !== "plan_selection",
      ),
    );
  });
});
