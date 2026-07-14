import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileAccountDeletionStripeAction } from "@/lib/stripe/accountDeletionReconciler";

const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

type CleanupStripeAction = {
  generation: number;
  status: "pending" | "applied" | "blocked";
  lastErrorCode: string | null;
};

type GraceStripeAction = {
  businessId: string;
  desiredAction: "pause";
  generation: number;
  status: "pending" | "blocked";
  lastErrorCode: string | null;
};

// Cron teardown of expired soft-deleted accounts.
//
// The database scrub happens inside cleanup_expired_business in one
// transaction. Stripe cancellation and auth deletion cannot join that
// transaction, so their durable linkages remain until final completion.
// Before per-business cleanup, reconcile unexpired pause work left by a
// route outage or crash. The same daily job is the durable retry executor; a
// customer must not remain billable merely because the best-effort delete-route
// Stripe call failed after the database transaction committed.
// Per-business order:
//   0. Claim via conditional UPDATE on cleanup_attempted_at (stale after 10
//      minutes), so overlapping runs never interleave on one business.
//   1. RPC: anonymize messages/contacts, delete the config tables, scrub ALL
//      business PII, durably queue Stripe cancellation, copy owner_id into
//      cleanup_auth_user_id, and null owner_id
//      (businesses.owner_id is ON DELETE CASCADE — deleting the auth user
//      with it still set would cascade away the tombstone). Returns the auth
//      user id that still needs deletion, from the durable linkage column —
//      sound across crashes and retries.
//   2. Prove the exact durable Stripe cancellation generation applied.
//   3. Delete the auth user (GoTrue API; cannot join the transaction).
//      404 counts as done.
//   4. Completion RPC: remove the applied Stripe action and clear the schedule,
//      auth linkage, and claim together. Until this lands the row keeps
//      matching the cron query, so any failure above retries durably.
//
// Failure policy: abort the failing business (it retries on the next run),
// continue the batch, report honestly — deleted_count counts only fully
// completed businesses and success is false when anything failed. A lost
// claim is a skip, not a failure.
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: expiredBusinesses, error: queryError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .not("deleted_at", "is", null)
    .lt("deletion_scheduled_for", new Date().toISOString());

  if (queryError) {
    console.error("[cleanup] Query error:", queryError);
    return NextResponse.json({ error: "Failed to query expired accounts" }, { status: 500 });
  }

  const expiredBusinessIds = new Set(
    (expiredBusinesses ?? []).map((business) => business.id)
  );
  const failedIds = new Set<string>();
  const fail = (businessId: string, step: string, detail: string) => {
    console.error(`[cleanup] ${step} failed for business ${businessId}: ${detail}`);
    failedIds.add(businessId);
  };

  const { data: graceActionData, error: graceActionError } = await supabaseAdmin
    .from("account_deletion_stripe_actions")
    .select("business_id, desired_action, generation, status, last_error_code")
    .eq("desired_action", "pause")
    .in("status", ["pending", "blocked"]);

  if (graceActionError) {
    console.error("[cleanup] Grace-period Stripe action query error:", graceActionError);
    return NextResponse.json(
      { error: "Failed to query pending Stripe billing actions" },
      { status: 500 }
    );
  }

  for (const value of graceActionData ?? []) {
    const action = parseGraceStripeAction(value);
    if (!action) {
      console.error("[cleanup] Invalid grace-period Stripe action payload");
      return NextResponse.json(
        { error: "Invalid pending Stripe billing action" },
        { status: 500 }
      );
    }

    // Expired businesses transition their durable desired state directly to
    // cancel inside cleanup_expired_business. Pausing immediately beforehand
    // would add a redundant Stripe mutation and delay terminal cleanup.
    if (expiredBusinessIds.has(action.businessId)) continue;

    if (action.status === "blocked") {
      fail(
        action.businessId,
        `Stripe ${action.desiredAction}`,
        action.lastErrorCode ? `blocked (${action.lastErrorCode})` : "blocked"
      );
      continue;
    }

    try {
      const result = await reconcileAccountDeletionStripeAction({
        businessId: action.businessId,
        generation: action.generation,
      });

      if (result.outcome === "not_claimed" || result.outcome === "stale") {
        // A route request or overlapping cron owns the exact CAS generation.
        // Its durable result is authoritative; a later daily run will retry if
        // the action remains pending after the five-minute lease expires.
        continue;
      }

      if (
        result.outcome !== "applied" ||
        (result.appliedAction !== action.desiredAction &&
          result.appliedAction !== "cancel")
      ) {
        fail(
          action.businessId,
          `Stripe ${action.desiredAction}`,
          reconciliationFailureDetail(result)
        );
      }
    } catch (stripeError) {
      fail(
        action.businessId,
        `Stripe ${action.desiredAction}`,
        errorMessage(stripeError)
      );
    }
  }

  let deletedCount = 0;

  for (const business of expiredBusinesses ?? []) {
    const failBusiness = (step: string, detail: string) =>
      fail(business.id, step, detail);

    // 0. Claim — compare-and-swap on cleanup_attempted_at. Zero rows means
    //    another run holds this business: skip, not a failure.
    const claimCutoff = new Date(Date.now() - CLAIM_STALE_AFTER_MS).toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("businesses")
      .update({ cleanup_attempted_at: new Date().toISOString() })
      .eq("id", business.id)
      .or(`cleanup_attempted_at.is.null,cleanup_attempted_at.lt.${claimCutoff}`)
      .select("id");
    if (claimError) {
      failBusiness("claim", claimError.message);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      console.log(`[cleanup] Business ${business.id} is claimed by another run, skipping`);
      continue;
    }

    // 1. Atomic DB teardown — everything or nothing. Returns the auth user
    //    that still needs deletion (null when none remains).
    const { data: pendingAuthUserId, error: rpcError } = await supabaseAdmin.rpc(
      "cleanup_expired_business",
      { p_business_id: business.id }
    );
    if (rpcError) {
      failBusiness("cleanup RPC", rpcError.message);
      continue;
    }
    if (
      pendingAuthUserId !== null &&
      (typeof pendingAuthUserId !== "string" || !pendingAuthUserId)
    ) {
      failBusiness("cleanup RPC", "invalid auth-user linkage");
      continue;
    }

    // 2. Stripe cancellation — the scrub transaction has already preserved
    //    the subscription id and exact cancel generation. No auth deletion or
    //    completion may happen until cancellation is proven applied.
    const { data: actionData, error: actionError } = await supabaseAdmin
      .from("account_deletion_stripe_actions")
      .select(
        "business_id, desired_action, generation, status, applied_action, last_error_code"
      )
      .eq("business_id", business.id)
      .maybeSingle();
    if (actionError) {
      failBusiness("Stripe action query", actionError.message);
      continue;
    }

    const stripeAction = actionData
      ? parseCleanupStripeAction(actionData, business.id)
      : null;
    if (actionData && !stripeAction) {
      failBusiness("Stripe action query", "invalid cancellation action payload");
      continue;
    }

    if (stripeAction?.status === "blocked") {
      failBusiness(
        "Stripe cancellation",
        stripeAction.lastErrorCode
          ? `blocked (${stripeAction.lastErrorCode})`
          : "blocked"
      );
      continue;
    }

    if (stripeAction?.status === "pending") {
      try {
        const result = await reconcileAccountDeletionStripeAction({
          businessId: business.id,
          generation: stripeAction.generation,
        });

        if (result.outcome !== "applied" || result.appliedAction !== "cancel") {
          failBusiness("Stripe cancellation", reconciliationFailureDetail(result));
          continue;
        }
      } catch (stripeError) {
        failBusiness("Stripe cancellation", errorMessage(stripeError));
        continue;
      }
    }

    // 3. Auth user delete, from the RPC's durable linkage. On failure the
    //    linkage column survives, so the next run retries the deletion —
    //    no restore path needed.
    if (pendingAuthUserId) {
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
        pendingAuthUserId
      );
      if (authError && authError.status !== 404) {
        failBusiness("auth user delete", authError.message);
        continue;
      }
    }

    // 4. Completion — remove the applied cancellation action and clear every
    //    durable external-work linkage together. deleted_at remains the
    //    tombstone flag.
    const { data: completed, error: completionError } = await supabaseAdmin.rpc(
      "complete_expired_business_cleanup",
      {
        p_business_id: business.id,
        p_generation: stripeAction?.generation ?? null,
      }
    );
    if (completionError || completed !== true) {
      failBusiness(
        "completion RPC",
        completionError?.message ?? "invalid completion response"
      );
      continue;
    }

    deletedCount++;
    console.log(`[cleanup] Permanently cleaned business ${business.id}`);
  }

  return NextResponse.json({
    success: failedIds.size === 0,
    deleted_count: deletedCount,
    failed_count: failedIds.size,
    failed_ids: Array.from(failedIds),
  });
}

function parseGraceStripeAction(value: unknown): GraceStripeAction | null {
  if (
    !isRecord(value) ||
    typeof value.business_id !== "string" ||
    !value.business_id ||
    value.desired_action !== "pause" ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    (value.status !== "pending" && value.status !== "blocked") ||
    (value.last_error_code !== null &&
      typeof value.last_error_code !== "string")
  ) {
    return null;
  }

  return {
    businessId: value.business_id,
    desiredAction: value.desired_action,
    generation: value.generation as number,
    status: value.status,
    lastErrorCode: value.last_error_code,
  };
}

function parseCleanupStripeAction(
  value: unknown,
  expectedBusinessId: string
): CleanupStripeAction | null {
  if (
    !isRecord(value) ||
    value.business_id !== expectedBusinessId ||
    value.desired_action !== "cancel" ||
    !Number.isSafeInteger(value.generation) ||
    (value.generation as number) < 1 ||
    !isStripeActionStatus(value.status) ||
    !isNullableStripeAction(value.applied_action) ||
    (value.last_error_code !== null &&
      typeof value.last_error_code !== "string")
  ) {
    return null;
  }

  if (value.status === "applied" && value.applied_action !== "cancel") {
    return null;
  }

  return {
    generation: value.generation as number,
    status: value.status,
    lastErrorCode: value.last_error_code,
  };
}

function reconciliationFailureDetail(
  result: Awaited<ReturnType<typeof reconcileAccountDeletionStripeAction>>
): string {
  if (result.outcome === "pending" || result.outcome === "blocked") {
    return `${result.outcome} (${result.errorCode})`;
  }
  if (result.outcome === "applied") {
    return `applied unexpected action ${result.appliedAction}`;
  }
  return result.outcome;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "unknown reconciliation failure";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStripeActionStatus(
  value: unknown
): value is CleanupStripeAction["status"] {
  return value === "pending" || value === "applied" || value === "blocked";
}

function isNullableStripeAction(
  value: unknown
): value is "pause" | "resume" | "cancel" | null {
  return (
    value === null ||
    value === "pause" ||
    value === "resume" ||
    value === "cancel"
  );
}
