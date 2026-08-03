import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
export {
  EXTERNAL_BILLING_MESSAGE,
  partnerManagedBillingMessage,
} from "@/lib/billing/partnerManagedBilling";

type PartnerNameRow = {
  name: unknown;
};

/**
 * Resolves the assigned partner's display name through the service-role client.
 * Billing ownership follows the assignment itself, independently of whether the
 * partner is active or has a connected presentation domain.
 */
export async function resolveAssignedPartnerName(
  partnerId: string | null,
): Promise<string | null> {
  if (!partnerId) return null;

  const { data, error } = await supabaseAdmin
    .from("partners")
    .select("name")
    .eq("id", partnerId)
    .maybeSingle<PartnerNameRow>();

  if (error) {
    throw new Error(
      `Failed to resolve assigned billing partner: ${error.message}`,
    );
  }

  if (!data || typeof data.name !== "string") return null;

  const name = data.name.trim();
  return name || null;
}
