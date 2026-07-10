import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { registrationHasStartedForRisk } from "@/lib/messaging/registration/riskScreening";
import { normalizeUsStateCode } from "@/lib/usStates";

const REGISTRATION_LOCKED_MESSAGE =
  "Your registration is in carrier review — these details are locked until review completes.";

function hasFirstAndLastName(value: string): boolean {
  return value.trim().split(/\s+/).length >= 2;
}

const einPathSchema = z.object({
  businessId: z.string().uuid(),
  has_ein: z.literal(true),
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
});

const noEinPathSchema = z.object({
  businessId: z.string().uuid(),
  has_ein: z.literal(false),
  join_waitlist: z.boolean().optional(),
});

const brandVerificationServerSchema = z.discriminatedUnion("has_ein", [
  einPathSchema,
  noEinPathSchema,
]);

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

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select(
      "id, no_ein_hold_status, telnyx_brand_id, brand_status, campaign_status, onboarding_registration_status"
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

  // Legal identity is frozen while a submitted registration awaits carrier
  // review — the Telnyx brand can't be updated, so edits would only drift the
  // DB from the filed brand. The 'failed' state stays editable: fixing data
  // before a retry is the designed recovery path.
  if (
    registrationHasStartedForRisk(business) &&
    business.onboarding_registration_status !== "failed"
  ) {
    return NextResponse.json(
      { error: REGISTRATION_LOCKED_MESSAGE },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  if (data.has_ein === false) {
    const { error: updateError } = await supabaseAdmin
      .from("businesses")
      .update({
        has_ein: false,
        a2p_brand_tier: null,
        no_ein_hold_status: data.join_waitlist ? "waitlisted" : "ein_encouraged",
        no_ein_waitlist_requested_at: data.join_waitlist ? now : null,
        onboarding_step: "legal_verification",
        onboarding_last_saved_at: now,
      })
      .eq("id", data.businessId);

    if (updateError) {
      console.error(
        `[onboarding:brand-verification] Failed to save No-EIN hold for ${data.businessId}:`,
        updateError
      );
      return NextResponse.json(
        { error: "Failed to save EIN status" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      held: true,
      code: "held_no_ein",
    });
  }

  const registrationStateCode = normalizeUsStateCode(data.business_registration_state);

  if (!registrationStateCode) {
    return NextResponse.json(
      { error: "Invalid state of registration" },
      { status: 400 }
    );
  }

  const convertedFromNoEin =
    business.no_ein_hold_status === "ein_encouraged" ||
    business.no_ein_hold_status === "waitlisted";

  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({
      has_ein: true,
      a2p_brand_tier: "low_volume_standard",
      no_ein_hold_status: convertedFromNoEin ? "converted_to_ein" : "none",
      legal_business_name: data.legal_business_name,
      business_entity_type: data.business_entity_type,
      business_registration_state: registrationStateCode,
      tax_id_type: "ein" as const,
      ein: data.ein,
      authorized_rep_name: data.authorized_rep_name,
      authorized_rep_title: data.authorized_rep_title,
      authorized_rep_email: data.authorized_rep_email,
      authorized_rep_phone: data.authorized_rep_phone,
      onboarding_step: "sms_use_case",
      onboarding_last_saved_at: now,
    })
    .eq("id", data.businessId);

  if (updateError) {
    console.error(
      `[onboarding:brand-verification] Failed to save legal fields for ${data.businessId}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save business verification info" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
