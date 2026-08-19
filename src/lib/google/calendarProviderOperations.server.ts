import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const CALENDAR_PROVIDER_OPERATION_SELECT =
  "id,business_id,operation_kind,google_calendar_id,desired_starts_at,desired_ends_at,linked_booking_id,deterministic_google_event_id,target_google_event_id,provider_target_event_id,request_fingerprint,status,claim_token,claimed_at,claim_expires_at,claim_released_at,reconciliation_review_after_at,attempt_count,provider_submission_started_at,provider_event_id,provider_starts_at,provider_ends_at,provider_evidence,provider_applied_at,finalized_at,failed_at,failure_reason,reconciliation_claim_token,reconciliation_claimed_at,reconciliation_claim_expires_at,reconciliation_attempt_count,reconciliation_attempted_at,created_at,updated_at";

export const CALENDAR_OPERATION_PRIVATE_KEY =
  "simplassistCalendarOperationId";

export type CalendarProviderOperationKind = "create" | "update" | "delete";
export type CalendarProviderOperationStatus =
  | "holding"
  | "provider_applied"
  | "finalized"
  | "failed";

export interface CalendarProviderOperation {
  id: string;
  business_id: string;
  operation_kind: CalendarProviderOperationKind;
  google_calendar_id: string;
  desired_starts_at: string | null;
  desired_ends_at: string | null;
  linked_booking_id: string | null;
  deterministic_google_event_id: string | null;
  target_google_event_id: string | null;
  provider_target_event_id: string | null;
  request_fingerprint: string;
  status: CalendarProviderOperationStatus;
  claim_token: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  claim_released_at: string | null;
  reconciliation_review_after_at: string;
  attempt_count: number;
  provider_submission_started_at: string | null;
  provider_event_id: string | null;
  provider_starts_at: string | null;
  provider_ends_at: string | null;
  provider_evidence: Record<string, unknown> | null;
  provider_applied_at: string | null;
  finalized_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  reconciliation_claim_token: string | null;
  reconciliation_claimed_at: string | null;
  reconciliation_claim_expires_at: string | null;
  reconciliation_attempt_count: number;
  reconciliation_attempted_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CalendarProviderOperationRequestPayload = {
  title: string | null;
  titleProvided: boolean;
  description: string | null;
  descriptionProvided: boolean;
  startTime: string | null;
  endTime: string | null;
  eventId: string | null;
};

export type AcquireCalendarProviderOperationInput = {
  operationId: string;
  businessId: string;
  kind: CalendarProviderOperationKind;
  calendarId: string;
  startsAt: string | null;
  endsAt: string | null;
  linkedBookingId: string | null;
  deterministicGoogleEventId: string | null;
  targetGoogleEventId: string | null;
  requestPayload: CalendarProviderOperationRequestPayload;
};

export type AcquiredCalendarProviderOperation = {
  operation: CalendarProviderOperation;
  claimToken: string;
};

export type CalendarProviderEvidenceInput = {
  businessId: string;
  operationId: string;
  claimToken: string;
  providerEventId: string;
  providerStartsAt: string;
  providerEndsAt: string;
  evidence: CalendarProviderEvidence;
};

export type CalendarProviderEvidence = {
  operation_marker_verified?: true;
  provider_absence_verified?: true;
  provider_status?: "confirmed" | "tentative" | "unknown";
  provider_etag_sha256?: string;
};

export class CalendarProviderSlotUnavailableError extends Error {
  constructor() {
    super("The requested calendar time is unavailable.");
    this.name = "CalendarProviderSlotUnavailableError";
  }
}

export class CalendarProviderOperationBusyError extends Error {
  readonly retryable = true;

  constructor() {
    super("The calendar operation is already in progress.");
    this.name = "CalendarProviderOperationBusyError";
  }
}

export class CalendarProviderOperationConflictError extends Error {
  constructor() {
    super("The calendar operation identity was reused with different input.");
    this.name = "CalendarProviderOperationConflictError";
  }
}

export class CalendarProviderOperationStateError extends Error {
  readonly retryable = true;

  constructor(
    readonly operation: string,
    options?: ErrorOptions
  ) {
    super("Calendar operation state is temporarily unavailable.", options);
    this.name = "CalendarProviderOperationStateError";
  }
}

export function createDeterministicGoogleEventId(operationId: string): string {
  if (!UUID_PATTERN.test(operationId)) {
    throw new TypeError("Calendar operation ID must be a UUID.");
  }

  // Google accepts client-supplied event IDs using lower-case base32hex
  // characters. UUID hex is a strict subset and remains globally unique.
  return operationId.toLowerCase().replaceAll("-", "");
}

export function calendarProviderRequestFingerprint(
  input: Omit<AcquireCalendarProviderOperationInput, "operationId">
): string {
  const canonical = {
    businessId: input.businessId,
    kind: input.kind,
    calendarId: input.calendarId,
    startsAt: input.startsAt
      ? new Date(input.startsAt).toISOString()
      : null,
    endsAt: input.endsAt ? new Date(input.endsAt).toISOString() : null,
    linkedBookingId: input.linkedBookingId,
    deterministicGoogleEventId: input.deterministicGoogleEventId,
    targetGoogleEventId: input.targetGoogleEventId,
    requestPayload: input.requestPayload,
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex");
}

export async function acquireCalendarProviderOperation(
  input: AcquireCalendarProviderOperationInput
): Promise<AcquiredCalendarProviderOperation> {
  if (!UUID_PATTERN.test(input.operationId)) {
    throw new CalendarProviderOperationConflictError();
  }
  const claimToken = randomUUID();
  const fingerprint = calendarProviderRequestFingerprint(input);

  let result: { data: unknown; error: ProviderDatabaseError | null };
  try {
    result = await supabaseAdmin.rpc("acquire_calendar_provider_operation", {
      p_operation_id: input.operationId,
      p_business_id: input.businessId,
      p_operation_kind: input.kind,
      p_google_calendar_id: input.calendarId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_linked_booking_id: input.linkedBookingId,
      p_deterministic_google_event_id: input.deterministicGoogleEventId,
      p_target_google_event_id: input.targetGoogleEventId,
      p_request_fingerprint: fingerprint,
      p_claim_token: claimToken,
    });
  } catch (cause) {
    throw new CalendarProviderOperationStateError("acquire", { cause });
  }

  if (result.error) throwAcquireError(result.error);
  const operation = requireCalendarProviderOperation(result.data, "acquire");
  assertOperationIdentity(operation, input, fingerprint);
  if (
    operation.status === "holding" &&
    operation.claim_token !== claimToken
  ) {
    throw new CalendarProviderOperationStateError("acquire_claim");
  }

  return { operation, claimToken };
}

export async function readCalendarProviderOperation(
  businessId: string,
  operationId: string
): Promise<CalendarProviderOperation | null> {
  let result: { data: unknown; error: ProviderDatabaseError | null };
  try {
    result = await supabaseAdmin
      .from("calendar_provider_operations")
      .select(CALENDAR_PROVIDER_OPERATION_SELECT)
      .eq("business_id", businessId)
      .eq("id", operationId)
      .maybeSingle();
  } catch (cause) {
    throw new CalendarProviderOperationStateError("read", { cause });
  }
  if (result.error) {
    throw new CalendarProviderOperationStateError("read", {
      cause: result.error,
    });
  }
  if (!result.data) return null;
  const operation = requireCalendarProviderOperation(result.data, "read");
  if (
    operation.business_id !== businessId ||
    operation.id !== operationId
  ) {
    throw new CalendarProviderOperationStateError("read_response");
  }
  return operation;
}

export async function markCalendarProviderOperationApplied(
  input: CalendarProviderEvidenceInput
): Promise<CalendarProviderOperation> {
  const result = await callStateRpc(
    "mark_calendar_provider_operation_applied",
    {
      p_business_id: input.businessId,
      p_operation_id: input.operationId,
      p_claim_token: input.claimToken,
      p_provider_event_id: input.providerEventId,
      p_provider_starts_at: input.providerStartsAt,
      p_provider_ends_at: input.providerEndsAt,
      p_provider_evidence: input.evidence,
    },
    "mark_applied"
  );
  const operation = requireCalendarProviderOperation(result, "mark_applied");
  if (
    operation.id !== input.operationId ||
    operation.business_id !== input.businessId ||
    !["provider_applied", "finalized"].includes(operation.status) ||
    operation.provider_event_id !== input.providerEventId
  ) {
    throw new CalendarProviderOperationStateError("mark_applied_response");
  }
  return operation;
}

export async function markCalendarProviderSubmissionStarted(
  businessId: string,
  operationId: string,
  claimToken: string
): Promise<CalendarProviderOperation> {
  const data = await callStateRpc(
    "mark_calendar_provider_submission_started",
    {
      p_business_id: businessId,
      p_operation_id: operationId,
      p_claim_token: claimToken,
    },
    "mark_submission_started"
  );
  const operation = requireCalendarProviderOperation(
    data,
    "mark_submission_started"
  );
  if (
    operation.id !== operationId ||
    operation.business_id !== businessId ||
    !["holding", "provider_applied", "finalized"].includes(
      operation.status
    ) ||
    operation.provider_submission_started_at === null ||
    (operation.status === "holding" &&
      (operation.claim_token !== claimToken ||
        operation.claim_expires_at === null ||
        !Number.isFinite(new Date(operation.claim_expires_at).getTime()) ||
        new Date(operation.claim_expires_at).getTime() <= Date.now()))
  ) {
    throw new CalendarProviderOperationStateError(
      "mark_submission_started_response"
    );
  }
  return operation;
}

export async function markCalendarProviderDeleteApplied(
  businessId: string,
  operationId: string,
  claimToken: string,
  providerEventId: string
): Promise<CalendarProviderOperation> {
  const data = await callStateRpc(
    "mark_calendar_provider_delete_applied",
    {
      p_business_id: businessId,
      p_operation_id: operationId,
      p_claim_token: claimToken,
      p_provider_event_id: providerEventId,
    },
    "mark_delete_applied"
  );
  const operation = requireCalendarProviderOperation(
    data,
    "mark_delete_applied"
  );
  if (
    operation.id !== operationId ||
    operation.business_id !== businessId ||
    operation.operation_kind !== "delete" ||
    !["provider_applied", "finalized"].includes(operation.status) ||
    operation.provider_event_id !== providerEventId
  ) {
    throw new CalendarProviderOperationStateError(
      "mark_delete_applied_response"
    );
  }
  return operation;
}

export async function finalizeCalendarProviderOperation(
  businessId: string,
  operationId: string
): Promise<CalendarProviderOperation> {
  const data = await callStateRpc(
    "finalize_calendar_provider_operation",
    {
      p_business_id: businessId,
      p_operation_id: operationId,
    },
    "finalize"
  );
  const operation = requireCalendarProviderOperation(data, "finalize");
  if (
    operation.id !== operationId ||
    operation.business_id !== businessId ||
    operation.status !== "finalized"
  ) {
    throw new CalendarProviderOperationStateError("finalize_response");
  }
  return operation;
}

export async function failCalendarProviderOperation(
  businessId: string,
  operationId: string,
  claimToken: string,
  failureReason: string
): Promise<CalendarProviderOperation> {
  const data = await callStateRpc(
    "fail_calendar_provider_operation",
    {
      p_business_id: businessId,
      p_operation_id: operationId,
      p_claim_token: claimToken,
      p_failure_reason: failureReason.slice(0, 1000),
    },
    "fail"
  );
  return requireCalendarProviderOperation(data, "fail");
}

export async function claimNextCalendarProviderOperationReconciliation(): Promise<AcquiredCalendarProviderOperation | null> {
  const claimToken = randomUUID();
  const data = await callStateRpc(
    "claim_next_calendar_provider_operation_reconciliation",
    {
      p_claim_token: claimToken,
    },
    "claim_reconciliation"
  );
  if (data === null) return null;
  const operation = requireCalendarProviderOperation(
    data,
    "claim_reconciliation"
  );
  if (
    !["holding", "provider_applied"].includes(operation.status) ||
    operation.reconciliation_claim_token !== claimToken ||
    (operation.status === "holding" && operation.claim_token !== claimToken)
  ) {
    throw new CalendarProviderOperationStateError(
      "claim_reconciliation_response"
    );
  }
  return { operation, claimToken };
}

export async function resolveCalendarProviderOperationAbsent(
  businessId: string,
  operationId: string,
  claimToken: string
): Promise<CalendarProviderOperation> {
  const data = await callStateRpc(
    "resolve_calendar_provider_operation_absent",
    {
      p_business_id: businessId,
      p_operation_id: operationId,
      p_claim_token: claimToken,
    },
    "resolve_absent"
  );
  const operation = requireCalendarProviderOperation(data, "resolve_absent");
  if (
    operation.id !== operationId ||
    operation.business_id !== businessId ||
    operation.status !== "failed" ||
    operation.reconciliation_claim_token !== null
  ) {
    throw new CalendarProviderOperationStateError("resolve_absent_response");
  }
  return operation;
}

export function hasCalendarProviderOperationMarker(
  value: unknown,
  operationId: string
): boolean {
  if (!isRecord(value)) return false;
  const extended = value.extendedProperties;
  if (!isRecord(extended) || !isRecord(extended.private)) return false;
  return extended.private[CALENDAR_OPERATION_PRIVATE_KEY] === operationId;
}

export function buildCalendarProviderEvidence(
  event: unknown,
  operationId: string
): CalendarProviderEvidence {
  if (!hasCalendarProviderOperationMarker(event, operationId)) {
    throw new CalendarProviderOperationStateError(
      "provider_marker_verification"
    );
  }
  const candidate = event as Record<string, unknown>;
  if (candidate.status === "cancelled") {
    throw new CalendarProviderOperationStateError(
      "provider_event_cancelled"
    );
  }
  const evidence: CalendarProviderEvidence = {
    operation_marker_verified: true,
  };
  evidence.provider_status =
    candidate.status === "confirmed" || candidate.status === "tentative"
      ? candidate.status
      : "unknown";
  if (typeof candidate.etag === "string" && candidate.etag.length > 0) {
    evidence.provider_etag_sha256 = createHash("sha256")
      .update(candidate.etag)
      .digest("hex");
  }
  return evidence;
}

export function isDefinitiveCalendarProviderFailure(error: unknown): boolean {
  const status = providerStatus(error);
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    ![408, 409, 425, 429, 499].includes(status)
  );
}

function providerStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const direct = normalizeStatus(error.code);
  if (direct !== null) return direct;
  if (isRecord(error.response)) {
    return normalizeStatus(error.response.status);
  }
  return null;
}

function normalizeStatus(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d{3}$/.test(value)) {
    return Number(value);
  }
  return null;
}

async function callStateRpc(
  name: string,
  args: Record<string, unknown>,
  operation: string
): Promise<unknown> {
  let result: { data: unknown; error: ProviderDatabaseError | null };
  try {
    result = await supabaseAdmin.rpc(name, args);
  } catch (cause) {
    throw new CalendarProviderOperationStateError(operation, { cause });
  }
  if (result.error) {
    throw new CalendarProviderOperationStateError(operation, {
      cause: result.error,
    });
  }
  return result.data;
}

function throwAcquireError(error: ProviderDatabaseError): never {
  if (
    error.code === "23P01" &&
    error.message?.includes("calendar_provider_slot_unavailable")
  ) {
    throw new CalendarProviderSlotUnavailableError();
  }
  if (
    error.code === "55P03" ||
    error.message?.includes("calendar_provider_operation_busy")
  ) {
    throw new CalendarProviderOperationBusyError();
  }
  if (
    error.message?.includes("calendar_provider_operation_idempotency_conflict") ||
    error.message?.includes("calendar provider linked booking mismatch") ||
    error.message?.includes("calendar_provider_operation_terminal") ||
    error.message?.includes("calendar_provider_operation_superseded")
  ) {
    throw new CalendarProviderOperationConflictError();
  }
  throw new CalendarProviderOperationStateError("acquire", { cause: error });
}

function assertOperationIdentity(
  operation: CalendarProviderOperation,
  input: AcquireCalendarProviderOperationInput,
  fingerprint: string
): void {
  if (
    operation.id !== input.operationId ||
    operation.business_id !== input.businessId ||
    operation.operation_kind !== input.kind ||
    operation.google_calendar_id !== input.calendarId ||
    !sameNullableTimestamp(operation.desired_starts_at, input.startsAt) ||
    !sameNullableTimestamp(operation.desired_ends_at, input.endsAt) ||
    operation.linked_booking_id !== input.linkedBookingId ||
    operation.deterministic_google_event_id !==
      input.deterministicGoogleEventId ||
    operation.target_google_event_id !== input.targetGoogleEventId ||
    operation.provider_target_event_id !==
      (input.targetGoogleEventId ?? input.deterministicGoogleEventId) ||
    operation.request_fingerprint !== fingerprint
  ) {
    throw new CalendarProviderOperationStateError("acquire_response");
  }
}

function sameNullableTimestamp(
  stored: string | null,
  submitted: string | null
): boolean {
  if (stored === null || submitted === null) return stored === submitted;
  return new Date(stored).toISOString() === new Date(submitted).toISOString();
}

function requireCalendarProviderOperation(
  data: unknown,
  operationName: string
): CalendarProviderOperation {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (
    !isRecord(candidate) ||
    !isUuid(candidate.id) ||
    !isUuid(candidate.business_id) ||
    !["create", "update", "delete"].includes(
      String(candidate.operation_kind)
    ) ||
    typeof candidate.google_calendar_id !== "string" ||
    !candidate.google_calendar_id ||
    !isNullableTimestamp(candidate.desired_starts_at) ||
    !isNullableTimestamp(candidate.desired_ends_at) ||
    !isNullableUuid(candidate.linked_booking_id) ||
    !isNullableString(candidate.deterministic_google_event_id) ||
    !isNullableString(candidate.target_google_event_id) ||
    !isNullableString(candidate.provider_target_event_id) ||
    typeof candidate.request_fingerprint !== "string" ||
    !SHA256_PATTERN.test(candidate.request_fingerprint) ||
    !["holding", "provider_applied", "finalized", "failed"].includes(
      String(candidate.status)
    ) ||
    !isNullableUuid(candidate.claim_token) ||
    !isNullableTimestamp(candidate.claimed_at) ||
    !isNullableTimestamp(candidate.claim_expires_at) ||
    !isNullableTimestamp(candidate.claim_released_at) ||
    !isTimestamp(candidate.reconciliation_review_after_at) ||
    !Number.isSafeInteger(candidate.attempt_count) ||
    (candidate.attempt_count as number) < 1 ||
    !isNullableTimestamp(candidate.provider_submission_started_at) ||
    !isNullableString(candidate.provider_event_id) ||
    !isNullableTimestamp(candidate.provider_starts_at) ||
    !isNullableTimestamp(candidate.provider_ends_at) ||
    !isSafeCalendarProviderEvidence(
      candidate.provider_evidence,
      String(candidate.operation_kind),
      String(candidate.status)
    ) ||
    !isNullableTimestamp(candidate.provider_applied_at) ||
    !isNullableTimestamp(candidate.finalized_at) ||
    !isNullableTimestamp(candidate.failed_at) ||
    !isNullableString(candidate.failure_reason) ||
    !isNullableUuid(candidate.reconciliation_claim_token) ||
    !isNullableTimestamp(candidate.reconciliation_claimed_at) ||
    !isNullableTimestamp(candidate.reconciliation_claim_expires_at) ||
    !Number.isSafeInteger(candidate.reconciliation_attempt_count) ||
    (candidate.reconciliation_attempt_count as number) < 0 ||
    !isNullableTimestamp(candidate.reconciliation_attempted_at) ||
    !isTimestamp(candidate.created_at) ||
    !isTimestamp(candidate.updated_at)
  ) {
    throw new CalendarProviderOperationStateError(
      `${operationName}_response`
    );
  }
  return candidate as unknown as CalendarProviderOperation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeCalendarProviderEvidence(
  value: unknown,
  operationKind: string,
  status: string
): boolean {
  if (value === null) {
    return status === "holding" || status === "failed";
  }
  if (!isRecord(value) || status === "holding") return false;
  const allowedKeys = new Set([
    "operation_marker_verified",
    "provider_absence_verified",
    "provider_status",
    "provider_etag_sha256",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (
    value.provider_status !== undefined &&
    !["confirmed", "tentative", "unknown"].includes(
      String(value.provider_status)
    )
  ) {
    return false;
  }
  if (
    value.provider_etag_sha256 !== undefined &&
    (typeof value.provider_etag_sha256 !== "string" ||
      !SHA256_PATTERN.test(value.provider_etag_sha256))
  ) {
    return false;
  }
  if (operationKind === "delete") {
    return (
      value.provider_absence_verified === true &&
      value.operation_marker_verified === undefined
    );
  }
  return (
    ["create", "update"].includes(operationKind) &&
    value.operation_marker_verified === true &&
    value.provider_absence_verified === undefined
  );
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

type ProviderDatabaseError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};
