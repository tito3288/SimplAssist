import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getGoogleOAuth2Client } from "@/lib/google/client";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

export async function POST() {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;
  const businessId = workspace.access.business.id;

  // Get the token to revoke it
  const { data: token, error: tokenError } = await supabaseAdmin
    .from("google_calendar_tokens")
    .select("access_token")
    .eq("business_id", businessId)
    .maybeSingle();

  if (tokenError) {
    console.error("[google-disconnect] Token lookup failed:", tokenError);
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (token) {
    // Try to revoke the token with Google
    try {
      const client = getGoogleOAuth2Client();
      await client.revokeToken(token.access_token);
    } catch {
      // Token may already be invalid — continue with deletion
    }

    // Delete from database
    const { error: deleteError } = await supabaseAdmin
      .from("google_calendar_tokens")
      .delete()
      .eq("business_id", businessId);

    if (deleteError) {
      console.error("[google-disconnect] Token delete failed:", deleteError);
      return NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      );
    }
  }

  return NextResponse.json({ success: true });
}
