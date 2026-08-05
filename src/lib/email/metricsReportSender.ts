import "server-only";

import { randomUUID } from "node:crypto";
import { resend, RESEND_FROM } from "./client";

export const METRICS_REPORT_PROVIDER_TIMEOUT_MS = 15_000;

export type MetricsReportEmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

export type MetricsReportDefiniteNoSendCode =
  | "invalid_sender_input"
  | "sender_not_configured"
  | "sender_internal_error"
  | "provider_invalid_request"
  | "provider_auth_rejected"
  | "provider_rate_limited"
  | "provider_quota_exceeded"
  | "provider_not_found"
  | "provider_method_not_allowed"
  | "provider_security_rejected";

export type MetricsReportAmbiguousCode =
  | "provider_timeout"
  | "provider_rejection_ambiguous"
  | "provider_response_invalid"
  | "provider_request_failed";

export type MetricsReportSendOutcome =
  | { kind: "accepted"; providerMessageId: string }
  | {
      kind: "definite_no_send";
      errorCode: MetricsReportDefiniteNoSendCode;
    }
  | { kind: "ambiguous"; errorCode: MetricsReportAmbiguousCode };

type SendContext = "durable" | "test";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

const DEFINITE_PROVIDER_ERROR_CODES: Readonly<
  Record<string, MetricsReportDefiniteNoSendCode>
> = {
  missing_required_field: "provider_invalid_request",
  invalid_idempotency_key: "provider_invalid_request",
  invalid_access: "provider_auth_rejected",
  invalid_parameter: "provider_invalid_request",
  invalid_region: "provider_invalid_request",
  rate_limit_exceeded: "provider_rate_limited",
  daily_quota_exceeded: "provider_quota_exceeded",
  monthly_quota_exceeded: "provider_quota_exceeded",
  restricted_api_key: "provider_auth_rejected",
  invalid_api_key: "provider_auth_rejected",
  // Resend 4.8's published union contains this legacy capitalization.
  invalid_api_Key: "provider_auth_rejected",
  missing_api_key: "provider_auth_rejected",
  invalid_from_address: "provider_invalid_request",
  invalid_attachment: "provider_invalid_request",
  validation_error: "provider_invalid_request",
  not_found: "provider_not_found",
  method_not_allowed: "provider_method_not_allowed",
  security_error: "provider_security_rejected",
};

type ProviderDeadlineResult =
  | {
      timedOut: false;
      result: Awaited<ReturnType<typeof resend.emails.send>>;
    }
  | { timedOut: true };

export async function sendMetricsReportEmail({
  deliveryId,
  message,
}: {
  deliveryId: string;
  message: MetricsReportEmailMessage;
}): Promise<MetricsReportSendOutcome> {
  const canonicalDeliveryId = canonicalUuid(deliveryId);
  if (!canonicalDeliveryId) {
    return definiteNoSend("durable", "invalid_sender_input");
  }

  return sendMetricsReportMessage({
    context: "durable",
    idempotencyKey: `metrics-report-v1/${canonicalDeliveryId}`,
    message,
  });
}

export async function sendMetricsReportTestEmail({
  message,
}: {
  message: MetricsReportEmailMessage;
}): Promise<MetricsReportSendOutcome> {
  let idempotencyKey: string;
  try {
    idempotencyKey = `metrics-report-test-v1/${randomUUID()}`;
  } catch {
    return definiteNoSend("test", "sender_internal_error");
  }

  return sendMetricsReportMessage({
    context: "test",
    idempotencyKey,
    message,
  });
}

async function sendMetricsReportMessage({
  context,
  idempotencyKey,
  message,
}: {
  context: SendContext;
  idempotencyKey: string;
  message: MetricsReportEmailMessage;
}): Promise<MetricsReportSendOutcome> {
  if (!validMessage(message)) {
    return definiteNoSend(context, "invalid_sender_input");
  }
  if (typeof RESEND_FROM !== "string" || RESEND_FROM.trim().length === 0) {
    return definiteNoSend(context, "sender_not_configured");
  }

  let provider: ProviderDeadlineResult;
  try {
    provider = await sendWithProviderDeadline(
      {
        from: RESEND_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      },
      idempotencyKey,
    );
  } catch {
    return ambiguous(context, "provider_request_failed");
  }

  if (provider.timedOut) {
    return ambiguous(context, "provider_timeout");
  }

  const result: unknown = provider.result;
  if (!isRecord(result) || !("data" in result) || !("error" in result)) {
    return ambiguous(context, "provider_response_invalid");
  }

  if (result.error !== null) {
    if (result.data !== null) {
      return ambiguous(context, "provider_response_invalid");
    }
    const definiteCode = definiteProviderErrorCode(result.error);
    return definiteCode
      ? definiteNoSend(context, definiteCode)
      : ambiguous(context, "provider_rejection_ambiguous");
  }

  if (!isRecord(result.data)) {
    return ambiguous(context, "provider_response_invalid");
  }
  const providerMessageId = validProviderMessageId(result.data.id);
  if (!providerMessageId) {
    return ambiguous(context, "provider_response_invalid");
  }

  return { kind: "accepted", providerMessageId };
}

async function sendWithProviderDeadline(
  message: Parameters<typeof resend.emails.send>[0],
  idempotencyKey: string,
): Promise<ProviderDeadlineResult> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let deadlineTriggered = false;

  const providerRequest = resend.emails
    .send(message, {
      idempotencyKey,
      // Resend 4.8 forwards request options to fetch at runtime, but its
      // published request-options type does not yet expose AbortSignal.
      signal: controller.signal,
    } as Parameters<typeof resend.emails.send>[1] & {
      signal: AbortSignal;
    })
    .then((result) => ({ timedOut: false, result }) as const)
    .catch((error: unknown) => {
      // An abort-aware fetch may reject before the deadline promise wins its
      // race. Once our timer initiated the abort, preserve the honest timeout
      // classification rather than treating that rejection as a new outcome.
      if (deadlineTriggered) return { timedOut: true } as const;
      throw error;
    });

  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timeout = setTimeout(() => {
      deadlineTriggered = true;
      controller.abort();
      resolve({ timedOut: true });
    }, METRICS_REPORT_PROVIDER_TIMEOUT_MS);
  });

  try {
    return await Promise.race([providerRequest, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function validMessage(value: unknown): value is MetricsReportEmailMessage {
  if (!isRecord(value)) return false;
  return (
    nonBlankString(value.to) &&
    nonBlankString(value.subject) &&
    nonBlankString(value.text) &&
    nonBlankString(value.html)
  );
}

function canonicalUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const canonical = value.trim().toLowerCase();
  return UUID.test(canonical) ? canonical : null;
}

function validProviderMessageId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length >= 1 &&
    normalized.length <= 255 &&
    !CONTROL_CHARACTER.test(normalized)
    ? normalized
    : null;
}

function definiteProviderErrorCode(
  error: unknown,
): MetricsReportDefiniteNoSendCode | null {
  if (!isRecord(error) || typeof error.name !== "string") return null;
  return DEFINITE_PROVIDER_ERROR_CODES[error.name] ?? null;
}

function definiteNoSend(
  context: SendContext,
  errorCode: MetricsReportDefiniteNoSendCode,
): MetricsReportSendOutcome {
  logOutcome(context, "definite_no_send", errorCode);
  return { kind: "definite_no_send", errorCode };
}

function ambiguous(
  context: SendContext,
  errorCode: MetricsReportAmbiguousCode,
): MetricsReportSendOutcome {
  logOutcome(context, "ambiguous", errorCode);
  return { kind: "ambiguous", errorCode };
}

function logOutcome(
  context: SendContext,
  classification: "definite_no_send" | "ambiguous",
  errorCode: MetricsReportDefiniteNoSendCode | MetricsReportAmbiguousCode,
): void {
  // Classification and bounded internal code only. Provider objects and
  // message fields can contain recipient addresses, rendered content, or
  // credentials and must never be logged.
  console.error(`[email:metrics-report] ${context} ${classification}`, {
    errorCode,
  });
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
