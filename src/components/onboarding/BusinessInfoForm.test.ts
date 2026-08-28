import { describe, expect, it } from "vitest";

import { REJECTION_SUPPORT_MESSAGE } from "@/lib/onboarding/rejectionGuidance";
import {
  businessInfoRegistrationGateMessage,
  businessInfoRegistrationLockMessage,
  REGISTRATION_STATE_UNAVAILABLE_MESSAGE,
} from "./BusinessInfoForm";

describe("businessInfoRegistrationLockMessage", () => {
  it.each([
    ["brand-only", "rejected", "pending"],
    ["campaign-only", "approved", "rejected"],
    ["dual", "rejected", "rejected"],
  ])("locks a failed %s rejection for support", (_label, brandStatus, campaignStatus) => {
    expect(
      businessInfoRegistrationLockMessage({
        status: "failed",
        brandStatus,
        campaignStatus,
        smsReady: false,
        riskReview: { registrationStarted: true },
      })
    ).toBe(REJECTION_SUPPORT_MESSAGE);
  });

  it("keeps a non-rejection technical failure editable", () => {
    expect(
      businessInfoRegistrationLockMessage({
        status: "failed",
        brandStatus: "pending",
        campaignStatus: null,
        smsReady: false,
        riskReview: { registrationStarted: true },
      })
    ).toBeNull();
  });

  it("keeps the normal review lock and lets active SMS outrank stale rejection data", () => {
    expect(
      businessInfoRegistrationLockMessage({
        status: "submitted",
        brandStatus: "pending",
        campaignStatus: null,
        smsReady: false,
        riskReview: { registrationStarted: true },
      })
    ).toMatch(/locked until review completes/i);

    expect(
      businessInfoRegistrationLockMessage({
        status: "complete",
        brandStatus: "approved",
        campaignStatus: "rejected",
        smsReady: true,
        riskReview: { registrationStarted: false },
      })
    ).toBeNull();
  });

  it("fails closed when the fresh registration-state check is unavailable", () => {
    expect(
      businessInfoRegistrationGateMessage({
        responseOk: false,
        registration: undefined,
      })
    ).toBe(REGISTRATION_STATE_UNAVAILABLE_MESSAGE);

    expect(
      businessInfoRegistrationGateMessage({
        responseOk: true,
        registration: undefined,
      })
    ).toBe(REGISTRATION_STATE_UNAVAILABLE_MESSAGE);
  });
});
