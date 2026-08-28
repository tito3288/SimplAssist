import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import {
  hasCarrierRejection,
  REJECTION_SUPPORT_MESSAGE,
} from "@/lib/onboarding/rejectionGuidance";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const retrySchema = z.object({
  businessId: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

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

  // The UI exposes support as the only rejection action. Keep the route guard
  // authoritative for stale tabs and direct POSTs, and return current state so
  // callers can immediately render the support-only carrier-review screen.
  if (hasCarrierRejection(business.brand_status, business.campaign_status)) {
    const state = await getOnboardingStateForBusinessId(businessId);
    return NextResponse.json(
      {
        error: REJECTION_SUPPORT_MESSAGE,
        code: "rejection_support_required",
        state,
      },
      { status: 409 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      { error: "Complete brand verification info before retrying registration" },
      { status: 400 }
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
    launch.status === "rejection_support_required"
      ? "rejection_support_required"
      : launch.status === "services_faqs_required"
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
    {
      status:
        code === "billing_required"
          ? 402
          : code === "rejection_support_required"
            ? 409
            : 400,
    }
  );
}
