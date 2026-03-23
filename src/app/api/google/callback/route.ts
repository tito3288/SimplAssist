import { NextRequest, NextResponse } from "next/server";
import { getGoogleOAuth2Client } from "@/lib/google/client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Use NEXT_PUBLIC_APP_URL for production, fall back to request origin for local dev
  const origin = new URL(request.url).origin;
  const isLocalhost = origin.includes("localhost:3000");
  const appUrl = isLocalhost ? origin : (process.env.NEXT_PUBLIC_APP_URL || origin);

  if (error || !code || !state) {
    return NextResponse.redirect(
      `${appUrl}/settings`
    );
  }

  let businessId: string;
  try {
    businessId = Buffer.from(state, "base64").toString("utf-8");
  } catch {
    return NextResponse.redirect(
      `${appUrl}/settings`
    );
  }

  // Verify business exists
  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .single();

  if (!business) {
    return NextResponse.redirect(
      `${appUrl}/settings`
    );
  }

  try {
    const client = getGoogleOAuth2Client();
    const { tokens } = await client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      console.error("[google-callback] Missing tokens");
      return NextResponse.redirect(
        `${appUrl}/settings`
      );
    }

    // Try to extract email from the ID token (if present)
    let googleEmail: string | null = null;
    if (tokens.id_token) {
      try {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: process.env.GOOGLE_CLIENT_ID!,
        });
        const payload = ticket.getPayload();
        googleEmail = payload?.email || null;
      } catch {
        // ID token parsing failed — continue without email
      }
    }

    const tokenExpiry = tokens.expiry_date
      ? new Date(tokens.expiry_date).toISOString()
      : new Date(Date.now() + 3600 * 1000).toISOString();

    // Upsert token (one calendar connection per business)
    const { error: dbError } = await supabaseAdmin.from("google_calendar_tokens").upsert(
      {
        business_id: businessId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry: tokenExpiry,
        google_email: googleEmail,
        calendar_id: "primary",
      },
      { onConflict: "business_id" }
    );

    if (dbError) {
      console.error("[google-callback] DB error:", dbError);
      return NextResponse.redirect(
        `${appUrl}/settings`
      );
    }

    // Auto-set booking mode to direct scheduling since they connected their calendar
    await supabaseAdmin
      .from("ai_settings")
      .update({ booking_enabled: true, booking_mode: "schedule_direct" })
      .eq("business_id", businessId);

    console.log("[google-callback] Success! Token saved for business:", businessId);
    return NextResponse.redirect(
      `${appUrl}/settings`
    );
  } catch (err) {
    console.error("[google-callback] Error:", err);
    return NextResponse.redirect(
      `${appUrl}/settings`
    );
  }
}
