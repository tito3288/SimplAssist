import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sendFullSuiteWaitlistConfirmation } from "@/lib/email/fullSuiteWaitlist";
import { supabaseAdmin } from "@/lib/supabase/admin";

const waitlistSignupSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(320, "Please keep your email under 320 characters")
      .email("Please enter a valid email")
      .transform((value) => value.toLowerCase()),
    // Hidden honeypot. Humans never fill this field.
    website: z.string().optional(),
  })
  .strict();

const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const MAX_RATE_LIMIT_IDENTIFIERS = 10_000;
const CONFIRMATION_DEADLINE_MS = 1_000;
const MIN_SUCCESS_RESPONSE_MS = 1_100;
const SUCCESS_RESPONSE_JITTER_MS = 200;
let lastRateLimitPruneAt = 0;

function pruneRateLimitMap(now: number): void {
  if (
    now - lastRateLimitPruneAt < RATE_LIMIT_WINDOW_MS &&
    rateLimitMap.size < MAX_RATE_LIMIT_IDENTIFIERS
  ) {
    return;
  }

  rateLimitMap.forEach((timestamps, identifier) => {
    const recent = timestamps.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
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

function isRateLimited(identifier: string): boolean {
  const now = Date.now();
  pruneRateLimitMap(now);
  const timestamps = rateLimitMap.get(identifier) ?? [];
  const recent = timestamps.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS
  );

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(identifier, recent);
    return true;
  }

  recent.push(now);
  rateLimitMap.set(identifier, recent);
  return false;
}

async function successResponse(startedAt: number): Promise<NextResponse> {
  // Fresh signups perform a provider call while duplicates do not. Equalize
  // normal success timing so the endpoint does not become an email-membership
  // oracle, while keeping confirmation delivery inside the request lifetime.
  const targetDuration =
    MIN_SUCCESS_RESPONSE_MS +
    Math.floor(Math.random() * SUCCESS_RESPONSE_JITTER_MS);
  const remainingDelay = targetDuration - (Date.now() - startedAt);
  if (remainingDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  }

  return NextResponse.json(
    { success: true },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim() ??
    "unknown";

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a minute and try again." },
      { status: 429, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parsed = waitlistSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (parsed.data.website?.trim()) {
    return successResponse(startedAt);
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("waitlist_signups")
    .insert({ email: parsed.data.email })
    .select("id")
    .single<{ id: string }>();

  if (insertError) {
    if (insertError.code === "23505") {
      // Duplicate, including a previously unsubscribed row. Do not query or
      // update it: the response remains private and no second email is sent.
      return successResponse(startedAt);
    }

    console.error("[waitlist] insert failed", {
      code: insertError.code ?? "unknown",
    });
    return NextResponse.json(
      { error: "Couldn’t join the waitlist right now. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (!inserted?.id) {
    console.error("[waitlist] insert returned no signup id");
    return NextResponse.json(
      { error: "Couldn’t join the waitlist right now. Please try again." },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  // The database row is the durable signup. Email delivery failure is
  // intentionally non-fatal so the public response remains a success.
  const confirmationController = new AbortController();
  const confirmationBudgetMs = Math.max(
    0,
    CONFIRMATION_DEADLINE_MS - (Date.now() - startedAt)
  );
  let confirmationDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      sendFullSuiteWaitlistConfirmation({
        signupId: inserted.id,
        email: parsed.data.email,
        requestOrigin: request.nextUrl.origin,
        signal: confirmationController.signal,
      }),
      new Promise<false>((resolve) => {
        confirmationDeadline = setTimeout(() => {
          confirmationController.abort();
          resolve(false);
        }, confirmationBudgetMs);
      }),
    ]);
  } catch {
    // The sender is designed not to throw, but keep the durable-signup
    // contract intact even if that implementation changes.
    console.error("[waitlist] confirmation sender failed unexpectedly");
  } finally {
    if (confirmationDeadline) clearTimeout(confirmationDeadline);
  }

  return successResponse(startedAt);
}
