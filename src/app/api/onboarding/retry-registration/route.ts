import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

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
    .select("id, compliance_info_completed_at")
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

  const launch = await attemptPaidLaunch(businessId, "onboarding_retry");
  const state = await getOnboardingStateForBusinessId(businessId);
  if (launch.status === "submitted" || launch.status === "already_submitted") {
    return NextResponse.json({ success: true, state });
  }
  if (launch.status === "in_progress") {
    return NextResponse.json({ success: true, inProgress: true, state });
  }

  const code =
    launch.status === "risk_review_required"
      ? "a2p_risk_review_required"
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
