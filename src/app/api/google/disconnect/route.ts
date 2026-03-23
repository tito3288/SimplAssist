import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGoogleOAuth2Client } from "@/lib/google/client";

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
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  // Get the token to revoke it
  const { data: token } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("access_token")
    .eq("business_id", business.id)
    .single();

  if (token) {
    // Try to revoke the token with Google
    try {
      const client = getGoogleOAuth2Client();
      await client.revokeToken(token.access_token);
    } catch {
      // Token may already be invalid — continue with deletion
    }

    // Delete from database
    await supabaseAdmin
      .from("google_calendar_tokens")
      .delete()
      .eq("business_id", business.id);
  }

  return NextResponse.json({ success: true });
}
