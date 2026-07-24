import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import { isRejectionRetryBlocked } from "@/lib/onboarding/rejectionGuidance";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const REJECTION_SUPPORT_MESSAGE =
  "Carriers rejected this registration — update your details with Fix & resubmit, or contact support and we'll fix it with you.";

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
    .select("id, compliance_info_completed_at, brand_status, campaign_status")
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

  // Carrier rejections are never blind-retryable: every resubmission costs
  // real money (campaign recreation charges; a rejected campaign's Mission
  // Control appeal option is destroyed by deactivation) and an unchanged
  // resubmission just rejects again. The step-9 panel hides Retry in these
  // states; this guard covers stale tabs and direct POSTs. The legitimate
  // fixed-content path resubmits through submit-registration instead.
  if (isRejectionRetryBlocked(business.brand_status, business.campaign_status)) {
    return NextResponse.json(
      {
        error: REJECTION_SUPPORT_MESSAGE,
        code: "rejection_support_required",
      },
      { status: 409 }
    );
  }

  const launch = await attemptPaidLaunch(businessId, "onboarding_retry");
  const state = await getOnboardingStateForBusinessId(businessId);
  if (launch.status === "submitted" || launch.status === "already_submitted") {
    return NextResponse.json({ success: true, state });
  }
  if (launch.status === "in_progress") {
    return NextResponse.json({ success: true, inProgress: true, state });
  }

  const code =
    launch.status === "services_faqs_required"
      ? "services_faqs_required"
      : launch.status === "held_no_ein"
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
