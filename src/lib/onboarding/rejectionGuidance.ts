import type { OnboardingStep } from "@/types/database";

export type RejectionKind = "brand" | "campaign";

// Ordered: identity checks run before content checks because carrier texts
// citing brand identity often also contain generic words like "description".
// Carrier codes: 808/810 = identity/EIN verification; 861 = missing opt-out
// language in sample messages; 708 = message flow / call-to-action issues.
const IDENTITY_PATTERN =
  /(\bein\b|tax id|legal name|identity|vetting|brand verification|registration number|address mismatch|\b808\b|\b810\b)/i;
const OPT_OUT_PATTERN = /(opt.?out|unsubscribe|\bstop\b|\b861\b)/i;
const OPT_IN_PATTERN = /(call.?to.?action|\bcta\b|message flow|opt.?in|consent|\b708\b)/i;
const SAMPLE_PATTERN = /(sample|example message)/i;
const USE_CASE_PATTERN = /(use.?case|description|vague|insufficient|unclear)/i;
const CONTENT_PATTERN =
  /(prohibited|disallowed|restricted|cannabis|firearm|gambl|lending|\bloan\b|alcohol|tobacco|content)/i;
const URL_PATTERN = /(\burl\b|website|\blink\b|landing page|privacy|terms)/i;

/**
 * Best-effort inference of which onboarding step a carrier rejection points
 * at, so "Fix & resubmit" can land the customer on the right form.
 *
 * Keyword-based and intentionally conservative: an unrecognized or ambiguous
 * reason falls back to the earliest relevant step for the rejection kind
 * (brand → Business Verification, campaign → SMS Use Case). Inference never
 * blocks anything, and callers keep showing the full raw reason regardless.
 */
export function inferRejectionStep(
  kind: RejectionKind,
  reason: string | null | undefined
): OnboardingStep {
  const text = reason ?? "";
  if (IDENTITY_PATTERN.test(text)) return "legal_verification";
  // Content patterns only apply to campaign rejections: generic quality
  // wording ("insufficient", "unclear", "description") in a BRAND rejection
  // refers to brand data, not campaign content — let it fall through to the
  // kind fallback (Business Verification) instead of misrouting.
  if (kind === "campaign") {
    if (OPT_OUT_PATTERN.test(text)) return "sms_use_case";
    if (OPT_IN_PATTERN.test(text)) return "sms_use_case";
    if (SAMPLE_PATTERN.test(text)) return "sms_use_case";
    if (USE_CASE_PATTERN.test(text)) return "sms_use_case";
    if (CONTENT_PATTERN.test(text)) return "sms_use_case";
  }
  if (URL_PATTERN.test(text)) return "business_info";
  return kind === "brand" ? "legal_verification" : "sms_use_case";
}
