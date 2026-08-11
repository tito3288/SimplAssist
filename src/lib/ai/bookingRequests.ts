import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const BOOKING_REQUEST_IDEMPOTENCY_NAMESPACE = "booking-request:v1";

const IMMUTABLE_BOOKING_REQUEST_COLUMNS =
  "business_id, contact_id, conversation_id, source_message_id, requested_service, requested_time_text, customer_name, customer_phone, customer_email, idempotency_key";

interface BookingRequestImmutableRow {
  business_id: string;
  contact_id: string;
  conversation_id: string;
  source_message_id: string;
  requested_service: string;
  requested_time_text: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  idempotency_key: string;
}

interface BookingRequestInsertRow extends BookingRequestImmutableRow {
  status: "new";
}

export interface RecordBookingRequestInput {
  businessId: string;
  contactId: string;
  conversationId: string;
  sourceMessageId: string;
  requestedService: string;
  requestedTimeText: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}

export type RecordBookingRequestResult = "inserted" | "duplicate";

export class BookingRequestInvariantCollisionError extends Error {
  constructor(
    readonly businessId: string,
    readonly idempotencyKey: string,
    options: { cause?: unknown } = {}
  ) {
    super(
      `Booking request unique collision did not match the captured request for business ${businessId}.`,
      options
    );
    this.name = "BookingRequestInvariantCollisionError";
  }
}

export function buildBookingRequestIdempotencyKey(
  businessId: string,
  sourceMessageId: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        BOOKING_REQUEST_IDEMPOTENCY_NAMESPACE,
        businessId,
        sourceMessageId,
      ]),
      "utf8"
    )
    .digest("base64url");
}

export async function recordBookingRequest({
  businessId,
  contactId,
  conversationId,
  sourceMessageId,
  requestedService,
  requestedTimeText,
  customerName,
  customerPhone,
  customerEmail,
}: RecordBookingRequestInput): Promise<RecordBookingRequestResult> {
  const row: BookingRequestInsertRow = {
    business_id: businessId,
    contact_id: contactId,
    conversation_id: conversationId,
    source_message_id: sourceMessageId,
    requested_service: requestedService,
    requested_time_text: requestedTimeText,
    customer_name: optionalSnapshot(customerName),
    customer_phone: optionalSnapshot(customerPhone),
    customer_email: optionalSnapshot(customerEmail),
    idempotency_key: buildBookingRequestIdempotencyKey(
      businessId,
      sourceMessageId
    ),
    status: "new",
  };

  const { error: insertError } = await supabaseAdmin
    .from("booking_requests")
    .insert(row);

  if (!insertError) return "inserted";
  if (insertError.code !== "23505") throw insertError;

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("booking_requests")
    .select(IMMUTABLE_BOOKING_REQUEST_COLUMNS)
    .eq("business_id", businessId)
    .eq("idempotency_key", row.idempotency_key)
    .maybeSingle<BookingRequestImmutableRow>();

  if (lookupError) throw lookupError;
  if (existing && immutableFieldsMatch(existing, row)) return "duplicate";

  throw new BookingRequestInvariantCollisionError(
    businessId,
    row.idempotency_key,
    { cause: insertError }
  );
}

function optionalSnapshot(value: string | null | undefined): string | null {
  return value && /\S/.test(value) ? value : null;
}

function immutableFieldsMatch(
  existing: BookingRequestImmutableRow,
  expected: BookingRequestImmutableRow
): boolean {
  return (
    existing.business_id === expected.business_id &&
    existing.contact_id === expected.contact_id &&
    existing.conversation_id === expected.conversation_id &&
    existing.source_message_id === expected.source_message_id &&
    existing.requested_service === expected.requested_service &&
    existing.requested_time_text === expected.requested_time_text &&
    existing.customer_name === expected.customer_name &&
    existing.customer_phone === expected.customer_phone &&
    existing.customer_email === expected.customer_email &&
    existing.idempotency_key === expected.idempotency_key
  );
}
