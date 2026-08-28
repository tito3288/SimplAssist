export type RejectionKind = "brand" | "campaign";

export const REJECTION_SUPPORT_MESSAGE =
  "Your registration was rejected by the carrier. Contact support so our team can review it and help with the next step.";

export type CarrierRejectionSnapshot = {
  brandStatus: string | null | undefined;
  campaignStatus: string | null | undefined;
  brandReason?: string | null;
  campaignReason?: string | null;
};

/**
 * Stable control-flow error for a carrier rejection discovered after a launch
 * has already been claimed. Provider helpers throw it from their last fresh
 * status check; paid launch maps it back to the support-only result without
 * exposing or overwriting the carrier's exact stored reason.
 */
export class CarrierRejectionSupportRequiredError extends Error {
  readonly code = "rejection_support_required" as const;
  readonly carrierReason: string | null;
  readonly rejectedResource: RejectionKind;

  constructor(options: {
    carrierReason: string | null;
    rejectedResource: RejectionKind;
  }) {
    super(REJECTION_SUPPORT_MESSAGE);
    this.name = "CarrierRejectionSupportRequiredError";
    this.carrierReason = options.carrierReason;
    this.rejectedResource = options.rejectedResource;
  }
}

// Ordered: identity checks run before content checks because carrier texts
// citing brand identity often also contain generic words like "description".
// Carrier codes: 808/810 = identity/EIN verification; 861 = missing opt-out
// language in sample messages; 708 = message flow / call-to-action issues.
const IDENTITY_PATTERN =
  /(\bein\b|tax id|legal name|identity|vetting|brand verification|registration number|address mismatch|\b808\b|\b810\b)/i;
// "opt(ing/ed/s) out" needs explicit alternatives: `opt.?out` cannot span
// the suffix, and the opt-in pattern's trailing \b keeps it out of "opting".
const OPT_OUT_PATTERN = /(opt(?:ing|ed|s)?[ -]?out|unsubscribe|\bstop\b|\b861\b)/i;
// Unambiguous message-flow / call-to-action evidence, including the explicit
// carrier code: that text is SimplAssist-generated, so it outranks keyword
// overlap with customer-owned fields (samples, use-case description).
const MESSAGE_FLOW_PATTERN = /(call.?to.?action|\bcta\b|message flow|\b708\b)/i;
// Ambiguous consent/opt-in wording is checked only after sample and use-case
// categories so the friendly explanation identifies the likely source field.
const OPT_IN_PATTERN = /(\bopt[ -]?ins?\b|consent)/i;
const SAMPLE_PATTERN = /(sample|example message)/i;
const USE_CASE_PATTERN = /(use.?case|description|vague|insufficient|unclear)/i;
const CONTENT_PATTERN =
  /(prohibited|disallowed|restricted|cannabis|firearm|gambl|lending|\bloan\b|alcohol|tobacco|content)/i;
// Deliberately no bare "privacy"/"terms": phrases like "violates our terms
// of service" are policy wording, not a website problem.
const URL_PATTERN =
  /(\burl\b|website|\blink\b|landing page|privacy policy|privacy page|privacy notice|privacy statement|terms page|terms and conditions|terms & conditions)/i;

type RejectionCategory =
  | "identity"
  | "opt_out"
  | "opt_in"
  | "sample"
  | "use_case"
  | "content"
  | "url"
  | null;

function classifyRejection(
  kind: RejectionKind,
  reason: string | null | undefined
): RejectionCategory {
  const text = reason ?? "";
  if (IDENTITY_PATTERN.test(text)) return "identity";
  // Content patterns only apply to campaign rejections: generic quality
  // wording ("insufficient", "unclear", "description") in a BRAND rejection
  // refers to brand data, not campaign content.
  if (kind === "campaign") {
    // An explicit 861 (missing opt-out in samples) beats message-flow
    // keywords, mirroring how the explicit 708 beats opt-out keywords below.
    if (/\b861\b/.test(text)) return "opt_out";
    // Explicit message-flow evidence (708, "message flow", CTA) outranks
    // everything else on the campaign side — real 708 boilerplate routinely
    // embeds "STOP opt-out" wording, and the message flow is our generated
    // text, so opt-out keywords must not steal it into the self-serve path.
    // Ambiguous consent/opt-in words rank below sample/use-case/url evidence,
    // keeping the explanation aligned with the carrier's likely concern.
    if (MESSAGE_FLOW_PATTERN.test(text)) return "opt_in";
    if (OPT_OUT_PATTERN.test(text)) return "opt_out";
    if (SAMPLE_PATTERN.test(text)) return "sample";
    if (USE_CASE_PATTERN.test(text)) return "use_case";
    if (URL_PATTERN.test(text)) return "url";
    if (OPT_IN_PATTERN.test(text)) return "opt_in";
    if (CONTENT_PATTERN.test(text)) return "content";
  }
  if (URL_PATTERN.test(text)) return "url";
  return null;
}

/**
 * Carrier rejections require staff review. They are never self-serve editable
 * or retryable because an automatic resubmission can create another paid
 * Telnyx resource and can remove the option to remediate the existing one.
 */
export function hasCarrierRejection(
  brandStatus: string | null | undefined,
  campaignStatus: string | null | undefined
): boolean {
  return brandStatus === "rejected" || campaignStatus === "rejected";
}

/** Throw the stable support-only error while preserving the exact DB reason. */
export function throwIfCarrierRejected(
  snapshot: CarrierRejectionSnapshot
): void {
  if (snapshot.brandStatus === "rejected") {
    throw new CarrierRejectionSupportRequiredError({
      carrierReason:
        nonEmptyReason(snapshot.brandReason) ??
        (snapshot.campaignStatus === "rejected"
          ? nonEmptyReason(snapshot.campaignReason)
          : null),
      rejectedResource: "brand",
    });
  }

  if (snapshot.campaignStatus === "rejected") {
    throw new CarrierRejectionSupportRequiredError({
      carrierReason: nonEmptyReason(snapshot.campaignReason),
      rejectedResource: "campaign",
    });
  }
}

function nonEmptyReason(reason: string | null | undefined): string | null {
  return typeof reason === "string" && reason.length > 0 ? reason : null;
}

/**
 * Compatibility wrapper for retry guards. New callers should use
 * hasCarrierRejection because the policy also locks editing and launch paths.
 */
export function isRejectionRetryBlocked(
  brandStatus: string | null | undefined,
  campaignStatus: string | null | undefined
): boolean {
  return hasCarrierRejection(brandStatus, campaignStatus);
}

/**
 * Plain-English explanation of a carrier rejection for non-technical
 * customers (Approach A: light string mapper). Returns null when the reason
 * doesn't match a known category — callers fall back to the raw text plus a
 * contact-support line. The raw carrier wording is always shown alongside,
 * smaller, for support/debugging.
 */
export function mapReasonToFriendly(
  kind: RejectionKind,
  reason: string | null | undefined
): string | null {
  switch (classifyRejection(kind, reason)) {
    case "identity":
      return kind === "brand"
        ? "Carriers couldn't verify your business identity. This can happen when the legal business name, EIN, or address doesn't exactly match official records. Contact support and our team will review the carrier's reason with you."
        : "The carrier flagged a business-identity issue while reviewing your SMS campaign. Contact support and our team will review the campaign and existing business verification before deciding the next step.";
    case "opt_out":
      return "One or more sample messages may be missing clear opt-out wording, such as 'Reply STOP to unsubscribe.' Contact support and our team will review the submitted campaign before taking the next step.";
    case "opt_in":
      return "This rejection concerns the opt-in explanation submitted with your campaign. Contact support so our team can review the generated language and determine the correct next step.";
    case "sample":
      return "One or more example texts didn't pass carrier review. Contact support so our team can compare the submitted messages with the carrier's requirements and determine the correct next step.";
    case "use_case":
      return "The carrier needs a clearer or more specific description of the SMS use case. Contact support so our team can review the submitted description and the carrier's reason before making changes.";
    case "content":
      return "The carrier flagged the submitted message content as a restricted category. Contact support so our team can review the decision and determine whether the campaign can be corrected or needs carrier assistance.";
    case "url":
      return kind === "brand"
        ? "Carriers couldn't verify the website or related policy pages for your business. Contact support so our team can inspect the submitted links and carrier feedback before taking the next step."
        : "Carriers couldn't load or verify a privacy or terms link on your SMS registration. Contact support so our team can inspect the submitted links and carrier feedback before taking the next step.";
    default:
      return null;
  }
}
