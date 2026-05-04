import { telnyx, TELNYX_MESSAGING_PROFILE_ID } from "./client";
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
      console.warn(`[missed-call] No active phone number for business: ${businessId}`);
      return;
    }

    await findOrCreateContact(businessId, callerPhone, null, "sms");

    const aiResponse = await processIncomingMessage(
      businessId,
      callerPhone,
      null,
      "A customer just called and no one answered. Generate a friendly SMS as if the business itself is replying — never say assistant or bot. You MUST include the business name in this message so the customer knows who is texting them. Let them know you missed their call and ask how you can help. End the message with: Reply STOP to opt out. Keep the entire message under 160 characters.",
      "sms"
    );

    const result = await telnyx.messages.send({
      from: twilioNumber.phone_number,
      to: callerPhone,
      text: aiResponse,
      messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
      type: "SMS",
    });

    console.log(
      `[missed-call] SMS sent to ${callerPhone} for business ${businessId} (id: ${result.data?.id})`
    );
  } catch (error) {
    console.error("[missed-call] Error sending missed call SMS:", error);
  }
}
