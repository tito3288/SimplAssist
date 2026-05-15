import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { telnyx } from "@/lib/messaging/client";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { to, message, businessId } = await request.json();

    if (!to || !message || !businessId) {
      return NextResponse.json(
        { error: "Missing required fields: to, message, businessId" },
        { status: 400 }
      );
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id, telnyx_messaging_profile_id, campaign_status")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .single();

    if (!business) {
      return NextResponse.json(
        { error: "Business not found or unauthorized" },
        { status: 403 }
      );
    }

    if (business.campaign_status !== "approved") {
      return NextResponse.json(
        {
          error: "CAMPAIGN_NOT_APPROVED",
          message:
            "Your SMS campaign is still under carrier review. Sending is paused until approval — usually 1-5 days.",
        },
        { status: 403 }
      );
    }

    if (!business.telnyx_messaging_profile_id) {
      return NextResponse.json(
        { error: "Messaging profile not configured for this business" },
        { status: 500 }
      );
    }

    const { data: phoneNumberRow } = await supabase
      .from("phone_numbers")
      .select("phone_number")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .single();

    if (!phoneNumberRow) {
      return NextResponse.json(
        { error: "No active phone number found for this business" },
        { status: 404 }
      );
    }

    const result = await telnyx.messages.send({
      to,
      from: phoneNumberRow.phone_number,
      text: message,
      messaging_profile_id: business.telnyx_messaging_profile_id,
      type: "SMS",
    });

    return NextResponse.json({ success: true, id: result.data?.id });
  } catch (error) {
    console.error("Error sending SMS:", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 }
    );
  }
}
