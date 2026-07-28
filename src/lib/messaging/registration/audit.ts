import { supabaseAdmin } from "@/lib/supabase/admin";
import type { TelnyxEventType, TelnyxResourceType } from "@/types/database";

export interface AppendRegistrationEventInput {
  businessId: string;
  eventType: TelnyxEventType;
  resourceType: TelnyxResourceType;
  resourceId?: string | null;
  status?: string | null;
  rejectionReason?: string | null;
  rawPayload?: unknown;
}

export async function appendRegistrationEvent(
  input: AppendRegistrationEventInput
): Promise<void> {
  const error = await insertRegistrationEvent(input);

  if (error) {
    console.error(
      `[registration:audit] Failed to log ${input.eventType} for business ${input.businessId}:`,
      error
    );
  }
}

export async function appendRegistrationEventOrThrow(
  input: AppendRegistrationEventInput
): Promise<void> {
  const error = await insertRegistrationEvent(input);
  if (error) {
    throw new Error(
      `[registration:audit] Failed to log ${input.eventType} for business ${input.businessId}: ${error.message}`
    );
  }
}

async function insertRegistrationEvent(
  input: AppendRegistrationEventInput
) {
  const { error } = await supabaseAdmin
    .from("telnyx_registration_events")
    .insert({
      business_id: input.businessId,
      event_type: input.eventType,
      telnyx_resource_type: input.resourceType,
      telnyx_resource_id: input.resourceId ?? null,
      status: input.status ?? null,
      rejection_reason: input.rejectionReason ?? null,
      raw_payload: input.rawPayload ?? null,
    });

  return error;
}

export function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.parse(JSON.stringify(err));
    } catch {
      return { value: String(err) };
    }
  }
  return { value: String(err) };
}
