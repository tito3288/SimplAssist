import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appendRegistrationEvent, serializeError } from "./audit";
import {
  beginProviderCreateIntent,
  resolveProviderCreateIntents,
  type ProviderCreateIntentSpec,
} from "./providerCreateIntent";

const TELNYX_VOICE_APPLICATION_ID_PATTERN = /^[0-9]+$/;
const VOICE_APPLICATION_CREATE_INTENT = {
  eventType: "voice_application_create_intent",
  resourceType: "voice_application",
} as const satisfies ProviderCreateIntentSpec;

function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for Telnyx webhook URLs"
    );
  }
  return url.replace(/\/+$/, "");
}

function businessResourceNameSuffix(businessId: string): string {
  return `(${businessId})`;
}

/**
 * Recover a voice application created by a prior attempt whose provider
 * response could not be saved locally. Telnyx only exposes a contains filter
 * here, so filter by the business UUID and require one exact deterministic
 * name suffix client-side. Ambiguity fails closed without another create.
 */
async function recoverVoiceApplicationId(
  businessId: string
): Promise<string | null> {
  const suffix = businessResourceNameSuffix(businessId);
  const matches = new Map<string, string>();

  let applications;
  try {
    applications = telnyx.callControlApplications.list({
      filter: { application_name: { contains: businessId } },
    });

    for await (const application of applications) {
      if (typeof application.application_name !== "string") {
        throw new Error(
          `[registration:voiceApplication] Telnyx returned an application without a valid name while recovering business ${businessId}`
        );
      }
      if (!application.application_name.trim().endsWith(suffix)) continue;
      if (
        typeof application.id !== "string" ||
        !TELNYX_VOICE_APPLICATION_ID_PATTERN.test(application.id.trim())
      ) {
        throw new Error(
          `[registration:voiceApplication] Telnyx returned a matching application without an id for business ${businessId}`
        );
      }
      matches.set(application.id.trim(), application.application_name);
    }
  } catch (cause) {
    throw new Error(
      `[registration:voiceApplication] Could not check Telnyx for an existing application for business ${businessId}`,
      { cause }
    );
  }

  if (matches.size > 1) {
    throw new Error(
      `[registration:voiceApplication] More than one Telnyx application matches business ${businessId}; contact support before retrying`
    );
  }

  return matches.keys().next().value ?? null;
}

async function persistVoiceApplicationId(
  businessId: string,
  applicationId: string
): Promise<void> {
  const { data: persisted, error } = await supabaseAdmin
    .from("businesses")
    .update({ telnyx_voice_application_id: applicationId })
    .eq("id", businessId)
    .is("telnyx_voice_application_id", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(
      `[registration:voiceApplication] Failed to persist application id ${applicationId} for business ${businessId}: ${error.message}`
    );
  }
  if (persisted) return;

  const { data: current, error: currentError } = await supabaseAdmin
    .from("businesses")
    .select("telnyx_voice_application_id")
    .eq("id", businessId)
    .single<{ telnyx_voice_application_id: string | null }>();

  if (currentError || !current) {
    throw new Error(
      `[registration:voiceApplication] Could not verify concurrent application persistence for business ${businessId}: ${currentError?.message ?? "not found"}`
    );
  }
  if (current.telnyx_voice_application_id?.trim() === applicationId) return;
  throw new Error(
    `[registration:voiceApplication] Business ${businessId} acquired a different voice application during persistence; contact support before retrying`
  );
}

async function readCurrentVoiceApplicationId(
  businessId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("telnyx_voice_application_id")
    .eq("id", businessId)
    .single<{ telnyx_voice_application_id: string | null }>();

  if (error || !data) {
    throw new Error(
      `[registration:voiceApplication] Could not recheck the application pointer for business ${businessId}: ${error?.message ?? "not found"}`
    );
  }
  if (!data.telnyx_voice_application_id) return null;
  const applicationId = data.telnyx_voice_application_id.trim();
  if (!TELNYX_VOICE_APPLICATION_ID_PATTERN.test(applicationId)) {
    throw new Error(
      `[registration:voiceApplication] Business ${businessId} has an invalid voice application pointer`
    );
  }
  return applicationId;
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
    await resolveProviderCreateIntents({
      businessId,
      spec: VOICE_APPLICATION_CREATE_INTENT,
    });
    return;
  }

  const applicationName = `${business.legal_business_name ?? business.name} (${businessId})`;
  const webhookEventUrl = `${appBaseUrl()}/api/messaging/voice`;

  try {
    const recoveredApplicationId = await recoverVoiceApplicationId(businessId);
    if (recoveredApplicationId) {
      await persistVoiceApplicationId(businessId, recoveredApplicationId);
      await resolveProviderCreateIntents({
        businessId,
        spec: VOICE_APPLICATION_CREATE_INTENT,
      });
      await appendRegistrationEvent({
        businessId,
        eventType: "voice_application_created",
        resourceType: "voice_application",
        resourceId: recoveredApplicationId,
        status: "success",
        rawPayload: {
          _recovery: {
            source: "telnyx_call_control_application_list",
            businessIdSuffixMatched: true,
          },
        },
      });
      return;
    }

    const createIntentId = await beginProviderCreateIntent({
      businessId,
      spec: VOICE_APPLICATION_CREATE_INTENT,
    });
    const concurrentlyPersistedApplicationId =
      await readCurrentVoiceApplicationId(businessId);
    if (concurrentlyPersistedApplicationId) {
      await resolveProviderCreateIntents({
        businessId,
        spec: VOICE_APPLICATION_CREATE_INTENT,
      });
      return;
    }
    const response = await telnyx.callControlApplications.create(
      {
        application_name: applicationName,
        webhook_event_url: webhookEventUrl,
        webhook_event_failover_url: webhookEventUrl,
      },
      // See messagingProfile.ts: one POST per launch attempt, with provider
      // list recovery on Retry, is safer than an unkeyed SDK auto-retry.
      { maxRetries: 0 }
    );

    const applicationId = response.data?.id;
    if (
      typeof applicationId !== "string" ||
      !TELNYX_VOICE_APPLICATION_ID_PATTERN.test(applicationId.trim())
    ) {
      throw new Error(
        `[registration:voiceApplication] Telnyx returned an invalid id for business ${businessId}`
      );
    }

    const normalizedApplicationId = applicationId.trim();
    await persistVoiceApplicationId(businessId, normalizedApplicationId);
    await resolveProviderCreateIntents({
      businessId,
      spec: VOICE_APPLICATION_CREATE_INTENT,
    });

    await appendRegistrationEvent({
      businessId,
      eventType: "voice_application_created",
      resourceType: "voice_application",
      resourceId: normalizedApplicationId,
      status: "success",
      rawPayload: {
        ...(response as unknown as Record<string, unknown>),
        _createIntent: { id: createIntentId },
      },
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
