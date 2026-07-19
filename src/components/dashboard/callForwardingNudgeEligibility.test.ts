import { describe, expect, it } from "vitest";
import { shouldShowCallForwardingNudge } from "./callForwardingNudgeEligibility";

const eligible = {
  hasActivePhoneNumber: true,
  canUseMissedCallSms: true,
  callForwardingEnabled: false,
  resolvedAt: null,
};

describe("shouldShowCallForwardingNudge", () => {
  it("shows for an entitled business with an active number and undiscovered forwarding", () => {
    expect(shouldShowCallForwardingNudge(eligible)).toBe(true);
  });

  it.each([
    ["the active number is missing", { hasActivePhoneNumber: false }],
    ["missed-call SMS is unavailable", { canUseMissedCallSms: false }],
    ["forwarding is already enabled", { callForwardingEnabled: true }],
    [
      "the nudge was previously resolved",
      { resolvedAt: "2026-07-19T12:00:00.000Z" },
    ],
  ])("hides when %s", (_label, override) => {
    expect(
      shouldShowCallForwardingNudge({ ...eligible, ...override })
    ).toBe(false);
  });
});
