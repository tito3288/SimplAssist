import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  CalendarProviderOperationBusyError,
  CalendarProviderOperationConflictError,
  CalendarProviderOperationStateError,
  CalendarProviderSlotUnavailableError,
  acquireCalendarProviderOperation,
  buildCalendarProviderEvidence,
  calendarProviderRequestFingerprint,
  claimNextCalendarProviderOperationReconciliation,
  createDeterministicGoogleEventId,
  isDefinitiveCalendarProviderFailure,
  markCalendarProviderSubmissionStarted,
  readCalendarProviderOperation,
} from "./calendarProviderOperations.server";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OPERATION_ID = "10000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "20000000-0000-4000-8000-000000000001";
const START = "2026-07-20T13:00:00.000Z";
const END = "2026-07-20T14:00:00.000Z";
const FINGERPRINT = "a".repeat(64);

function operation(overrides: Record<string, unknown> = {}) {
  const deterministicId = OPERATION_ID.replaceAll("-", "");
  return {
    id: OPERATION_ID,
    business_id: BUSINESS_ID,
    operation_kind: "create",
    google_calendar_id: "primary",
    desired_starts_at: START,
    desired_ends_at: END,
    linked_booking_id: null,
    deterministic_google_event_id: deterministicId,
    target_google_event_id: null,
    provider_target_event_id: deterministicId,
    request_fingerprint: FINGERPRINT,
    status: "holding",
    claim_token: CLAIM_TOKEN,
    claimed_at: START,
    claim_expires_at: END,
    claim_released_at: null,
    reconciliation_review_after_at: "2026-07-22T13:00:00.000Z",
    attempt_count: 1,
    provider_submission_started_at: null,
    provider_event_id: null,
    provider_starts_at: null,
    provider_ends_at: null,
    provider_evidence: null,
    provider_applied_at: null,
    finalized_at: null,
    failed_at: null,
    failure_reason: null,
    reconciliation_claim_token: null,
    reconciliation_claimed_at: null,
    reconciliation_claim_expires_at: null,
    reconciliation_attempt_count: 0,
    reconciliation_attempted_at: null,
    created_at: START,
    updated_at: START,
    ...overrides,
  };
}

function acquireInput() {
  return {
    operationId: OPERATION_ID,
    businessId: BUSINESS_ID,
    kind: "create" as const,
    calendarId: "primary",
    startsAt: START,
    endsAt: END,
    linkedBookingId: null,
    deterministicGoogleEventId: OPERATION_ID.replaceAll("-", ""),
    targetGoogleEventId: null,
    requestPayload: {
      title: "Private title",
      titleProvided: true,
      description: "Private description",
      descriptionProvided: true,
      startTime: START,
      endTime: END,
      eventId: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const chain = {} as {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: typeof mocks.maybeSingle;
  };
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.maybeSingle = mocks.maybeSingle;
  mocks.from.mockReturnValue(chain);
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
});

describe("calendar provider operation identity", () => {
  it("derives a Google base32hex-safe deterministic ID from the request UUID", () => {
    expect(createDeterministicGoogleEventId(OPERATION_ID)).toBe(
      "10000000000040008000000000000001"
    );
  });

  it("rejects non-UUID operation identities", () => {
    expect(() => createDeterministicGoogleEventId("attacker-event-id")).toThrow(
      TypeError
    );
  });

  it("fingerprints exact submitted omission semantics without returning content", () => {
    const input = acquireInput();
    const first = calendarProviderRequestFingerprint(input);
    const exactRetry = calendarProviderRequestFingerprint({ ...input });
    const omittedDescription = calendarProviderRequestFingerprint({
      ...input,
      requestPayload: {
        ...input.requestPayload,
        description: null,
        descriptionProvided: false,
      },
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(exactRetry).toBe(first);
    expect(omittedDescription).not.toBe(first);
    expect(first).not.toContain("Private title");
    expect(first).not.toContain("Private description");
  });
});

describe("calendar provider operation database boundary", () => {
  it("sends only stable identity, times, and a fingerprint to acquisition", async () => {
    const input = acquireInput();
    const fingerprint = calendarProviderRequestFingerprint(input);
    mocks.rpc.mockImplementation(async (_name, args) => ({
      data: operation({
        request_fingerprint: fingerprint,
        claim_token: args.p_claim_token,
      }),
      error: null,
    }));

    await acquireCalendarProviderOperation(input);

    const [, args] = mocks.rpc.mock.calls[0];
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_calendar_provider_operation",
      expect.objectContaining({
        p_operation_id: OPERATION_ID,
        p_request_fingerprint: fingerprint,
      })
    );
    expect(JSON.stringify(args)).not.toContain("Private title");
    expect(JSON.stringify(args)).not.toContain("Private description");
    expect(args).not.toHaveProperty("p_request_payload");
  });

  it.each([
    [
      { code: "23P01", message: "calendar_provider_slot_unavailable" },
      CalendarProviderSlotUnavailableError,
    ],
    [
      { code: "55P03", message: "calendar_provider_operation_busy" },
      CalendarProviderOperationBusyError,
    ],
    [
      { code: "23514", message: "calendar_provider_operation_idempotency_conflict" },
      CalendarProviderOperationConflictError,
    ],
  ])("maps typed SQL failures without exposing detail", async (error, Type) => {
    mocks.rpc.mockResolvedValue({ data: null, error });

    await expect(acquireCalendarProviderOperation(acquireInput())).rejects.toBeInstanceOf(
      Type
    );
  });

  it("fails closed on malformed lifecycle rows", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: operation({ reconciliation_attempt_count: -1 }),
      error: null,
    });

    await expect(
      readCalendarProviderOperation(BUSINESS_ID, OPERATION_ID)
    ).rejects.toBeInstanceOf(CalendarProviderOperationStateError);
  });

  it("rejects provider evidence containing raw provider or customer fields", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: operation({
        status: "provider_applied",
        claim_token: null,
        claimed_at: null,
        claim_expires_at: null,
        provider_submission_started_at: START,
        provider_event_id: OPERATION_ID.replaceAll("-", ""),
        provider_starts_at: START,
        provider_ends_at: END,
        provider_evidence: {
          operation_marker_verified: true,
          raw_title: "private customer appointment",
        },
        provider_applied_at: START,
      }),
      error: null,
    });

    await expect(
      readCalendarProviderOperation(BUSINESS_ID, OPERATION_ID)
    ).rejects.toBeInstanceOf(CalendarProviderOperationStateError);
  });

  it("marks the provider side-effect fence with the exact active claim", async () => {
    mocks.rpc.mockResolvedValue({
      data: operation({
        provider_submission_started_at: START,
        claim_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
      error: null,
    });

    await markCalendarProviderSubmissionStarted(
      BUSINESS_ID,
      OPERATION_ID,
      CLAIM_TOKEN
    );

    expect(mocks.rpc).toHaveBeenCalledWith(
      "mark_calendar_provider_submission_started",
      {
        p_business_id: BUSINESS_ID,
        p_operation_id: OPERATION_ID,
        p_claim_token: CLAIM_TOKEN,
      }
    );
  });

  it("returns null when the atomic fair reconciliation queue is empty", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      claimNextCalendarProviderOperationReconciliation()
    ).resolves.toBeNull();
  });

  it("requires the atomic reconciliation lease in the decoded response", async () => {
    mocks.rpc.mockImplementation(async (_name, args) => ({
      data: operation({
        claim_token: args.p_claim_token,
        reconciliation_claim_token: args.p_claim_token,
        reconciliation_claimed_at: START,
        reconciliation_claim_expires_at: END,
        reconciliation_attempt_count: 1,
        reconciliation_attempted_at: START,
      }),
      error: null,
    }));

    const claimed = await claimNextCalendarProviderOperationReconciliation();

    expect(claimed?.operation.status).toBe("holding");
    expect(claimed?.operation.reconciliation_attempt_count).toBe(1);
  });
});

describe("content-free provider evidence", () => {
  it("hashes etags and persists no provider body/title/contact content", () => {
    const evidence = buildCalendarProviderEvidence(
      {
        id: "event-1",
        status: "confirmed",
        etag: '"private-etag"',
        summary: "Customer medical appointment",
        description: "customer@example.test bearer-secret",
        extendedProperties: {
          private: { simplassistCalendarOperationId: OPERATION_ID },
        },
      },
      OPERATION_ID
    );

    expect(evidence).toEqual({
      operation_marker_verified: true,
      provider_status: "confirmed",
      provider_etag_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(evidence)).not.toContain("medical appointment");
    expect(JSON.stringify(evidence)).not.toContain("customer@example.test");
    expect(JSON.stringify(evidence)).not.toContain("private-etag");
  });

  it("rejects cancelled resources as live provider evidence", () => {
    expect(() =>
      buildCalendarProviderEvidence(
        {
          status: "cancelled",
          extendedProperties: {
            private: { simplassistCalendarOperationId: OPERATION_ID },
          },
        },
        OPERATION_ID
      )
    ).toThrow(CalendarProviderOperationStateError);
  });
});

describe("provider failure classification", () => {
  it("keeps client-cancelled HTTP 499 ambiguous after the provider fence", () => {
    expect(
      isDefinitiveCalendarProviderFailure({ response: { status: 499 } })
    ).toBe(false);
    expect(
      isDefinitiveCalendarProviderFailure({ response: { status: 400 } })
    ).toBe(true);
  });
});
