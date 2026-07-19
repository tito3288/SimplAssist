import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id, call_forwarding_nudge_resolved_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    console.error(
      `[settings:call-forwarding:nudge] Failed to find business for user ${user.id}:`,
      businessError
    );
    return NextResponse.json(
      { error: "Failed to save call forwarding preference" },
      { status: 500 }
    );
  }

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  if (business.call_forwarding_nudge_resolved_at) {
    return NextResponse.json({ success: true });
  }

  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({ call_forwarding_nudge_resolved_at: new Date().toISOString() })
    .eq("id", business.id)
    .is("call_forwarding_nudge_resolved_at", null);

  if (updateError) {
    console.error(
      `[settings:call-forwarding:nudge] Failed to resolve for user ${user.id}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save call forwarding preference" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
