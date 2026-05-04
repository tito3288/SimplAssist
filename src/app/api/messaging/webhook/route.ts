import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { twilio } from "@/lib/twilio/client";
import { processIncomingMessage } from "@/lib/ai/engine";

function twimlResponse(message: string) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Message>${message}</Message></Response>`;
  return new NextResponse(xml, {
    headers: { "Content-Type": "text/xml" },
  });
}

function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {},
      },
    }
  );
}

export async function POST(request: NextRequest) {
  const twilioSignature = request.headers.get("x-twilio-signature");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const webhookUrl = `${appUrl}/api/twilio/webhook`;

  const body = await request.text();
  const params = Object.fromEntries(new URLSearchParams(body));

  if (
    !twilioSignature ||
    !twilio.validateRequest(authToken, twilioSignature, webhookUrl, params)
  ) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const from = params.From;
  const to = params.To;
  const messageBody = params.Body;

  const supabase = createServiceClient();

  const { data: twilioNumber } = await supabase
    .from("twilio_numbers")
    .select("business_id")
    .eq("phone_number", to)
    .eq("is_active", true)
    .single();

  if (!twilioNumber) {
    return twimlResponse("This number is not configured");
  }

  const businessId = twilioNumber.business_id;

  try {
    const { data: existingContact } = await supabase
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("phone_number", from)
      .maybeSingle();

    const isFirstContact = !existingContact;

    const aiResponse = await processIncomingMessage(
      businessId,
      from,
      null,
      messageBody,
      "sms"
    );

    const { data: aiSettings } = await supabase
      .from("ai_settings")
      .select("sms_response_delay_seconds")
      .eq("business_id", businessId)
      .single();

    if (aiSettings && aiSettings.sms_response_delay_seconds > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, aiSettings.sms_response_delay_seconds * 1000)
      );
    }

    const finalResponse = isFirstContact
      ? `${aiResponse}\n\nReply STOP to opt out.`
      : aiResponse;

    return twimlResponse(finalResponse);
  } catch (error) {
    console.error("Error processing incoming SMS:", error);
    return twimlResponse(
      "Sorry, we are unable to process your message right now."
    );
  }
}
