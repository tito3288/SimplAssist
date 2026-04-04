import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(request: NextRequest) {
  try {
    const businessId = request.nextUrl.searchParams.get("businessId");

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing businessId parameter" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: widgetConfig } = await supabaseAdmin
      .from("widget_configs")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .single();

    if (!widgetConfig) {
      return NextResponse.json(
        { error: "Widget not found or not active" },
        { status: 404, headers: corsHeaders }
      );
    }

    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .single();

    return NextResponse.json(
      {
        businessName: business?.name || "Business",
        brandColor: widgetConfig.brand_color,
        position: widgetConfig.position,
        welcomeMessage: widgetConfig.welcome_message,
        showLogo: widgetConfig.show_logo,
        logoUrl: widgetConfig.logo_url,
        leadCaptureEnabled: widgetConfig.lead_capture_enabled,
        leadCaptureTiming: widgetConfig.lead_capture_timing,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Widget config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
