import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RegistrationStatus } from "@/types/database";

export interface OutboundSendContext {
  businessId: string;
  messagingProfileId: string;
  campaignStatus: RegistrationStatus | null;
}

// Resolves everything an automated send path needs in one DB round-trip:
// - businessId: for inserting paused system messages / audit lookups
// - messagingProfileId: per-customer Telnyx messaging profile (Phase 3)
// - campaignStatus: gates the send (Phase 5 — block when != 'approved')
//
// Single phone_numbers JOIN businesses query. Replaces the previous
// getMessagingProfileForOutbound which queried the same join just for the
// profile id — adding a separate campaign_status helper would have doubled
// round-trips on the hottest send path (every inbound SMS).
//
// Throws if the phone number isn't registered to an active business, or if
// the business has no per-customer messaging profile yet. Both are hard
// errors: outbound SMS without a per-customer profile defeats the
// per-customer brand on the carriers' side.
//
// Callers are responsible for the campaignStatus gate: if it's not
// 'approved', they should skip the send and (typically) insert a paused
// system message via insertPausedSystemMessageIfNeeded().
export async function getOutboundSendContext(
  fromPhoneNumber: string
): Promise<OutboundSendContext> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select(
      "business_id, businesses!inner(id, telnyx_messaging_profile_id, campaign_status)"
    )
    .eq("phone_number", fromPhoneNumber)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(
      `[messaging:lookup] No active phone_numbers row for ${fromPhoneNumber}: ${error?.message ?? "not found"}`
    );
  }

  const businessesRow = data.businesses as
    | {
        id: string;
        telnyx_messaging_profile_id: string | null;
        campaign_status: RegistrationStatus | null;
      }
    | {
        id: string;
        telnyx_messaging_profile_id: string | null;
        campaign_status: RegistrationStatus | null;
      }[]
    | null;
  const business = Array.isArray(businessesRow) ? businessesRow[0] : businessesRow;

  if (!business?.telnyx_messaging_profile_id) {
    throw new Error(
      `[messaging:lookup] Business for ${fromPhoneNumber} has no telnyx_messaging_profile_id — Phase 3 registration must complete before outbound SMS`
    );
  }

  return {
    businessId: business.id,
    messagingProfileId: business.telnyx_messaging_profile_id,
    campaignStatus: business.campaign_status,
  };
}
