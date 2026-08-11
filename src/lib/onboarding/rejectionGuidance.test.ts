import { describe, expect, it } from "vitest";

import { validateCustomerCareCopy } from "@/lib/messaging/registration/customerCareTemplates";

import {
  isRejectionRetryBlocked,
  mapReasonToFriendly,
} from "./rejectionGuidance";

const USE_CASE_GUIDANCE =
  "Carriers need a clearer picture of what you'll text customers about. Rewrite your SMS description in plain terms — for example, replies to customer questions, missed-call follow-ups, service-inquiry responses, and next-step coordination. Describe only messages your assistant will actually send. A couple of clear sentences is all it takes.";

const UNSUPPORTED_CLAIM_ERROR =
  "SMS registration text must stay limited to Customer Care, not marketing, blasts, coupons, cold outreach, affiliate marketing, or unsupported automation.";

const FRIENDLY_GUIDANCE_CASES = [
  ["brand", "Brand verification failed: EIN mismatch"],
  ["campaign", "Campaign rejected: EIN mismatch"],
  ["campaign", "Carrier code 861"],
  ["campaign", "Carrier code 708"],
  ["campaign", "Sample message was rejected"],
  ["campaign", "Use-case description is unclear"],
  ["campaign", "Cannabis content is restricted"],
  ["brand", "The business website could not be verified"],
  ["campaign", "Unable to load privacy policy link on the registration"],
] as const;

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

describe("mapReasonToFriendly customer-care guidance", () => {
  it("uses carrier-safe use-case guidance", () => {
    expect(
      mapReasonToFriendly("campaign", "Use-case description is unclear")
    ).toBe(USE_CASE_GUIDANCE);
  });

  it("never returns guidance containing an unsupported customer-care claim", () => {
    const guidance = FRIENDLY_GUIDANCE_CASES.map(([kind, reason]) =>
      mapReasonToFriendly(kind, reason)
    );

    expect(guidance).not.toContain(null);
    expect(new Set(guidance).size).toBe(FRIENDLY_GUIDANCE_CASES.length);

    const safeRegistrationFields = {
      optInDescription:
        "Customers opt in by contacting Example Company for customer care.",
      sampleMessages: [
        "Example Company: How can we help with your question? Reply STOP to opt out.",
      ],
    };

    expect(
      validateCustomerCareCopy({
        ...safeRegistrationFields,
        useCaseDescription: "We send appointment reminders.",
      })
    ).toContain(UNSUPPORTED_CLAIM_ERROR);

    for (const text of guidance) {
      const errors = validateCustomerCareCopy({
        ...safeRegistrationFields,
        useCaseDescription: text ?? "",
      });

      expect(errors).not.toContain(UNSUPPORTED_CLAIM_ERROR);
    }
  });
});
