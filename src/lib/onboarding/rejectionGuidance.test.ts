import { describe, expect, it } from "vitest";

import {
  isRejectionRetryBlocked,
  mapReasonToFriendly,
} from "./rejectionGuidance";

describe("isRejectionRetryBlocked", () => {
  it("blocks retry for a campaign rejection", () => {
    expect(isRejectionRetryBlocked("approved", "rejected")).toBe(true);
    expect(isRejectionRetryBlocked(null, "rejected")).toBe(true);
    expect(isRejectionRetryBlocked(undefined, "rejected")).toBe(true);
  });

  it("blocks retry for a brand rejection, alone or alongside a campaign rejection", () => {
    // Brand refile rebuilds the campaign too, so a blind retry carries the
    // full campaign charges on top of the brand fee — support/fix only.
    expect(isRejectionRetryBlocked("rejected", null)).toBe(true);
    expect(isRejectionRetryBlocked("rejected", "pending")).toBe(true);
    expect(isRejectionRetryBlocked("rejected", "rejected")).toBe(true);
  });

  it("keeps retry for technical failures with no carrier rejection", () => {
    expect(isRejectionRetryBlocked(null, null)).toBe(false);
    expect(isRejectionRetryBlocked("pending", "pending")).toBe(false);
    expect(isRejectionRetryBlocked("approved", "approved")).toBe(false);
    expect(isRejectionRetryBlocked(undefined, undefined)).toBe(false);
  });
});

describe("mapReasonToFriendly copy never points at the withheld Retry button", () => {
  it("campaign url copy points at support", () => {
    const friendly = mapReasonToFriendly(
      "campaign",
      "Unable to load privacy policy link on the registration"
    );
    expect(friendly).toBeTruthy();
    expect(friendly).toMatch(/contact support/i);
    expect(friendly).not.toMatch(/retry registration/i);
  });

  it.each([
    ["identity", "Brand verification failed: EIN mismatch"],
    ["url", "The business website could not be verified"],
  ])("brand %s copy points at Fix & resubmit, not Retry", (_category, reason) => {
    const friendly = mapReasonToFriendly("brand", reason);
    expect(friendly).toBeTruthy();
    expect(friendly).toMatch(/fix & resubmit/i);
    expect(friendly).not.toMatch(/retry registration/i);
  });
});
