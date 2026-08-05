import "server-only";

import { createHash } from "node:crypto";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function buildMissedCallSourceKey(
  businessId: string,
  callSessionOrControlId: string,
): string {
  return `missed-call:${hashOpaqueIdentifiers([
    canonicalUuid(businessId, "businessId"),
    requireOpaqueIdentifier(callSessionOrControlId, "callSessionOrControlId"),
  ])}`;
}

export function buildAiConversationSourceKey(
  conversationId: string,
  occurredAt: Date,
): string {
  return `ai-conversation:${canonicalUuid(
    conversationId,
    "conversationId",
  )}:${utcMonth(occurredAt)}`;
}

export function buildDashboardBookingSourceKey(
  businessId: string,
  calendarId: string,
  providerEventId: string,
): string {
  return `dashboard-booking:${hashOpaqueIdentifiers([
    canonicalUuid(businessId, "businessId"),
    requireOpaqueIdentifier(calendarId, "calendarId"),
    requireOpaqueIdentifier(providerEventId, "providerEventId"),
  ])}`;
}

export function buildWebChatSessionSourceKey(
  businessId: string,
  sessionId: string,
): string {
  return `web-chat-session:${hashOpaqueIdentifiers([
    canonicalUuid(businessId, "businessId"),
    requireOpaqueIdentifier(sessionId, "sessionId"),
  ])}`;
}

function hashOpaqueIdentifiers(parts: readonly string[]): string {
  // JSON array framing prevents ambiguous concatenations such as ["ab", "c"]
  // and ["a", "bc"] while keeping every external identifier out of storage.
  return createHash("sha256").update(JSON.stringify(parts), "utf8").digest("hex");
}

function canonicalUuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new TypeError(`${field} must be a UUID`);
  }
  return value.toLowerCase();
}

function requireOpaqueIdentifier(value: string, field: string): string {
  if (typeof value !== "string" || value.length === 0 || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function utcMonth(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("occurredAt must be a valid Date");
  }
  return value.toISOString().slice(0, 7);
}
