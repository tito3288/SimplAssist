import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { publicAppOrigin } from "@/lib/billing/publicAppOrigin";
import {
  type FullSuiteLaunchSendOutcome,
  sendFullSuiteLaunchEmail,
} from "@/lib/email/fullSuiteLaunch";
import { supabaseAdmin } from "@/lib/supabase/admin";

const singlePayloadSchema = z
  .object({
    action: z.literal("single"),
    signupId: z.string().uuid(),
  })
  .strict();

const bulkPayloadSchema = z
  .object({
    action: z.literal("bulk"),
    confirmation: z.literal("SEND"),
    expectedCount: z.number().int().nonnegative(),
    cutoff: z.string().datetime({ offset: true }),
  })
  .strict();

const testPayloadSchema = z
  .object({
    action: z.literal("test"),
  })
  .strict();

const payloadSchema = z.discriminatedUnion("action", [
  singlePayloadSchema,
  bulkPayloadSchema,
  testPayloadSchema,
]);

type SendTotals = {
  sent: number;
  failed: number;
  skipped: number;
  needsReview: number;
};

type ClaimedRecipient = {
  signupId: string;
  email: string;
};

type ClaimReleaseResult = "released" | "not_released" | "error";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
const CANDIDATE_PAGE_SIZE = 1_000;

function emptyTotals(): SendTotals {
  return { sent: 0, failed: 0, skipped: 0, needsReview: 0 };
}

function jsonError(
  error: string,
  status: number,
  code?: string
): NextResponse {
  return NextResponse.json(
    { error, ...(code ? { code } : {}) },
    { status, headers: NO_STORE_HEADERS }
  );
}

function isConfiguredSameOrigin(request: NextRequest): boolean {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim()) return false;

  let expectedOrigin: string;
  try {
    expectedOrigin = publicAppOrigin(request.nextUrl.origin);
  } catch {
    return false;
  }

  const providedOrigin = request.headers.get("origin");
  if (!providedOrigin) return false;

  try {
    const parsedOrigin = new URL(providedOrigin);
    if (
      parsedOrigin.origin !== expectedOrigin ||
      parsedOrigin.username ||
      parsedOrigin.password ||
      parsedOrigin.pathname !== "/" ||
      parsedOrigin.search ||
      parsedOrigin.hash
    ) {
      return false;
    }
  } catch {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}

function parseClaimedRecipient(
  data: unknown,
  expectedSignupId: string
): ClaimedRecipient | null {
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;

  if (
    !row ||
    typeof row !== "object" ||
    !("signup_id" in row) ||
    !("signup_email" in row) ||
    row.signup_id !== expectedSignupId ||
    typeof row.signup_email !== "string" ||
    row.signup_email.length < 3 ||
    row.signup_email.length > 320
  ) {
    return null;
  }

  return {
    signupId: row.signup_id,
    email: row.signup_email,
  };
}

async function releaseClaim(
  signupId: string,
  claimToken: string
): Promise<ClaimReleaseResult> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "release_waitlist_launch_send",
      {
        p_signup_id: signupId,
        p_claim_token: claimToken,
      }
    );

    if (error) {
      console.error("[admin:waitlist:send] claim release failed");
      return "error";
    }

    return data === true ? "released" : "not_released";
  } catch {
    console.error("[admin:waitlist:send] claim release failed");
    return "error";
  }
}

async function claimRecipient(
  signupId: string,
  claimToken: string
): Promise<
  | { state: "claimed"; recipient: ClaimedRecipient }
  | { state: "skipped" }
  | { state: "failed" }
  | { state: "needs_review" }
> {
  let data: unknown;
  try {
    const result = await supabaseAdmin.rpc("claim_waitlist_launch_send", {
      p_signup_id: signupId,
      p_claim_token: claimToken,
    });
    if (result.error) {
      console.error("[admin:waitlist:send] claim failed");
      return (await releaseClaim(signupId, claimToken)) === "error"
        ? { state: "needs_review" }
        : { state: "failed" };
    }
    data = result.data;
  } catch {
    console.error("[admin:waitlist:send] claim failed");
    return (await releaseClaim(signupId, claimToken)) === "error"
      ? { state: "needs_review" }
      : { state: "failed" };
  }

  if (Array.isArray(data) && data.length === 0) {
    return { state: "skipped" };
  }

  const recipient = parseClaimedRecipient(data, signupId);
  if (!recipient) {
    console.error("[admin:waitlist:send] claim returned an invalid result");
    return (await releaseClaim(signupId, claimToken)) === "released"
      ? { state: "failed" }
      : { state: "needs_review" };
  }

  return { state: "claimed", recipient };
}

async function completeClaim(
  signupId: string,
  claimToken: string
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc(
      "complete_waitlist_launch_send",
      {
        p_signup_id: signupId,
        p_claim_token: claimToken,
      }
    );

    if (error || data !== true) {
      console.error("[admin:waitlist:send] claim completion failed");
      return false;
    }

    return true;
  } catch {
    console.error("[admin:waitlist:send] claim completion failed");
    return false;
  }
}

async function revalidateClaimBeforeSend(
  signupId: string,
  claimToken: string
): Promise<"ready" | "skipped" | "failed" | "needs_review"> {
  try {
    const { data, error } = await supabaseAdmin
      .from("waitlist_signups")
      .select("id")
      .eq("id", signupId)
      .eq("launch_send_claim_token", claimToken)
      .is("notified_at", null)
      .is("unsubscribed_at", null)
      .maybeSingle();

    if (error) {
      console.error("[admin:waitlist:send] pre-send recheck failed");
      return (await releaseClaim(signupId, claimToken)) === "released"
        ? "failed"
        : "needs_review";
    }

    if (
      !data ||
      typeof data !== "object" ||
      !("id" in data) ||
      data.id !== signupId
    ) {
      const release = await releaseClaim(signupId, claimToken);
      return release === "error" ? "needs_review" : "skipped";
    }

    return "ready";
  } catch {
    console.error("[admin:waitlist:send] pre-send recheck failed");
    return (await releaseClaim(signupId, claimToken)) === "released"
      ? "failed"
      : "needs_review";
  }
}

async function sendClaimedSignup(
  signupId: string,
  requestOrigin: string
): Promise<keyof SendTotals> {
  const claimToken = randomUUID();
  const claim = await claimRecipient(signupId, claimToken);

  if (claim.state === "skipped") return "skipped";
  if (claim.state === "failed") return "failed";
  if (claim.state === "needs_review") return "needsReview";

  let outcome: FullSuiteLaunchSendOutcome;
  const preflightState: {
    value: "not_run" | "ready" | "skipped" | "failed" | "needs_review";
  } = { value: "not_run" };
  try {
    outcome = await sendFullSuiteLaunchEmail(
      {
        kind: "launch",
        signupId: claim.recipient.signupId,
        email: claim.recipient.email,
        requestOrigin,
      },
      async () => {
        preflightState.value = await revalidateClaimBeforeSend(
          signupId,
          claimToken
        );
        return preflightState.value === "ready";
      }
    );
  } catch {
    // Keep the claim: a thrown provider call has an ambiguous delivery state.
    console.error("[admin:waitlist:send] provider outcome is ambiguous");
    return "needsReview";
  }

  if (outcome === "cancelled") {
    if (preflightState.value === "skipped") return "skipped";
    if (preflightState.value === "failed") return "failed";
    return "needsReview";
  }

  if (outcome === "ambiguous") return "needsReview";

  if (outcome === "definite_failure") {
    return (await releaseClaim(signupId, claimToken)) === "released"
      ? "failed"
      : "needsReview";
  }

  return (await completeClaim(signupId, claimToken))
    ? "sent"
    : "needsReview";
}

async function loadBulkCandidateIds(cutoff: string): Promise<string[] | null> {
  const candidateIds: string[] = [];
  const seenCandidateIds = new Set<string>();

  for (let start = 0; ; start += CANDIDATE_PAGE_SIZE) {
    let result: {
      data: unknown;
      error: { message?: string } | null;
    };
    try {
      result = await supabaseAdmin
        .from("waitlist_signups")
        .select("id")
        .is("notified_at", null)
        .is("unsubscribed_at", null)
        .is("launch_send_claim_token", null)
        .lte("created_at", cutoff)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(start, start + CANDIDATE_PAGE_SIZE - 1);
    } catch {
      console.error("[admin:waitlist:send] candidate query failed");
      return null;
    }

    if (result.error || !Array.isArray(result.data)) {
      console.error("[admin:waitlist:send] candidate query failed");
      return null;
    }
    const data = result.data;

    for (const row of data) {
      if (
        !row ||
        typeof row !== "object" ||
        !("id" in row) ||
        typeof row.id !== "string" ||
        !z.string().uuid().safeParse(row.id).success ||
        seenCandidateIds.has(row.id)
      ) {
        console.error(
          "[admin:waitlist:send] candidate query returned invalid data"
        );
        return null;
      }
      candidateIds.push(row.id);
      seenCandidateIds.add(row.id);
    }

    if (data.length < CANDIDATE_PAGE_SIZE) break;
  }

  return candidateIds;
}

export async function POST(request: NextRequest) {
  // Authentication intentionally precedes origin checks, body parsing, and
  // every service-role query so unauthenticated callers receive only a 404.
  const admin = await getAdminUser();
  if (!admin) return jsonError("Not found", 404);

  if (!isConfiguredSameOrigin(request)) {
    return jsonError("Request origin is not allowed", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid send request", 400);

  const requestOrigin = request.nextUrl.origin;

  if (parsed.data.action === "test") {
    if (!admin.email) {
      return jsonError("Admin email is unavailable", 409);
    }

    let outcome: FullSuiteLaunchSendOutcome;
    try {
      outcome = await sendFullSuiteLaunchEmail({
        kind: "test",
        email: admin.email,
        requestOrigin,
      });
    } catch {
      console.error("[admin:waitlist:send] test provider outcome is ambiguous");
      outcome = "ambiguous";
    }

    const totals = emptyTotals();
    if (outcome === "accepted") totals.sent = 1;
    else if (outcome === "definite_failure") totals.failed = 1;
    else totals.needsReview = 1;
    return NextResponse.json(totals, { headers: NO_STORE_HEADERS });
  }

  if (parsed.data.action === "single") {
    const totals = emptyTotals();
    totals[
      await sendClaimedSignup(parsed.data.signupId, requestOrigin)
    ] += 1;
    return NextResponse.json(totals, { headers: NO_STORE_HEADERS });
  }

  if (Date.parse(parsed.data.cutoff) > Date.now()) {
    return jsonError("Invalid send request", 400);
  }

  const candidateIds = await loadBulkCandidateIds(parsed.data.cutoff);
  if (!candidateIds) {
    return jsonError("Couldn’t load pending waitlist recipients", 500);
  }

  if (candidateIds.length !== parsed.data.expectedCount) {
    return jsonError(
      "Pending waitlist changed; refresh before sending",
      409,
      "waitlist_count_drift"
    );
  }

  const totals = emptyTotals();
  for (const signupId of candidateIds) {
    totals[await sendClaimedSignup(signupId, requestOrigin)] += 1;
  }

  return NextResponse.json(totals, { headers: NO_STORE_HEADERS });
}
