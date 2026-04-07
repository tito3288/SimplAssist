import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { closeConversation } from "@/lib/ai/conversations";

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

    // Find contact by session_id
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("session_id", sessionId)
      .single();

    if (!contact) {
      return NextResponse.json(
        { success: true },
        { headers: corsHeaders }
      );
    }

    // Find active conversation for this contact
    const { data: conversation } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .eq("status", "active")
      .single();

    if (conversation) {
      await closeConversation(conversation.id);
    }

    return NextResponse.json(
      { success: true },
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
