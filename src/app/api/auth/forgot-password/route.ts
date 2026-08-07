import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCanonicalAppOrigin } from "@/lib/branding/defaultBrand";
import { normalizeHostHeader } from "@/lib/branding/hostname";
import { processPasswordResetRequest } from "@/lib/auth/recovery.server";

const requestSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(320)
      .email()
      .transform((value) => value.toLowerCase()),
  })
  .strict();

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RATE_LIMIT_MAX = 3;
const IP_RATE_LIMIT_MAX = 10;
const MAX_RATE_LIMIT_IDENTIFIERS = 10_000;
const MIN_RESPONSE_MS = 1_100;
const RESPONSE_JITTER_MS = 200;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const NEUTRAL_MESSAGE =
  "If an account exists for this email, a reset link is on its way.";

const rateLimitMap = new Map<string, number[]>();
let lastRateLimitPruneAt = 0;

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const responseAt =
    startedAt +
    MIN_RESPONSE_MS +
    Math.floor(Math.random() * RESPONSE_JITTER_MS);
  const rawHost = request.headers.get("host");
  const ip = requestIp(request);

  if (isRateLimited(`ip:${ip}`, IP_RATE_LIMIT_MAX, startedAt)) {
    await waitUntil(responseAt);
    return NextResponse.json(
      { message: "Too many requests. Please wait and try again." },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, "Retry-After": "900" },
      },
    );
  }

  if (!isSameOriginJsonRequest(request, rawHost)) {
    await waitUntil(responseAt);
    return NextResponse.json(
      { message: "Invalid request." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let parsed: z.infer<typeof requestSchema>;
  try {
    parsed = requestSchema.parse(await request.json());
  } catch {
    await waitUntil(responseAt);
    return NextResponse.json(
      { message: "Invalid request." },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const hostname = normalizeHostHeader(rawHost) ?? "invalid-host";
  const emailKey = hashedEmailRateLimitKey(parsed.email, hostname);
  if (!isRateLimited(`email:${emailKey}`, EMAIL_RATE_LIMIT_MAX, Date.now())) {
    void processPasswordResetRequest({ email: parsed.email, rawHost })
      .catch(() => {
        // The public response is deliberately outcome-neutral. Do not include
        // the address, token, provider error, or any other request data here.
        console.error("[auth:forgot-password] recovery processing failed");
      });
  }

  await waitUntil(responseAt);
  return NextResponse.json(
    { message: NEUTRAL_MESSAGE },
    { status: 200, headers: NO_STORE_HEADERS },
  );
}

function requestIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function isSameOriginJsonRequest(
  request: NextRequest,
  rawHost: string | null,
): boolean {
  if (request.headers.get("sec-fetch-site") !== "same-origin") return false;
  const contentType = request.headers.get("content-type")?.toLowerCase();
  if (!contentType || contentType.split(";", 1)[0].trim() !== "application/json") {
    return false;
  }

  const hostname = normalizeHostHeader(rawHost);
  const providedOrigin = request.headers.get("origin");
  if (!hostname || !providedOrigin) return false;

  try {
    const canonicalOrigin = getCanonicalAppOrigin();
    const canonicalHostname = new URL(canonicalOrigin).hostname.toLowerCase();
    const expectedOrigin =
      hostname === canonicalHostname
        ? canonicalOrigin
        : `https://${hostname}`;
    const parsed = new URL(providedOrigin);
    return (
      parsed.origin === expectedOrigin &&
      !parsed.username &&
      !parsed.password &&
      parsed.pathname === "/" &&
      !parsed.search &&
      !parsed.hash
    );
  } catch {
    return false;
  }
}

function hashedEmailRateLimitKey(email: string, hostname: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "missing-service-key";
  return createHmac("sha256", secret)
    .update("simplassist:forgot-password-rate-limit:v1")
    .update("\0")
    .update(hostname)
    .update("\0")
    .update(email)
    .digest("base64url");
}

function isRateLimited(identifier: string, limit: number, now: number): boolean {
  pruneRateLimitMap(now);
  const recent = (rateLimitMap.get(identifier) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );

  if (recent.length >= limit) {
    rateLimitMap.delete(identifier);
    rateLimitMap.set(identifier, recent);
    return true;
  }

  recent.push(now);
  rateLimitMap.delete(identifier);
  rateLimitMap.set(identifier, recent);
  return false;
}

function pruneRateLimitMap(now: number): void {
  if (
    now - lastRateLimitPruneAt < RATE_LIMIT_WINDOW_MS &&
    rateLimitMap.size < MAX_RATE_LIMIT_IDENTIFIERS
  ) {
    return;
  }

  rateLimitMap.forEach((timestamps, identifier) => {
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    );
    if (recent.length === 0) {
      rateLimitMap.delete(identifier);
    } else {
      rateLimitMap.set(identifier, recent);
    }
  });

  while (rateLimitMap.size >= MAX_RATE_LIMIT_IDENTIFIERS) {
    const oldestIdentifier = rateLimitMap.keys().next().value;
    if (typeof oldestIdentifier !== "string") break;
    rateLimitMap.delete(oldestIdentifier);
  }

  lastRateLimitPruneAt = now;
}

async function waitUntil(target: number): Promise<void> {
  const remaining = target - Date.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}
