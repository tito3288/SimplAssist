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

const PREFLIGHT_FAILURE_MESSAGE =
  "Couldn't validate your compliance settings. Check Settings > Compliance, then try again.";

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
  ein: string | null;
  authorized_rep_name: string | null;
  authorized_rep_title: string | null;
  authorized_rep_email: string | null;
  authorized_rep_phone: string | null;
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
  })
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
        "ein",
        "authorized_rep_name",
        "authorized_rep_title",
        "authorized_rep_email",
        "authorized_rep_phone",
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

  if (
    !business.legal_business_name ||
    !business.business_entity_type ||
    !business.business_registration_state ||
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

  if (isFirstSubmit) {
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
  }

  const now = new Date().toISOString();
  const editablePayload = {
    use_case_description: data.use_case_description,
    estimated_monthly_volume: data.estimated_monthly_volume,
    sample_messages: data.sample_messages.map((sample) => sample.trim()),
    opt_in_description: data.opt_in_description,
    onboarding_step: "phone_number" as const,
    onboarding_last_saved_at: now,
  };

  if (isFirstSubmit) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        ...editablePayload,
        ...(slugForUpdate ? { slug: slugForUpdate } : {}),
        compliance_info_completed_at: now,
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
      return NextResponse.json({ success: true });
    }
  } else {
    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update(editablePayload)
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

  return NextResponse.json({ success: true });
}
