import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { processIncomingMessage } from "@/lib/ai/engine";

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
    const body = await request.json();
    const { businessId, message, sessionId, visitorEmail, visitorName } = body;

    if (!businessId || !message || !sessionId) {
      return NextResponse.json(
        { error: "Missing required fields: businessId, message, sessionId" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: widgetConfig } = await supabaseAdmin
      .from("widget_configs")
      .select("id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .single();

    if (!widgetConfig) {
      return NextResponse.json(
        { error: "Widget not found or not active" },
        { status: 404, headers: corsHeaders }
      );
    }

    const response = await processIncomingMessage(
      businessId,
      null,
      visitorEmail || null,
      message,
      "web_chat"
    );

    return NextResponse.json(
      { response, sessionId },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Widget chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
