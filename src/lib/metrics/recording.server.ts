import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type {
  BusinessMetricBookingOriginV1,
  BusinessMetricKeyV1,
} from "./contract";

export interface RecordBusinessMetricEventBestEffortInput {
  businessId: string;
  metricKey: BusinessMetricKeyV1;
  quantity: number;
  occurredAt: Date;
  sourceKey: string;
  origin?: BusinessMetricBookingOriginV1 | null;
}

/**
 * Starts a service-role metric RPC without awaiting, retrying, or exposing a
 * failure to its customer-facing caller. Database uniqueness owns deduping.
 */
export function recordBusinessMetricEventBestEffort(
  input: RecordBusinessMetricEventBestEffortInput,
): void {
  try {
    const request = supabaseAdmin.rpc("record_business_metric_event_v1", {
      p_business_id: input.businessId,
      p_metric_key: input.metricKey,
      p_quantity: input.quantity,
      p_occurred_at: input.occurredAt.toISOString(),
      p_source_key: input.sourceKey,
      p_origin: input.origin ?? null,
    });

    void Promise.resolve(request)
      .then((result) => {
        if (!isSuccessfulRpcResponse(result)) {
          logMetricRecordingFailure(input.businessId, input.metricKey);
        }
      })
      .catch(() => {
        logMetricRecordingFailure(input.businessId, input.metricKey);
      });
  } catch {
    logMetricRecordingFailure(input.businessId, input.metricKey);
  }
}

function isSuccessfulRpcResponse(
  result: unknown,
): result is { data: boolean; error: null } {
  if (!result || typeof result !== "object") return false;
  const response = result as { data?: unknown; error?: unknown };
  return response.error == null && typeof response.data === "boolean";
}

function logMetricRecordingFailure(
  businessId: string,
  metricKey: BusinessMetricKeyV1,
): void {
  console.error("[metrics] Metric recording failed:", {
    businessId,
    metricKey,
  });
}
