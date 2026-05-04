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

  const { data: business } = await supabaseAdmin
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .single();

  const businessName = business?.name ?? "us";

  const response = new twilio.twiml.VoiceResponse();
  response.say(
    `Thanks for calling ${businessName}. We're unavailable right now but we'll text you right back with assistance. If you prefer not to receive messages, reply STOP to opt out. Please leave a message after the beep.`
  );
  response.record({
    action: `${appUrl}/api/twilio/voice/recording`,
    maxLength: 60,
    timeout: 5,
    transcribe: false,
  });
  response.say(
    `Thank you for your message. ${businessName} will be in touch soon. Goodbye.`
  );
  response.hangup();

  setTimeout(() => {
    sendMissedCallSMS(from, businessId);
  }, 0);

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
