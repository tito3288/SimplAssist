import { NextRequest, NextResponse } from "next/server";
import { twilio } from "@/lib/twilio/client";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const from = formData.get("From") as string;
  const recordingUrl = formData.get("RecordingUrl") as string;
  const recordingSid = formData.get("RecordingSid") as string;
  const callSid = formData.get("CallSid") as string;

  console.log(
    `[recording] Voicemail from ${from} (CallSid: ${callSid}, RecordingSid: ${recordingSid}): ${recordingUrl}`
  );

  const response = new twilio.twiml.VoiceResponse();
  response.say("Your message has been received. We'll text you shortly.");
  response.hangup();

  return new NextResponse(response.toString(), {
    headers: { "Content-Type": "text/xml" },
  });
}
