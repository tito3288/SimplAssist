import { describe, expect, it } from "vitest";

import { validateCustomerCareCopy } from "@/lib/messaging/registration/customerCareTemplates";

import {
  CarrierRejectionSupportRequiredError,
  hasCarrierRejection,
  isRejectionRetryBlocked,
  mapReasonToFriendly,
  REJECTION_SUPPORT_MESSAGE,
  throwIfCarrierRejected,
} from "./rejectionGuidance";

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
    // A blind replacement can rebuild the campaign too, carrying campaign
    // charges on top of the brand fee — support is the only customer path.
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

describe("hasCarrierRejection", () => {
  it("detects brand-only, campaign-only, and dual rejections", () => {
    expect(hasCarrierRejection("rejected", "pending")).toBe(true);
    expect(hasCarrierRejection("approved", "rejected")).toBe(true);
    expect(hasCarrierRejection("rejected", "rejected")).toBe(true);
  });

  it("does not treat ordinary registration states as carrier rejections", () => {
    expect(hasCarrierRejection(null, null)).toBe(false);
    expect(hasCarrierRejection("pending", "pending")).toBe(false);
    expect(hasCarrierRejection("approved", "approved")).toBe(false);
  });

  it("provides neutral support-only API copy", () => {
    expect(REJECTION_SUPPORT_MESSAGE).toMatch(/contact support/i);
    expect(REJECTION_SUPPORT_MESSAGE).not.toMatch(
      /retry|resubmit|update your|edit/i
    );
  });

  it("throws stable control flow with the exact stored carrier reason", () => {
    expect(() =>
      throwIfCarrierRejected({
        brandStatus: "approved",
        campaignStatus: "rejected",
        campaignReason: "  exact carrier text is preserved  ",
      })
    ).toThrowError(
      expect.objectContaining({
        name: "CarrierRejectionSupportRequiredError",
        code: "rejection_support_required",
        carrierReason: "  exact carrier text is preserved  ",
        rejectedResource: "campaign",
      })
    );
  });

  it("does nothing for technical registration states", () => {
    expect(() =>
      throwIfCarrierRejected({
        brandStatus: "pending",
        campaignStatus: null,
        brandReason: "A stale reason without a rejected status",
      })
    ).not.toThrow();
    expect(CarrierRejectionSupportRequiredError).toBeTypeOf("function");
  });
});

describe("mapReasonToFriendly customer-care guidance", () => {
  it.each(FRIENDLY_GUIDANCE_CASES)(
    "%s guidance preserves useful context but routes only to support",
    (kind, reason) => {
      const guidance = mapReasonToFriendly(kind, reason);
      expect(guidance).toBeTruthy();
      expect(guidance).toMatch(/contact support/i);
      expect(guidance).not.toMatch(/fix & resubmit|retry registration|resubmit/i);
    }
  );

  it("keeps unknown carrier wording out of inferred guidance", () => {
    expect(mapReasonToFriendly("campaign", "Opaque provider response")).toBeNull();
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
