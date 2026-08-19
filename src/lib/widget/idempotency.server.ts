import "server-only";

import { createHash } from "node:crypto";

export function buildWidgetChatRequestFingerprint(input: {
  businessId: string;
  origin: string;
  sessionId: string;
  clientMessageId: string;
  message: string;
  visitorEmail?: string;
  visitorName?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "simplassist-widget-chat-request:v1",
        input.businessId,
        input.origin,
        input.sessionId,
        input.clientMessageId,
        input.message,
        input.visitorEmail ?? null,
        input.visitorName ?? null,
      ]),
      "utf8",
    )
    .digest("hex");
}

export function buildWidgetSourceProviderEventId(input: {
  businessId: string;
  clientMessageId: string;
}): string {
  return `widget:${createHash("sha256")
    .update(
      JSON.stringify([
        "simplassist-widget-message:v1",
        input.businessId,
        input.clientMessageId,
      ]),
      "utf8",
    )
    .digest("hex")}`;
}

export function buildWidgetMessageFingerprint(message: string): string {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

export function buildWidgetLeadSubmissionFingerprint(input: {
  businessId: string;
  sessionId: string;
  clientLeadId: string;
  sourceClientMessageId: string;
  message: string;
  visitorName?: string;
  visitorEmail?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "simplassist-widget-offline-lead:v1",
        input.businessId,
        input.sessionId,
        input.clientLeadId,
        input.sourceClientMessageId,
        input.message,
        input.visitorName ?? null,
        input.visitorEmail ?? null,
      ]),
      "utf8",
    )
    .digest("hex");
}
