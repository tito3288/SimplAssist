import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { appendRegistrationEvent, serializeError } from "./audit";
import { resolveLegalUrls, type PrivacyTermsMode } from "./legalUrls";

function appBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set — required for Telnyx webhook URLs"
    );
  }
  return url.replace(/\/+$/, "");
}

const HELP_KEYWORDS = "HELP,INFO";
const OPTOUT_KEYWORDS = "STOP,END,UNSUBSCRIBE,CANCEL,QUIT";
const OPTIN_KEYWORDS = "START,SUBSCRIBE,YES";
const HELP_MESSAGE =
  "Reply with your question and we'll get back to you during business hours, or call us directly.";
const OPTOUT_MESSAGE =
  "You have been unsubscribed and will not receive any more messages. Reply START to opt back in.";
const OPTIN_MESSAGE =
  "You're subscribed and will receive messages from this business. Msg & data rates may apply. Reply HELP for help, STOP to opt out.";

export async function registerCampaign(businessId: string): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, telnyx_brand_id, telnyx_campaign_id, use_case_description, sample_messages, opt_in_description, slug, privacy_terms_mode, privacy_url_override, terms_url_override"
    )
    .eq("id", businessId)
    .single<{
      id: string;
      telnyx_brand_id: string | null;
      telnyx_campaign_id: string | null;
      use_case_description: string | null;
      sample_messages: string[] | null;
      opt_in_description: string | null;
      slug: string;
      privacy_terms_mode: PrivacyTermsMode;
      privacy_url_override: string | null;
      terms_url_override: string | null;
    }>();

  if (readError || !business) {
    throw new Error(
      `[registration:campaign] Business ${businessId} not found: ${readError?.message}`
    );
  }

  if (business.telnyx_campaign_id) {
    return;
  }

  if (!business.telnyx_brand_id) {
    throw new Error(
      `[registration:campaign] Business ${businessId} has no telnyx_brand_id — register brand first`
    );
  }

  if (!business.use_case_description) {
    throw new Error(
      `[registration:campaign] Business ${businessId} is missing use_case_description`
    );
  }

  const samples = business.sample_messages ?? [];
  if (samples.length < 3) {
    throw new Error(
      `[registration:campaign] Business ${businessId} requires at least 3 sample messages (got ${samples.length})`
    );
  }

  const webhookURL = `${appBaseUrl()}/api/messaging/registration/status`;
  const messageFlow = business.opt_in_description ?? OPTIN_MESSAGE;

  // Phase 6: privacy + terms URLs submitted to Telnyx. Resolved BEFORE the
  // try/catch so a placeholder slug or missing override URL fails fast and
  // never reaches the Telnyx API (no wasted submission, no retry quota burn,
  // no half-submitted campaign in TCR). The pre-flight gate in
  // /api/onboarding/brand-verification is the primary safety net; this is
  // defense in depth.
  const { privacyUrl, termsUrl } = resolveLegalUrls(business);

  try {
    const response = await telnyx.messaging10dlc.campaignBuilder.submit({
      brandId: business.telnyx_brand_id,
      description: business.use_case_description,
      usecase: "CUSTOMER_CARE",
      sample1: samples[0],
      sample2: samples[1],
      sample3: samples[2],
      sample4: samples[3],
      sample5: samples[4],
      messageFlow,
      subscriberOptin: true,
      optinKeywords: OPTIN_KEYWORDS,
      optinMessage: OPTIN_MESSAGE,
      subscriberOptout: true,
      optoutKeywords: OPTOUT_KEYWORDS,
      optoutMessage: OPTOUT_MESSAGE,
      subscriberHelp: true,
      helpKeywords: HELP_KEYWORDS,
      helpMessage: HELP_MESSAGE,
      // Boolean acceptance flag — REQUIRED by Telnyx, separate from the URL
      // fields below. Do not remove when refactoring URL handling.
      termsAndConditions: true,
      privacyPolicyLink: privacyUrl,
      termsAndConditionsLink: termsUrl,
      autoRenewal: true,
      embeddedLink: false,
      embeddedPhone: false,
      ageGated: false,
      numberPool: false,
      directLending: false,
      referenceId: businessId,
      webhookURL,
      webhookFailoverURL: webhookURL,
    });

    const campaignId = response.campaignId;
    if (!campaignId) {
      throw new Error(
        `[registration:campaign] Telnyx returned no campaignId for business ${businessId}`
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        telnyx_campaign_id: campaignId,
        campaign_status: "pending",
        campaign_status_updated_at: new Date().toISOString(),
      })
      .eq("id", businessId);

    if (updateError) {
      throw new Error(
        `[registration:campaign] Failed to persist campaign id ${campaignId} for business ${businessId}: ${updateError.message}`
      );
    }

    await appendRegistrationEvent({
      businessId,
      eventType: "campaign_submitted",
      resourceType: "campaign",
      resourceId: campaignId,
      status: "pending",
      rawPayload: {
        ...(response as unknown as Record<string, unknown>),
        _submitted: {
          privacyPolicyLink: privacyUrl,
          termsAndConditionsLink: termsUrl,
        },
      },
    });
  } catch (err) {
    await appendRegistrationEvent({
      businessId,
      eventType: "campaign_submitted",
      resourceType: "campaign",
      status: "error",
      rawPayload: {
        error: serializeError(err),
        _submitted: {
          privacyPolicyLink: privacyUrl,
          termsAndConditionsLink: termsUrl,
        },
      },
    });
    throw err;
  }
}
