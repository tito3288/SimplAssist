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
    };

interface ProviderCreateIntentRow {
  id: string;
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
}: {
  businessId: string;
  spec: ProviderCreateIntentSpec;
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
      raw_payload: { version: 1 },
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
