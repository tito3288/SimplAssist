import { telnyx } from "./client";
import { supabaseAdmin } from "@/lib/supabase/admin";

const TELNYX_PHONE_NUMBER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTelnyxPhoneNumberId(value: unknown, context: string): string {
  if (
    typeof value !== "string" ||
    !TELNYX_PHONE_NUMBER_ID_PATTERN.test(value.trim())
  ) {
    throw new Error(`[messaging:numbers] Invalid Telnyx phone number id ${context}`);
  }
  return value.trim().toLowerCase();
}

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

// Thrown when a number was PURCHASED at Telnyx but the local phone_numbers
// insert failed — the purchase-save two-phase-commit gap. Typed so callers
// classify by construction instead of message-sniffing: this is NOT
// "number unavailable" (the customer was charged; a retry must recover the
// owned number, never re-purchase or re-pick).
export class PurchasedNumberSaveError extends Error {
  readonly phoneNumber: string;
  readonly telnyxPhoneNumberId: string;

  constructor(args: {
    phoneNumber: string;
    telnyxPhoneNumberId: string;
    cause: unknown;
  }) {
    super(
      `[messaging:numbers] Number ${args.phoneNumber} purchased at Telnyx (id=${args.telnyxPhoneNumberId}) but the local save failed`,
      { cause: args.cause }
    );
    this.name = "PurchasedNumberSaveError";
    this.phoneNumber = args.phoneNumber;
    this.telnyxPhoneNumberId = args.telnyxPhoneNumberId;
  }
}

// Thrown when the pending number is actively held by ANOTHER business —
// typed so classification is by construction (the collision genuinely is
// "unavailable", but message-sniffing for it would recreate the coupling
// the save-error type exists to remove).
export class NumberTakenError extends Error {
  constructor(phoneNumber: string) {
    super(
      `[messaging:numbers] Number ${phoneNumber} is already held by another business`
    );
    this.name = "NumberTakenError";
  }
}

// Recovery lookup for the purchase-save gap: did THIS BUSINESS already
// purchase this exact number? Scoped by customer_reference (stamped on
// every order) — on a single Telnyx account, matching by phone number
// alone would let business B "recover" a number business A just paid for.
// Used BEFORE purchasing so a retry after a failed save completes setup
// without charging again. Throws on lookup failure; NOTE the honest limit:
// a successful-but-stale list (Telnyx read-after-write lag) returns null
// and the caller re-purchases — backstopped by Telnyx rejecting orders for
// already-owned numbers (routing to re-pick, never a double charge) and by
// retries here being human-speed (launch failures are not webhook-looped).
export async function findOwnedNumberId(
  phoneNumber: string,
  businessId: string
): Promise<string | null> {
  // Digits-only for the filter: the SDK documents "non-numerical characters
  // will result in no values being returned" for filter[phone_number].
  // (Empirically a URL-encoded '+' also matches, verified against prod
  // 2026-07-15 — digits-only satisfies both the documented contract and
  // observed behavior.) The response itself is +E.164, so the equality
  // check below keeps the full-format match.
  const digitsOnly = phoneNumber.replace(/\D/g, "");
  const result = await telnyx.phoneNumbers.list({
    filter: { phone_number: digitsOnly, customer_reference: businessId },
  });

  const owned = result.data?.find((n) => n.phone_number === phoneNumber);
  return owned
    ? normalizeTelnyxPhoneNumberId(
        owned.id,
        `returned while recovering ${phoneNumber} for business ${businessId}`
      )
    : null;
}

export async function getActivePhoneNumberForBusiness(
  businessId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("phone_number")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[messaging:numbers] Failed to read active phone number for ${businessId}: ${error.message}`
    );
  }

  return data?.phone_number ?? null;
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

  const order = await telnyx.numberOrders.create(
    {
      phone_numbers: [{ phone_number: phoneNumber }],
      connection_id: business.telnyx_voice_application_id,
      messaging_profile_id: business.telnyx_messaging_profile_id,
      customer_reference: businessId,
    },
    // Avoid an unkeyed automatic second order after an ambiguous transport
    // failure. Retry recovers this exact business-scoped owned number before
    // it can place another order.
    { maxRetries: 0 }
  );

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
  const phoneNumberId = normalizeTelnyxPhoneNumberId(
    purchased.id,
    `returned by the number order for business ${businessId}`
  );

  return {
    phoneNumber: purchased.phone_number,
    phoneNumberId,
    status: order.data?.status,
  };
}

export async function attachOwnedNumberToCustomerProfile(
  businessId: string,
  phoneNumberId: string
): Promise<void> {
  // Migration 034 deliberately preserves one protected legacy non-UUID row
  // for manual cleanup, but that stale value must never be trusted or sent to
  // Telnyx. Validate before any provider-facing routing update.
  const normalizedPhoneNumberId = normalizeTelnyxPhoneNumberId(
    phoneNumberId,
    `stored for business ${businessId}`
  );

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
      `[messaging:numbers] Business ${businessId} has no telnyx_messaging_profile_id — cannot attach owned number`
    );
  }

  if (!business.telnyx_voice_application_id) {
    throw new Error(
      `[messaging:numbers] Business ${businessId} has no telnyx_voice_application_id — cannot attach owned number`
    );
  }

  await telnyx.phoneNumbers.update(normalizedPhoneNumberId, {
    connection_id: business.telnyx_voice_application_id,
    customer_reference: businessId,
  });
  await telnyx.phoneNumbers.messaging.update(normalizedPhoneNumberId, {
    messaging_profile_id: business.telnyx_messaging_profile_id,
  });
}
