import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, deleted_at")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  if (business.deleted_at) {
    return NextResponse.json(
      { error: "Account is already scheduled for deletion" },
      { status: 400 }
    );
  }

  const now = new Date();
  const deletionDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days

  const { error } = await supabase
    .from("businesses")
    .update({
      deleted_at: now.toISOString(),
      deletion_scheduled_for: deletionDate.toISOString(),
    })
    .eq("id", business.id);

  if (error) {
    console.error("[account] Delete error:", error);
    return NextResponse.json(
      { error: "Failed to delete account" },
      { status: 500 }
    );
  }

  // TODO: Phase 3 — Pause Stripe subscription on account deletion
  // const { data: subscription } = await supabase
  //   .from("subscriptions")
  //   .select("stripe_subscription_id")
  //   .eq("business_id", business.id)
  //   .single();
  //
  // if (subscription?.stripe_subscription_id) {
  //   await stripe.subscriptions.update(subscription.stripe_subscription_id, {
  //     pause_collection: { behavior: "void" },
  //   });
  // }

  return NextResponse.json({
    success: true,
    deletion_scheduled_for: deletionDate.toISOString(),
  });
}
