import { describe, expect, it } from "vitest";
import {
  CHECKOUT_FINALIZE_ERROR,
  checkoutFinalizeFailureAction,
  checkoutFinalizeErrorMessage,
} from "@/lib/onboarding/checkoutFinalize";

describe("OnboardingPage Checkout return", () => {
  it("accepts only an error-free successful finalize response", () => {
    expect(checkoutFinalizeErrorMessage(true)).toBeNull();
  });

  it("keeps the Checkout return retryable for non-2xx responses", () => {
    expect(checkoutFinalizeErrorMessage(false)).toBe(CHECKOUT_FINALIZE_ERROR);
  });

  it("shows the server detail when an error payload accompanies the response", () => {
    expect(
      checkoutFinalizeErrorMessage(
        true,
        "An active Chat Only subscription is required to complete setup.",
      ),
    ).toBe(
      `${CHECKOUT_FINALIZE_ERROR} An active Chat Only subscription is required to complete setup.`,
    );
  });

  it("resumes the wizard when failed finalization returns trustworthy state", () => {
    expect(
      checkoutFinalizeFailureAction({
        responseOk: false,
        payloadError: "Core setup is incomplete.",
        hasState: true,
      }),
    ).toEqual({ kind: "resume_onboarding" });
  });

  it("keeps finalization retryable when no trustworthy state is returned", () => {
    expect(
      checkoutFinalizeFailureAction({
        responseOk: false,
        payloadError: "Billing synchronization is unavailable.",
        hasState: false,
      }),
    ).toEqual({
      kind: "retry_finalization",
      message: `${CHECKOUT_FINALIZE_ERROR} Billing synchronization is unavailable.`,
    });
  });
});
