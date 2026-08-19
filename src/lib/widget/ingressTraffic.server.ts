import "server-only";

import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type WidgetIngressEndpoint = "config" | "chat" | "end" | "lead";

export type WidgetIngressAcquireInput = {
  endpoint: WidgetIngressEndpoint;
  networkKey: string;
};

export type WidgetIngressAcquireResult =
  | { status: "allowed" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export interface WidgetIngressAdapter {
  acquire(
    input: WidgetIngressAcquireInput,
  ): Promise<WidgetIngressAcquireResult>;
}

const rpcAllowedSchema = z.object({ status: z.literal("allowed") }).strict();
const rpcDeniedSchema = z
  .object({
    status: z.literal("rate_limited"),
    retry_after_seconds: z.number().int().min(1).max(60),
  })
  .strict();
const rpcResultSchema = z.union([rpcAllowedSchema, rpcDeniedSchema]);

const RATE_WINDOW_MS = 60_000;
const MAX_LOCAL_NETWORK_BUCKETS = 10_000;
const LOCAL_LIMITS: Record<
  WidgetIngressEndpoint,
  { network: number; global: number }
> = {
  config: { network: 120, global: 10_000 },
  chat: { network: 60, global: 3_000 },
  end: { network: 30, global: 3_000 },
  lead: { network: 20, global: 1_000 },
};

type RateBucket = { windowStart: number; count: number };
const networkRateBuckets = new Map<string, RateBucket>();
const globalRateBuckets = new Map<string, RateBucket>();

class SupabaseWidgetIngressAdapter implements WidgetIngressAdapter {
  async acquire(
    input: WidgetIngressAcquireInput,
  ): Promise<WidgetIngressAcquireResult> {
    let result: { data: unknown; error: unknown };
    try {
      result = await supabaseAdmin.rpc("acquire_widget_ingress_capacity", {
        p_endpoint: input.endpoint,
        p_network_key: input.networkKey,
      });
    } catch (error) {
      console.error("[widget:ingress] Shared acquire threw:", error);
      return { status: "unavailable" };
    }

    if (result.error) {
      console.error("[widget:ingress] Shared acquire failed:", result.error);
      return { status: "unavailable" };
    }
    const parsed = rpcResultSchema.safeParse(result.data);
    if (!parsed.success) {
      console.error("[widget:ingress] Shared acquire returned malformed data");
      return { status: "unavailable" };
    }
    if (parsed.data.status === "allowed") return { status: "allowed" };
    return {
      status: "rate_limited",
      retryAfterSeconds: parsed.data.retry_after_seconds,
    };
  }
}

let adapter: WidgetIngressAdapter = new SupabaseWidgetIngressAdapter();

/**
 * Applies a bounded process-local prefilter before the authoritative shared
 * ingress counter. This layer intentionally has no business identifier: it
 * protects token, workspace, widget-config, and business lookups from callers
 * rotating arbitrary business UUIDs.
 */
export async function acquireWidgetIngressTraffic(
  input: WidgetIngressAcquireInput,
  now = Date.now(),
): Promise<WidgetIngressAcquireResult> {
  const local = acquireLocalIngress(input, now);
  if (local.status !== "allowed") return local;

  try {
    return await adapter.acquire(input);
  } catch (error) {
    console.error("[widget:ingress] Adapter acquire threw:", error);
    return { status: "unavailable" };
  }
}

function acquireLocalIngress(
  input: WidgetIngressAcquireInput,
  now: number,
): WidgetIngressAcquireResult {
  const windowStart = Math.floor(now / RATE_WINDOW_MS) * RATE_WINDOW_MS;
  pruneLocalIngress(windowStart);

  const limits = LOCAL_LIMITS[input.endpoint];
  const networkKey = `${input.endpoint}:network:${input.networkKey}`;
  const globalKey = `${input.endpoint}:global`;
  const networkAllowed = incrementRateBucket(
    networkRateBuckets,
    networkKey,
    limits.network,
    windowStart,
  );
  const globalAllowed = incrementRateBucket(
    globalRateBuckets,
    globalKey,
    limits.global,
    windowStart,
  );
  if (networkAllowed && globalAllowed) return { status: "allowed" };

  return {
    status: "rate_limited",
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStart + RATE_WINDOW_MS - now) / 1000),
    ),
  };
}

function incrementRateBucket(
  buckets: Map<string, RateBucket>,
  key: string,
  limit: number,
  windowStart: number,
): boolean {
  const current = buckets.get(key);
  if (!current || current.windowStart !== windowStart) {
    buckets.set(key, { windowStart, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function pruneLocalIngress(windowStart: number): void {
  for (const [key, bucket] of Array.from(networkRateBuckets.entries())) {
    if (bucket.windowStart < windowStart) networkRateBuckets.delete(key);
  }
  for (const [key, bucket] of Array.from(globalRateBuckets.entries())) {
    if (bucket.windowStart < windowStart) globalRateBuckets.delete(key);
  }
  while (networkRateBuckets.size >= MAX_LOCAL_NETWORK_BUCKETS) {
    const oldest = networkRateBuckets.keys().next().value as
      | string
      | undefined;
    if (!oldest) break;
    networkRateBuckets.delete(oldest);
  }
}

export function setWidgetIngressAdapterForTests(
  next: WidgetIngressAdapter | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Widget ingress adapter overrides are test-only");
  }
  adapter = next ?? new SupabaseWidgetIngressAdapter();
}

export function resetWidgetIngressStateForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Widget ingress state resets are test-only");
  }
  networkRateBuckets.clear();
  globalRateBuckets.clear();
}
