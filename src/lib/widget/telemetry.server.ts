import "server-only";

import { createHmac } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TELEMETRY_HASH_CONTEXT = "simplassist-widget-engagement-session:v1";
const MIN_SECRET_BYTES = 32;
const UUID = z.string().uuid();
const SESSION_ID = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const SESSION_HASH = z.string().regex(/^[0-9a-f]{64}$/);

export const WIDGET_ENGAGEMENT_EVENT_TYPES = [
  "widget_loaded",
  "invitation_shown",
  "invitation_dismissed",
  "widget_engaged",
  "first_message_submitted",
] as const;

export const WIDGET_ENGAGEMENT_SOURCES = [
  "widget_load",
  "manual",
  "proactive_timer",
  "proactive_scroll",
] as const;

export const WIDGET_DEVICE_BUCKETS = ["mobile", "desktop"] as const;

export type WidgetEngagementEventType =
  (typeof WIDGET_ENGAGEMENT_EVENT_TYPES)[number];
export type WidgetEngagementSource = (typeof WIDGET_ENGAGEMENT_SOURCES)[number];
export type WidgetDeviceBucket = (typeof WIDGET_DEVICE_BUCKETS)[number];

export interface RecordWidgetEngagementEventInput {
  businessId: string;
  sessionId: string;
  eventType: WidgetEngagementEventType;
  source: WidgetEngagementSource;
  deviceBucket: WidgetDeviceBucket;
  promptVersion: number;
}

function telemetryHashSecret(override?: string): string {
  const secret = override ?? process.env.WIDGET_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error("WIDGET_TOKEN_SECRET must contain at least 32 bytes");
  }
  return secret;
}

/**
 * Produces the only visitor/session identity persisted by telemetry. The
 * widget token secret is reused with an independent HMAC context so the raw
 * browser session identifier cannot be recovered or correlated elsewhere.
 */
export function deriveWidgetEngagementSessionHash(
  input: { businessId: string; sessionId: string },
  secretOverride?: string,
): string {
  const businessId = UUID.parse(input.businessId).toLowerCase();
  const sessionId = SESSION_ID.parse(input.sessionId);
  return createHmac("sha256", telemetryHashSecret(secretOverride))
    .update(TELEMETRY_HASH_CONTEXT, "utf8")
    .update("\0", "utf8")
    .update(businessId, "utf8")
    .update("\0", "utf8")
    .update(sessionId, "utf8")
    .digest("hex");
}

/**
 * Records a content-free, session-deduplicated widget funnel event. This RPC
 * has no relationship to contacts, conversations, messages, billing usage,
 * or provider calls.
 */
export async function recordWidgetEngagementEvent(
  input: RecordWidgetEngagementEventInput,
): Promise<boolean> {
  const sessionKeyHash = deriveWidgetEngagementSessionHash(input);
  // Defense in depth: only a lowercase SHA-256 HMAC can cross the database
  // boundary, even if the derivation implementation changes later.
  SESSION_HASH.parse(sessionKeyHash);
  const { data, error } = await supabaseAdmin.rpc(
    "record_widget_engagement_event",
    {
      p_business_id: input.businessId,
      p_session_key_hash: sessionKeyHash,
      p_event_type: input.eventType,
      p_source: input.source,
      p_device_bucket: input.deviceBucket,
      p_prompt_version: input.promptVersion,
    },
  );

  if (error) {
    throw new Error("Widget engagement telemetry persistence failed.", {
      cause: error,
    });
  }
  if (typeof data !== "boolean") {
    throw new Error("Widget engagement telemetry returned malformed data.");
  }
  return data;
}
