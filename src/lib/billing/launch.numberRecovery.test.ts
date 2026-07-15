import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  purchaseNumber: vi.fn(),
  findOwnedNumberId: vi.fn(),
  attachOwnedNumberToCustomerProfile: vi.fn(),
  registerBrand: vi.fn(),
  registerCampaign: vi.fn(),
  createMessagingProfile: vi.fn(),
  createVoiceApplication: vi.fn(),
  archiveAndClearRejectedBrand: vi.fn(),
  archiveAndClearRejectedCampaign: vi.fn(),
  getA2pRiskClearanceForBusiness: vi.fn(),
  screenA2pRiskForBusiness: vi.fn(),
  ensureCampaignAssignmentForBusiness: vi.fn(),
  claimRegistrationAttempt: vi.fn(),
  markRegistrationFailed: vi.fn(),
  markRegistrationSubmitted: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/numbers", async (importOriginal) => {
  // Keep the REAL PurchasedNumberSaveError class — launch.ts classifies by
  // instanceof against the same constructor.
  const actual =
    await importOriginal<typeof import("@/lib/messaging/numbers")>();
  return {
    ...actual,
    purchaseNumber: mocks.purchaseNumber,
    findOwnedNumberId: mocks.findOwnedNumberId,
    attachOwnedNumberToCustomerProfile: mocks.attachOwnedNumberToCustomerProfile,
  };
});
vi.mock("@/lib/messaging/registration", () => ({
  registerBrand: mocks.registerBrand,
  registerCampaign: mocks.registerCampaign,
  createMessagingProfile: mocks.createMessagingProfile,
  createVoiceApplication: mocks.createVoiceApplication,
}));
vi.mock("@/lib/messaging/registration/brand", () => ({
  archiveAndClearRejectedBrand: mocks.archiveAndClearRejectedBrand,
}));
vi.mock("@/lib/messaging/registration/campaign", () => ({
  archiveAndClearRejectedCampaign: mocks.archiveAndClearRejectedCampaign,
}));
vi.mock("@/lib/messaging/registration/riskScreening", () => ({
  getA2pRiskClearanceForBusiness: mocks.getA2pRiskClearanceForBusiness,
  screenA2pRiskForBusiness: mocks.screenA2pRiskForBusiness,
}));
vi.mock("@/lib/messaging/registration/phoneNumberAssignment", () => ({
  ensureCampaignAssignmentForBusiness: mocks.ensureCampaignAssignmentForBusiness,
}));
vi.mock("@/lib/onboarding/registrationAttempt", () => ({
  claimRegistrationAttempt: mocks.claimRegistrationAttempt,
  markRegistrationFailed: mocks.markRegistrationFailed,
  markRegistrationSubmitted: mocks.markRegistrationSubmitted,
}));

import { attemptPaidLaunch } from "./launch";

const BUSINESS_ID = "00000000-0000-4000-8000-00000000b1z1";
const PENDING_NUMBER = "+15745550300";
const TELNYX_NUMBER_ID = "tn_number_uuid_1";

const LAUNCH_BUSINESS = {
  id: BUSINESS_ID,
  has_ein: true,
  pending_phone_number: PENDING_NUMBER,
  telnyx_submission_disabled: false,
  telnyx_brand_id: null,
  telnyx_campaign_id: null,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: true, // skips the subscription read
};

// Chainable, awaitable supabase mock; from() consumes queued results FIFO
// and records chains for argument assertions.
const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? { data: null, error: null };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of [
      "select",
      "insert",
      "update",
      "eq",
      "or",
      "order",
      "limit",
      "maybeSingle",
      "single",
    ]) {
      chain[m] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

// Query order for the fresh-purchase flow (billing_exempt business):
// 1 businesses launch-row read; 2 phone_numbers readActiveNumber (pre-claim);
// 3 phone_numbers readActiveNumber (post-registration); 4 phone_numbers
// step-1 collision check; 5 phone_numbers insert; 6 businesses clearPending.
function queueHappyPathThrough(...tail: unknown[]) {
  queueResults(
    { data: LAUNCH_BUSINESS, error: null },
    { data: null, error: null },
    { data: null, error: null },
    ...tail
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  mocks.getA2pRiskClearanceForBusiness.mockResolvedValue({
    cleared: true,
    hashMatches: true,
    status: "passed",
    message: null,
  });
  mocks.claimRegistrationAttempt.mockResolvedValue({
    claimed: true,
    claimedFrom: "not_started",
    startedAt: "2026-07-15T00:00:00.000Z",
  });
  for (const fn of [
    mocks.registerBrand,
    mocks.registerCampaign,
    mocks.createMessagingProfile,
    mocks.createVoiceApplication,
    mocks.archiveAndClearRejectedBrand,
    mocks.archiveAndClearRejectedCampaign,
    mocks.ensureCampaignAssignmentForBusiness,
    mocks.markRegistrationFailed,
    mocks.markRegistrationSubmitted,
    mocks.attachOwnedNumberToCustomerProfile,
  ]) {
    fn.mockResolvedValue(undefined);
  }
  mocks.findOwnedNumberId.mockResolvedValue(null);
  mocks.purchaseNumber.mockResolvedValue({
    phoneNumber: PENDING_NUMBER,
    phoneNumberId: TELNYX_NUMBER_ID,
    status: "success",
  });
});

describe("attemptPaidLaunch number purchase recovery", () => {
  it("submits on the fresh-purchase happy path", async () => {
    queueHappyPathThrough(
      { data: null, error: null }, // step-1 collision check
      { error: null }, // insert
      { error: null } // clearPending
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("submitted");
    expect(mocks.purchaseNumber).toHaveBeenCalledWith(
      PENDING_NUMBER,
      BUSINESS_ID
    );
    expect(mocks.markRegistrationSubmitted).toHaveBeenCalledWith(BUSINESS_ID);
  });

  it("classifies a save failure as retryable with truthful copy, keeping the pending number", async () => {
    queueHappyPathThrough(
      { data: null, error: null }, // step-1 collision check
      {
        error: {
          message:
            'duplicate key value violates unique constraint "phone_numbers_phone_number_key"',
        },
      } // insert fails — message contains the relation name that fooled the old regex
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    // NOT number_unavailable: the customer was charged, so no re-pick and
    // no false "you will not be charged again for a fresh number" routing.
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Retry to complete setup");
    expect(mocks.markRegistrationFailed).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.stringContaining("we couldn't finish saving it")
    );
    // pending_phone_number kept: no update carrying pending_phone_number null
    // (persistNumberFailure would also write a failure_reason — must not run).
    for (const chain of chains) {
      for (const call of chain.update.mock.calls) {
        expect(call[0]).not.toHaveProperty("pending_phone_number_failure_reason");
      }
    }
  });

  it("recovers an owned-but-unsaved number without purchasing again", async () => {
    mocks.findOwnedNumberId.mockResolvedValue(TELNYX_NUMBER_ID);
    queueHappyPathThrough(
      { data: null, error: null }, // step-1 collision check
      { error: null }, // insert (recovery save)
      { error: null } // clearPending
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("submitted");
    expect(mocks.purchaseNumber).not.toHaveBeenCalled();
    // The scoping pin: recovery must be customer_reference-scoped to THIS
    // business — an unscoped lookup lets one business seize another's paid
    // number on a single Telnyx account.
    expect(mocks.findOwnedNumberId).toHaveBeenCalledWith(
      PENDING_NUMBER,
      BUSINESS_ID
    );
    expect(mocks.attachOwnedNumberToCustomerProfile).toHaveBeenCalledWith(
      BUSINESS_ID,
      TELNYX_NUMBER_ID
    );
  });

  it("re-asserts routing on an already-completed prior attempt (idempotent completion)", async () => {
    queueHappyPathThrough(
      {
        data: {
          business_id: BUSINESS_ID,
          telnyx_phone_number_id: TELNYX_NUMBER_ID,
        },
        error: null,
      }, // our own row exists
      { error: null } // clearPending
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("submitted");
    expect(mocks.purchaseNumber).not.toHaveBeenCalled();
    expect(mocks.findOwnedNumberId).not.toHaveBeenCalled();
    // A crash between a prior insert and attach leaves a saved-but-unrouted
    // number; idempotent completion must re-assert routing, not just clear.
    expect(mocks.attachOwnedNumberToCustomerProfile).toHaveBeenCalledWith(
      BUSINESS_ID,
      TELNYX_NUMBER_ID
    );
  });

  it("treats another business holding the number as genuinely unavailable", async () => {
    queueHappyPathThrough(
      { data: { business_id: "other-business" }, error: null }, // collision
      { error: null } // persistNumberFailure update
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("number_unavailable");
    expect(mocks.purchaseNumber).not.toHaveBeenCalled();
  });

  it("no longer misclassifies Postgres relation-name errors as unavailable", async () => {
    // A non-typed error whose text contains 'phone_number' (the old regex's
    // false trigger) must fall through to the generic failed path, not the
    // re-pick path.
    mocks.registerBrand.mockRejectedValue(
      new Error('permission denied for table phone_numbers')
    );
    queueHappyPathThrough();

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("failed");
    expect(result.message).toContain("try again or contact support");
  });

  it("still classifies genuine Telnyx order failures as unavailable", async () => {
    mocks.purchaseNumber.mockRejectedValue(
      new Error(`Telnyx number order failed for ${PENDING_NUMBER}: {"status":"failure"}`)
    );
    queueHappyPathThrough(
      { data: null, error: null }, // step-1 collision check
      { error: null } // persistNumberFailure update
    );

    const result = await attemptPaidLaunch(BUSINESS_ID, "onboarding_retry");

    expect(result.status).toBe("number_unavailable");
  });
});
