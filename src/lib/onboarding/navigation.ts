import type { OnboardingState, OnboardingStep } from "./types";

/** Completed Chat Only resumes directly into the dashboard, never carrier UI. */
export function isCompletedChatOnlyState(state: OnboardingState): boolean {
  return (
    state.planSelection.effectivePlan === "chat_only" &&
    state.dashboardReady &&
    state.currentStep === "complete"
  );
}

/**
 * Convert the server resume marker into the wizard's visible step. SMS keeps
 * its established carrier-status completion screen. A malformed/unfinalized
 * Chat completion fails back to review instead of leaking carrier UI.
 */
export function displayStepForState(state: OnboardingState): OnboardingStep {
  if (state.currentStep !== "complete") return state.currentStep;
  if (state.planSelection.effectivePlan === "chat_only") {
    return "review_submit";
  }
  return "carrier_review";
}
