import { NextRequest, NextResponse } from "next/server";
import { twilio } from "@/lib/twilio/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendMissedCallSMS } from "@/lib/twilio/missed-call";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const from = formData.get("From") as string;
  const to = formData.get("To") as string;
  const callSid = formData.get("CallSid") as string;

  console.log(`[voice] Incoming call: ${from} -> ${to} (CallSid: ${callSid})`);

  const { data: twilioNumber } = await supabaseAdmin
    .from("twilio_numbers")
    .select("*")
    .eq("phone_number", to)
    .eq("is_active", true)
    .single();

  if (!twilioNumber) {
    const response = new twilio.twiml.VoiceResponse();
    response.say("Sorry, this number is not currently configured. Goodbye.");
    response.hangup();

    return new NextResponse(response.toString(), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  const businessId = twilioNumber.business_id;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;

  const response = new twilio.twiml.VoiceResponse();
  response.say(
    "Thanks for calling. We're unavailable right now but we'll text you right back with assistance. You can also leave a brief message after the tone."
  );
  response.record({
    action: `${appUrl}/api/twilio/voice/recording`,
    maxLength: 60,
    timeout: 5,
    transcribe: false,
  });
  response.say(
    "Thank you. We'll be in touch soon via text message. Goodbye."
  );
  response.hangup();

  setTimeout(() => {
    sendMissedCallSMS(from, businessId);
  }, 0);

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
