import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ProviderCreateIntentSpec =
  | {
      eventType: "messaging_profile_create_intent";
      resourceType: "messaging_profile";
    }
  | {
      eventType: "voice_application_create_intent";
      resourceType: "voice_application";
    }
  | {
      eventType: "phone_number_order_create_intent";
      resourceType: "phone_number";
    };

interface ProviderCreateIntentRow {
  id: string;
  raw_payload?: unknown;
  status?: string;
}

/**
 * An unresolved intent means a prior POST may have reached Telnyx. Retrying a
 * create while the provider list is stale would risk a duplicate, so this is
 * deliberately a fail-closed support/reconciliation outcome.
 */
export class ProviderCreateReconciliationRequiredError extends Error {
  readonly code = "provider_create_reconciliation_required" as const;

  constructor(businessId: string, resourceType: string) {
    super(
      `[registration:providerCreateIntent] ${resourceType} creation for business ${businessId} has an unresolved provider attempt; reconcile it before another create`
    );
    this.name = "ProviderCreateReconciliationRequiredError";
  }
}

export async function beginProviderCreateIntent({
  businessId,
  spec,
  rawPayload,
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
  rawPayload?: Record<string, unknown>;
}): Promise<string> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("telnyx_registration_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("status", "started")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<ProviderCreateIntentRow>();

  if (existingError) {
    throw new Error(
      `[registration:providerCreateIntent] Could not read ${spec.resourceType} create intent for business ${businessId}: ${existingError.message}`
    );
  }
  if (existing) {
    throw new ProviderCreateReconciliationRequiredError(
      businessId,
      spec.resourceType
    );
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("telnyx_registration_events")
    .insert({
      business_id: businessId,
      event_type: spec.eventType,
      telnyx_resource_type: spec.resourceType,
      status: "started",
      raw_payload: { ...rawPayload, version: 1 },
    })
    .select("id")
    .single<ProviderCreateIntentRow>();

  if (insertError || !inserted) {
    throw new Error(
      `[registration:providerCreateIntent] Could not persist ${spec.resourceType} create intent for business ${businessId}: ${insertError?.message ?? "no row returned"}`
    );
  }

  // Registration claims serialize normal launches. This deterministic
  // oldest-intent check is additional defense for an overlapping stale-claim
  // takeover: only one contender is allowed to reach the provider POST.
  const { data: owner, error: ownerError } = await supabaseAdmin
    .from("telnyx_registration_events")
    .select("id")
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("status", "started")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle<ProviderCreateIntentRow>();

  if (ownerError || !owner) {
    throw new Error(
      `[registration:providerCreateIntent] Could not verify ${spec.resourceType} create-intent ownership for business ${businessId}: ${ownerError?.message ?? "no row returned"}`
    );
  }
  if (owner.id !== inserted.id) {
    throw new ProviderCreateReconciliationRequiredError(
      businessId,
      spec.resourceType
    );
  }

  return inserted.id;
}

export async function resolveProviderCreateIntents({
  businessId,
  spec,
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("telnyx_registration_events")
    .update({ status: "resolved" })
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("status", "started");

  if (error) {
    throw new Error(
      `[registration:providerCreateIntent] Could not resolve ${spec.resourceType} create intent for business ${businessId}: ${error.message}`
    );
  }
}

export async function resolveProviderCreateIntent({
  businessId,
  spec,
  intentId,
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
  intentId: string;
}): Promise<void> {
  const { data: resolved, error } = await supabaseAdmin
    .from("telnyx_registration_events")
    .update({ status: "resolved" })
    .eq("id", intentId)
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("telnyx_resource_type", spec.resourceType)
    .eq("status", "started")
    .select("id")
    .maybeSingle<ProviderCreateIntentRow>();

  if (error) {
    throw new Error(
      `[registration:providerCreateIntent] Could not resolve exact ${spec.resourceType} create intent ${intentId} for business ${businessId}: ${error.message}`
    );
  }
  if (resolved) return;

  // A concurrent recovery may have resolved the same exact intent after our
  // read. Proceed only when a fresh read proves that id is already resolved;
  // a silent zero-row update must never let launch continue with an active or
  // missing ambiguity fence.
  const { data: existing, error: verifyError } = await supabaseAdmin
    .from("telnyx_registration_events")
    .select("id, status")
    .eq("id", intentId)
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("telnyx_resource_type", spec.resourceType)
    .maybeSingle<ProviderCreateIntentRow>();

  if (verifyError || existing?.status !== "resolved") {
    throw new Error(
      `[registration:providerCreateIntent] Could not verify exact ${spec.resourceType} create intent ${intentId} as resolved for business ${businessId}: ${verifyError?.message ?? "intent was not resolved"}`
    );
  }
}

/**
 * Resolve a recovered create only when the one active intent carries the
 * exact durable payload that was just proven provider-side. A phone-number
 * lookup for selection B must never clear an ambiguous order for selection A.
 */
export async function resolveProviderCreateIntentForPayload({
  businessId,
  spec,
  expectedPayload,
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
  expectedPayload: Record<string, unknown>;
}): Promise<void> {
  const intentId = await readProviderCreateIntentForPayload({
    businessId,
    spec,
    expectedPayload,
  });
  if (!intentId) return;

  await resolveProviderCreateIntent({ businessId, spec, intentId });
}

/**
 * Validate and capture the one active intent before any recovered-resource
 * mutation. The caller resolves this exact id only after its local/provider
 * recovery work succeeds.
 */
export async function readProviderCreateIntentForPayload({
  businessId,
  spec,
  expectedPayload,
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
  expectedPayload: Record<string, unknown>;
}): Promise<string | null> {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("telnyx_registration_events")
    .select("id, raw_payload")
    .eq("business_id", businessId)
    .eq("event_type", spec.eventType)
    .eq("telnyx_resource_type", spec.resourceType)
    .eq("status", "started")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<ProviderCreateIntentRow>();

  if (existingError) {
    throw new Error(
      `[registration:providerCreateIntent] Could not read recoverable ${spec.resourceType} create intent for business ${businessId}: ${existingError.message}`
    );
  }
  if (!existing) return null;

  if (!payloadContains(existing.raw_payload, expectedPayload)) {
    throw new ProviderCreateReconciliationRequiredError(
      businessId,
      spec.resourceType
    );
  }

  return existing.id;
}

function payloadContains(
  rawPayload: unknown,
  expectedPayload: Record<string, unknown>
): boolean {
  if (
    !rawPayload ||
    typeof rawPayload !== "object" ||
    Array.isArray(rawPayload)
  ) {
    return false;
  }
  const payload = rawPayload as Record<string, unknown>;
  return Object.entries(expectedPayload).every(
    ([key, value]) => payload[key] === value
  );
}
