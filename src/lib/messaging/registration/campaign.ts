import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSmsComplianceCopy } from "@/lib/messaging/complianceCopy";
import { appendRegistrationEvent, serializeError } from "./audit";
import { resolveLegalUrls, type PrivacyTermsMode } from "./legalUrls";
import {
  buildA2pRiskInputForBusiness,
  hashA2pRiskInput,
} from "./riskScreening";

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

/**
 * Retry recovery for a carrier-rejected campaign: preserve the rejected
 * campaign's ID and rejection details in rejected_campaigns, deactivate it at
 * Telnyx best-effort (stops its monthly billing; failure is recorded for
 * manual cleanup and never blocks the retry), then clear
 * businesses.telnyx_campaign_id so registerCampaign creates a replacement.
 *
 * No-op unless campaign_status is 'rejected' with a campaign ID present.
 * Safe to re-run after a partial failure: the history row is reused and an
 * already-deactivated campaign is not re-deactivated.
 */
export async function archiveAndClearRejectedCampaign(
  businessId: string
): Promise<void> {
  const { data: business, error: readError } = await supabaseAdmin
    .from("businesses")
    .select("id, telnyx_campaign_id, campaign_status, campaign_rejection_reason")
    .eq("id", businessId)
    .single<{
      id: string;
      telnyx_campaign_id: string | null;
      campaign_status: string | null;
      campaign_rejection_reason: string | null;
    }>();

  if (readError || !business) {
    throw new Error(
      `[registration:campaign] Business ${businessId} not found for rejected-campaign recovery: ${readError?.message}`
    );
  }

  if (!business.telnyx_campaign_id || business.campaign_status !== "rejected") {
    return;
  }

  const campaignId = business.telnyx_campaign_id;

  // 1. Preserve history before anything is repointed (reuse the row if a
  //    prior partial run already archived this campaign).
  const { data: existing, error: existingError } = await supabaseAdmin
    .from("rejected_campaigns")
    .select("id, telnyx_deactivated")
    .eq("business_id", businessId)
    .eq("telnyx_campaign_id", campaignId)
    .maybeSingle<{ id: string; telnyx_deactivated: boolean }>();

  if (existingError) {
    // Fail loudly rather than risk duplicating history or re-deactivating:
    // the thrown error keeps the attempt in a retryable state.
    throw new Error(
      `[registration:campaign] Failed to read rejected-campaign history for ${businessId}: ${existingError.message}`
    );
  }

  let historyId = existing?.id ?? null;
  if (!historyId) {
    const { data: inserted, error: historyError } = await supabaseAdmin
      .from("rejected_campaigns")
      .insert({
        business_id: businessId,
        telnyx_campaign_id: campaignId,
        rejection_reason: business.campaign_rejection_reason,
      })
      .select("id")
      .single<{ id: string }>();

    if (historyError || !inserted) {
      throw new Error(
        `[registration:campaign] Failed to archive rejected campaign ${campaignId} for ${businessId}: ${historyError?.message}`
      );
    }
    historyId = inserted.id;
  }

  // 2. Best-effort Telnyx deactivation — stops the rejected campaign's
  //    monthly billing. Never blocks the retry.
  if (!existing?.telnyx_deactivated) {
    try {
      await telnyx.messaging10dlc.campaign.deactivate(campaignId);
      await supabaseAdmin
        .from("rejected_campaigns")
        .update({ telnyx_deactivated: true, deactivation_error: null })
        .eq("id", historyId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[registration:campaign] Best-effort deactivation of rejected campaign ${campaignId} failed for ${businessId} — needs manual cleanup:`,
        err
      );
      await supabaseAdmin
        .from("rejected_campaigns")
        .update({ deactivation_error: message })
        .eq("id", historyId);
    }
  }

  // 3. Reset the numbers' campaign-assignment state BEFORE clearing the
  //    campaign pointer: stale 'assigned'/failed rows referencing the old
  //    campaign would otherwise be skipped by the lazy-refresh gate and
  //    strand the number when the replacement campaign is approved. (Done
  //    before the pointer clear so a failure here leaves the helper
  //    re-runnable — campaign_status is still 'rejected'.)
  const { error: assignmentResetError } = await supabaseAdmin
    .from("phone_numbers")
    .update({
      telnyx_campaign_assignment_status: "unassigned",
      telnyx_campaign_assignment_campaign_id: null,
      telnyx_campaign_assignment_task_id: null,
      telnyx_campaign_assignment_failure_reason: null,
      telnyx_campaign_assignment_updated_at: new Date().toISOString(),
    })
    .eq("business_id", businessId)
    .eq("is_active", true);

  if (assignmentResetError) {
    throw new Error(
      `[registration:campaign] Failed to reset number assignment state for ${businessId}: ${assignmentResetError.message}`
    );
  }

  // 4. Clear the pointer so registerCampaign creates the replacement.
  const { error: clearError } = await supabaseAdmin
    .from("businesses")
    .update({
      telnyx_campaign_id: null,
      campaign_status: null,
      campaign_status_updated_at: new Date().toISOString(),
      campaign_rejection_reason: null,
    })
    .eq("id", businessId);

  if (clearError) {
    throw new Error(
      `[registration:campaign] Failed to clear rejected campaign ${campaignId} for ${businessId}: ${clearError.message}`
    );
  }
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
  const smsEntryPoint = `${appBaseUrl()}/c/${business.slug}`;

  const complianceCopy = buildSmsComplianceCopy({
    privacyUrl,
    smsPhoneNumber: null,
    smsEntryPoint,
    business,
  });
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

    // The rewrite above changes a risk-hash input. For a business whose
    // screening decision stands (passed/admin_approved), restamp the stored
    // hash so this machine-induced drift can't invalidate the decision or
    // trigger a spurious re-screen on a later retry. Best-effort: a failed
    // restamp only costs one extra re-screen later.
    try {
      const { data: riskRow } = await supabaseAdmin
        .from("businesses")
        .select("a2p_risk_review_status")
        .eq("id", businessId)
        .single<{ a2p_risk_review_status: string | null }>();
      if (
        riskRow?.a2p_risk_review_status === "passed" ||
        riskRow?.a2p_risk_review_status === "admin_approved"
      ) {
        const { input } = await buildA2pRiskInputForBusiness(businessId);
        const { error: restampError } = await supabaseAdmin
          .from("businesses")
          .update({ a2p_risk_review_input_hash: hashA2pRiskInput(input) })
          .eq("id", businessId);
        if (restampError) {
          console.warn(
            `[registration:campaign] Risk-hash restamp write failed for ${businessId} (harmless; next retry re-screens once): ${restampError.message}`
          );
        }
      }
    } catch (err) {
      console.warn(
        `[registration:campaign] Risk-hash restamp after opt-in rewrite failed for ${businessId} (harmless; next retry re-screens once):`,
        err
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
          smsPhoneNumber: "number_agnostic_pending_paid_launch",
          smsEntryPoint,
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
          smsPhoneNumber: "number_agnostic_pending_paid_launch",
          smsEntryPoint,
          optinMessage: complianceCopy.optinMessage,
          optoutMessage: complianceCopy.optoutMessage,
          helpMessage: complianceCopy.helpMessage,
        },
      },
    });
    throw err;
  }
}
