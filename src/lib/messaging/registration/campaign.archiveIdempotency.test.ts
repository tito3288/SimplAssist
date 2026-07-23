import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TelnyxRemoteMutationAuthorizationError extends Error {}
  return {
    from: vi.fn(),
    deactivateCampaign: vi.fn(),
    providerDeactivate: vi.fn(),
    TelnyxRemoteMutationAuthorizationError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/telnyxDestructive", () => ({
  deactivateTelnyxCampaign: mocks.deactivateCampaign,
  TelnyxRemoteMutationAuthorizationError:
    mocks.TelnyxRemoteMutationAuthorizationError,
}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      campaign: { list: vi.fn(), usecase: { getCost: vi.fn() } },
      campaignBuilder: {
        brand: { qualifyByUsecase: vi.fn() },
        submit: vi.fn(),
      },
    },
  },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: vi.fn(),
  serializeError: vi.fn(),
}));
vi.mock("@/lib/messaging/complianceCopy", () => ({
  buildSmsComplianceCopy: vi.fn(),
}));
vi.mock("@/lib/messaging/phoneNumberLookup", () => ({
  getActiveSmsNumberForBusiness: vi.fn(),
}));
vi.mock("./legalUrls", () => ({ resolveLegalUrls: vi.fn() }));
vi.mock("./riskScreening", () => ({
  buildA2pRiskInputForBusiness: vi.fn(),
  hashA2pRiskInput: vi.fn(),
}));

import {
  archiveAndClearRejectedCampaign,
  CampaignDeactivationStateError,
} from "./campaign";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000391";
const CAMPAIGN_ID = "CMPARCHIVE391";
const REPLACEMENT_CAMPAIGN_ID = "CMPREPLACE391";
const HISTORY_ID = "10000000-0000-4000-8000-000000000391";
const ATTEMPT_PREFIX = "SIMPLASSIST_CAMPAIGN_DEACTIVATION_ATTEMPT_V1:";
const READY = "SIMPLASSIST_CAMPAIGN_DEACTIVATION_READY_V1";
const PROVIDER_ERROR_PREFIX =
  "SIMPLASSIST_CAMPAIGN_DEACTIVATION_PROVIDER_ERROR_V1:";
const OTHER_ATTEMPT = `${ATTEMPT_PREFIX}2026-07-22T00:00:00.000Z:other-owner`;

interface HistoryState {
  id: string;
  business_id: string;
  telnyx_campaign_id: string;
  telnyx_deactivated: boolean | null;
  deactivation_error: string | null;
}

type QueryOperation = "select" | "insert" | "update";
type QueryFilter = {
  kind: "eq" | "is";
  column: string;
  value: unknown;
};
type QueryResult = { data?: unknown; error: { message: string } | null };

let campaignPointer: string | null;
let campaignStatus: string | null;
let campaignRejectionReason: string | null;
let assignedCampaignId: string | null;
let history: HistoryState | null;
let historyInsertCount: number;
let fenceClaimAttemptCount: number;
let confirmationAttemptCount: number;
let terminalTransitionCount: number;
let assignmentResetCount: number;
let clearAttemptCount: number;
let clearAppliedCount: number;
let failAssignmentOnce: boolean;
let failClearOnce: boolean;
let failFenceOnce: boolean;
let failConfirmationOnce: boolean;
let failTerminalTransitionOnce: boolean;
let commitConfirmationThenErrorOnce: boolean;
let commitTerminalThenErrorOnce: boolean;
let forceFenceCasLossOnce: boolean;
let replacePointerBeforeClearOnce: boolean;
let denyBeforeFenceOnce: boolean;
let denyAfterFenceOnce: boolean;

function matchesFilters(
  row: object,
  filters: QueryFilter[]
): boolean {
  const values = row as Record<string, unknown>;
  return filters.every(({ column, value }) => values[column] === value);
}

function currentBusinessRow() {
  return {
    id: BUSINESS_ID,
    telnyx_campaign_id: campaignPointer,
    campaign_status: campaignStatus,
    campaign_rejection_reason: campaignRejectionReason,
  };
}

function executeBusinessesQuery({
  operation,
  selection,
  payload,
  filters,
}: {
  operation: QueryOperation;
  selection: string | null;
  payload: Record<string, unknown> | null;
  filters: QueryFilter[];
}): QueryResult {
  if (operation === "select") {
    const row = currentBusinessRow();
    if (!matchesFilters(row, filters)) return { data: null, error: null };
    if (selection === "telnyx_campaign_id") {
      return {
        data: { telnyx_campaign_id: campaignPointer },
        error: null,
      };
    }
    return { data: row, error: null };
  }

  if (operation !== "update" || !payload) {
    throw new Error(`Unsupported businesses operation: ${operation}`);
  }

  clearAttemptCount += 1;
  if (failClearOnce) {
    failClearOnce = false;
    return { data: null, error: { message: "clear failed" } };
  }

  if (replacePointerBeforeClearOnce) {
    replacePointerBeforeClearOnce = false;
    campaignPointer = REPLACEMENT_CAMPAIGN_ID;
    campaignStatus = "pending";
    campaignRejectionReason = null;
  }

  const row = currentBusinessRow();
  if (!matchesFilters(row, filters)) return { data: null, error: null };

  campaignPointer = (payload.telnyx_campaign_id as string | null) ?? null;
  campaignStatus = (payload.campaign_status as string | null) ?? null;
  campaignRejectionReason =
    (payload.campaign_rejection_reason as string | null) ?? null;
  clearAppliedCount += 1;
  return { data: { id: BUSINESS_ID }, error: null };
}

function executeRejectedCampaignsQuery({
  operation,
  payload,
  filters,
}: {
  operation: QueryOperation;
  payload: Record<string, unknown> | null;
  filters: QueryFilter[];
}): QueryResult {
  if (operation === "select") {
    if (!history || !matchesFilters(history, filters)) {
      return { data: null, error: null };
    }
    return { data: { ...history }, error: null };
  }

  if (operation === "insert") {
    if (!payload) throw new Error("Missing rejected-campaign insert payload");
    historyInsertCount += 1;
    history = {
      id: HISTORY_ID,
      business_id: String(payload.business_id),
      telnyx_campaign_id: String(payload.telnyx_campaign_id),
      telnyx_deactivated:
        (payload.telnyx_deactivated as boolean | null) ?? false,
      deactivation_error:
        (payload.deactivation_error as string | null) ?? null,
    };
    return { data: { ...history }, error: null };
  }

  if (operation !== "update" || !payload || !history) {
    throw new Error("Unsupported rejected-campaign update");
  }

  const nextError = payload.deactivation_error;
  const isAttemptClaim =
    typeof nextError === "string" && nextError.startsWith(ATTEMPT_PREFIX);
  const isConfirmation = payload.telnyx_deactivated === true;
  const isTerminalTransition =
    typeof nextError === "string" && !nextError.startsWith(ATTEMPT_PREFIX);

  if (isAttemptClaim) {
    fenceClaimAttemptCount += 1;
    if (failFenceOnce) {
      failFenceOnce = false;
      return { data: null, error: { message: "fence unavailable" } };
    }
    if (forceFenceCasLossOnce) {
      forceFenceCasLossOnce = false;
      history.deactivation_error = OTHER_ATTEMPT;
      return { data: null, error: null };
    }
  }

  if (isConfirmation) {
    confirmationAttemptCount += 1;
    if (commitConfirmationThenErrorOnce) {
      commitConfirmationThenErrorOnce = false;
      Object.assign(history, payload);
      return {
        data: null,
        error: { message: "confirmation committed before response failed" },
      };
    }
    if (failConfirmationOnce) {
      failConfirmationOnce = false;
      return { data: null, error: { message: "confirmation unavailable" } };
    }
  }

  if (isTerminalTransition) terminalTransitionCount += 1;
  if (isTerminalTransition && commitTerminalThenErrorOnce) {
    commitTerminalThenErrorOnce = false;
    Object.assign(history, payload);
    return {
      data: null,
      error: { message: "terminal state committed before response failed" },
    };
  }
  if (isTerminalTransition && failTerminalTransitionOnce) {
    failTerminalTransitionOnce = false;
    return { data: null, error: { message: "terminal state unavailable" } };
  }

  if (!matchesFilters(history, filters)) {
    return { data: null, error: null };
  }

  if (Object.prototype.hasOwnProperty.call(payload, "telnyx_deactivated")) {
    history.telnyx_deactivated = payload.telnyx_deactivated as boolean;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "deactivation_error")) {
    history.deactivation_error = payload.deactivation_error as string | null;
  }
  return { data: { id: history.id }, error: null };
}

function executePhoneNumbersQuery({
  operation,
  payload,
  filters,
}: {
  operation: QueryOperation;
  payload: Record<string, unknown> | null;
  filters: QueryFilter[];
}): QueryResult {
  if (operation !== "update" || !payload) {
    throw new Error(`Unsupported phone_numbers operation: ${operation}`);
  }

  assignmentResetCount += 1;
  if (failAssignmentOnce) {
    failAssignmentOnce = false;
    return { error: { message: "assignment reset failed" } };
  }

  const row = {
    business_id: BUSINESS_ID,
    is_active: true,
    telnyx_campaign_assignment_campaign_id: assignedCampaignId,
  };
  if (matchesFilters(row, filters)) {
    assignedCampaignId =
      (payload.telnyx_campaign_assignment_campaign_id as string | null) ??
      null;
  }
  return { error: null };
}

function createQuery(table: string) {
  let operation: QueryOperation = "select";
  let selection: string | null = null;
  let payload: Record<string, unknown> | null = null;
  const filters: QueryFilter[] = [];
  let resultPromise: Promise<QueryResult> | null = null;

  const execute = () => {
    if (!resultPromise) {
      const input = { operation, selection, payload, filters };
      const result =
        table === "businesses"
          ? executeBusinessesQuery(input)
          : table === "rejected_campaigns"
            ? executeRejectedCampaignsQuery(input)
            : table === "phone_numbers"
              ? executePhoneNumbersQuery(input)
              : (() => {
                  throw new Error(`Unexpected table ${table}`);
                })();
      resultPromise = Promise.resolve(result);
    }
    return resultPromise;
  };

  const chain: Record<string, unknown> = {};
  chain.select = vi.fn((columns: string) => {
    selection = columns;
    return chain;
  });
  chain.insert = vi.fn((values: Record<string, unknown>) => {
    operation = "insert";
    payload = values;
    return chain;
  });
  chain.update = vi.fn((values: Record<string, unknown>) => {
    operation = "update";
    payload = values;
    return chain;
  });
  chain.eq = vi.fn((column: string, value: unknown) => {
    filters.push({ kind: "eq", column, value });
    return chain;
  });
  chain.is = vi.fn((column: string, value: unknown) => {
    filters.push({ kind: "is", column, value });
    return chain;
  });
  chain.single = vi.fn(execute);
  chain.maybeSingle = vi.fn(execute);
  chain.then = (
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) => execute().then(onFulfilled, onRejected);

  return chain;
}

function seedHistory({
  deactivated = false,
  error = READY,
}: {
  deactivated?: boolean | null;
  error?: string | null;
} = {}) {
  history = {
    id: HISTORY_ID,
    business_id: BUSINESS_ID,
    telnyx_campaign_id: CAMPAIGN_ID,
    telnyx_deactivated: deactivated,
    deactivation_error: error,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  campaignPointer = CAMPAIGN_ID;
  campaignStatus = "rejected";
  campaignRejectionReason = "Carrier rejection";
  assignedCampaignId = CAMPAIGN_ID;
  history = null;
  historyInsertCount = 0;
  fenceClaimAttemptCount = 0;
  confirmationAttemptCount = 0;
  terminalTransitionCount = 0;
  assignmentResetCount = 0;
  clearAttemptCount = 0;
  clearAppliedCount = 0;
  failAssignmentOnce = false;
  failClearOnce = false;
  failFenceOnce = false;
  failConfirmationOnce = false;
  failTerminalTransitionOnce = false;
  commitConfirmationThenErrorOnce = false;
  commitTerminalThenErrorOnce = false;
  forceFenceCasLossOnce = false;
  replacePointerBeforeClearOnce = false;
  denyBeforeFenceOnce = false;
  denyAfterFenceOnce = false;

  mocks.providerDeactivate.mockResolvedValue(undefined);
  mocks.deactivateCampaign.mockImplementation(
    async (
      _scope: unknown,
      options?: { beforeMutation?: () => Promise<"proceed" | "skip"> }
    ) => {
      if (denyBeforeFenceOnce) {
        denyBeforeFenceOnce = false;
        throw new mocks.TelnyxRemoteMutationAuthorizationError(
          "authorization denied before fence"
        );
      }
      const decision = (await options?.beforeMutation?.()) ?? "proceed";
      if (decision === "skip") return "skipped";
      if (denyAfterFenceOnce) {
        denyAfterFenceOnce = false;
        throw new mocks.TelnyxRemoteMutationAuthorizationError(
          "authorization denied after fence"
        );
      }
      await mocks.providerDeactivate();
      return "deactivated";
    }
  );
  mocks.from.mockImplementation(createQuery);
});

describe("rejected campaign retry idempotency", () => {
  it("calls the provider once when Retry follows assignment-reset failure", async () => {
    failAssignmentOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to reset number assignment state");
    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();
    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(historyInsertCount).toBe(1);
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(confirmationAttemptCount).toBe(1);
    expect(assignmentResetCount).toBe(2);
    expect(clearAttemptCount).toBe(1);
    expect(clearAppliedCount).toBe(1);
    expect(campaignPointer).toBeNull();
  });

  it("calls the provider once when Retry follows pointer-clear failure", async () => {
    failClearOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to clear rejected campaign");
    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(historyInsertCount).toBe(1);
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(assignmentResetCount).toBe(2);
    expect(clearAttemptCount).toBe(2);
    expect(clearAppliedCount).toBe(1);
    expect(campaignPointer).toBeNull();
  });

  it("terminalizes provider success when confirmation persistence fails and Retry never calls the provider again", async () => {
    failConfirmationOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_outcome_persist_failed",
    });

    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: expect.stringContaining(
        "returned success, but SimplAssist could not persist confirmation"
      ),
    });
    expect(terminalTransitionCount).toBe(1);
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(fenceClaimAttemptCount).toBe(1);
    expect(confirmationAttemptCount).toBe(1);
    expect(campaignPointer).toBeNull();
  });

  it("records a provider failure once and Retry performs only local cleanup", async () => {
    failAssignmentOnce = true;
    mocks.providerDeactivate.mockRejectedValueOnce(
      new Error("ambiguous provider timeout")
    );

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to reset number assignment state");
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: `${PROVIDER_ERROR_PREFIX}ambiguous provider timeout`,
    });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(fenceClaimAttemptCount).toBe(1);
    expect(terminalTransitionCount).toBe(1);
    expect(campaignPointer).toBeNull();
  });

  it("namespaces a provider error that exactly matches the READY control value", async () => {
    failAssignmentOnce = true;
    mocks.providerDeactivate.mockRejectedValueOnce(new Error(READY));

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to reset number assignment state");
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: `${PROVIDER_ERROR_PREFIX}${READY}`,
    });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(fenceClaimAttemptCount).toBe(1);
    expect(campaignPointer).toBeNull();
  });

  it("keeps an unresolved fence fail-closed when a provider failure cannot be terminalized", async () => {
    failTerminalTransitionOnce = true;
    mocks.providerDeactivate.mockRejectedValueOnce(
      new Error("ambiguous provider timeout")
    );

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_outcome_persist_failed",
    });
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(history?.deactivation_error).toMatch(
      new RegExp(`^${ATTEMPT_PREFIX}`)
    );
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_reconciliation_required",
    });

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);
    expect(campaignPointer).toBe(CAMPAIGN_ID);
  });

  it("accepts a confirmation write that committed before its database response failed", async () => {
    commitConfirmationThenErrorOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();
    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(history).toMatchObject({
      telnyx_deactivated: true,
      deactivation_error: null,
    });
    expect(campaignPointer).toBeNull();
  });

  it("accepts a terminal failure write that committed before its response failed and Retry never calls again", async () => {
    commitTerminalThenErrorOnce = true;
    failAssignmentOnce = true;
    mocks.providerDeactivate.mockRejectedValueOnce(
      new Error("ambiguous provider timeout")
    );

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to reset number assignment state");
    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: `${PROVIDER_ERROR_PREFIX}ambiguous provider timeout`,
    });
    expect(campaignPointer).toBeNull();
  });

  it("makes no provider call when fence acquisition fails, then exactly one after a safe Retry", async () => {
    failFenceOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_fence_unavailable",
    });
    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);
    expect(campaignPointer).toBe(CAMPAIGN_ID);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(fenceClaimAttemptCount).toBe(2);
    expect(campaignPointer).toBeNull();
  });

  it("fails closed with zero provider or cleanup calls when another owner wins the fence CAS", async () => {
    seedHistory();
    forceFenceCasLossOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_reconciliation_required",
    });

    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);
    expect(campaignPointer).toBe(CAMPAIGN_ID);
    expect(history?.deactivation_error).toBe(OTHER_ATTEMPT);
  });

  it.each([
    {
      label: "confirmed",
      deactivated: true,
      error: null,
    },
    {
      label: "terminal provider failure",
      deactivated: false,
      error: "provider rejected the deactivation",
    },
  ])(
    "performs only local cleanup for a prior $label state",
    async ({ deactivated, error }) => {
      seedHistory({ deactivated, error });

      await expect(
        archiveAndClearRejectedCampaign(BUSINESS_ID)
      ).resolves.toBeUndefined();

      expect(mocks.providerDeactivate).not.toHaveBeenCalled();
      expect(fenceClaimAttemptCount).toBe(0);
      expect(assignmentResetCount).toBe(1);
      expect(clearAppliedCount).toBe(1);
      expect(campaignPointer).toBeNull();
    }
  );

  it("does not clear a concurrently installed replacement campaign pointer", async () => {
    replacePointerBeforeClearOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(clearAttemptCount).toBe(1);
    expect(clearAppliedCount).toBe(0);
    expect(campaignPointer).toBe(REPLACEMENT_CAMPAIGN_ID);
  });

  it("defers at the provider while a concurrent Retry fails closed behind the durable fence", async () => {
    seedHistory();
    const provider = deferred<void>();
    mocks.providerDeactivate.mockReturnValueOnce(provider.promise);

    const owner = archiveAndClearRejectedCampaign(BUSINESS_ID);
    await vi.waitFor(() => {
      expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
      expect(history?.deactivation_error).toMatch(
        new RegExp(`^${ATTEMPT_PREFIX}`)
      );
    });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_reconciliation_required",
    });
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);

    provider.resolve();
    await expect(owner).resolves.toBeUndefined();

    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(campaignPointer).toBeNull();
  });

  it("makes no provider call on pre-fence authorization denial and calls it once after Retry", async () => {
    denyBeforeFenceOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toBeInstanceOf(
      mocks.TelnyxRemoteMutationAuthorizationError
    );
    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(history?.deactivation_error).toBe(READY);
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(campaignPointer).toBeNull();
  });

  it("releases a post-fence authorization denial so Retry makes exactly one provider call", async () => {
    denyAfterFenceOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toBeInstanceOf(
      mocks.TelnyxRemoteMutationAuthorizationError
    );
    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(history?.deactivation_error).toBe(READY);
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();
    expect(mocks.providerDeactivate).toHaveBeenCalledTimes(1);
    expect(fenceClaimAttemptCount).toBe(2);
    expect(campaignPointer).toBeNull();
  });

  it("rejects an unresolved prior attempt without calling the provider or touching local pointers", async () => {
    seedHistory({ error: OTHER_ATTEMPT });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toBeInstanceOf(CampaignDeactivationStateError);

    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);
    expect(campaignPointer).toBe(CAMPAIGN_ID);
  });

  it("fails closed on a legacy false/null history row that may already have called Telnyx", async () => {
    seedHistory({ error: null });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_reconciliation_required",
    });

    expect(mocks.providerDeactivate).not.toHaveBeenCalled();
    expect(assignmentResetCount).toBe(0);
    expect(clearAttemptCount).toBe(0);
    expect(campaignPointer).toBe(CAMPAIGN_ID);
  });
});
