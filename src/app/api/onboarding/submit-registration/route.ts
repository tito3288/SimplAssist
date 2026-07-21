import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";

const MISSING_COMPLIANCE_MESSAGE =
  "Finish business verification before submitting SMS registration.";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't submit your SMS registration right now. Please try again or contact support.";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at")
    .eq("owner_id", user.id)
    .single();

  if (businessError || !business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      { error: MISSING_COMPLIANCE_MESSAGE, code: "missing_compliance_info" },
      { status: 400 }
    );
  }

  const launch = await attemptPaidLaunch(business.id, "onboarding_retry");
  const state = await getOnboardingStateForBusinessId(business.id);
  if (launch.status === "submitted" || launch.status === "already_submitted") {
    return NextResponse.json({ success: true, state });
  }
  if (launch.status === "in_progress") {
    return NextResponse.json({ success: true, inProgress: true, state });
  }

  const code =
    launch.status === "held_no_ein"
      ? "held_no_ein"
      : launch.status === "risk_review_required"
      ? "a2p_risk_review_required"
      : launch.status === "existing_brand_review_required"
        ? "existing_brand_review_required"
        : launch.status === "linked_brand_needs_support"
          ? "linked_brand_needs_support"
      : launch.status === "missing_phone_number"
        ? "missing_phone_number"
        : launch.status === "number_unavailable"
          ? "phone_number_unavailable"
          : launch.status === "billing_required"
            ? "billing_required"
            : "registration_failed";

  return NextResponse.json(
    { error: launch.message || REGISTRATION_FAILURE_MESSAGE, code, state },
    { status: code === "billing_required" ? 402 : 400 }
  );
}
