import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appendRegistrationEvent, serializeError } from "./audit";
import {
  beginProviderCreateIntent,
  resolveProviderCreateIntents,
  type ProviderCreateIntentSpec,
} from "./providerCreateIntent";
import { buildProviderResourceName } from "./providerResourceName";

const TELNYX_MESSAGING_PROFILE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGING_PROFILE_CREATE_INTENT = {
  eventType: "messaging_profile_create_intent",
  resourceType: "messaging_profile",
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
 * Recover a profile created by a prior attempt whose provider response could
 * not be saved locally. The business UUID suffix is deterministic and unique
 * across all SimplAssist-created profiles. Multiple exact suffix matches are
 * ambiguous, so fail closed instead of creating another resource.
 */
async function recoverMessagingProfileId(
  businessId: string
): Promise<string | null> {
  const suffix = businessResourceNameSuffix(businessId);
  const matches = new Map<string, string>();

  let profiles;
  try {
    profiles = telnyx.messagingProfiles.list({
      "filter[name][contains]": businessId,
    });

    for await (const profile of profiles) {
      if (typeof profile.name !== "string") {
        throw new Error(
          `[registration:messagingProfile] Telnyx returned a profile without a valid name while recovering business ${businessId}`
        );
      }
      if (!profile.name.trim().endsWith(suffix)) continue;
      if (
        typeof profile.id !== "string" ||
        !TELNYX_MESSAGING_PROFILE_ID_PATTERN.test(profile.id.trim())
      ) {
        throw new Error(
          `[registration:messagingProfile] Telnyx returned a matching profile without an id for business ${businessId}`
        );
      }
      matches.set(profile.id.trim().toLowerCase(), profile.name);
    }
  } catch (cause) {
    throw new Error(
      `[registration:messagingProfile] Could not check Telnyx for an existing profile for business ${businessId}`,
      { cause }
    );
  }

  if (matches.size > 1) {
    throw new Error(
      `[registration:messagingProfile] More than one Telnyx profile matches business ${businessId}; contact support before retrying`
    );
  }

  return matches.keys().next().value ?? null;
}

async function persistMessagingProfileId(
  businessId: string,
  profileId: string
): Promise<void> {
  const { data: persisted, error } = await supabaseAdmin
    .from("businesses")
    .update({ telnyx_messaging_profile_id: profileId })
    .eq("id", businessId)
    .is("telnyx_messaging_profile_id", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(
      `[registration:messagingProfile] Failed to persist profile id ${profileId} for business ${businessId}: ${error.message}`
    );
  }
  if (persisted) return;

  // A stale-submitting takeover can race an older invocation. Never replace
  // a pointer that another attempt saved after our initial read.
  const { data: current, error: currentError } = await supabaseAdmin
    .from("businesses")
    .select("telnyx_messaging_profile_id")
    .eq("id", businessId)
    .single<{ telnyx_messaging_profile_id: string | null }>();

  if (currentError || !current) {
    throw new Error(
      `[registration:messagingProfile] Could not verify concurrent profile persistence for business ${businessId}: ${currentError?.message ?? "not found"}`
    );
  }
  if (
    current.telnyx_messaging_profile_id?.trim().toLowerCase() ===
    profileId.toLowerCase()
  ) {
    return;
  }
  throw new Error(
    `[registration:messagingProfile] Business ${businessId} acquired a different messaging profile during persistence; contact support before retrying`
  );
}

async function readCurrentMessagingProfileId(
  businessId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("businesses")
    .select("telnyx_messaging_profile_id")
    .eq("id", businessId)
    .single<{ telnyx_messaging_profile_id: string | null }>();

  if (error || !data) {
    throw new Error(
      `[registration:messagingProfile] Could not recheck the profile pointer for business ${businessId}: ${error?.message ?? "not found"}`
    );
  }
  if (!data.telnyx_messaging_profile_id) return null;
  const profileId = data.telnyx_messaging_profile_id.trim().toLowerCase();
  if (!TELNYX_MESSAGING_PROFILE_ID_PATTERN.test(profileId)) {
    throw new Error(
      `[registration:messagingProfile] Business ${businessId} has an invalid messaging profile pointer`
    );
  }
  return profileId;
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
    await resolveProviderCreateIntents({
      businessId,
      spec: MESSAGING_PROFILE_CREATE_INTENT,
    });
    return;
  }

  const profileName = buildProviderResourceName(
    business.legal_business_name ?? business.name,
    businessId
  );
  const webhookUrl = `${appBaseUrl()}/api/messaging/webhook`;

  try {
    const recoveredProfileId = await recoverMessagingProfileId(businessId);
    if (recoveredProfileId) {
      await persistMessagingProfileId(businessId, recoveredProfileId);
      await resolveProviderCreateIntents({
        businessId,
        spec: MESSAGING_PROFILE_CREATE_INTENT,
      });
      await appendRegistrationEvent({
        businessId,
        eventType: "messaging_profile_created",
        resourceType: "messaging_profile",
        resourceId: recoveredProfileId,
        status: "success",
        rawPayload: {
          _recovery: {
            source: "telnyx_messaging_profile_list",
            businessIdSuffixMatched: true,
          },
        },
      });
      return;
    }

    const createIntentId = await beginProviderCreateIntent({
      businessId,
      spec: MESSAGING_PROFILE_CREATE_INTENT,
    });
    // The partial unique index serializes unresolved intents. A contender
    // delayed until after the winner resolved can acquire a new intent, so
    // re-read the CAS-protected pointer before authorizing its provider POST.
    const concurrentlyPersistedProfileId =
      await readCurrentMessagingProfileId(businessId);
    if (concurrentlyPersistedProfileId) {
      await resolveProviderCreateIntents({
        businessId,
        spec: MESSAGING_PROFILE_CREATE_INTENT,
      });
      return;
    }
    const response = await telnyx.messagingProfiles.create(
      {
        name: profileName,
        whitelisted_destinations: ["US"],
        webhook_url: webhookUrl,
        webhook_failover_url: webhookUrl,
      },
      // The SDK has no configured idempotency header for this endpoint.
      // Avoid an automatic second POST after an ambiguous transport error;
      // the next launch attempt recovers by deterministic provider name.
      { maxRetries: 0 }
    );

    const profileId = response.data?.id;
    if (
      typeof profileId !== "string" ||
      !TELNYX_MESSAGING_PROFILE_ID_PATTERN.test(profileId.trim())
    ) {
      throw new Error(
        `[registration:messagingProfile] Telnyx returned an invalid id for business ${businessId}`
      );
    }

    const normalizedProfileId = profileId.trim().toLowerCase();
    await persistMessagingProfileId(businessId, normalizedProfileId);
    await resolveProviderCreateIntents({
      businessId,
      spec: MESSAGING_PROFILE_CREATE_INTENT,
    });

    await appendRegistrationEvent({
      businessId,
      eventType: "messaging_profile_created",
      resourceType: "messaging_profile",
      resourceId: normalizedProfileId,
      status: "success",
      rawPayload: {
        ...(response as unknown as Record<string, unknown>),
        _createIntent: { id: createIntentId },
      },
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
