import { twilioClient } from "./client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateContact } from "@/lib/ai/contacts";
import { processIncomingMessage } from "@/lib/ai/engine";

export async function sendMissedCallSMS(
  callerPhone: string,
  businessId: string
): Promise<void> {
  try {
    const { data: business } = await supabaseAdmin
      .from("businesses")
      .select("*")
      .eq("id", businessId)
      .single();

    if (!business) {
      console.warn(`[missed-call] Business not found: ${businessId}`);
      return;
    }

    const { data: twilioNumber } = await supabaseAdmin
      .from("twilio_numbers")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .single();

    if (!twilioNumber) {
      console.warn(`[missed-call] No active Twilio number for business: ${businessId}`);
      return;
    }

    await findOrCreateContact(businessId, callerPhone, null, "sms");

    const aiResponse = await processIncomingMessage(
      businessId,
      callerPhone,
      null,
      "A customer just called and no one answered. Generate a friendly SMS as if the business itself is replying — never say assistant or bot. Let them know you missed their call and ask how you can help. End the message with: Reply STOP to opt out. Keep the entire message under 160 characters.",
      "sms"
    );

    await twilioClient.messages.create({
      from: twilioNumber.phone_number,
      to: callerPhone,
      body: aiResponse,
    });

    console.log(`[missed-call] SMS sent to ${callerPhone} for business ${businessId}`);
  } catch (error) {
    console.error("[missed-call] Error sending missed call SMS:", error);
  }
}
