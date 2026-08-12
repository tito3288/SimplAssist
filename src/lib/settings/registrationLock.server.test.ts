import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  registrationHasStartedForRisk: (business: {
    telnyx_brand_id: string | null;
    brand_status: string | null;
    campaign_status: string | null;
    onboarding_registration_status: string | null;
  }) =>
    Boolean(
      business.telnyx_brand_id ||
        business.brand_status ||
        business.campaign_status ||
        business.onboarding_registration_status === "submitted"
    ),
}));

import {
  applyRegistrationStateSnapshot,
  isSettingsRegistrationLocked,
} from "./registrationLock.server";

const pristine = {
  telnyx_brand_id: null,
  brand_status: null,
  campaign_status: null,
  onboarding_registration_status: "not_started" as const,
};

describe("isSettingsRegistrationLocked", () => {
  it("keeps pristine and bare-submitting registrations unlocked", () => {
    expect(isSettingsRegistrationLocked(pristine)).toBe(false);
    expect(
      isSettingsRegistrationLocked({
        ...pristine,
        onboarding_registration_status: "submitting",
      })
    ).toBe(false);
  });

  it.each([
    { telnyx_brand_id: "brand-1" },
    { brand_status: "pending" as const },
    { campaign_status: "approved" as const },
    { onboarding_registration_status: "submitted" as const },
  ])("locks for canonical started signal $key", (override) => {
    expect(
      isSettingsRegistrationLocked({ ...pristine, ...override })
    ).toBe(true);
  });

  it.each([
    { telnyx_brand_id: "brand-1" },
    { brand_status: "pending" as const },
    { campaign_status: "approved" as const },
  ])("lets failed registration override $key", (override) => {
    expect(
      isSettingsRegistrationLocked({
        ...pristine,
        ...override,
        onboarding_registration_status: "failed",
      })
    ).toBe(false);
  });
});

describe("applyRegistrationStateSnapshot", () => {
  it("uses is for nulls and eq for concrete state values", () => {
    const query = {
      eq: vi.fn(),
      is: vi.fn(),
    };
    query.eq.mockReturnValue(query);
    query.is.mockReturnValue(query);

    expect(
      applyRegistrationStateSnapshot(query, {
        telnyx_brand_id: "brand-1",
        brand_status: null,
        campaign_status: "approved",
        onboarding_registration_status: "submitted",
      })
    ).toBe(query);
    expect(query.eq.mock.calls).toEqual([
      ["telnyx_brand_id", "brand-1"],
      ["campaign_status", "approved"],
      ["onboarding_registration_status", "submitted"],
    ]);
    expect(query.is).toHaveBeenCalledExactlyOnceWith("brand_status", null);
  });
});
