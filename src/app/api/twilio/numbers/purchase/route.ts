import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { purchaseNumber, twilioClient } from "@/lib/twilio/client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (bizError || !business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  const { phoneNumber } = await request.json();

  if (!phoneNumber) {
    return NextResponse.json(
      { error: "Phone number is required" },
      { status: 400 }
    );
  }

  try {
    const purchased = await purchaseNumber(phoneNumber);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
    await twilioClient.incomingPhoneNumbers(purchased.sid).update({
      smsUrl: `${appUrl}/api/twilio/webhook`,
      voiceUrl: `${appUrl}/api/twilio/voice`,
    });

    const { data: record, error: insertError } = await supabase
      .from("twilio_numbers")
      .insert({
        business_id: business.id,
        phone_number: purchased.phoneNumber,
        twilio_sid: purchased.sid,
        is_active: true,
        sms_webhook_url: `${appUrl}/api/twilio/webhook`,
        voice_webhook_url: `${appUrl}/api/twilio/voice`,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error saving number:", insertError);
      return NextResponse.json(
        { error: "Number purchased but failed to save" },
        { status: 500 }
      );
    }

    return NextResponse.json({ number: record });
  } catch (error) {
    console.error("Error purchasing number:", error);
    return NextResponse.json(
      { error: "Failed to purchase number" },
      { status: 500 }
    );
  }
}
