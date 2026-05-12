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

export async function createVoiceApplication(businessId: string): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select("id, name, legal_business_name, telnyx_voice_application_id")
    .eq("id", businessId)
    .single();

  if (readError || !business) {
    throw new Error(
      `[registration:voiceApplication] Business ${businessId} not found: ${readError?.message}`
    );
  }

  if (business.telnyx_voice_application_id) {
    return;
  }

  const applicationName = `${business.legal_business_name ?? business.name} (${businessId})`;
  const webhookEventUrl = `${appBaseUrl()}/api/messaging/voice`;

  try {
    const response = await telnyx.callControlApplications.create({
      application_name: applicationName,
      webhook_event_url: webhookEventUrl,
      webhook_event_failover_url: webhookEventUrl,
    });

    const applicationId = response.data?.id;
    if (!applicationId) {
      throw new Error(
        `[registration:voiceApplication] Telnyx returned no id for business ${businessId}`
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({ telnyx_voice_application_id: applicationId })
      .eq("id", businessId);

    if (updateError) {
      throw new Error(
        `[registration:voiceApplication] Failed to persist application id ${applicationId} for business ${businessId}: ${updateError.message}`
      );
    }

    await appendRegistrationEvent({
      businessId,
      eventType: "voice_application_created",
      resourceType: "voice_application",
      resourceId: applicationId,
      status: "success",
      rawPayload: response as unknown as Record<string, unknown>,
    });
  } catch (err) {
    await appendRegistrationEvent({
      businessId,
      eventType: "voice_application_created",
      resourceType: "voice_application",
      status: "error",
      rawPayload: serializeError(err),
    });
    throw err;
  }
}
