import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { telnyx } from "@/lib/messaging/client";
import {
  getOutboundSendContext,
  smsBlockCode,
  smsBlockMessage,
} from "@/lib/messaging/lookup";

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
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .single();

    if (!business) {
      return NextResponse.json(
        { error: "Business not found or unauthorized" },
        { status: 403 }
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

    const sendContext = await getOutboundSendContext(
      phoneNumberRow.phone_number
    );

    if (!sendContext.smsReady) {
      return NextResponse.json(
        {
          error: smsBlockCode(sendContext.blockReason),
          message: smsBlockMessage(sendContext.blockReason),
          assignmentStatus: sendContext.assignmentStatus,
          assignmentFailureReason: sendContext.assignmentFailureReason,
        },
        { status: 403 }
      );
    }

    if (!sendContext.messagingProfileId) {
      return NextResponse.json(
        { error: "Messaging profile not configured for this business" },
        { status: 500 }
      );
    }

    const result = await telnyx.messages.send({
      to,
      from: phoneNumberRow.phone_number,
      text: message,
      messaging_profile_id: sendContext.messagingProfileId,
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
