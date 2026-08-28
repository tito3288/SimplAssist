import "server-only";

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { WebsiteScanReviewDraft } from "./client";
import { toWebsiteScanPublishPayload } from "./contracts";

export type WebsiteScanRpcResult = {
  data: unknown;
  error: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
  } | null;
};

export async function startWebsiteScan(
  client: SupabaseClient,
  input: {
    businessId: string;
    sourceUrl: string;
    purpose: "onboarding" | "manual_rescan";
    idempotencyKey: string;
  },
): Promise<WebsiteScanRpcResult> {
  return rpc(client, "start_website_scan_v1", {
    p_business_id: input.businessId,
    p_source_url: input.sourceUrl,
    p_purpose: input.purpose,
    p_idempotency_key: input.idempotencyKey,
  });
}

export async function saveWebsiteScanReview(
  client: SupabaseClient,
  input: {
    scanId: string;
    expectedRevision: number;
    draft: WebsiteScanReviewDraft;
  },
): Promise<WebsiteScanRpcResult> {
  return rpc(client, "save_website_scan_review_v1", {
    p_scan_id: input.scanId,
    p_expected_revision: input.expectedRevision,
    p_review_draft: input.draft,
  });
}

export async function publishWebsiteScanReview(
  client: SupabaseClient,
  input: {
    scanId: string;
    expectedRevision: number;
    idempotencyKey: string;
    draft: WebsiteScanReviewDraft;
  },
): Promise<WebsiteScanRpcResult> {
  return rpc(client, "publish_website_scan_v1", {
    p_scan_id: input.scanId,
    p_expected_revision: input.expectedRevision,
    p_idempotency_key: input.idempotencyKey,
    p_final_review: toWebsiteScanPublishPayload(input.draft),
  });
}

export async function cancelWebsiteScan(
  client: SupabaseClient,
  scanId: string,
): Promise<WebsiteScanRpcResult> {
  return rpc(client, "request_cancel_website_scan_v1", {
    p_scan_id: scanId,
    p_expected_revision: null,
  });
}

export async function retryWebsiteScan(
  client: SupabaseClient,
  input: { scanId: string; failedRunUpdatedAt: string },
): Promise<WebsiteScanRpcResult> {
  return rpc(client, "retry_website_scan_v1", {
    p_scan_id: input.scanId,
    p_idempotency_key: stableRetryIdempotencyKey(
      input.scanId,
      input.failedRunUpdatedAt,
    ),
  });
}

export function scanIdFromRpcData(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    if (typeof id === "string") return id;
    const scanId = (value as Record<string, unknown>).scanId;
    if (typeof scanId === "string") return scanId;
  }
  return null;
}

/** A stable UUID for retries of one exact failed state; a later failure gets a new key. */
export function stableRetryIdempotencyKey(
  scanId: string,
  failedRunUpdatedAt: string,
): string {
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`website-scan-retry:${scanId}:${failedRunUpdatedAt}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function rpc(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<WebsiteScanRpcResult> {
  return (await client.rpc(name as never, args as never)) as WebsiteScanRpcResult;
}
