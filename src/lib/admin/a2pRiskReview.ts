import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  appendRiskEvent,
  buildA2pRiskInputForBusiness,
  hashA2pRiskInput,
} from "@/lib/messaging/registration/riskScreening";
import { A2P_RISK_PASSED_MESSAGE } from "@/lib/messaging/registration/riskCategories";

export async function approveA2pRiskReview(args: {
  businessId: string;
  note: string;
  reviewedBy: string;
  acknowledgeFeeRisk: true;
}): Promise<{ status: "admin_approved"; inputHash: string }> {
  const { businessId, note, reviewedBy } = args;
  const { input } = await buildA2pRiskInputForBusiness(businessId);
  const inputHash = hashA2pRiskInput(input);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("businesses")
    .update({
      a2p_risk_review_status: "admin_approved",
      a2p_risk_review_input_hash: inputHash,
      a2p_risk_review_message: A2P_RISK_PASSED_MESSAGE,
      a2p_risk_review_reason: "Admin approved after manual review",
      a2p_risk_review_reviewed_at: now,
      a2p_risk_review_reviewed_by: reviewedBy,
      a2p_risk_review_override_note: note,
      a2p_risk_review_updated_at: now,
    })
    .eq("id", businessId)
    .or(
      [
        "a2p_risk_review_status.is.null",
        "a2p_risk_review_status.neq.admin_approved",
        "a2p_risk_review_input_hash.is.null",
        `a2p_risk_review_input_hash.neq.${inputHash}`,
      ].join(",")
    );

  if (error) {
    throw new Error(
      `[a2p-risk:admin] Failed to approve ${businessId}: ${error.message}`
    );
  }

  await appendRiskEvent({
    businessId,
    eventType: "admin_approved",
    status: "admin_approved",
    inputHash,
    message: A2P_RISK_PASSED_MESSAGE,
    rawPayload: {
      reviewedBy,
      note,
      acknowledgeFeeRisk: true,
    },
  });

  return { status: "admin_approved", inputHash };
}
