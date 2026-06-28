import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runFullRegistration } from "@/lib/messaging/registration";
import { generateSlug, ensureUniqueSlug, isPendingSlug } from "@/lib/util/slug";
import {
  resolveLegalUrls,
  buildBusinessLandingUrl,
  type PrivacyTermsMode,
} from "@/lib/messaging/registration/legalUrls";
import {
  appendRegistrationEvent,
  serializeError,
} from "@/lib/messaging/registration/audit";
import { normalizeUsStateCode } from "@/lib/usStates";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const PREFLIGHT_FAILURE_MESSAGE =
  "Couldn't validate your compliance settings. Check Settings → Compliance, then try again.";

const PLACEHOLDER_PATTERN = /\[.+?\]/;

function hasFirstAndLastName(value: string): boolean {
  return value.trim().split(/\s+/).length >= 2;
}

const brandVerificationServerSchema = z.object({
  businessId: z.string().uuid(),
  legal_business_name: z.string().min(1),
  business_entity_type: z.enum(["llc", "c_corp", "s_corp", "nonprofit", "partnership"]),
  business_registration_state: z
    .string()
    .min(2)
    .refine((value) => Boolean(normalizeUsStateCode(value))),
  ein: z.string().regex(/^\d{2}-\d{7}$/),
  authorized_rep_name: z
    .string()
    .min(1)
    .refine(
      hasFirstAndLastName,
      "Representative name must include first and last name"
    ),
  authorized_rep_title: z.string().min(1),
  authorized_rep_email: z.string().email(),
  authorized_rep_phone: z.string().min(10),
  use_case_description: z.string().min(40),
  estimated_monthly_volume: z.enum(["under_1k", "1k_10k", "10k_100k", "over_100k"]),
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
});

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

  const parsed = brandVerificationServerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const registrationStateCode = normalizeUsStateCode(data.business_registration_state);

  if (!registrationStateCode) {
    return NextResponse.json(
      { error: "Invalid state of registration" },
      { status: 400 }
    );
  }

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select(
      "id, compliance_info_completed_at, slug, privacy_terms_mode, privacy_url_override, terms_url_override, website_url"
    )
    .eq("id", data.businessId)
    .eq("owner_id", user.id)
    .single();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  const isFirstSubmit = !business.compliance_info_completed_at;

  // Phase 6: slug is generated from the real legal_business_name on first
  // submit only. If the current slug is not a 'pending-*' placeholder, it's
  // already been finalized and is FROZEN — subsequent edits to
  // legal_business_name do NOT regenerate it, because URLs already submitted
  // to Telnyx must remain reachable for the lifetime of the campaign.
  let slugForUpdate: string | undefined;
  if (isPendingSlug(business.slug)) {
    const baseSlug = generateSlug(data.legal_business_name);
    try {
      slugForUpdate = await ensureUniqueSlug(baseSlug);
    } catch (err) {
      console.error(
        `[onboarding:brand-verification] Slug generation failed for ${data.businessId}:`,
        err
      );
      return NextResponse.json(
        { error: "Failed to generate a unique URL slug for your business" },
        { status: 500 }
      );
    }
  }

  const editablePayload = {
    legal_business_name: data.legal_business_name,
    business_entity_type: data.business_entity_type,
    business_registration_state: registrationStateCode,
    tax_id_type: "ein" as const,
    ein: data.ein,
    authorized_rep_name: data.authorized_rep_name,
    authorized_rep_title: data.authorized_rep_title,
    authorized_rep_email: data.authorized_rep_email,
    authorized_rep_phone: data.authorized_rep_phone,
    use_case_description: data.use_case_description,
    estimated_monthly_volume: data.estimated_monthly_volume,
    sample_messages: data.sample_messages,
    opt_in_description: data.opt_in_description,
  };

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
        `[onboarding:brand-verification] Pre-flight failed for ${data.businessId}:`,
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

  // Race-safe first-submit transition: when compliance_info_completed_at is
  // null, the conditional UPDATE only succeeds for the one request that wins
  // the null→timestamp flip. Subsequent concurrent requests get 0 rows back
  // and skip the Phase 3 trigger. Matches the Phase 4/5 pattern documented
  // in project_post_isv_roadmap.md.
  //
  // On subsequent edits (compliance_info_completed_at already set), do a
  // plain UPDATE without changing the timestamp, slug, or firing Phase 3 —
  // the customer is just amending their info post-registration. If the
  // initial Phase 3 attempt failed, retries are out of scope for this flow.
  let shouldFirePhase3 = false;

  if (isFirstSubmit) {
    const completedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        ...editablePayload,
        ...(slugForUpdate ? { slug: slugForUpdate } : {}),
        compliance_info_completed_at: completedAt,
      })
      .eq("id", data.businessId)
      .is("compliance_info_completed_at", null)
      .select("id");

    if (updateError) {
      console.error(
        `[onboarding:brand-verification] Failed to persist compliance fields for ${data.businessId}:`,
        updateError
      );
      return NextResponse.json(
        { error: "Failed to save brand verification info" },
        { status: 500 }
      );
    }

    if (updated && updated.length > 0) {
      shouldFirePhase3 = true;
    } else {
      // Another concurrent request won the race and already fired Phase 3.
      // Return success — duplicate submits should be no-ops, not errors.
      return NextResponse.json({ success: true });
    }
  } else {
    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update(editablePayload)
      .eq("id", data.businessId);

    if (updateError) {
      console.error(
        `[onboarding:brand-verification] Failed to update compliance fields for ${data.businessId}:`,
        updateError
      );
      return NextResponse.json(
        { error: "Failed to save brand verification info" },
        { status: 500 }
      );
    }
  }

  if (!shouldFirePhase3) {
    return NextResponse.json({ success: true });
  }

  try {
    await runFullRegistration(data.businessId);
  } catch (err) {
    console.error(
      `[onboarding:brand-verification] Registration failed for ${data.businessId}:`,
      err
    );
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
