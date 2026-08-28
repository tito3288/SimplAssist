import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CampaignAssignmentSafetyBlock,
  CampaignStatusSnapshot,
} from "./campaignStatusTransition";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}));

import {
  applyObservedCampaignStatus,
  getCampaignAssignmentSafetyBlock,
} from "./campaignStatusTransition";

const BUSINESS_ID = "ea848911-ef72-44a6-8cf3-c47b3959be26";
const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const BRAND_ID = "4b20019d-e93e-d697-b8ee-c6233e9bf533";
const CAMPAIGN_ID = "4b30019f-8814-cb6c-1e77-950fa70e0410";
const PROFILE_ID = "40019f88-14ce-429f-a024-17fd89a4fe92";
const UPDATED_AT = "2026-07-27T20:39:27.000Z";
const STATUS_UPDATED_AT = "2026-07-27T20:39:26.000Z";
const OBSERVED_AT = "2026-07-28T10:00:00.000Z";

type DatabaseResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

type QueryChain = {
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  or: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
};

function campaignSnapshot(
  overrides: Partial<CampaignStatusSnapshot> = {}
): CampaignStatusSnapshot {
  return {
    id: BUSINESS_ID,
    owner_id: OWNER_ID,
    updated_at: UPDATED_AT,
    deleted_at: null,
    telnyx_unique_claims_released_at: null,
    active_telnyx_release_run_id: null,
    telnyx_resource_state: "active",
    telnyx_submission_disabled: false,
    telnyx_brand_id: BRAND_ID,
    telnyx_campaign_id: CAMPAIGN_ID,
    telnyx_messaging_profile_id: PROFILE_ID,
    brand_status: "approved",
    campaign_status: "pending",
    campaign_status_updated_at: STATUS_UPDATED_AT,
    campaign_rejection_reason: null,
    onboarding_registration_status: "submitted",
    onboarding_registration_submitted_at: "2026-07-22T04:28:15.000Z",
    onboarding_registration_error: null,
    ...overrides,
  };
}

function queueDatabaseResult(
  result: DatabaseResult = {
    data: { id: BUSINESS_ID },
    error: null,
  }
): QueryChain {
  const chain = {} as QueryChain;
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.or = vi.fn(() => chain);
  chain.select = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(async () => result);
  mocks.from.mockReturnValue(chain);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyObservedCampaignStatus", () => {
  it("uses the exact observed row and every assignment-safety field in the CAS", async () => {
    const snapshot = campaignSnapshot();
    const chain = queueDatabaseResult();

    const outcome = await applyObservedCampaignStatus({
      snapshot,
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
      enforceAssignmentSafety: true,
    });

    expect(outcome).toEqual({
      outcome: "applied",
      statusChanged: true,
      repairedRejectedOnboarding: false,
    });
    expect(mocks.from).toHaveBeenCalledWith("businesses");
    expect(chain.update).toHaveBeenCalledWith({
      campaign_status: "approved",
      campaign_status_updated_at: OBSERVED_AT,
      campaign_rejection_reason: null,
    });
    expect(chain.eq.mock.calls).toEqual([
      ["id", BUSINESS_ID],
      ["owner_id", OWNER_ID],
      ["updated_at", UPDATED_AT],
      ["telnyx_campaign_id", CAMPAIGN_ID],
      ["telnyx_brand_id", BRAND_ID],
      ["campaign_status", "pending"],
      ["brand_status", "approved"],
      ["telnyx_submission_disabled", false],
      ["telnyx_resource_state", "active"],
      ["telnyx_messaging_profile_id", PROFILE_ID],
      ["onboarding_registration_status", "submitted"],
    ]);
    expect(chain.is.mock.calls).toEqual([
      ["deleted_at", null],
      ["telnyx_unique_claims_released_at", null],
      ["active_telnyx_release_run_id", null],
    ]);
    expect(chain.or).toHaveBeenCalledWith(
      expect.stringMatching(
        /^telnyx_campaign_assignment_claim_token\.is\.null,telnyx_campaign_assignment_claimed_at\.lt\./
      )
    );
    expect(chain.select).toHaveBeenCalledWith("id");
    expect(chain.maybeSingle).toHaveBeenCalledOnce();
  });

  it("uses IS NULL for an exactly observed null campaign status", async () => {
    const snapshot = campaignSnapshot({
      campaign_status: null,
      campaign_status_updated_at: null,
    });
    const chain = queueDatabaseResult();

    await applyObservedCampaignStatus({
      snapshot,
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
    });

    expect(chain.is).toHaveBeenCalledWith("campaign_status", null);
    expect(chain.eq).not.toHaveBeenCalledWith("campaign_status", null);
  });

  it("repairs stale rejected onboarding fields when approval supersedes rejection", async () => {
    const carrierReason = "CTA rejected by carrier";
    const snapshot = campaignSnapshot({
      campaign_status: "rejected",
      campaign_rejection_reason: carrierReason,
      onboarding_registration_status: "failed",
      onboarding_registration_submitted_at: null,
      onboarding_registration_error: carrierReason,
    });
    const chain = queueDatabaseResult();

    const outcome = await applyObservedCampaignStatus({
      snapshot,
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
    });

    expect(outcome).toEqual({
      outcome: "applied",
      statusChanged: true,
      repairedRejectedOnboarding: true,
    });
    expect(chain.update).toHaveBeenCalledWith({
      campaign_status: "approved",
      campaign_status_updated_at: OBSERVED_AT,
      campaign_rejection_reason: null,
      onboarding_registration_status: "submitted",
      onboarding_registration_submitted_at: OBSERVED_AT,
      onboarding_registration_error: null,
      onboarding_step: "carrier_review",
    });
  });

  it("repairs stale rejected onboarding fields even when campaign is already approved", async () => {
    const submittedAt = "2026-07-22T04:28:15.000Z";
    const carrierReason = "CTA rejected by carrier";
    const snapshot = campaignSnapshot({
      campaign_status: "approved",
      campaign_rejection_reason: carrierReason,
      onboarding_registration_status: "failed",
      onboarding_registration_submitted_at: submittedAt,
      onboarding_registration_error: carrierReason,
    });
    const chain = queueDatabaseResult();

    const outcome = await applyObservedCampaignStatus({
      snapshot,
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
    });

    expect(outcome).toEqual({
      outcome: "applied",
      statusChanged: false,
      repairedRejectedOnboarding: true,
    });
    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_status: "approved",
        campaign_rejection_reason: null,
        onboarding_registration_status: "submitted",
        onboarding_registration_submitted_at: submittedAt,
        onboarding_registration_error: null,
      })
    );
  });

  it("writes rejection state for support review", async () => {
    const rejectionReason = "Carrier rejected the submitted CTA";
    const snapshot = campaignSnapshot();
    const chain = queueDatabaseResult();

    const outcome = await applyObservedCampaignStatus({
      snapshot,
      newStatus: "rejected",
      rejectionReason,
      observedAt: OBSERVED_AT,
    });

    expect(outcome).toEqual({
      outcome: "applied",
      statusChanged: true,
      repairedRejectedOnboarding: false,
    });
    expect(chain.update).toHaveBeenCalledWith({
      campaign_status: "rejected",
      campaign_status_updated_at: OBSERVED_AT,
      campaign_rejection_reason: rejectionReason,
      onboarding_registration_status: "failed",
      onboarding_registration_submitted_at: null,
      onboarding_registration_error: rejectionReason,
    });
  });

  it("does not write a status-changing observation older than local status", async () => {
    const outcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "rejected",
        campaign_rejection_reason: "newer rejection",
        campaign_status_updated_at: "2026-07-28T10:00:00.000Z",
        onboarding_registration_status: "failed",
        onboarding_registration_error: "newer rejection",
      }),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: "2026-07-28T09:59:59.999Z",
    });

    expect(outcome).toEqual({
      outcome: "stale",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not write an unchanged observation by default", async () => {
    const outcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "approved",
        campaign_rejection_reason: null,
      }),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
    });

    expect(outcome).toEqual({
      outcome: "unchanged",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("touches an unchanged observation when requested", async () => {
    const chain = queueDatabaseResult();

    const outcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "approved",
        campaign_rejection_reason: null,
      }),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
      touchIfUnchanged: true,
    });

    expect(outcome).toEqual({
      outcome: "applied",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(chain.update).toHaveBeenCalledWith({
      campaign_status: "approved",
      campaign_status_updated_at: OBSERVED_AT,
      campaign_rejection_reason: null,
    });
  });

  it("does not backdate an unchanged status when touch is requested", async () => {
    const outcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "approved",
        campaign_status_updated_at: OBSERVED_AT,
        campaign_rejection_reason: null,
      }),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: "2026-07-28T09:59:59.999Z",
      touchIfUnchanged: true,
    });

    expect(outcome).toEqual({
      outcome: "unchanged",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("advances a same-status watermark so an older rejection cannot regress it", async () => {
    const newerApprovalAt = "2026-07-28T11:00:00.000Z";
    const olderRejectionAt = "2026-07-28T10:00:00.000Z";
    queueDatabaseResult();

    const approvalOutcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "approved",
        campaign_status_updated_at: "2026-07-28T09:00:00.000Z",
        campaign_rejection_reason: null,
      }),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: newerApprovalAt,
      touchIfUnchanged: true,
    });

    const rejectionOutcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot({
        campaign_status: "approved",
        campaign_status_updated_at: newerApprovalAt,
        campaign_rejection_reason: null,
      }),
      newStatus: "rejected",
      rejectionReason: "older rejection",
      observedAt: olderRejectionAt,
      touchIfUnchanged: true,
    });

    expect(approvalOutcome).toEqual({
      outcome: "applied",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(rejectionOutcome).toEqual({
      outcome: "stale",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("reports a retryable conflict when the exact-row CAS misses", async () => {
    queueDatabaseResult({ data: null, error: null });

    const outcome = await applyObservedCampaignStatus({
      snapshot: campaignSnapshot(),
      newStatus: "approved",
      rejectionReason: null,
      observedAt: OBSERVED_AT,
    });

    expect(outcome).toEqual({
      outcome: "conflict",
      statusChanged: false,
      repairedRejectedOnboarding: false,
    });
  });

  it("surfaces a database error from the conditional write", async () => {
    queueDatabaseResult({
      data: null,
      error: { message: "serialization failure" },
    });

    await expect(
      applyObservedCampaignStatus({
        snapshot: campaignSnapshot(),
        newStatus: "approved",
        rejectionReason: null,
        observedAt: OBSERVED_AT,
      })
    ).rejects.toThrow(
      `Conditional update failed for business ${BUSINESS_ID}: serialization failure`
    );
  });

  it("rejects an invalid observation timestamp before touching the database", async () => {
    await expect(
      applyObservedCampaignStatus({
        snapshot: campaignSnapshot(),
        newStatus: "approved",
        rejectionReason: null,
        observedAt: "not-a-time",
      })
    ).rejects.toThrow("Invalid observation timestamp");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});

const ASSIGNMENT_SAFETY_CASES: Array<
  [
    CampaignAssignmentSafetyBlock,
    Partial<CampaignStatusSnapshot>,
  ]
> = [
  ["deleted", { deleted_at: "2026-07-28T09:00:00.000Z" }],
  [
    "claims_released",
    { telnyx_unique_claims_released_at: "2026-07-28T09:00:00.000Z" },
  ],
  [
    "release_in_progress",
    { active_telnyx_release_run_id: "20000000-0000-4000-8000-000000000002" },
  ],
  [
    "resource_state_blocked",
    { telnyx_resource_state: "parked" },
  ],
  [
    "submission_disabled",
    { telnyx_submission_disabled: true },
  ],
  [
    "assignment_in_progress",
    {
      telnyx_campaign_assignment_claim_token:
        "30000000-0000-4000-8000-000000000003",
      telnyx_campaign_assignment_claimed_at:
        "2099-07-27T09:00:00.000Z",
    },
  ],
  [
    "submission_in_progress",
    { onboarding_registration_status: "submitting" },
  ],
  ["brand_not_approved", { brand_status: "pending" }],
  ["missing_campaign_id", { telnyx_campaign_id: null }],
  ["missing_campaign_id", { telnyx_campaign_id: "   " }],
  ["missing_brand_id", { telnyx_brand_id: null }],
  ["missing_brand_id", { telnyx_brand_id: "   " }],
  [
    "missing_messaging_profile_id",
    { telnyx_messaging_profile_id: null },
  ],
  ["missing_messaging_profile_id", { telnyx_messaging_profile_id: "   " }],
];

describe("getCampaignAssignmentSafetyBlock", () => {
  it("allows a fully eligible snapshot", () => {
    expect(getCampaignAssignmentSafetyBlock(campaignSnapshot())).toBeNull();
  });

  it("allows an expired assignment lease to reach conditional worker recovery", () => {
    expect(
      getCampaignAssignmentSafetyBlock(
        campaignSnapshot({
          telnyx_campaign_assignment_claim_token:
            "30000000-0000-4000-8000-000000000003",
          telnyx_campaign_assignment_claimed_at:
            "2000-01-01T00:00:00.000Z",
        })
      )
    ).toBeNull();
  });

  it.each(ASSIGNMENT_SAFETY_CASES)(
    "classifies %s",
    (expectedBlock, overrides) => {
      expect(
        getCampaignAssignmentSafetyBlock(campaignSnapshot(overrides))
      ).toBe(expectedBlock);
    }
  );

  it.each(ASSIGNMENT_SAFETY_CASES)(
    "prevents database writes for %s when assignment safety is enforced",
    async (expectedBlock, overrides) => {
      const transition = applyObservedCampaignStatus({
        snapshot: campaignSnapshot(overrides),
        newStatus: "approved",
        rejectionReason: null,
        observedAt: OBSERVED_AT,
        enforceAssignmentSafety: true,
      });

      await expect(transition).rejects.toThrow(
        `Unsafe reconciliation precondition: ${expectedBlock}`
      );
      expect(mocks.from).not.toHaveBeenCalled();
    }
  );
});
