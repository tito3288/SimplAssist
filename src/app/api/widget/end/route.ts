import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const { businessId, sessionId } = await request.json();

    if (!businessId || !sessionId) {
      return NextResponse.json(
        { error: "Missing businessId or sessionId" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: widgetConfig, error: widgetError } = await supabaseAdmin
      .from("widget_configs")
      .select("id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle();

    if (widgetError) {
      console.error("Widget end config lookup error:", widgetError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (!widgetConfig) {
      return NextResponse.json(
        { success: true, available: false },
        { headers: corsHeaders }
      );
    }

    try {
      const entitlements = await resolveBusinessEntitlements(businessId);
      if (!canUseFeature(entitlements, "web_chat")) {
        return NextResponse.json(
          { success: true, available: false },
          { headers: corsHeaders }
        );
      }
    } catch (error) {
      if (error instanceof EntitlementResolutionError) {
        return NextResponse.json(
          { error: "Service temporarily unavailable", retryable: true },
          { status: 503, headers: corsHeaders }
        );
      }
      throw error;
    }

    // Find contact by session_id
    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (contactError) {
      console.error("Widget end contact lookup error:", contactError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (!contact) {
      return NextResponse.json(
        { success: true, available: true },
        { headers: corsHeaders }
      );
    }

    // Find active conversation for this contact
    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .eq("status", "active")
      .maybeSingle();

    if (conversationError) {
      console.error("Widget end conversation lookup error:", conversationError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (conversation) {
      const { error: closeError } = await supabaseAdmin
        .from("conversations")
        .update({ status: "closed" })
        .eq("id", conversation.id);

      if (closeError) {
        console.error("Widget end close error:", closeError);
        return NextResponse.json(
          { error: "Service temporarily unavailable", retryable: true },
          { status: 503, headers: corsHeaders }
        );
      }
    }

    return NextResponse.json(
      { success: true, available: true },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Widget end conversation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
