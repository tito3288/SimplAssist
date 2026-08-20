import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type WidgetTrafficEndpoint =
  | "config"
  | "chat"
  | "end"
  | "lead"
  | "telemetry"
  | "preview_chat"
  | "preview_end";

export type WidgetTrafficAcquireInput = {
  businessId: string;
  originHostname: string;
  sessionId: string;
  endpoint: WidgetTrafficEndpoint;
  networkKey: string;
  requestKey: string;
};

export type WidgetTrafficAcquireResult =
  | { status: "allowed"; leaseToken: string | null }
  | { status: "origin_not_allowed" }
  | { status: "widget_inactive" }
  | {
      status: "rate_limited" | "concurrency_limited";
      retryAfterSeconds: number;
    }
  | { status: "unavailable" };

export interface WidgetTrafficAdapter {
  acquire(
    input: WidgetTrafficAcquireInput,
  ): Promise<WidgetTrafficAcquireResult>;
  release(input: { leaseToken: string }): Promise<boolean>;
}

export type WidgetTrafficLease = {
  sharedLeaseToken: string | null;
  localConcurrencyKeys: string[];
};

export type WidgetTrafficDecision =
  | { status: "allowed"; lease: WidgetTrafficLease }
  | { status: "origin_not_allowed" }
  | { status: "widget_inactive" }
  | {
      status: "rate_limited" | "concurrency_limited";
      retryAfterSeconds: number;
    }
  | { status: "unavailable" };

const rpcAllowedSchema = z
  .object({
    status: z.literal("allowed"),
    lease_token: z.string().uuid().nullable(),
  })
  .strict();
const rpcDeniedSchema = z
  .object({
    status: z.enum(["rate_limited", "concurrency_limited"]),
    retry_after_seconds: z.number().int().min(1).max(3600),
  })
  .strict();
const rpcOriginDeniedSchema = z
  .object({ status: z.literal("origin_not_allowed") })
  .strict();
const rpcInactiveSchema = z
  .object({ status: z.literal("widget_inactive") })
  .strict();
const rpcResultSchema = z.union([
  rpcAllowedSchema,
  rpcDeniedSchema,
  rpcOriginDeniedSchema,
  rpcInactiveSchema,
]);

const RATE_WINDOW_MS = 60_000;
const LOCAL_CONCURRENCY_LEASE_MS = 5 * 60_000;
const SHARED_RELEASE_WAIT_MS = 500;
const MAX_LOCAL_BUCKETS = 10_000;
const LOCAL_LIMITS: Record<
  WidgetTrafficEndpoint,
  { session: number; network: number }
> = {
  config: { session: 60, network: 60 },
  chat: { session: 12, network: 30 },
  end: { session: 10, network: 10 },
  lead: { session: 5, network: 10 },
  telemetry: { session: 12, network: 120 },
  preview_chat: { session: 6, network: 12 },
  preview_end: { session: 6, network: 6 },
};
const LOCAL_BUSINESS_CHAT_CONCURRENCY = 8;

type RateBucket = { startedAt: number; count: number };
const rateBuckets = new Map<string, RateBucket>();
const concurrency = new Map<string, Map<string, number>>();

class SupabaseWidgetTrafficAdapter implements WidgetTrafficAdapter {
  async acquire(
    input: WidgetTrafficAcquireInput,
  ): Promise<WidgetTrafficAcquireResult> {
    let result: { data: unknown; error: unknown };
    try {
      result =
        input.endpoint === "telemetry"
          ? await supabaseAdmin.rpc("acquire_widget_telemetry_capacity", {
              p_business_id: input.businessId,
              p_origin_hostname: input.originHostname,
              p_session_id: input.sessionId,
              p_network_key: input.networkKey,
              p_request_key: input.requestKey,
            })
          : await supabaseAdmin.rpc("acquire_widget_request_capacity", {
              p_business_id: input.businessId,
              p_origin_hostname: input.originHostname,
              p_session_id: input.sessionId,
              p_endpoint: input.endpoint,
              p_network_key: input.networkKey,
              p_request_key: input.requestKey,
            });
    } catch (error) {
      console.error("[widget:traffic] Shared acquire threw:", error);
      return { status: "unavailable" };
    }

    if (result.error) {
      console.error("[widget:traffic] Shared acquire failed:", result.error);
      return { status: "unavailable" };
    }
    const parsed = rpcResultSchema.safeParse(result.data);
    if (!parsed.success) {
      console.error("[widget:traffic] Shared acquire returned malformed data");
      return { status: "unavailable" };
    }

    if (parsed.data.status === "allowed") {
      return { status: "allowed", leaseToken: parsed.data.lease_token };
    }
    if (
      parsed.data.status === "origin_not_allowed" ||
      parsed.data.status === "widget_inactive"
    ) {
      return { status: parsed.data.status };
    }
    return {
      status: parsed.data.status,
      retryAfterSeconds: parsed.data.retry_after_seconds,
    };
  }

  async release({ leaseToken }: { leaseToken: string }): Promise<boolean> {
    try {
      const { data, error } = await supabaseAdmin.rpc(
        "release_widget_request_capacity",
        { p_lease_token: leaseToken },
      );
      if (error || data !== true) {
        console.error(
          "[widget:traffic] Shared release failed",
          error ?? "malformed response",
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error("[widget:traffic] Shared release threw:", error);
      return false;
    }
  }
}

let adapter: WidgetTrafficAdapter = new SupabaseWidgetTrafficAdapter();

export function deriveWidgetNetworkKey(
  request: Request,
  secretOverride?: string,
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  let address = "unknown";

  if (forwarded && forwarded.length <= 2048) {
    const entries = forwarded.split(",");
    const rightmost = entries.at(-1)?.trim() ?? "";
    if (rightmost && isIP(rightmost) !== 0) address = rightmost.toLowerCase();
  } else if (
    !forwarded &&
    realIp &&
    realIp.length <= 64 &&
    isIP(realIp) !== 0
  ) {
    address = realIp.toLowerCase();
  }

  return opaqueKey("network", address, secretOverride);
}

export function deriveWidgetRequestKey(
  input: {
    businessId: string;
    sessionId: string;
    endpoint: WidgetTrafficEndpoint;
    clientMessageId?: string;
  },
  secretOverride?: string,
): string {
  const requestIdentity =
    input.clientMessageId ?? randomBytes(18).toString("base64url");
  return opaqueKey(
    "request",
    [input.businessId, input.sessionId, input.endpoint, requestIdentity].join(
      ":",
    ),
    secretOverride,
  );
}

export async function acquireWidgetTraffic(
  input: WidgetTrafficAcquireInput,
  now = Date.now(),
): Promise<WidgetTrafficDecision> {
  const local = acquireLocalTraffic(input, now);
  if (local.status !== "allowed") return local;

  let shared: WidgetTrafficAcquireResult;
  try {
    shared = await adapter.acquire(input);
  } catch (error) {
    console.error("[widget:traffic] Adapter acquire threw:", error);
    releaseLocalConcurrency(local.lease.localConcurrencyKeys);
    return { status: "unavailable" };
  }

  if (shared.status !== "allowed") {
    releaseLocalConcurrency(local.lease.localConcurrencyKeys);
    return shared;
  }
  if (isChatTraffic(input.endpoint) && !shared.leaseToken) {
    console.error(
      "[widget:traffic] Chat acquire omitted its concurrency lease",
    );
    releaseLocalConcurrency(local.lease.localConcurrencyKeys);
    return { status: "unavailable" };
  }
  if (!isChatTraffic(input.endpoint) && shared.leaseToken) {
    console.error(
      "[widget:traffic] Non-chat acquire returned an unexpected lease",
    );
    await releaseSharedLeaseBestEffort(shared.leaseToken);
    releaseLocalConcurrency(local.lease.localConcurrencyKeys);
    return { status: "unavailable" };
  }

  return {
    status: "allowed",
    lease: {
      sharedLeaseToken: shared.leaseToken,
      localConcurrencyKeys: local.lease.localConcurrencyKeys,
    },
  };
}

export async function releaseWidgetTraffic(
  lease: WidgetTrafficLease,
): Promise<void> {
  releaseLocalConcurrency(lease.localConcurrencyKeys);
  if (!lease.sharedLeaseToken) return;
  await releaseSharedLeaseBestEffort(lease.sharedLeaseToken);
}

async function releaseSharedLeaseBestEffort(leaseToken: string): Promise<void> {
  const release = adapter.release({ leaseToken }).then(
    () => undefined,
    (error) => {
      console.error("[widget:traffic] Adapter release threw:", error);
    },
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    release,
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        console.error("[widget:traffic] Adapter release timed out");
        resolve();
      }, SHARED_RELEASE_WAIT_MS);
    }),
  ]);
  if (timer) clearTimeout(timer);
}

function acquireLocalTraffic(
  input: WidgetTrafficAcquireInput,
  now: number,
): WidgetTrafficDecision {
  pruneLocalState(now);
  const rateKeys = [
    {
      key: `${input.endpoint}:session:${input.businessId}:${input.sessionId}`,
      limit: LOCAL_LIMITS[input.endpoint].session,
    },
    {
      key: `${input.endpoint}:network:${input.businessId}:${input.networkKey}`,
      limit: LOCAL_LIMITS[input.endpoint].network,
    },
  ];
  for (const { key, limit } of rateKeys) {
    const decision = incrementRateBucket(key, limit, now);
    if (!decision) {
      return {
        status: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil(
            ((rateBuckets.get(key)?.startedAt ?? now) + RATE_WINDOW_MS - now) /
              1000,
          ),
        ),
      };
    }
  }

  if (!isChatTraffic(input.endpoint)) {
    return {
      status: "allowed",
      lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
    };
  }

  const sessionKey = `chat:concurrency:session:${input.businessId}:${input.sessionId}`;
  const businessKey = `chat:concurrency:business:${input.businessId}`;
  if (
    (concurrency.get(sessionKey)?.size ?? 0) >= 1 ||
    (concurrency.get(businessKey)?.size ?? 0) >= LOCAL_BUSINESS_CHAT_CONCURRENCY
  ) {
    return { status: "concurrency_limited", retryAfterSeconds: 2 };
  }
  const localLeaseToken = randomBytes(18).toString("base64url");
  incrementLocalConcurrency(sessionKey, localLeaseToken, now);
  incrementLocalConcurrency(businessKey, localLeaseToken, now);
  return {
    status: "allowed",
    lease: {
      sharedLeaseToken: null,
      localConcurrencyKeys: [
        `${sessionKey}|${localLeaseToken}`,
        `${businessKey}|${localLeaseToken}`,
      ],
    },
  };
}

function isChatTraffic(endpoint: WidgetTrafficEndpoint): boolean {
  return endpoint === "chat" || endpoint === "preview_chat";
}

function incrementRateBucket(key: string, limit: number, now: number): boolean {
  const current = rateBuckets.get(key);
  if (!current || now - current.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function releaseLocalConcurrency(keys: readonly string[]) {
  for (const leaseKey of keys) {
    const separator = leaseKey.lastIndexOf("|");
    if (separator < 1) continue;
    const key = leaseKey.slice(0, separator);
    const leaseToken = leaseKey.slice(separator + 1);
    const leases = concurrency.get(key);
    if (!leases) continue;
    leases.delete(leaseToken);
    if (leases.size === 0) concurrency.delete(key);
  }
}

function incrementLocalConcurrency(
  key: string,
  leaseToken: string,
  now: number,
): void {
  const leases = concurrency.get(key) ?? new Map<string, number>();
  leases.set(leaseToken, now + LOCAL_CONCURRENCY_LEASE_MS);
  concurrency.set(key, leases);
}

function pruneLocalState(now: number) {
  for (const [key, bucket] of Array.from(rateBuckets.entries())) {
    if (now - bucket.startedAt >= RATE_WINDOW_MS) rateBuckets.delete(key);
  }
  while (rateBuckets.size >= MAX_LOCAL_BUCKETS) {
    const oldest = rateBuckets.keys().next().value as string | undefined;
    if (!oldest) break;
    rateBuckets.delete(oldest);
  }
  for (const [key, leases] of Array.from(concurrency.entries())) {
    for (const [leaseToken, expiresAt] of Array.from(leases.entries())) {
      if (expiresAt <= now) leases.delete(leaseToken);
    }
    if (leases.size === 0) concurrency.delete(key);
  }
}

function opaqueKey(
  context: "network" | "request",
  value: string,
  secretOverride?: string,
): string {
  const secret = secretOverride ?? process.env.WIDGET_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("WIDGET_TOKEN_SECRET must contain at least 32 bytes");
  }
  return createHmac("sha256", secret)
    .update(`simplassist-widget-${context}:v1:${value}`)
    .digest("base64url");
}

export function setWidgetTrafficAdapterForTests(
  next: WidgetTrafficAdapter | null,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Widget traffic adapter overrides are test-only");
  }
  adapter = next ?? new SupabaseWidgetTrafficAdapter();
}

export function resetWidgetTrafficStateForTests(): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Widget traffic state resets are test-only");
  }
  rateBuckets.clear();
  concurrency.clear();
}
