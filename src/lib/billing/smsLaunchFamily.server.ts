import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Atomically establish or re-verify the SMS family immediately before paid
 * launch can enter risk, registration, or Telnyx work. A known opposing or
 * internally contradictory family is a clean authorization denial; unknown
 * database failures stay retryable by throwing.
 */
export async function claimSmsLaunchPlanFamily(
  businessId: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc(
    "claim_business_plan_family",
    {
      p_business_id: businessId,
      p_family: "sms",
      p_claimed_by: "sms_launch",
    },
  );

  if (error) {
    const text = [error.message, error.details, error.hint]
      .filter((value): value is string => typeof value === "string")
      .join(" ");
    if (
      /\b(?:plan_family_transition_not_supported|business_plan_family_evidence_conflict)\b/.test(
        text,
      )
    ) {
      return false;
    }
    throw new Error(
      `[billing:sms-launch-family] Failed to claim SMS family for ${businessId}: ${error.message}`,
    );
  }

  if (data === true || data === false) return data;
  throw new Error(
    `[billing:sms-launch-family] Claim returned an invalid response for ${businessId}`,
  );
}
