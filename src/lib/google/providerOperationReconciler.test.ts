import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedClient: vi.fn(),
  getCalendarService: vi.fn(),
  eventsGet: vi.fn(),
  claimNext: vi.fn(),
  fail: vi.fn(),
  finalize: vi.fn(),
  hasMarker: vi.fn(),
  markDeleteApplied: vi.fn(),
  markApplied: vi.fn(),
  resolveAbsent: vi.fn(),
  buildEvidence: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./client", () => ({
  getAuthenticatedClient: mocks.getAuthenticatedClient,
  getCalendarService: mocks.getCalendarService,
}));
vi.mock("./calendarProviderOperations.server", () => ({
  claimNextCalendarProviderOperationReconciliation: mocks.claimNext,
  failCalendarProviderOperation: mocks.fail,
  finalizeCalendarProviderOperation: mocks.finalize,
  hasCalendarProviderOperationMarker: mocks.hasMarker,
  markCalendarProviderDeleteApplied: mocks.markDeleteApplied,
  markCalendarProviderOperationApplied: mocks.markApplied,
  resolveCalendarProviderOperationAbsent: mocks.resolveAbsent,
  buildCalendarProviderEvidence: mocks.buildEvidence,
}));

import { reconcileCalendarProviderOperations } from "./providerOperationReconciler";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OPERATION_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const EVENT_ID = "10000000000040008000000000000001";
const START = "2026-08-20T13:00:00.000Z";
const END = "2026-08-20T14:00:00.000Z";

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: OPERATION_ID,
    business_id: BUSINESS_ID,
    operation_kind: "create",
    google_calendar_id: "primary",
    desired_starts_at: START,
    desired_ends_at: END,
    linked_booking_id: null,
    deterministic_google_event_id: EVENT_ID,
    target_google_event_id: null,
    provider_target_event_id: EVENT_ID,
    request_fingerprint: "a".repeat(64),
    status: "holding",
    claim_token: CLAIM_TOKEN,
    claimed_at: START,
    claim_expires_at: END,
    claim_released_at: null,
    reconciliation_review_after_at: "2026-08-22T13:00:00.000Z",
    attempt_count: 2,
    provider_submission_started_at: START,
    provider_event_id: null,
    provider_starts_at: null,
    provider_ends_at: null,
    provider_evidence: null,
    provider_applied_at: null,
    finalized_at: null,
    failed_at: null,
    failure_reason: null,
    reconciliation_claim_token: CLAIM_TOKEN,
    reconciliation_claimed_at: START,
    reconciliation_claim_expires_at: END,
    reconciliation_attempt_count: 1,
    reconciliation_attempted_at: START,
    created_at: START,
    updated_at: START,
    ...overrides,
  };
}

function claim(value = operation()) {
  return { operation: value, claimToken: CLAIM_TOKEN };
}

function providerEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    status: "confirmed",
    start: { dateTime: START },
    end: { dateTime: END },
    extendedProperties: {
      private: { simplassistCalendarOperationId: OPERATION_ID },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.claimNext
    .mockResolvedValueOnce(claim())
    .mockResolvedValueOnce(null);
  mocks.getAuthenticatedClient.mockResolvedValue({ credentials: {} });
  mocks.getCalendarService.mockReturnValue({
    events: { get: mocks.eventsGet },
  });
  mocks.eventsGet.mockResolvedValue({ data: providerEvent() });
  mocks.hasMarker.mockReturnValue(true);
  mocks.buildEvidence.mockReturnValue({
    operation_marker_verified: true,
    provider_status: "confirmed",
  });
  mocks.fail.mockResolvedValue(operation({ status: "failed" }));
  mocks.markApplied.mockResolvedValue(
    operation({ status: "provider_applied" }),
  );
  mocks.markDeleteApplied.mockResolvedValue(
    operation({ operation_kind: "delete", status: "provider_applied" }),
  );
  mocks.finalize.mockResolvedValue(operation({ status: "finalized" }));
  mocks.resolveAbsent.mockResolvedValue(operation({ status: "failed" }));
});

describe("calendar provider operation reconciliation", () => {
  it("finalizes durable provider evidence locally without credentials or a provider read", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(
          operation({
            status: "provider_applied",
            claim_token: null,
            claimed_at: null,
            claim_expires_at: null,
            provider_event_id: EVENT_ID,
            provider_starts_at: START,
            provider_ends_at: END,
            provider_evidence: { operation_marker_verified: true },
            provider_applied_at: START,
          }),
        ),
      )
      .mockResolvedValueOnce(null);

    await expect(reconcileCalendarProviderOperations()).resolves.toEqual({
      attempted: 1,
      finalized: 1,
      failed: 0,
      deferred: 0,
    });

    expect(mocks.finalize).toHaveBeenCalledWith(BUSINESS_ID, OPERATION_ID);
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.eventsGet).not.toHaveBeenCalled();
  });

  it("fails an abandoned pre-submit hold without provider work", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(operation({ provider_submission_started_at: null })),
      )
      .mockResolvedValueOnce(null);

    await expect(reconcileCalendarProviderOperations()).resolves.toEqual({
      attempted: 1,
      finalized: 0,
      failed: 1,
      deferred: 0,
    });

    expect(mocks.fail).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "Provider submission was never started.",
    );
    expect(mocks.getAuthenticatedClient).not.toHaveBeenCalled();
  });

  it("recovers an exact marked CREATE with one bounded, non-retrying GET", async () => {
    await expect(reconcileCalendarProviderOperations()).resolves.toEqual({
      attempted: 1,
      finalized: 1,
      failed: 0,
      deferred: 0,
    });

    expect(mocks.eventsGet).toHaveBeenCalledWith(
      { calendarId: "primary", eventId: EVENT_ID },
      { timeout: 5_000, retry: false },
    );
    expect(mocks.markApplied).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      operationId: OPERATION_ID,
      claimToken: CLAIM_TOKEN,
      providerEventId: EVENT_ID,
      providerStartsAt: START,
      providerEndsAt: END,
      evidence: {
        operation_marker_verified: true,
        provider_status: "confirmed",
      },
    });
    expect(mocks.markApplied).toHaveBeenCalledBefore(mocks.finalize);
  });

  it.each([404, 410])(
    "terminal-fails an absent submitted CREATE after provider %s",
    async (status) => {
      mocks.eventsGet.mockRejectedValue({ response: { status } });

      await expect(reconcileCalendarProviderOperations()).resolves.toEqual({
        attempted: 1,
        finalized: 0,
        failed: 1,
        deferred: 0,
      });

      expect(mocks.fail).toHaveBeenCalledWith(
        BUSINESS_ID,
        OPERATION_ID,
        CLAIM_TOKEN,
        "Provider create did not apply.",
      );
      expect(mocks.markApplied).not.toHaveBeenCalled();
    },
  );

  it("treats a cancelled CREATE resource as verified absence", async () => {
    mocks.eventsGet.mockResolvedValue({
      data: providerEvent({ status: "cancelled" }),
    });

    const counts = await reconcileCalendarProviderOperations();

    expect(counts.failed).toBe(1);
    expect(mocks.fail).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "Provider create did not apply.",
    );
  });

  it("atomically resolves an absent UPDATE so its linked booking can be cancelled", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(
          operation({
            operation_kind: "update",
            deterministic_google_event_id: null,
            target_google_event_id: "existing-event",
            provider_target_event_id: "existing-event",
            linked_booking_id: "30000000-0000-4000-8000-000000000001",
          }),
        ),
      )
      .mockResolvedValueOnce(null);
    mocks.eventsGet.mockRejectedValue({ code: 410 });

    const counts = await reconcileCalendarProviderOperations();

    expect(counts.failed).toBe(1);
    expect(mocks.resolveAbsent).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
    );
    expect(mocks.fail).not.toHaveBeenCalled();
  });

  it("fails UPDATE when the target exists without the exact operation marker", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(
          operation({
            operation_kind: "update",
            deterministic_google_event_id: null,
            target_google_event_id: "existing-event",
            provider_target_event_id: "existing-event",
          }),
        ),
      )
      .mockResolvedValueOnce(null);
    mocks.eventsGet.mockResolvedValue({
      data: providerEvent({ id: "existing-event" }),
    });
    mocks.hasMarker.mockReturnValue(false);

    const counts = await reconcileCalendarProviderOperations();

    expect(counts.failed).toBe(1);
    expect(mocks.fail).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "Provider mutation did not apply.",
    );
    expect(mocks.markApplied).not.toHaveBeenCalled();
  });

  it.each([
    { label: "404", kind: "404" as const },
    { label: "cancelled", kind: "cancelled" as const },
  ])("finalizes DELETE when provider absence is proven by $label", async ({ kind }) => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(
          operation({
            operation_kind: "delete",
            desired_starts_at: null,
            desired_ends_at: null,
            deterministic_google_event_id: null,
            target_google_event_id: "existing-event",
            provider_target_event_id: "existing-event",
          }),
        ),
      )
      .mockResolvedValueOnce(null);
    if (kind === "404") {
      mocks.eventsGet.mockRejectedValue({ code: 404 });
    } else {
      mocks.eventsGet.mockResolvedValue({
        data: providerEvent({ id: "existing-event", status: "cancelled" }),
      });
    }

    const counts = await reconcileCalendarProviderOperations();

    expect(counts.finalized).toBe(1);
    expect(mocks.markDeleteApplied).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "existing-event",
    );
    expect(mocks.markDeleteApplied).toHaveBeenCalledBefore(mocks.finalize);
  });

  it("never reissues a submitted DELETE when the target is still present", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext
      .mockResolvedValueOnce(
        claim(
          operation({
            operation_kind: "delete",
            desired_starts_at: null,
            desired_ends_at: null,
            deterministic_google_event_id: null,
            target_google_event_id: "existing-event",
            provider_target_event_id: "existing-event",
          }),
        ),
      )
      .mockResolvedValueOnce(null);
    mocks.eventsGet.mockResolvedValue({
      data: providerEvent({ id: "existing-event" }),
    });

    const counts = await reconcileCalendarProviderOperations();

    expect(counts.failed).toBe(1);
    expect(mocks.fail).toHaveBeenCalledWith(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN,
      "Provider delete did not apply.",
    );
    expect(mocks.markDeleteApplied).not.toHaveBeenCalled();
  });

  it("defers malformed or wrong-ID 2xx reads without terminalizing authority", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.eventsGet.mockResolvedValue({
      data: providerEvent({ id: "wrong-event" }),
    });

    await expect(reconcileCalendarProviderOperations()).resolves.toEqual({
      attempted: 1,
      finalized: 0,
      failed: 0,
      deferred: 1,
    });

    expect(mocks.fail).not.toHaveBeenCalled();
    expect(mocks.markApplied).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "[calendar:provider-reconciler] Operation deferred",
      { kind: "create", status: "holding" },
    );
  });

  it("does not log provider bodies, tokens, or raw error objects on uncertainty", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.eventsGet.mockRejectedValue(
      new Error("patient@example.test bearer-secret Private title"),
    );

    const counts = await reconcileCalendarProviderOperations();
    const serializedLogs = JSON.stringify(log.mock.calls);

    expect(counts.deferred).toBe(1);
    expect(serializedLogs).not.toContain("patient@example.test");
    expect(serializedLogs).not.toContain("bearer-secret");
    expect(serializedLogs).not.toContain("Private title");
  });

  it("leases at most two fair queue entries per heartbeat", async () => {
    mocks.claimNext.mockReset();
    mocks.claimNext.mockResolvedValue(claim(operation({
      provider_submission_started_at: null,
    })));

    const counts = await reconcileCalendarProviderOperations();

    expect(counts).toEqual({
      attempted: 2,
      finalized: 0,
      failed: 2,
      deferred: 0,
    });
    expect(mocks.claimNext).toHaveBeenCalledTimes(2);
  });
});
