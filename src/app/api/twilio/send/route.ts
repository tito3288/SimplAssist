import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { twilioClient } from "@/lib/twilio/client";

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

    // Verify the user owns the business
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

    // Get the business's Twilio number
    const { data: twilioNumber } = await supabase
      .from("twilio_numbers")
      .select("phone_number")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .single();

    if (!twilioNumber) {
      return NextResponse.json(
        { error: "No active Twilio number found for this business" },
        { status: 404 }
      );
    }

    // Send SMS via Twilio
    const result = await twilioClient.messages.create({
      to,
      from: twilioNumber.phone_number,
      body: message,
    });

    return NextResponse.json({ success: true, sid: result.sid });
  } catch (error) {
    console.error("Error sending SMS:", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 }
    );
  }
}
