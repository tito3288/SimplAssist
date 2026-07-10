import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateSlug, ensureUniqueSlug, isPendingSlug } from "@/lib/util/slug";
import {
  buildBusinessLandingUrl,
  resolveLegalUrls,
  type PrivacyTermsMode,
} from "@/lib/messaging/registration/legalUrls";
import {
  appendRegistrationEvent,
  serializeError,
} from "@/lib/messaging/registration/audit";
import {
  A2P_RISK_CHECKLIST_ANSWERS,
  isA2pRiskSelection,
} from "@/lib/messaging/registration/riskCategories";
import {
  registrationHasStartedForRisk,
  screenA2pRiskForBusiness,
  type A2pRiskReviewResult,
} from "@/lib/messaging/registration/riskScreening";
import { validateCustomerCareCopy } from "@/lib/messaging/registration/customerCareTemplates";
import type { A2pRiskChecklistAnswer } from "@/types/database";

const PREFLIGHT_FAILURE_MESSAGE =
  "Couldn't validate your compliance settings. Check Settings > Compliance, then try again.";

const REGISTRATION_LOCKED_MESSAGE =
  "Your registration is in carrier review — these details are locked until review completes.";

const PLACEHOLDER_PATTERN = /\[.+?\]/;
const STOP_PATTERN = /\bstop\b/i;

type SmsUseCaseBusinessRow = {
  id: string;
  compliance_info_completed_at: string | null;
  slug: string;
  privacy_terms_mode: PrivacyTermsMode | null;
  privacy_url_override: string | null;
  terms_url_override: string | null;
  website_url: string | null;
  legal_business_name: string | null;
  business_entity_type: string | null;
  business_registration_state: string | null;
  has_ein: boolean | null;
  ein: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
  telnyx_brand_id: string | null;
  brand_status: string | null;
  campaign_status: string | null;
  onboarding_registration_status:
    | "not_started"
    | "submitting"
    | "failed"
    | "submitted"
    | null;
};

const smsUseCaseSchema = z
  .object({
    businessId: z.string().uuid(),
    use_case_description: z.string().min(40),
    estimated_monthly_volume: z.enum([
      "under_1k",
      "1k_10k",
      "10k_100k",
      "over_100k",
    ]),
    sample_messages: z
      .array(
        z
          .string()
          .min(1)
          .refine(
            (value) => !PLACEHOLDER_PATTERN.test(value),
            "Sample messages cannot contain placeholders"
          )
      )
      .min(3)
      .max(5),
    opt_in_description: z.string().min(40),
    a2p_risk_checklist_answer: z.enum(A2P_RISK_CHECKLIST_ANSWERS),
    a2p_risk_checklist_selections: z.array(z.string()).default([]),
  })
  .refine(
    (data) =>
      data.a2p_risk_checklist_answer !== "restricted" ||
      data.a2p_risk_checklist_selections.some(isA2pRiskSelection),
    {
      message: "Select at least one restricted category, or choose a different answer",
      path: ["a2p_risk_checklist_selections"],
    }
  )
  .refine(
    (data) => data.sample_messages.some((sample) => STOP_PATTERN.test(sample)),
    {
      message: "At least one sample message must mention STOP opt-out wording",
      path: ["sample_messages"],
    }
  );

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = smsUseCaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const customerCareErrors = validateCustomerCareCopy({
    useCaseDescription: data.use_case_description,
    sampleMessages: data.sample_messages,
    optInDescription: data.opt_in_description,
  });
  if (customerCareErrors.length > 0) {
    return NextResponse.json(
      {
        error: customerCareErrors[0],
        details: customerCareErrors,
      },
      { status: 400 }
    );
  }

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select(
      [
        "id",
        "compliance_info_completed_at",
        "slug",
        "privacy_terms_mode",
        "privacy_url_override",
        "terms_url_override",
        "website_url",
        "legal_business_name",
        "business_entity_type",
        "business_registration_state",
        "has_ein",
        "ein",
        "authorized_rep_name",
        "authorized_rep_title",
        "authorized_rep_email",
        "authorized_rep_phone",
        "telnyx_brand_id",
        "brand_status",
        "campaign_status",
        "onboarding_registration_status",
      ].join(", ")
    )
    .eq("id", data.businessId)
    .eq("owner_id", user.id)
    .single<SmsUseCaseBusinessRow>();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  // Compliance content feeds the submitted Telnyx campaign, which can't be
  // updated mid-review — edits would only drift the DB from the filed
  // registration. The 'failed' state stays editable: fixing data before a
  // retry is the designed recovery path.
  if (
    registrationHasStartedForRisk(business) &&
    business.onboarding_registration_status !== "failed"
  ) {
    return NextResponse.json(
      { error: REGISTRATION_LOCKED_MESSAGE },
      { status: 409 }
    );
  }

  if (
    !business.legal_business_name ||
    !business.business_entity_type ||
    !business.business_registration_state ||
    business.has_ein !== true ||
    !business.ein ||
    !business.authorized_rep_name ||
    !business.authorized_rep_title ||
    !business.authorized_rep_email ||
    !business.authorized_rep_phone
  ) {
    return NextResponse.json(
      { error: "Finish business verification before SMS use case details" },
      { status: 400 }
    );
  }

  const isFirstSubmit = !business.compliance_info_completed_at;
  let slugForUpdate: string | undefined;

  if (isFirstSubmit && isPendingSlug(business.slug)) {
    const baseSlug = generateSlug(business.legal_business_name);
    try {
      slugForUpdate = await ensureUniqueSlug(baseSlug);
    } catch (err) {
      console.error(
        `[onboarding:sms-use-case] Slug generation failed for ${data.businessId}:`,
        err
      );
      return NextResponse.json(
        { error: "Failed to generate a unique URL slug for your business" },
        { status: 500 }
      );
    }
  }

  const resolvedSlug = slugForUpdate ?? business.slug;
  const preflightBusiness = {
    slug: resolvedSlug,
    privacy_terms_mode: (business.privacy_terms_mode ??
      "hosted") as PrivacyTermsMode,
    privacy_url_override: business.privacy_url_override,
    terms_url_override: business.terms_url_override,
  };

  try {
    resolveLegalUrls(preflightBusiness);
    const trimmedWebsite = business.website_url?.trim();
    if (!trimmedWebsite) {
      buildBusinessLandingUrl(resolvedSlug);
    }
  } catch (err) {
    console.error(
      `[onboarding:sms-use-case] Pre-flight failed for ${data.businessId}:`,
      err
    );
    await appendRegistrationEvent({
      businessId: data.businessId,
      eventType: "brand_submitted",
      resourceType: "brand",
      status: "error",
      rawPayload: { preflight_failure: serializeError(err) },
    });
    return NextResponse.json(
      { error: PREFLIGHT_FAILURE_MESSAGE },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const trimmedSamples = data.sample_messages.map((sample) => sample.trim());
  const checklistSelections = data.a2p_risk_checklist_selections.filter(
    isA2pRiskSelection
  );
  const editablePayload = {
    use_case_description: data.use_case_description,
    estimated_monthly_volume: data.estimated_monthly_volume,
    sample_messages: trimmedSamples,
    opt_in_description: data.opt_in_description,
    a2p_risk_review_customer_answer:
      data.a2p_risk_checklist_answer as A2pRiskChecklistAnswer,
    a2p_risk_review_customer_selections: checklistSelections,
    onboarding_last_saved_at: now,
  };

  let riskResult: A2pRiskReviewResult;
  try {
    riskResult = await screenA2pRiskForBusiness(data.businessId, {
      useCaseDescription: data.use_case_description,
      sampleMessages: trimmedSamples,
      optInDescription: data.opt_in_description,
      checklistAnswer: data.a2p_risk_checklist_answer,
      checklistSelections,
    });
  } catch (err) {
    console.error(
      `[onboarding:sms-use-case] A2P risk scan failed for ${data.businessId}:`,
      err
    );
    return NextResponse.json(
      {
        error:
          "Couldn't complete SMS eligibility review right now. Please try again.",
      },
      { status: 500 }
    );
  }

  const riskCleared =
    riskResult.registrationStarted ||
    riskResult.status === "passed" ||
    riskResult.status === "admin_approved";
  const preSubmissionRecoveryPayload = !riskResult.registrationStarted
    ? {
        onboarding_registration_status: "not_started" as const,
        onboarding_registration_error: null,
        onboarding_registration_started_at: null,
        onboarding_registration_submitted_at: null,
      }
    : {};

  if (!riskCleared) {
    const { error: draftError } = await supabaseAdmin
      .from("businesses")
      .update({
        ...editablePayload,
        ...(slugForUpdate ? { slug: slugForUpdate } : {}),
        compliance_info_completed_at: null,
        onboarding_step: "sms_use_case" as const,
      })
      .eq("id", data.businessId);

    if (draftError) {
      console.error(
        `[onboarding:sms-use-case] Failed to persist held SMS fields for ${data.businessId}:`,
        draftError
      );
      return NextResponse.json(
        { error: "Failed to save SMS use case details" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: false,
      riskReview: riskResult,
    });
  }

  if (isFirstSubmit) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        ...editablePayload,
        ...(slugForUpdate ? { slug: slugForUpdate } : {}),
        ...preSubmissionRecoveryPayload,
        compliance_info_completed_at: now,
        onboarding_step: "phone_number" as const,
      })
      .eq("id", data.businessId)
      .is("compliance_info_completed_at", null)
      .select("id");

    if (updateError) {
      console.error(
        `[onboarding:sms-use-case] Failed to persist compliance fields for ${data.businessId}:`,
        updateError
      );
      return NextResponse.json(
        { error: "Failed to save SMS use case details" },
        { status: 500 }
      );
    }

    if (!updated || updated.length === 0) {
      return NextResponse.json({ success: true, riskReview: riskResult });
    }
  } else {
    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        ...editablePayload,
        ...preSubmissionRecoveryPayload,
        compliance_info_completed_at: business.compliance_info_completed_at ?? now,
        onboarding_step: "phone_number" as const,
      })
      .eq("id", data.businessId);

    if (updateError) {
      console.error(
        `[onboarding:sms-use-case] Failed to update compliance fields for ${data.businessId}:`,
        updateError
      );
      return NextResponse.json(
        { error: "Failed to save SMS use case details" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ success: true, riskReview: riskResult });
}
