import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  submit: vi.fn(),
  getCost: vi.fn(),
  qualify: vi.fn(),
  deactivate: vi.fn(),
  from: vi.fn(),
  appendRegistrationEvent: vi.fn(),
  buildSmsComplianceCopy: vi.fn(),
  resolveLegalUrls: vi.fn(),
  buildRiskInput: vi.fn(),
  hashRiskInput: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      campaign: {
        list: mocks.list,
        deactivate: mocks.deactivate,
        usecase: { getCost: mocks.getCost },
      },
      campaignBuilder: {
        brand: { qualifyByUsecase: mocks.qualify },
        submit: mocks.submit,
      },
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: mocks.appendRegistrationEvent,
  serializeError: (error: unknown) => ({
    message: error instanceof Error ? error.message : "unknown",
  }),
}));
vi.mock("@/lib/messaging/complianceCopy", () => ({
  buildSmsComplianceCopy: mocks.buildSmsComplianceCopy,
}));
vi.mock("./legalUrls", () => ({
  resolveLegalUrls: mocks.resolveLegalUrls,
}));
vi.mock("./riskScreening", () => ({
  buildA2pRiskInputForBusiness: mocks.buildRiskInput,
  hashA2pRiskInput: mocks.hashRiskInput,
}));

import {
  CampaignRegistrationError,
  registerCampaign,
} from "./campaign";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const BRAND_ID = "4b20019d-e93e-4000-8000-000000000001";
const CAMPAIGN_ID = "CMN3FR1";
const NEW_CAMPAIGN_ID = "CMNNEW1";
const CAP_MESSAGE =
  "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link.";

const business = {
  id: BUSINESS_ID,
  name: "SimplAssist",
  email: "owner@example.com",
  phone_number: null,
  telnyx_brand_id: BRAND_ID,
  telnyx_campaign_id: null,
  use_case_description: "Respond to customer questions and missed calls.",
  sample_messages: ["Sample one", "Sample two", "Sample three"],
  slug: "simplassist",
  privacy_terms_mode: "hosted",
  privacy_url_override: null,
  terms_url_override: null,
};

const complianceCopy = {
  messageFlow: "Customers opt in on the website.",
  optinMessage: "You are subscribed.",
  optoutMessage: "You are unsubscribed.",
  helpMessage: "Reply STOP to opt out.",
};

type PersistenceResult = {
  data: { id: string } | null;
  error: { message: string } | null;
};

let persistenceResults: PersistenceResult[];
let updates: Array<Record<string, unknown>>;
let archivedCampaignIds: string[];
let campaignHistoryError: { message: string } | null;
let campaignHistoryDataOverride: unknown;

function asyncItems(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function setCampaigns(items: unknown[]) {
  mocks.list.mockImplementation(() => asyncItems(items));
}

function campaignItem(overrides: Record<string, unknown> = {}) {
  return {
    brandId: BRAND_ID,
    campaignId: CAMPAIGN_ID,
    campaignStatus: "MNO_PENDING",
    failureReasons: null,
    referenceId: BUSINESS_ID,
    ...overrides,
  };
}

function unrelatedCampaign(index: number) {
  return campaignItem({
    campaignId: `OTHER${index}`,
    referenceId: `external-reference-${index}`,
  });
}

function augmentPromise<T>(
  value: T,
  additions: Record<string, unknown>
): Promise<T> & Record<string, unknown> {
  return Object.assign(Promise.resolve(value), additions);
}

function businessQuery() {
  return {
    select: vi.fn((columns: string) => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () =>
          columns === "a2p_risk_review_status"
            ? { data: { a2p_risk_review_status: "not_started" }, error: null }
            : { data: { ...business }, error: null }
        ),
      })),
    })),
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return {
        eq: vi.fn(() =>
          augmentPromise(
            { data: null, error: null },
            {
              is: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () =>
                    persistenceResults.shift() ?? {
                      data: { id: BUSINESS_ID },
                      error: null,
                    }
                  ),
                })),
              })),
            }
          )
        ),
      };
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.simplassist.com/");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);

  persistenceResults = [];
  updates = [];
  archivedCampaignIds = [];
  campaignHistoryError = null;
  campaignHistoryDataOverride = undefined;
  setCampaigns([]);
  mocks.from.mockImplementation((table: string) => {
    if (table === "businesses") return businessQuery();
    if (table === "rejected_campaigns") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data:
              campaignHistoryDataOverride !== undefined
                ? campaignHistoryDataOverride
                : archivedCampaignIds.map((telnyx_campaign_id) => ({
                    telnyx_campaign_id,
                  })),
            error: campaignHistoryError,
          })),
        })),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  mocks.appendRegistrationEvent.mockResolvedValue(undefined);
  mocks.buildSmsComplianceCopy.mockReturnValue(complianceCopy);
  mocks.resolveLegalUrls.mockReturnValue({
    privacyUrl: "https://app.simplassist.com/c/simplassist/privacy",
    termsUrl: "https://app.simplassist.com/c/simplassist/terms",
  });
  mocks.getCost.mockResolvedValue({ monthlyCost: 1.5, upFrontCost: 15 });
  mocks.qualify.mockResolvedValue({ usecase: "CUSTOMER_CARE" });
  mocks.submit.mockResolvedValue({ campaignId: NEW_CAMPAIGN_ID });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("registerCampaign recover-before-create", () => {
  it("lists by brand before a normal submit when no referenceId matches", async () => {
    setCampaigns([unrelatedCampaign(1)]);

    await registerCampaign(BUSINESS_ID);

    expect(mocks.list).toHaveBeenCalledWith({
      brandId: BRAND_ID,
      recordsPerPage: 10,
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(mocks.submit).toHaveBeenCalledWith(
      expect.objectContaining({ referenceId: BUSINESS_ID, brandId: BRAND_ID })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: NEW_CAMPAIGN_ID })
    );
  });

  it("recovers exactly one pending campaign and skips all create preflight", async () => {
    setCampaigns([campaignItem()]);

    await registerCampaign(BUSINESS_ID);

    expect(updates).toContainEqual({
      telnyx_campaign_id: CAMPAIGN_ID,
      campaign_status: "pending",
      campaign_status_updated_at: expect.any(String),
      campaign_rejection_reason: null,
    });
    expect(mocks.getCost).not.toHaveBeenCalled();
    expect(mocks.qualify).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      eventType: "campaign_submitted",
      resourceType: "campaign",
      resourceId: CAMPAIGN_ID,
      status: "pending",
      rejectionReason: null,
      rawPayload: {
        _recovery: {
          source: "telnyx_campaign_list",
          referenceIdMatched: true,
        },
      },
    });
  });

  it("maps a recovered MNO-approved campaign to approved", async () => {
    setCampaigns([campaignItem({ campaignStatus: "MNO_PROVISIONED" })]);

    await registerCampaign(BUSINESS_ID);

    expect(updates).toContainEqual(
      expect.objectContaining({
        telnyx_campaign_id: CAMPAIGN_ID,
        campaign_status: "approved",
        campaign_rejection_reason: null,
      })
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("persists a recovered rejection and its reason, audits it, then stops safely", async () => {
    const providerReason = "private upstream rejection detail";
    setCampaigns([
      campaignItem({
        campaignStatus: "MNO_REJECTED",
        failureReasons: providerReason,
      }),
    ]);

    let caught: unknown;
    try {
      await registerCampaign(BUSINESS_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CampaignRegistrationError);
    expect(caught).toMatchObject({
      code: "campaign_recovered_rejected",
      kind: "permanent",
    });
    expect((caught as Error).message).not.toContain(providerReason);
    expect(updates).toContainEqual(
      expect.objectContaining({
        telnyx_campaign_id: CAMPAIGN_ID,
        campaign_status: "rejected",
        campaign_rejection_reason: providerReason,
      })
    );
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "campaign_submitted",
        resourceId: CAMPAIGN_ID,
        status: "rejected",
        rejectionReason: providerReason,
        rawPayload: expect.objectContaining({ _recovery: expect.any(Object) }),
      })
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not re-adopt a rejected campaign that the retry flow already archived", async () => {
    archivedCampaignIds = [CAMPAIGN_ID];
    setCampaigns([
      campaignItem({
        campaignStatus: "MNO_REJECTED",
        failureReasons: "the old archived rejection",
      }),
    ]);

    await expect(registerCampaign(BUSINESS_ID)).resolves.toBeUndefined();

    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(updates).not.toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: CAMPAIGN_ID })
    );
    expect(updates).toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: NEW_CAMPAIGN_ID })
    );
  });

  it("uses a stable persisted rejection reason when Telnyx omits one", async () => {
    setCampaigns([
      campaignItem({ campaignStatus: "TELNYX_FAILED", failureReasons: " " }),
    ]);

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovered_rejected",
    });
    expect(updates).toContainEqual(
      expect.objectContaining({
        campaign_rejection_reason:
          "Telnyx reported that the recovered campaign was rejected.",
      })
    );
  });

  it("fails closed when more than one campaign matches the business reference", async () => {
    setCampaigns([
      campaignItem(),
      campaignItem({ campaignId: "CMN3FR2" }),
    ]);

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_multiple_matches",
      kind: "permanent",
    });
    expect(updates).toEqual([]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["missing campaign ID", { campaignId: undefined }],
    ["malformed campaign ID", { campaignId: "bad id" }],
    ["wrong brand", { brandId: "different-brand" }],
    ["missing status", { campaignStatus: undefined }],
    ["unknown status", { campaignStatus: "FUTURE_STATUS" }],
  ])("fails closed for a matching campaign with %s", async (_label, patch) => {
    setCampaigns([campaignItem(patch as Record<string, unknown>)]);

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_malformed_response",
      kind: "permanent",
    });
    expect(updates).toEqual([]);
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["null list row", null],
    ["numeric campaign ID", campaignItem({ campaignId: 123 })],
    ["numeric reference ID", campaignItem({ referenceId: 123 })],
    ["numeric brand ID", campaignItem({ brandId: 123 })],
    ["numeric failure reasons", campaignItem({ failureReasons: 123 })],
  ])("fails closed for runtime-malformed provider data: %s", async (_label, row) => {
    setCampaigns([row]);

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_malformed_response",
      kind: "permanent",
    });
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("throws on a failed recovery save and relists successfully on retry", async () => {
    setCampaigns([campaignItem()]);
    persistenceResults = [
      { data: null, error: { message: "database unavailable" } },
      { data: { id: BUSINESS_ID }, error: null },
    ];

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_persist_failed",
      kind: "transient",
    });
    expect(mocks.submit).not.toHaveBeenCalled();

    await expect(registerCampaign(BUSINESS_ID)).resolves.toBeUndefined();
    expect(mocks.list).toHaveBeenCalledTimes(2);
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(mocks.appendRegistrationEvent).toHaveBeenCalledTimes(1);
  });

  it("blocks a new campaign when five unrelated campaigns consume the cap", async () => {
    setCampaigns(Array.from({ length: 5 }, (_, index) => unrelatedCampaign(index)));

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "telnyx_brand_campaign_cap_reached",
      kind: "permanent",
      message: CAP_MESSAGE,
    });
    expect(mocks.getCost).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("permits recovery of our match when the brand is already at the cap", async () => {
    setCampaigns([
      campaignItem(),
      ...Array.from({ length: 4 }, (_, index) => unrelatedCampaign(index)),
    ]);

    await expect(registerCampaign(BUSINESS_ID)).resolves.toBeUndefined();
    expect(updates).toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: CAMPAIGN_ID })
    );
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not count an archived Telnyx record against replacement capacity", async () => {
    archivedCampaignIds = [CAMPAIGN_ID];
    setCampaigns([
      campaignItem({ campaignStatus: "MNO_REJECTED" }),
      ...Array.from({ length: 4 }, (_, index) => unrelatedCampaign(index)),
    ]);

    await expect(registerCampaign(BUSINESS_ID)).resolves.toBeUndefined();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });

  it("fails before listing or creating when campaign history is unavailable", async () => {
    campaignHistoryError = { message: "private database detail" };

    let caught: unknown;
    try {
      await registerCampaign(BUSINESS_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "campaign_recovery_history_unavailable",
      kind: "transient",
    });
    expect((caught as Error).message).not.toContain("private database detail");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("fails closed on malformed archived campaign history", async () => {
    archivedCampaignIds = ["bad campaign id"];

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_history_invalid",
      kind: "permanent",
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("fails closed when the campaign-history collection is unexpectedly null", async () => {
    campaignHistoryDataOverride = null;

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_recovery_history_invalid",
      kind: "permanent",
    });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("does not persist a runtime-malformed fresh campaign ID", async () => {
    mocks.submit.mockResolvedValue({ campaignId: 123 });

    await expect(registerCampaign(BUSINESS_ID)).rejects.toMatchObject({
      code: "campaign_submit_malformed_response",
      kind: "permanent",
    });
    expect(updates).not.toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: expect.anything() })
    );
  });

  it("normalizes a valid fresh campaign ID before persistence", async () => {
    mocks.submit.mockResolvedValue({ campaignId: `  ${NEW_CAMPAIGN_ID}  ` });

    await expect(registerCampaign(BUSINESS_ID)).resolves.toBeUndefined();
    expect(updates).toContainEqual(
      expect.objectContaining({ telnyx_campaign_id: NEW_CAMPAIGN_ID })
    );
  });

  it("classifies list failure as transient without exposing provider details", async () => {
    const providerDetail = "raw provider account data";
    mocks.list.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        throw new Error(providerDetail);
      },
    }));

    let caught: unknown;
    try {
      await registerCampaign(BUSINESS_ID);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: "campaign_recovery_provider_unavailable",
      kind: "transient",
    });
    expect((caught as Error).message).not.toContain(providerDetail);
    expect(mocks.submit).not.toHaveBeenCalled();
  });
});
