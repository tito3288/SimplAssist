import { telnyx } from "./client";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string;
}

export async function searchAvailableNumbers(
  areaCode: string
): Promise<AvailableNumber[]> {
  const result = await telnyx.availablePhoneNumbers.list({
    filter: {
      country_code: "US",
      national_destination_code: areaCode,
      features: ["sms", "voice"],
      limit: 10,
    },
  });

  return (
    result.data
      ?.filter((n): n is { phone_number: string; vanity_format?: string } =>
        typeof n.phone_number === "string"
      )
      .map((n) => ({
        phoneNumber: n.phone_number,
        friendlyName: n.vanity_format ?? n.phone_number,
      })) ?? []
  );
}

export interface PurchasedNumber {
  phoneNumber: string;
  // Telnyx phone_number_id (UUID). Stored in phone_numbers.telnyx_phone_number_id.
  phoneNumberId: string;
  status: "pending" | "success" | "failure" | undefined;
}

export async function purchaseNumber(
  phoneNumber: string,
  businessId: string
): Promise<PurchasedNumber> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select("telnyx_messaging_profile_id, telnyx_voice_application_id")
    .eq("id", businessId)
    .single();

  if (readError || !business) {
    throw new Error(
      `[messaging:numbers] Business ${businessId} not found: ${readError?.message ?? "not found"}`
    );
  }

  if (!business.telnyx_messaging_profile_id) {
    throw new Error(
      `[messaging:numbers] Business ${businessId} has no telnyx_messaging_profile_id — complete brand verification before purchasing a number`
    );
  }

  if (!business.telnyx_voice_application_id) {
    throw new Error(
      `[messaging:numbers] Business ${businessId} has no telnyx_voice_application_id — complete brand verification before purchasing a number`
    );
  }

  const order = await telnyx.numberOrders.create({
    phone_numbers: [{ phone_number: phoneNumber }],
    connection_id: business.telnyx_voice_application_id,
    messaging_profile_id: business.telnyx_messaging_profile_id,
    customer_reference: businessId,
  });

  if (order.data?.status === "failure") {
    throw new Error(
      `Telnyx number order failed for ${phoneNumber}: ${JSON.stringify(order.data)}`
    );
  }

  const purchased = order.data?.phone_numbers?.[0];
  if (!purchased?.id || !purchased?.phone_number) {
    throw new Error(
      `Telnyx number order returned no phone_numbers entry for ${phoneNumber}`
    );
  }

  return {
    phoneNumber: purchased.phone_number,
    phoneNumberId: purchased.id,
    status: order.data?.status,
  };
}

export async function releaseNumber(phoneNumberId: string): Promise<void> {
  await telnyx.phoneNumbers.delete(phoneNumberId);
}
