import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { OnboardingRegistrationStatus } from "@/types/database";

const STALE_SUBMITTING_AFTER_MS = 15 * 60 * 1000;

interface AttemptRow {
  id: string;
  onboarding_registration_status: OnboardingRegistrationStatus;
  onboarding_registration_started_at: string | null;
  onboarding_registration_submitted_at: string | null;
}

export type RegistrationAttemptClaim =
  | { claimed: true; startedAt: string }
  | {
      claimed: false;
      reason: "already_submitted" | "already_submitting" | "not_claimable";
      current: AttemptRow | null;
    };

export async function claimRegistrationAttempt(
  businessId: string
): Promise<RegistrationAttemptClaim> {
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - STALE_SUBMITTING_AFTER_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("businesses")
    .update({
      onboarding_registration_status: "submitting",
      onboarding_registration_started_at: now,
      onboarding_registration_error: null,
    })
    .eq("id", businessId)
    .or(
      [
        "onboarding_registration_status.in.(not_started,failed)",
        `and(onboarding_registration_status.eq.submitting,onboarding_registration_started_at.lt.${staleBefore})`,
        "and(onboarding_registration_status.eq.submitting,onboarding_registration_started_at.is.null)",
      ].join(",")
    )
    .select(
      "id, onboarding_registration_status, onboarding_registration_started_at, onboarding_registration_submitted_at"
    )
    .returns<AttemptRow[]>();

  if (error) {
    throw new Error(
      `[onboarding:registrationAttempt] Failed to claim registration for ${businessId}: ${error.message}`
    );
  }

  if (data && data.length > 0) {
    return { claimed: true, startedAt: now };
  }

  const current = await readRegistrationAttempt(businessId);
  if (current?.onboarding_registration_status === "submitted") {
    return { claimed: false, reason: "already_submitted", current };
  }
  if (current?.onboarding_registration_status === "submitting") {
    return { claimed: false, reason: "already_submitting", current };
  }

  return { claimed: false, reason: "not_claimable", current };
}

export async function markRegistrationSubmitted(
  businessId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      onboarding_registration_status: "submitted",
      onboarding_registration_submitted_at: now,
      onboarding_registration_error: null,
      onboarding_step: "carrier_review",
      onboarding_last_saved_at: now,
    })
    .eq("id", businessId);

  if (error) {
    throw new Error(
      `[onboarding:registrationAttempt] Failed to mark registration submitted for ${businessId}: ${error.message}`
    );
  }
}

export async function markRegistrationFailed(
  businessId: string,
  message: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      onboarding_registration_status: "failed",
      onboarding_registration_error: message,
      onboarding_registration_submitted_at: null,
      onboarding_step: "carrier_review",
      onboarding_last_saved_at: now,
    })
    .eq("id", businessId);

  if (error) {
    throw new Error(
      `[onboarding:registrationAttempt] Failed to mark registration failed for ${businessId}: ${error.message}`
    );
  }
}

async function readRegistrationAttempt(
  businessId: string
): Promise<AttemptRow | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, onboarding_registration_status, onboarding_registration_started_at, onboarding_registration_submitted_at"
    )
    .eq("id", businessId)
    .maybeSingle<AttemptRow>();

  if (error) {
    throw new Error(
      `[onboarding:registrationAttempt] Failed to read registration attempt for ${businessId}: ${error.message}`
    );
  }

  return data ?? null;
}
