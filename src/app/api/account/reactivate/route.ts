import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id, deleted_at, deletion_scheduled_for")
    .eq("owner_id", user.id)
    .single();

  if (!business || !business.deleted_at) {
    return NextResponse.json(
      { error: "Account not found or not scheduled for deletion" },
      { status: 404 }
    );
  }

  // Check if the 60-day window has passed
  if (
    business.deletion_scheduled_for &&
    new Date(business.deletion_scheduled_for) <= new Date()
  ) {
    return NextResponse.json(
      { error: "Account has been permanently deleted and cannot be reactivated" },
      { status: 410 }
    );
  }

  const { error } = await supabase
    .from("businesses")
    .update({
      deleted_at: null,
      deletion_scheduled_for: null,
    })
    .eq("id", business.id);

  if (error) {
    console.error("[account/reactivate] Error:", error);
    return NextResponse.json(
      { error: "Failed to reactivate account" },
      { status: 500 }
    );
  }

  // TODO: Phase 3 — Resume Stripe subscription on reactivation
  // const { data: subscription } = await supabase
  //   .from("subscriptions")
  //   .select("stripe_subscription_id")
  //   .eq("business_id", business.id)
  //   .single();
  //
  // if (subscription?.stripe_subscription_id) {
  //   await stripe.subscriptions.update(subscription.stripe_subscription_id, {
  //     pause_collection: "",
  //   });
  // }

  return NextResponse.json({ success: true });
}
