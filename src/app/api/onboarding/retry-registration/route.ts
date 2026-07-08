import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runFullRegistration } from "@/lib/messaging/registration";
import {
  claimRegistrationAttempt,
  markRegistrationFailed,
  markRegistrationSubmitted,
} from "@/lib/onboarding/registrationAttempt";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import { getA2pRiskClearanceForBusiness } from "@/lib/messaging/registration/riskScreening";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const MISSING_NUMBER_MESSAGE =
  "Choose your SimplAssist number before retrying SMS registration.";

const retrySchema = z.object({
  businessId: z.string().uuid(),
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

  const parsed = retrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { businessId } = parsed.data;

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at, telnyx_campaign_id")
    .eq("id", businessId)
    .eq("owner_id", user.id)
    .single();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      { error: "Complete brand verification info before retrying registration" },
      { status: 400 }
    );
  }

  const { data: phoneNumberRow, error: phoneNumberError } = await supabase
    .from("phone_numbers")
    .select("id, phone_number")
    .eq("business_id", businessId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (phoneNumberError) {
    console.error(
      `[onboarding:retry-registration] Failed to read active number for ${businessId}:`,
      phoneNumberError
    );
    return NextResponse.json(
      { error: "Failed to check your phone number" },
      { status: 500 }
    );
  }

  if (!phoneNumberRow?.phone_number) {
    return NextResponse.json(
      { error: MISSING_NUMBER_MESSAGE, code: "missing_phone_number" },
      { status: 400 }
    );
  }

  if (business.telnyx_campaign_id) {
    await markRegistrationSubmitted(businessId);
    const state = await getOnboardingStateForBusinessId(businessId);
    return NextResponse.json({ success: true, state });
  }

  const riskClearance = await getA2pRiskClearanceForBusiness(businessId);
  if (!riskClearance.cleared) {
    const state = await getOnboardingStateForBusinessId(businessId);
    return NextResponse.json(
      {
        error: riskClearance.message,
        code: "a2p_risk_review_required",
        riskReview: riskClearance,
        state,
      },
      { status: 400 }
    );
  }

  const claim = await claimRegistrationAttempt(businessId);
  if (!claim.claimed) {
    const state = await getOnboardingStateForBusinessId(businessId);
    if (claim.reason === "already_submitted") {
      return NextResponse.json({ success: true, state });
    }
    if (claim.reason === "already_submitting") {
      return NextResponse.json({ success: true, inProgress: true, state });
    }
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE, state },
      { status: 409 }
    );
  }

  try {
    await runFullRegistration(businessId);
    await markRegistrationSubmitted(businessId);
  } catch (err) {
    console.error(
      `[onboarding:retry-registration] Registration failed for ${businessId}:`,
      err
    );
    await markRegistrationFailed(businessId, REGISTRATION_FAILURE_MESSAGE).catch(
      (markError) =>
        console.error(
          `[onboarding:retry-registration] Failed to persist retryable failure for ${businessId}:`,
          markError
        )
    );
    const state = await getOnboardingStateForBusinessId(businessId);
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE, code: "registration_failed", state },
      { status: 500 }
    );
  }

  const state = await getOnboardingStateForBusinessId(businessId);
  return NextResponse.json({ success: true, state });
}
