import { supabaseAdmin } from "@/lib/supabase/admin";

// Resolves the per-customer Telnyx messaging profile ID for outbound SMS sent
// FROM a customer's business phone number. Every customer-to-end-consumer send
// must route through the business's own messaging profile (set during Phase 3
// onboarding registration) so the brand on the carriers' side matches the
// sender — TCR rejects shared-campaign approaches at scale.
//
// Throws if the phone number isn't registered to an active business, or if the
// business has no per-customer messaging profile yet. Both are hard errors:
// outbound SMS without a per-customer profile would defeat the per-customer
// brand on the carriers' side.
export async function getMessagingProfileForOutbound(
  fromPhoneNumber: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("phone_numbers")
    .select("business_id, businesses!inner(telnyx_messaging_profile_id)")
    .eq("phone_number", fromPhoneNumber)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(
      `[messaging:lookup] No active phone_numbers row for ${fromPhoneNumber}: ${error?.message ?? "not found"}`
    );
  }

  const businesses = data.businesses as
    | { telnyx_messaging_profile_id: string | null }
    | { telnyx_messaging_profile_id: string | null }[]
    | null;
  const profileId = Array.isArray(businesses)
    ? businesses[0]?.telnyx_messaging_profile_id
    : businesses?.telnyx_messaging_profile_id;

  if (!profileId) {
    throw new Error(
      `[messaging:lookup] Business for ${fromPhoneNumber} has no telnyx_messaging_profile_id — Phase 3 registration must complete before outbound SMS`
    );
  }

  return profileId;
}
