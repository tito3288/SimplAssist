import { describe, expect, it } from "vitest";
import type { OnboardingState } from "./types";
import {
  displayStepForState,
  isCompletedChatOnlyState,
} from "./navigation";

function state(
  overrides: Omit<Partial<OnboardingState>, "planSelection"> & {
    planSelection?: Partial<OnboardingState["planSelection"]>;
  } = {},
): OnboardingState {
  const { planSelection, ...stateOverrides } = overrides;
  return {
    currentStep: "complete",
    dashboardReady: true,
    planSelection: {
      effectivePlan: "chat_only",
      source: "subscription",
      directIntent: "chat_only",
      canChooseDirectPlan: false,
      chatOnlyDirectSalesAvailable: false,
      chatOnlyCheckoutAvailable: true,
      chatOnlyCheckoutPaused: false,
      ...planSelection,
    },
    ...stateOverrides,
  } as OnboardingState;
}

describe("onboarding resume navigation", () => {
  it("identifies authoritative completed Chat Only for an immediate dashboard replace", () => {
    expect(isCompletedChatOnlyState(state())).toBe(true);
  });

  it("never sends an unfinalized Chat Only completion marker to carrier review", () => {
    const unfinalized = state({ dashboardReady: false });

    expect(isCompletedChatOnlyState(unfinalized)).toBe(false);
    expect(displayStepForState(unfinalized)).toBe("review_submit");
  });

  it("preserves the established carrier screen for completed SMS onboarding", () => {
    const sms = state({
      planSelection: {
        effectivePlan: "sms_and_chat",
        source: "subscription",
      },
    });

    expect(isCompletedChatOnlyState(sms)).toBe(false);
    expect(displayStepForState(sms)).toBe("carrier_review");
  });
});
