import { describe, expect, it } from "vitest";

import { shouldEnforceInitialContentQuality } from "./contentQualityGate";

describe("shouldEnforceInitialContentQuality", () => {
  it("enforces the gate for an unregistered incomplete business", () => {
    expect(
      shouldEnforceInitialContentQuality({
        onboarding_completed_at: null,
        onboarding_registration_status: "not_started",
        telnyx_brand_id: null,
        brand_status: null,
        campaign_status: null,
      })
    ).toBe(true);
  });

  it("grandfathers an already-completed business", () => {
    expect(
      shouldEnforceInitialContentQuality({
        onboarding_completed_at: "2026-07-24T00:00:00.000Z",
      })
    ).toBe(false);
  });

  it.each([
    { onboarding_registration_status: "submitted" as const },
    { telnyx_brand_id: "brand-1" },
    { brand_status: "pending" },
    { campaign_status: "approved" },
  ])("grandfathers genuine carrier-review state %#", (business) => {
    expect(shouldEnforceInitialContentQuality(business)).toBe(false);
  });

  it("does not mistake a local submitting marker for carrier progress", () => {
    expect(
      shouldEnforceInitialContentQuality({
        onboarding_registration_status: "submitting",
      })
    ).toBe(true);
  });
});
