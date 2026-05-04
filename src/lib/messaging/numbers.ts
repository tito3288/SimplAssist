import {
  telnyx,
  TELNYX_CONNECTION_ID,
  TELNYX_MESSAGING_PROFILE_ID,
} from "./client";

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
  // Telnyx phone_number_id (UUID). Stored in twilio_numbers.twilio_sid for now;
  // the column gets renamed to telnyx_phone_number_id in Phase E.
  phoneNumberId: string;
  status: "pending" | "success" | "failure" | undefined;
}

export async function purchaseNumber(
  phoneNumber: string,
  businessId: string
): Promise<PurchasedNumber> {
  const order = await telnyx.numberOrders.create({
    phone_numbers: [{ phone_number: phoneNumber }],
    connection_id: TELNYX_CONNECTION_ID,
    messaging_profile_id: TELNYX_MESSAGING_PROFILE_ID,
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
