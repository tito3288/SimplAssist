import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  throwIfCarrierRejected,
  type CarrierRejectionSnapshot,
} from "@/lib/onboarding/rejectionGuidance";

type CarrierRejectionRow = {
  brand_status: string | null;
  campaign_status: string | null;
  brand_rejection_reason: string | null;
  campaign_rejection_reason: string | null;
};

/**
 * Fresh server-side carrier-status boundary for multi-step launch work.
 * Callers use this after claiming and immediately before provider mutations;
 * a read failure is fatal because provisioning from unknown state is unsafe.
 */
export async function assertNoCarrierRejectionForBusiness(
  businessId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select(
      "brand_status, campaign_status, brand_rejection_reason, campaign_rejection_reason",
    )
    .eq("id", businessId)
    .single<CarrierRejectionRow>();

  if (error || !data) {
    throw new Error(
      `[onboarding:rejectionGuard] Failed to refresh carrier status for ${businessId}: ${error?.message ?? "business not found"}`,
    );
  }

  const snapshot: CarrierRejectionSnapshot = {
    brandStatus: data.brand_status,
    campaignStatus: data.campaign_status,
    brandReason: data.brand_rejection_reason,
    campaignReason: data.campaign_rejection_reason,
  };
  throwIfCarrierRejected(snapshot);
}
