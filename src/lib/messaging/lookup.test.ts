import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {},
}));
vi.mock(
  "@/lib/messaging/registration/phoneNumberAssignment",
  () => ({
    ensureCampaignAssignmentForBusiness: vi.fn(),
  })
);

import {
  reduceSmsReadinessSnapshot,
  type SmsReadinessSnapshot,
} from "./lookup";

const READY_SNAPSHOT: SmsReadinessSnapshot = {
  hasActivePhone: true,
  phoneNumber: "+13175550100",
  messagingProfileId: "profile-1",
  campaignStatus: "approved",
  expectedCampaignId: "campaign-1",
  assignmentStatus: "assigned",
  assignedCampaignId: "campaign-1",
  assignmentFailureReason: null,
};

describe("reduceSmsReadinessSnapshot", () => {
  it("returns ready only for an active phone assigned to the expected approved campaign", () => {
    expect(reduceSmsReadinessSnapshot(READY_SNAPSHOT)).toEqual({
      smsReady: true,
      blockReason: null,
      campaignStatus: "approved",
      assignmentStatus: "assigned",
      assignmentFailureReason: null,
      phoneNumber: "+13175550100",
      messagingProfileId: "profile-1",
    });
  });

  it("preserves missing-phone precedence and available business facts", () => {
    expect(
      reduceSmsReadinessSnapshot({
        ...READY_SNAPSHOT,
        hasActivePhone: false,
        phoneNumber: null,
        assignmentStatus: null,
        assignedCampaignId: null,
      })
    ).toEqual({
      smsReady: false,
      blockReason: "missing_phone_number",
      campaignStatus: "approved",
      assignmentStatus: null,
      assignmentFailureReason: null,
      phoneNumber: null,
      messagingProfileId: "profile-1",
    });
  });

  it.each([
    [
      "missing_messaging_profile",
      { messagingProfileId: null },
      "assigned",
    ],
    [
      "campaign_not_approved",
      { campaignStatus: "pending" },
      "assigned",
    ],
    [
      "assignment_pending",
      { assignmentStatus: null, assignedCampaignId: null },
      "unassigned",
    ],
    [
      "assignment_pending",
      { assignedCampaignId: "different-campaign" },
      "assigned",
    ],
    [
      "assignment_failed",
      {
        assignmentStatus: "failed",
        assignedCampaignId: null,
        assignmentFailureReason: "provider rejected assignment",
      },
      "failed",
    ],
  ] as const)(
    "reduces the existing %s gate with deterministic precedence",
    (blockReason, overrides, assignmentStatus) => {
      const readiness = reduceSmsReadinessSnapshot({
        ...READY_SNAPSHOT,
        ...overrides,
      });

      expect(readiness).toMatchObject({
        smsReady: false,
        blockReason,
        assignmentStatus,
      });
      if (blockReason === "assignment_failed") {
        expect(readiness.assignmentFailureReason).toBe(
          "provider rejected assignment"
        );
      }
    }
  );

  it("does not treat an assigned phone as ready without an expected campaign", () => {
    expect(
      reduceSmsReadinessSnapshot({
        ...READY_SNAPSHOT,
        expectedCampaignId: null,
      })
    ).toMatchObject({
      smsReady: false,
      blockReason: "assignment_pending",
      assignmentStatus: "assigned",
    });
  });
});
