import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  ensureCampaignAssignmentForBusiness: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock(
  "@/lib/messaging/registration/phoneNumberAssignment",
  () => ({
    ensureCampaignAssignmentForBusiness:
      mocks.ensureCampaignAssignmentForBusiness,
  })
);

import {
  getOutboundSendContext,
  getSmsReadinessForBusiness,
  reduceSmsReadinessSnapshot,
  type SmsReadinessSnapshot,
} from "./lookup";

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const queryChains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function queueQueryResults(...results: QueryResult[]) {
  const queue = [...results];
  queryChains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.single = vi.fn(async () => result);
    chain.maybeSingle = vi.fn(async () => result);
    queryChains.push(chain);
    return chain;
  });
}

function phoneContext(options: {
  operationsSuspendedAt?: string | null;
  assignmentStatus?: "unassigned" | "pending" | "assigned" | "failed";
  assignedCampaignId?: string | null;
  textingPausedAt?: string | null;
} = {}) {
  const assignmentStatus = options.assignmentStatus ?? "unassigned";
  return {
    id: "phone-row-1",
    business_id: "business-1",
    phone_number: "+13175550100",
    telnyx_campaign_assignment_status: assignmentStatus,
    telnyx_campaign_assignment_campaign_id:
      options.assignedCampaignId ??
      (assignmentStatus === "assigned" ? "campaign-1" : null),
    telnyx_campaign_assignment_failure_reason: null,
    businesses: {
      id: "business-1",
      operations_suspended_at: options.operationsSuspendedAt ?? null,
      // Deliberately present in the fixture to prove it is not consulted by
      // the provisioning-only lazy-assignment gate.
      texting_paused_at: options.textingPausedAt ?? null,
      telnyx_messaging_profile_id: "profile-1",
      telnyx_campaign_id: "campaign-1",
      campaign_status: "approved",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureCampaignAssignmentForBusiness.mockResolvedValue(undefined);
});

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

describe("lazy campaign-assignment operational gate", () => {
  it("does not let an outbound lookup provision while the account is suspended", async () => {
    queueQueryResults({
      data: phoneContext({
        operationsSuspendedAt: "2026-07-28T10:00:00.000Z",
      }),
      error: null,
    });

    const readiness = await getOutboundSendContext("+13175550100");

    expect(readiness).toMatchObject({
      businessId: "business-1",
      smsReady: false,
      blockReason: "assignment_pending",
      assignmentStatus: "unassigned",
    });
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expect(queryChains).toHaveLength(1);
    expect(queryChains[0].select).toHaveBeenCalledWith(
      expect.stringContaining("operations_suspended_at")
    );
  });

  it("does not let general SMS readiness provision while the account is suspended", async () => {
    queueQueryResults({
      data: phoneContext({
        operationsSuspendedAt: "2026-07-28T10:00:00.000Z",
      }),
      error: null,
    });

    const readiness = await getSmsReadinessForBusiness("business-1");

    expect(readiness).toMatchObject({
      smsReady: false,
      blockReason: "assignment_pending",
      assignmentStatus: "unassigned",
    });
    expect(mocks.ensureCampaignAssignmentForBusiness).not.toHaveBeenCalled();
    expect(queryChains).toHaveLength(1);
  });

  it("keeps lazy provisioning available when texting alone is paused", async () => {
    queueQueryResults(
      {
        data: phoneContext({
          textingPausedAt: "2026-07-28T10:00:00.000Z",
        }),
        error: null,
      },
      {
        data: phoneContext({
          assignmentStatus: "assigned",
          textingPausedAt: "2026-07-28T10:00:00.000Z",
        }),
        error: null,
      }
    );

    const readiness = await getSmsReadinessForBusiness("business-1");

    expect(mocks.ensureCampaignAssignmentForBusiness).toHaveBeenCalledWith(
      "business-1",
      { reason: "dashboard_lazy_refresh" }
    );
    expect(queryChains).toHaveLength(2);
    expect(readiness).toMatchObject({
      smsReady: true,
      blockReason: null,
      assignmentStatus: "assigned",
    });
  });
});

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
