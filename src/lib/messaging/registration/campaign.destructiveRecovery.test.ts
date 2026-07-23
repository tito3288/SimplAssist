import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  deactivateCampaign: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    messaging10dlc: {
      campaign: {
        deactivate: mocks.deactivateCampaign,
      },
    },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));
vi.mock("./audit", () => ({
  appendRegistrationEvent: vi.fn(),
  serializeError: vi.fn(),
}));
vi.mock("./legalUrls", () => ({ resolveLegalUrls: vi.fn() }));
vi.mock("./riskScreening", () => ({
  buildA2pRiskInputForBusiness: vi.fn(),
  hashA2pRiskInput: vi.fn(),
}));

import { archiveAndClearRejectedCampaign } from "./campaign";
import { TelnyxRemoteMutationAuthorizationError } from "../telnyxDestructive";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "CMN3FR1";
const HISTORY_ID = "10000000-0000-4000-8000-000000000001";
const PROTECTED_MESSAGING_PROFILE_ID =
  "00000000-0000-4000-8000-000000000004";
const PROTECTED_VOICE_APPLICATION_ID = "123456789";
const ATTEMPT_PREFIX = "SIMPLASSIST_CAMPAIGN_DEACTIVATION_ATTEMPT_V1:";
const READY = "SIMPLASSIST_CAMPAIGN_DEACTIVATION_READY_V1";
const PROVIDER_ERROR_PREFIX =
  "SIMPLASSIST_CAMPAIGN_DEACTIVATION_PROVIDER_ERROR_V1:";

const AUTHORIZATION = {
  authorized: true,
  business_id: BUSINESS_ID,
  context: "rejection_recovery",
  operation: "deactivate_campaign",
  action_id: null,
  provider_id: CAMPAIGN_ID,
  canonical_e164: null,
  public_tcr_id: CAMPAIGN_ID,
  config_updated_at: "2026-07-22T05:00:00.000Z",
};

interface BusinessState {
  id: string;
  telnyx_campaign_id: string | null;
  campaign_status: string | null;
  campaign_rejection_reason: string | null;
}

interface HistoryState {
  id: string;
  business_id: string;
  telnyx_campaign_id: string;
  rejection_reason: string | null;
  telnyx_deactivated: boolean;
  deactivation_error: string | null;
}

type QueryOperation = "select" | "insert" | "update";

interface QueryFilter {
  column: string;
  value: unknown;
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

let business: BusinessState;
let history: HistoryState | null;
let phoneAssignmentCampaignId: string | null;
let historyInsertCount: number;
let assignmentResetCount: number;
let businessClearCount: number;
let failConfirmationOnce: boolean;
let disableRuntimeAfterFence: boolean;
let failAssignmentOnce: boolean;
let operationOrder: string[];

function matchesFilters(
  row: Record<string, unknown>,
  filters: QueryFilter[]
): boolean {
  return filters.every(({ column, value }) => row[column] === value);
}

function executeQuery(
  table: string,
  operation: QueryOperation,
  payload: Record<string, unknown> | null,
  filters: QueryFilter[]
): QueryResult {
  if (table === "businesses") {
    if (operation === "select") {
      return matchesFilters(business as unknown as Record<string, unknown>, filters)
        ? { data: { ...business }, error: null }
        : { data: null, error: null };
    }

    if (
      operation === "update" &&
      payload &&
      matchesFilters(business as unknown as Record<string, unknown>, filters)
    ) {
      Object.assign(business, payload);
      businessClearCount += 1;
      return { data: { id: business.id }, error: null };
    }
    return { data: null, error: null };
  }

  if (table === "rejected_campaigns") {
    if (operation === "select") {
      return history &&
        matchesFilters(history as unknown as Record<string, unknown>, filters)
        ? { data: { ...history }, error: null }
        : { data: null, error: null };
    }

    if (operation === "insert" && payload) {
      if (history) {
        return {
          data: null,
          error: { message: "duplicate rejected-campaign history" },
        };
      }
      history = {
        id: HISTORY_ID,
        business_id: String(payload.business_id),
        telnyx_campaign_id: String(payload.telnyx_campaign_id),
        rejection_reason:
          typeof payload.rejection_reason === "string"
            ? payload.rejection_reason
            : null,
        telnyx_deactivated: payload.telnyx_deactivated === true,
        deactivation_error:
          typeof payload.deactivation_error === "string"
            ? payload.deactivation_error
            : null,
      };
      historyInsertCount += 1;
      return { data: { ...history }, error: null };
    }

    if (
      operation === "update" &&
      payload &&
      history &&
      matchesFilters(history as unknown as Record<string, unknown>, filters)
    ) {
      const isFenceClaim =
        typeof payload.deactivation_error === "string" &&
        payload.deactivation_error.startsWith(ATTEMPT_PREFIX);
      const isConfirmation =
        payload.telnyx_deactivated === true &&
        payload.deactivation_error === null;

      if (isConfirmation && failConfirmationOnce) {
        failConfirmationOnce = false;
        return {
          data: null,
          error: { message: "confirmation marker write failed" },
        };
      }

      Object.assign(history, payload);
      if (isFenceClaim) {
        operationOrder.push("fence");
        if (disableRuntimeAfterFence) {
          vi.stubEnv("TELNYX_REMOTE_RELEASE_ENABLED", "0");
        }
      }
      return { data: { id: history.id }, error: null };
    }
    return { data: null, error: null };
  }

  if (table === "phone_numbers" && operation === "update" && payload) {
    const row = {
      business_id: BUSINESS_ID,
      is_active: true,
      telnyx_campaign_assignment_campaign_id: phoneAssignmentCampaignId,
    };
    if (matchesFilters(row, filters)) {
      assignmentResetCount += 1;
      if (failAssignmentOnce) {
        failAssignmentOnce = false;
        return {
          data: null,
          error: { message: "assignment reset failed" },
        };
      }
      phoneAssignmentCampaignId =
        typeof payload.telnyx_campaign_assignment_campaign_id === "string"
          ? payload.telnyx_campaign_assignment_campaign_id
          : null;
    }
    return { data: null, error: null };
  }

  throw new Error(
    `Unexpected ${operation} query for ${table}: ${JSON.stringify(filters)}`
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createQuery(table: string) {
  let operation: QueryOperation = "select";
  let payload: Record<string, unknown> | null = null;
  const filters: QueryFilter[] = [];

  const query = {
    select: vi.fn(() => query),
    insert: vi.fn((values: Record<string, unknown>) => {
      operation = "insert";
      payload = values;
      return query;
    }),
    update: vi.fn((values: Record<string, unknown>) => {
      operation = "update";
      payload = values;
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return query;
    }),
    is: vi.fn((column: string, value: unknown) => {
      filters.push({ column, value });
      return query;
    }),
    single: vi.fn(async () => executeQuery(table, operation, payload, filters)),
    maybeSingle: vi.fn(async () =>
      executeQuery(table, operation, payload, filters)
    ),
    then: (
      onFulfilled: (result: QueryResult) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) =>
      Promise.resolve(executeQuery(table, operation, payload, filters)).then(
        onFulfilled,
        onRejected
      ),
  };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TELNYX_REMOTE_RELEASE_ENABLED", "1");
  vi.stubEnv(
    "TELNYX_PROTECTED_MESSAGING_PROFILE_ID",
    PROTECTED_MESSAGING_PROFILE_ID
  );
  vi.stubEnv(
    "TELNYX_PROTECTED_VOICE_APPLICATION_ID",
    PROTECTED_VOICE_APPLICATION_ID
  );

  business = {
    id: BUSINESS_ID,
    telnyx_campaign_id: CAMPAIGN_ID,
    campaign_status: "rejected",
    campaign_rejection_reason: "Carrier rejection",
  };
  history = null;
  phoneAssignmentCampaignId = CAMPAIGN_ID;
  historyInsertCount = 0;
  assignmentResetCount = 0;
  businessClearCount = 0;
  failConfirmationOnce = false;
  disableRuntimeAfterFence = false;
  failAssignmentOnce = false;
  operationOrder = [];

  mocks.from.mockImplementation((table: string) => createQuery(table));
  mocks.rpc.mockImplementation(async () => {
    operationOrder.push(`authorize-${mocks.rpc.mock.calls.length}`);
    return { data: AUTHORIZATION, error: null };
  });
  mocks.deactivateCampaign.mockImplementation(async () => {
    operationOrder.push("provider");
  });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rejected-campaign destructive authorization", () => {
  it("authorizes twice before fencing and sends one non-retrying provider request", async () => {
    await archiveAndClearRejectedCampaign(BUSINESS_ID);

    expect(operationOrder.slice(0, 5)).toEqual([
      "authorize-1",
      "authorize-2",
      "fence",
      "authorize-3",
      "provider",
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    for (const call of mocks.rpc.mock.calls) {
      expect(call).toEqual([
        "authorize_telnyx_remote_mutation",
        expect.objectContaining({
          p_business_id: BUSINESS_ID,
          p_context: "rejection_recovery",
          p_operation: "deactivate_campaign",
          p_provider_id: CAMPAIGN_ID,
          p_action_id: null,
          p_lease_token: null,
        }),
      ]);
    }
    expect(mocks.deactivateCampaign).toHaveBeenCalledOnce();
    expect(mocks.deactivateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      maxRetries: 0,
    });
    expect(history).toMatchObject({
      telnyx_deactivated: true,
      deactivation_error: null,
    });
    expect(historyInsertCount).toBe(1);
    expect(assignmentResetCount).toBe(1);
    expect(businessClearCount).toBe(1);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("rethrows a typed denial and performs no provider or pointer cleanup", async () => {
    mocks.rpc.mockRejectedValue(new Error("authorization transport failed"));

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toBeInstanceOf(TelnyxRemoteMutationAuthorizationError);

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.deactivateCampaign).not.toHaveBeenCalled();
    expect(assignmentResetCount).toBe(0);
    expect(businessClearCount).toBe(0);
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: READY,
    });
    expect(historyInsertCount).toBe(1);
  });

  it("terminalizes an unconfirmed provider success and Retry never calls Telnyx again", async () => {
    failConfirmationOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      name: "CampaignDeactivationStateError",
      code: "campaign_deactivation_outcome_persist_failed",
    });

    expect(mocks.deactivateCampaign).toHaveBeenCalledOnce();
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: expect.stringContaining(
        "Telnyx campaign deactivation returned success"
      ),
    });
    expect(history?.deactivation_error).not.toMatch(ATTEMPT_PREFIX);
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);
    expect(assignmentResetCount).toBe(0);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(historyInsertCount).toBe(1);
    expect(assignmentResetCount).toBe(1);
    expect(businessClearCount).toBe(1);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("releases a fence when the final runtime gate denies, then Retry calls once", async () => {
    disableRuntimeAfterFence = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      name: "TelnyxRemoteMutationAuthorizationError",
      reason: "kill_switch_disabled",
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.deactivateCampaign).not.toHaveBeenCalled();
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: READY,
    });
    expect(assignmentResetCount).toBe(0);
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);

    disableRuntimeAfterFence = false;
    vi.stubEnv("TELNYX_REMOTE_RELEASE_ENABLED", "1");
    await archiveAndClearRejectedCampaign(BUSINESS_ID);

    expect(mocks.rpc).toHaveBeenCalledTimes(5);
    expect(mocks.deactivateCampaign).toHaveBeenCalledOnce();
    expect(mocks.deactivateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      maxRetries: 0,
    });
    expect(historyInsertCount).toBe(1);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("releases a fence when final database authorization is revoked, then Retry calls once", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: AUTHORIZATION, error: null })
      .mockResolvedValueOnce({ data: AUTHORIZATION, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      name: "TelnyxRemoteMutationAuthorizationError",
      reason: "authorization_response_invalid",
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(mocks.deactivateCampaign).not.toHaveBeenCalled();
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: READY,
    });
    expect(assignmentResetCount).toBe(0);
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);

    await archiveAndClearRejectedCampaign(BUSINESS_ID);

    expect(mocks.rpc).toHaveBeenCalledTimes(6);
    expect(mocks.deactivateCampaign).toHaveBeenCalledOnce();
    expect(mocks.deactivateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      maxRetries: 0,
    });
    expect(historyInsertCount).toBe(1);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("records an SDK timeout once and Retry resumes after assignment cleanup fails", async () => {
    failAssignmentOnce = true;
    mocks.deactivateCampaign.mockRejectedValueOnce(
      new Error("ambiguous provider timeout")
    );

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toThrow("Failed to reset number assignment state");
    expect(history).toMatchObject({
      telnyx_deactivated: false,
      deactivation_error: `${PROVIDER_ERROR_PREFIX}ambiguous provider timeout`,
    });
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
    expect(mocks.deactivateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      maxRetries: 0,
    });
    expect(historyInsertCount).toBe(1);
    expect(assignmentResetCount).toBe(2);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("allows one in-flight SDK call while a concurrent Retry fails closed", async () => {
    const provider = deferred<void>();
    mocks.deactivateCampaign.mockReturnValueOnce(provider.promise);

    const owner = archiveAndClearRejectedCampaign(BUSINESS_ID);
    await vi.waitFor(() => {
      expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
      expect(history?.deactivation_error).toMatch(
        new RegExp(`^${ATTEMPT_PREFIX}`)
      );
    });

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID)
    ).rejects.toMatchObject({
      code: "campaign_deactivation_reconciliation_required",
    });
    expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
    expect(assignmentResetCount).toBe(0);
    expect(business.telnyx_campaign_id).toBe(CAMPAIGN_ID);

    provider.resolve();
    await expect(owner).resolves.toBeUndefined();

    expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
    expect(historyInsertCount).toBe(1);
    expect(business.telnyx_campaign_id).toBeNull();
  });

  it("fences a pending child campaign during brand re-file and Retry calls the SDK once", async () => {
    business.campaign_status = "pending";
    business.campaign_rejection_reason = null;
    failAssignmentOnce = true;

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID, {
        cause: "brand_refile",
      })
    ).rejects.toThrow("Failed to reset number assignment state");

    await expect(
      archiveAndClearRejectedCampaign(BUSINESS_ID, {
        cause: "brand_refile",
      })
    ).resolves.toBeUndefined();

    expect(mocks.deactivateCampaign).toHaveBeenCalledTimes(1);
    expect(mocks.deactivateCampaign).toHaveBeenCalledWith(CAMPAIGN_ID, {
      maxRetries: 0,
    });
    expect(historyInsertCount).toBe(1);
    expect(assignmentResetCount).toBe(2);
    expect(business.telnyx_campaign_id).toBeNull();
  });
});
