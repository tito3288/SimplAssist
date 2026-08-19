import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  getGoogleOAuth2Client,
  withGoogleAuthDeadline,
} from "@/lib/google/client";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

export async function POST() {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;
  const businessId = workspace.access.business.id;

  // Fence local provider work and delete the token atomically before any
  // external revocation. The sensitive token is kept server-side only.
  const { data: accessToken, error: tokenError } = await supabaseAdmin.rpc(
    "disconnect_google_calendar_token",
    { p_business_id: businessId }
  );

  if (tokenError) {
    if (
      tokenError.code === "55P03" ||
      tokenError.message?.includes("calendar_provider_operation_busy")
    ) {
      return NextResponse.json(
        { error: "calendar_operation_unavailable", retryable: true },
        { status: 503 }
      );
    }
    console.error("[google-disconnect] Token fencing failed", {
      code: tokenError.code ?? null,
    });
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (accessToken !== null && typeof accessToken !== "string") {
    console.error("[google-disconnect] Invalid token fencing response");
    return NextResponse.json(
      { error: "service_unavailable", retryable: true },
      { status: 503 }
    );
  }

  if (accessToken) {
    // Try to revoke the token with Google
    try {
      const client = getGoogleOAuth2Client();
      await withGoogleAuthDeadline(client.revokeToken(accessToken), 5_000);
    } catch {
      // The local fence is authoritative. Google may report an already-invalid
      // token; a later provider call cannot start without a replacement row.
    }
  }

  return NextResponse.json({ success: true });
}
