import { telnyx } from "@/lib/messaging/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buildSmsComplianceCopy } from "@/lib/messaging/complianceCopy";
import { appendRegistrationEvent, serializeError } from "./audit";
import { resolveLegalUrls, type PrivacyTermsMode } from "./legalUrls";
import {
  buildA2pRiskInputForBusiness,
  hashA2pRiskInput,
} from "./riskScreening";
import { mapCampaignStatus } from "./statusMapper";

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
const TELNYX_BRAND_CAMPAIGN_CAP = 5;
const TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE =
  "This Telnyx brand is at Telnyx's campaign cap: it already has 5 campaigns, the maximum allowed per brand. SimplAssist cannot create the additional campaign required for this account. Use a different eligible brand or contact Telnyx Support before approving this link.";

export type CampaignRegistrationErrorCode =
  | "campaign_recovery_provider_unavailable"
  | "campaign_recovery_malformed_response"
  | "campaign_recovery_multiple_matches"
  | "campaign_recovery_persist_failed"
  | "campaign_recovery_history_unavailable"
  | "campaign_recovery_history_invalid"
  | "campaign_recovered_rejected"
  | "campaign_submit_malformed_response"
  | "telnyx_brand_campaign_cap_reached";

export type CampaignRegistrationErrorKind = "transient" | "permanent";

/** Stable, provider-payload-free failures that launch can classify safely. */
export class CampaignRegistrationError extends Error {
  readonly code: CampaignRegistrationErrorCode;
  readonly kind: CampaignRegistrationErrorKind;

  constructor(options: {
    code: CampaignRegistrationErrorCode;
    kind: CampaignRegistrationErrorKind;
    message: string;
  }) {
    super(options.message);
    this.name = "CampaignRegistrationError";
    this.code = options.code;
    this.kind = options.kind;
  }
}

type RecoveredCampaignStatus = "pending" | "approved" | "rejected";

interface CampaignListItem {
  brandId?: string | null;
  campaignId?: string | null;
  campaignStatus?: string | null;
  failureReasons?: string | null;
  referenceId?: string | null;
}

const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const TELNYX_CAMPAIGN_STATUSES = new Set([
  "TCR_PENDING",
  "TCR_SUSPENDED",
  "TCR_EXPIRED",
  "TCR_ACCEPTED",
  "TCR_FAILED",
  "TELNYX_ACCEPTED",
  "TELNYX_FAILED",
  "MNO_PENDING",
  "MNO_ACCEPTED",
  "MNO_REJECTED",
  "MNO_PROVISIONED",
  "MNO_PROVISIONING_FAILED",
]);

function campaignRecoveryError(
  code: CampaignRegistrationErrorCode,
  kind: CampaignRegistrationErrorKind,
  message: string
): CampaignRegistrationError {
  return new CampaignRegistrationError({ code, kind, message });
}

function isValidCampaignId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    CAMPAIGN_ID_PATTERN.test(value.trim())
  );
}

async function readArchivedCampaignIds(businessId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from("rejected_campaigns")
    .select("telnyx_campaign_id")
    .eq("business_id", businessId);

  if (error) {
    throw campaignRecoveryError(
      "campaign_recovery_history_unavailable",
      "transient",
      "SimplAssist could not verify the prior campaign history. No new campaign was created; try again shortly."
    );
  }

  if (!Array.isArray(data)) {
    throw campaignRecoveryError(
      "campaign_recovery_history_invalid",
      "permanent",
      "SimplAssist found invalid prior campaign history. Contact SimplAssist Support before retrying."
    );
  }

  const archived = new Set<string>();
  for (const row of data ?? []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw campaignRecoveryError(
        "campaign_recovery_history_invalid",
        "permanent",
        "SimplAssist found invalid prior campaign history. Contact SimplAssist Support before retrying."
      );
    }
    const campaignId = (row as { telnyx_campaign_id?: unknown })
      .telnyx_campaign_id;
    if (!isValidCampaignId(campaignId)) {
      throw campaignRecoveryError(
        "campaign_recovery_history_invalid",
        "permanent",
        "SimplAssist found invalid prior campaign history. Contact SimplAssist Support before retrying."
      );
    }
    archived.add(campaignId.trim());
  }
  return archived;
}

function recoveredCampaignStatus(campaignStatus: string): RecoveredCampaignStatus {
  const mapped = mapCampaignStatus({ campaignStatus });
  return mapped.dbStatus ?? "pending";
}

/**
 * Recover a campaign created by an earlier submit whose local save failed.
 * The caller-supplied referenceId is the business UUID, so an exact match is
 * safe to adopt. This runs on every registration attempt while the local
 * campaign pointer is empty; a failed save therefore relists on the retry.
 */
async function recoverCampaignBeforeCreate(
  businessId: string,
  telnyxBrandId: string
): Promise<boolean> {
  const matches: CampaignListItem[] = [];
  let totalCampaigns = 0;
  const archivedCampaignIds = await readArchivedCampaignIds(businessId);

  try {
    const campaigns = telnyx.messaging10dlc.campaign.list({
      brandId: telnyxBrandId,
      recordsPerPage: 10,
    });

    for await (const listed of campaigns) {
      if (!listed || typeof listed !== "object" || Array.isArray(listed)) {
        throw campaignRecoveryError(
          "campaign_recovery_malformed_response",
          "permanent",
          "Telnyx returned an incomplete campaign list. Contact SimplAssist Support before retrying."
        );
      }
      const campaign = listed as CampaignListItem;
      // campaignId is the stable identity of every list row. Without it we
      // cannot safely distinguish or recover provider resources.
      if (!isValidCampaignId(campaign.campaignId)) {
        throw campaignRecoveryError(
          "campaign_recovery_malformed_response",
          "permanent",
          "Telnyx returned an incomplete campaign list. Contact SimplAssist Support before retrying."
        );
      }

      const campaignId = campaign.campaignId.trim();
      // Rejected-campaign retry deliberately archives, deactivates, and
      // clears the old pointer before asking for a replacement. Telnyx keeps
      // terminated campaign records in list results; never re-adopt or count
      // one that this business already archived.
      if (archivedCampaignIds.has(campaignId)) continue;

      totalCampaigns += 1;

      if (
        campaign.referenceId !== undefined &&
        campaign.referenceId !== null &&
        typeof campaign.referenceId !== "string"
      ) {
        throw campaignRecoveryError(
          "campaign_recovery_malformed_response",
          "permanent",
          "Telnyx returned an incomplete campaign list. Contact SimplAssist Support before retrying."
        );
      }

      if (campaign.referenceId !== businessId) continue;

      if (
        typeof campaign.brandId !== "string" ||
        campaign.brandId.length === 0 ||
        campaign.brandId.trim().toLowerCase() !== telnyxBrandId.toLowerCase() ||
        typeof campaign.campaignStatus !== "string" ||
        !TELNYX_CAMPAIGN_STATUSES.has(campaign.campaignStatus)
      ) {
        throw campaignRecoveryError(
          "campaign_recovery_malformed_response",
          "permanent",
          "Telnyx returned an incomplete matching campaign. Contact SimplAssist Support before retrying."
        );
      }
      if (
        campaign.failureReasons !== undefined &&
        campaign.failureReasons !== null &&
        typeof campaign.failureReasons !== "string"
      ) {
        throw campaignRecoveryError(
          "campaign_recovery_malformed_response",
          "permanent",
          "Telnyx returned an incomplete matching campaign. Contact SimplAssist Support before retrying."
        );
      }

      matches.push({
        ...campaign,
        campaignId,
        brandId: campaign.brandId.trim(),
      });
    }
  } catch (error) {
    if (error instanceof CampaignRegistrationError) throw error;
    throw campaignRecoveryError(
      "campaign_recovery_provider_unavailable",
      "transient",
      "Telnyx could not check for an existing campaign. No new campaign was created; try again shortly."
    );
  }

  if (matches.length > 1) {
    throw campaignRecoveryError(
      "campaign_recovery_multiple_matches",
      "permanent",
      "More than one Telnyx campaign matches this SimplAssist business. Contact SimplAssist Support before retrying."
    );
  }

  if (matches.length === 0) {
    if (totalCampaigns >= TELNYX_BRAND_CAMPAIGN_CAP) {
      throw campaignRecoveryError(
        "telnyx_brand_campaign_cap_reached",
        "permanent",
        TELNYX_BRAND_CAMPAIGN_CAP_MESSAGE
      );
    }
    return false;
  }

  // Recovery takes precedence over the cap: this does not create a sixth
  // campaign, so it remains safe even when the brand currently has five.
  const recovered = matches[0];
  const status = recoveredCampaignStatus(recovered.campaignStatus!);
  const rejectionReason =
    status === "rejected"
      ? recovered.failureReasons?.trim() ||
        "Telnyx reported that the recovered campaign was rejected."
      : null;
  const now = new Date().toISOString();

  const { data: persisted, error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({
      telnyx_campaign_id: recovered.campaignId,
      campaign_status: status,
      campaign_status_updated_at: now,
      campaign_rejection_reason: rejectionReason,
    })
    .eq("id", businessId)
    // Never overwrite a campaign another request persisted concurrently.
    .is("telnyx_campaign_id", null)
    .select("id")
    .maybeSingle<{ id: string }>();

  if (updateError || !persisted) {
    throw campaignRecoveryError(
      "campaign_recovery_persist_failed",
      "transient",
      "SimplAssist found the existing Telnyx campaign but could not save it. No new campaign was created; retry shortly."
    );
  }

  await appendRegistrationEvent({
    businessId,
    eventType: "campaign_submitted",
    resourceType: "campaign",
    resourceId: recovered.campaignId,
    status,
    rejectionReason,
    rawPayload: {
      _recovery: {
        source: "telnyx_campaign_list",
        referenceIdMatched: true,
      },
    },
  });

  if (status === "rejected") {
    throw campaignRecoveryError(
      "campaign_recovered_rejected",
      "permanent",
      "The existing Telnyx campaign is rejected. Its carrier reason was saved for review."
    );
  }

  return true;
}

/**
 * Why the campaign is being archived. 'campaign_rejected' is the original
 * carrier-rejection retry path. 'brand_refile' is brand-level recovery: a
 * campaign is bound to its brandId at TCR and cannot be adopted by the
 * replacement brand, and Telnyx refuses to delete a brand that still has
 * active campaigns — so the brand recovery helper archives the child
 * campaign whatever state it is in.
 */
export type CampaignArchiveCause = "campaign_rejected" | "brand_refile";

/**
 * Retry recovery for a carrier-rejected campaign: preserve the rejected
 * campaign's ID and rejection details in rejected_campaigns, deactivate it at
 * Telnyx best-effort (stops its monthly billing; failure is recorded for
 * manual cleanup and never blocks the retry), then clear
 * businesses.telnyx_campaign_id so registerCampaign creates a replacement.
 *
 * Default cause 'campaign_rejected': no-op unless campaign_status is
 * 'rejected' with a campaign ID present. Cause 'brand_refile' archives the
 * campaign in ANY status (it only requires a campaign ID) — see
 * CampaignArchiveCause for why brand recovery cannot keep the old campaign.
 * Safe to re-run after a partial failure: the history row is reused and an
 * already-deactivated campaign is not re-deactivated.
 */
export async function archiveAndClearRejectedCampaign(
  businessId: string,
  options: { cause?: CampaignArchiveCause } = {}
): Promise<void> {
  const cause = options.cause ?? "campaign_rejected";
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

  if (!business.telnyx_campaign_id) {
    return;
  }

  if (cause === "campaign_rejected" && business.campaign_status !== "rejected") {
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
        // A brand re-file can archive a campaign that was never itself
        // rejected (still pending under the dead brand) — record why the
        // row exists instead of leaving the reason blank.
        rejection_reason:
          business.campaign_rejection_reason ??
          (cause === "brand_refile"
            ? "Archived during brand re-file: parent brand rejected"
            : null),
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
  //    re-runnable — the campaign pointer is still set, and under the
  //    default cause campaign_status is still 'rejected'.)
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

  // Submit is not atomic with our database write. If a prior attempt reached
  // Telnyx but failed while persisting the returned ID, recover that exact
  // referenceId before doing any preflight work or creating another campaign.
  if (
    await recoverCampaignBeforeCreate(businessId, business.telnyx_brand_id)
  ) {
    return;
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

    const rawCampaignId = response.campaignId;
    if (!isValidCampaignId(rawCampaignId)) {
      throw campaignRecoveryError(
        "campaign_submit_malformed_response",
        "permanent",
        "Telnyx returned an invalid campaign identifier. Contact SimplAssist Support before retrying."
      );
    }
    const campaignId = rawCampaignId.trim();

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
