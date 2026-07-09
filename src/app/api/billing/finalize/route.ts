import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { syncCheckoutSession } from "@/lib/stripe/subscriptionSync";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
  };

  if (!sessionId || !sessionId.startsWith("cs_test_")) {
    return NextResponse.json(
      { error: "A valid test-mode checkout session is required" },
      { status: 400 }
    );
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const businessId = session.metadata?.business_id;

  if (!businessId) {
    return NextResponse.json(
      { error: "Checkout session is missing business metadata" },
      { status: 400 }
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", businessId)
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  const synced = await syncCheckoutSession(session);
  if (!synced) {
    return NextResponse.json(
      { error: "Checkout session could not be finalized" },
      { status: 400 }
    );
  }

  const launch = await attemptPaidLaunch(businessId, "stripe_finalize");
  const state = await getOnboardingStateForBusinessId(businessId);

  if (launch.status === "submitted" || launch.status === "already_submitted") {
    return NextResponse.json({ success: true, state });
  }
  if (launch.status === "in_progress") {
    return NextResponse.json({ success: true, inProgress: true, state });
  }

  const status = launch.status === "billing_required" ? 402 : 400;
  return NextResponse.json(
    {
      error: launch.message,
      code: launch.status,
      state,
    },
    { status }
  );
}
