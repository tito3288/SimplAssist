import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appendRegistrationEvent, serializeError } from "./audit";

function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for Telnyx webhook URLs"
    );
  }
  return url.replace(/\/+$/, "");
}

export async function createMessagingProfile(businessId: string): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select("id, name, legal_business_name, telnyx_messaging_profile_id")
    .eq("id", businessId)
    .single();

  if (readError || !business) {
    throw new Error(
      `[registration:messagingProfile] Business ${businessId} not found: ${readError?.message}`
    );
  }

  if (business.telnyx_messaging_profile_id) {
    return;
  }

  const profileName = `${business.legal_business_name ?? business.name} (${businessId})`;
  const webhookUrl = `${appBaseUrl()}/api/messaging/webhook`;

  try {
    const response = await telnyx.messagingProfiles.create({
      name: profileName,
      whitelisted_destinations: ["US"],
      webhook_url: webhookUrl,
      webhook_failover_url: webhookUrl,
    });

    const profileId = response.data?.id;
    if (!profileId) {
      throw new Error(
        `[registration:messagingProfile] Telnyx returned no id for business ${businessId}`
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({ telnyx_messaging_profile_id: profileId })
      .eq("id", businessId);

    if (updateError) {
      throw new Error(
        `[registration:messagingProfile] Failed to persist profile id ${profileId} for business ${businessId}: ${updateError.message}`
      );
    }

    await appendRegistrationEvent({
      businessId,
      eventType: "messaging_profile_created",
      resourceType: "messaging_profile",
      resourceId: profileId,
      status: "success",
      rawPayload: response as unknown as Record<string, unknown>,
    });
  } catch (err) {
    await appendRegistrationEvent({
      businessId,
      eventType: "messaging_profile_created",
      resourceType: "messaging_profile",
      status: "error",
      rawPayload: serializeError(err),
    });
    throw err;
  }
}
