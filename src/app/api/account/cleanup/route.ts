import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CLAIM_STALE_AFTER_MS = 10 * 60 * 1000;

// Cron teardown of expired soft-deleted accounts.
//
// All DB mutations happen inside the cleanup_expired_business RPC (migrations
// 026/027) in one transaction — a half-deleted account cannot exist.
// Per-business order:
//   0. Claim via conditional UPDATE on cleanup_attempted_at (stale after 10
//      minutes), so overlapping runs never interleave on one business.
//   1. RPC: anonymize messages/contacts, delete the config tables, scrub ALL
//      business PII, copy owner_id into cleanup_auth_user_id and null it
//      (businesses.owner_id is ON DELETE CASCADE — deleting the auth user
//      with it still set would cascade away the tombstone). Returns the auth
//      user id that still needs deletion, from the durable linkage column —
//      sound across crashes and retries.
//   2. Delete that auth user (GoTrue API; cannot join the transaction).
//      404 counts as done.
//   3. Completion: clear deletion_scheduled_for and cleanup_auth_user_id
//      together. Until this lands the row keeps matching the cron query, so
//      any failure above means the next run retries from the top (the RPC is
//      idempotent on an already-scrubbed account and returns the same
//      linked user id).
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

  if (!expiredBusinesses || expiredBusinesses.length === 0) {
    return NextResponse.json({ success: true, deleted_count: 0, failed_count: 0 });
  }

  let deletedCount = 0;
  const failedIds: string[] = [];

  for (const business of expiredBusinesses) {
    const fail = (step: string, detail: string) => {
      console.error(`[cleanup] ${step} failed for business ${business.id}: ${detail}`);
      failedIds.push(business.id);
    };

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
      fail("claim", claimError.message);
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
      fail("cleanup RPC", rpcError.message);
      continue;
    }

    // 2. Auth user delete, from the RPC's durable linkage. On failure the
    //    linkage column survives, so the next run retries the deletion —
    //    no restore path needed.
    if (pendingAuthUserId) {
      const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(
        pendingAuthUserId as string
      );
      if (authError && authError.status !== 404) {
        fail("auth user delete", authError.message);
        continue;
      }
    }

    // 3. Completion — clear the schedule and the linkage together; the row
    //    stops matching the cron query (deleted_at stays as the tombstone
    //    flag; cleanup_attempted_at stays as an audit breadcrumb).
    const { error: markerError } = await supabaseAdmin
      .from("businesses")
      .update({ deletion_scheduled_for: null, cleanup_auth_user_id: null })
      .eq("id", business.id);
    if (markerError) {
      fail("completion marker", markerError.message);
      continue;
    }

    deletedCount++;
    console.log(`[cleanup] Permanently cleaned business ${business.id}`);
  }

  return NextResponse.json({
    success: failedIds.length === 0,
    deleted_count: deletedCount,
    failed_count: failedIds.length,
    failed_ids: failedIds,
  });
}
