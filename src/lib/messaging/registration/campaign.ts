import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getActivePhoneNumberForBusiness } from "@/lib/messaging/numbers";
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
const CAMPAIGN_USECASE = "CUSTOMER_CARE";

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

function supportContact(business: {
  email: string | null;
  phone_number: string | null;
}): string {
  return (
    cleanText(business.email) ??
    cleanText(business.phone_number) ??
    "the business directly"
  );
}

function buildCampaignComplianceCopy(
  business: {
    name: string;
    email: string | null;
    phone_number: string | null;
  },
  privacyUrl: string,
  smsPhoneNumber: string
) {
  const brandName = business.name.trim();
  const contact = supportContact(business);

  return {
    messageFlow: [
      `Customers opt in to ${brandName} SMS by calling or texting ${smsPhoneNumber}, the ${brandName} SMS number.`,
      `Calls to this number may be forwarded to ${brandName}, and missed calls may receive an SMS follow-up.`,
      `${brandName} uses SMS for customer care only, including responses to customer questions, missed-call follow-ups, and service coordination.`,
      "Message frequency varies by conversation. Message and data rates may apply.",
      "Reply HELP for help or STOP to opt out.",
      `Privacy Policy: ${privacyUrl}.`,
    ].join(" "),
    optinMessage: `${brandName}: You are subscribed to customer care texts. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.`,
    optoutMessage: `${brandName}: You are unsubscribed. No further messages will be sent. Reply START to opt back in.`,
    helpMessage: `${brandName}: For help, contact ${contact}. Msg frequency varies. Msg & data rates may apply. Reply STOP to opt out.`,
  };
}

export async function registerCampaign(businessId: string): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select(
      "id, name, email, phone_number, telnyx_brand_id, telnyx_campaign_id, use_case_description, sample_messages, slug, privacy_terms_mode, privacy_url_override, terms_url_override"
    )
    .eq("id", businessId)
    .single<{
      id: string;
      name: string;
      email: string | null;
      phone_number: string | null;
      telnyx_brand_id: string | null;
      telnyx_campaign_id: string | null;
      use_case_description: string | null;
      sample_messages: string[] | null;
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

  // Phase 6: privacy + terms URLs submitted to Telnyx. Resolved BEFORE the
  // try/catch so a placeholder slug or missing override URL fails fast and
  // never reaches the Telnyx API (no wasted submission, no retry quota burn,
  // no half-submitted campaign in TCR). The pre-flight gate in
  // /api/onboarding/brand-verification is the primary safety net; this is
  // defense in depth.
  const { privacyUrl, termsUrl } = resolveLegalUrls(business);
  const smsPhoneNumber = await getActivePhoneNumberForBusiness(businessId);
  if (!smsPhoneNumber) {
    throw new Error(
      `[registration:campaign] Business ${businessId} must have an active purchased phone number before campaign submission`
    );
  }

  const complianceCopy = buildCampaignComplianceCopy(
    business,
    privacyUrl,
    smsPhoneNumber
  );
  let campaignPreflightChecked = false;

  try {
    const { error: optInUpdateError } = await supabaseAdmin
      .from("businesses")
      .update({ opt_in_description: complianceCopy.messageFlow })
      .eq("id", businessId);

    if (optInUpdateError) {
      throw new Error(
        `[registration:campaign] Failed to persist final opt-in description for business ${businessId}: ${optInUpdateError.message}`
      );
    }

    const [cost, qualification] = await Promise.all([
      telnyx.messaging10dlc.campaign.usecase.getCost({
        usecase: CAMPAIGN_USECASE,
      }),
      telnyx.messaging10dlc.campaignBuilder.brand.qualifyByUsecase(
        CAMPAIGN_USECASE,
        { brandId: business.telnyx_brand_id }
      ),
    ]);

    if (qualification.usecase && qualification.usecase !== CAMPAIGN_USECASE) {
      throw new Error(
        `[registration:campaign] Brand ${business.telnyx_brand_id} qualification returned unexpected usecase ${qualification.usecase}`
      );
    }

    console.log(
      `[registration:campaign] ${CAMPAIGN_USECASE} cost for business ${businessId}: monthly=${cost.monthlyCost} upfront=${cost.upFrontCost}`
    );

    await appendRegistrationEvent({
      businessId,
      eventType: "campaign_preflight_checked",
      resourceType: "campaign",
      status: "ok",
      rawPayload: {
        usecase: CAMPAIGN_USECASE,
        cost,
        qualification,
      },
    });
    campaignPreflightChecked = true;

    const response = await telnyx.messaging10dlc.campaignBuilder.submit({
      brandId: business.telnyx_brand_id,
      description: business.use_case_description,
      usecase: CAMPAIGN_USECASE,
      sample1: samples[0],
      sample2: samples[1],
      sample3: samples[2],
      sample4: samples[3],
      sample5: samples[4],
      messageFlow: complianceCopy.messageFlow,
      subscriberOptin: true,
      optinKeywords: OPTIN_KEYWORDS,
      optinMessage: complianceCopy.optinMessage,
      subscriberOptout: true,
      optoutKeywords: OPTOUT_KEYWORDS,
      optoutMessage: complianceCopy.optoutMessage,
      subscriberHelp: true,
      helpKeywords: HELP_KEYWORDS,
      helpMessage: complianceCopy.helpMessage,
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
          messageFlow: complianceCopy.messageFlow,
          smsPhoneNumber,
          optinMessage: complianceCopy.optinMessage,
          optoutMessage: complianceCopy.optoutMessage,
          helpMessage: complianceCopy.helpMessage,
        },
      },
    });
  } catch (err) {
    if (!campaignPreflightChecked) {
      await appendRegistrationEvent({
        businessId,
        eventType: "campaign_preflight_checked",
        resourceType: "campaign",
        status: "error",
        rawPayload: {
          usecase: CAMPAIGN_USECASE,
          error: serializeError(err),
        },
      });
    }

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
          messageFlow: complianceCopy.messageFlow,
          smsPhoneNumber,
          optinMessage: complianceCopy.optinMessage,
          optoutMessage: complianceCopy.optoutMessage,
          helpMessage: complianceCopy.helpMessage,
        },
      },
    });
    throw err;
  }
}
