import "server-only";

import { isE164PhoneNumber, normalizeE164Input } from "@/lib/phone/e164";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type ActiveSmsNumberLookupErrorCode =
  | "lookup_failed"
  | "multiple_active_numbers"
  | "invalid_e164";

export class ActiveSmsNumberLookupError extends Error {
  readonly code: ActiveSmsNumberLookupErrorCode;

  constructor(
    code: ActiveSmsNumberLookupErrorCode,
    businessId: string,
    detail: string
  ) {
    super(
      `[messaging:phone-number-lookup] ${detail} for business ${businessId}`
    );
    this.name = "ActiveSmsNumberLookupError";
    this.code = code;
  }
}

interface ActivePhoneNumberRow {
  phone_number: string;
}

/**
 * Returns the one active, publishable SMS number for a business.
 *
 * Missing is the only non-error null case. Database failures, ambiguous
 * active rows, and malformed values fail closed so public compliance pages
 * never publish a guessed or stale number. In particular, this helper never
 * reads pending_phone_number, businesses.phone_number, or the provider API.
 */
export async function getActiveSmsNumberForBusiness(
  businessId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("phone_number")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(2);

  if (error) {
    throw new ActiveSmsNumberLookupError(
      "lookup_failed",
      businessId,
      `Failed to read active phone number: ${error.message}`
    );
  }

  const rows = (data ?? []) as ActivePhoneNumberRow[];
  if (rows.length === 0) return null;

  if (rows.length > 1) {
    throw new ActiveSmsNumberLookupError(
      "multiple_active_numbers",
      businessId,
      "Found multiple active phone numbers"
    );
  }

  const phoneNumber = normalizeE164Input(rows[0]?.phone_number);
  if (!isE164PhoneNumber(phoneNumber)) {
    throw new ActiveSmsNumberLookupError(
      "invalid_e164",
      businessId,
      "Active phone number is not valid E.164"
    );
  }

  return phoneNumber;
}
