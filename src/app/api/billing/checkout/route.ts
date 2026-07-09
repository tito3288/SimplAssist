import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attemptPaidLaunch } from "@/lib/billing/launch";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { stripePriceIds, stripeSetupFeePriceId } from "@/lib/stripe/config";
import type { SubscriptionPlan } from "@/types/database";

const VALID_PLANS: SubscriptionPlan[] = ["sms_only", "sms_and_chat", "full"];
const VALID_MODES = ["onboarding", "billing"] as const;
const NO_EIN_HELD_MESSAGE =
  "Add your EIN before choosing a paid SMS plan.";

type CheckoutBusinessRow = {
  id: string;
  has_ein: boolean | null;
  billing_pilot: boolean;
  billing_comped: boolean;
  billing_exempt: boolean;
};

type CheckoutSubscriptionRow = {
  status: string;
  setup_fee_paid_at: string | null;
};

export async function POST(request: NextRequest) {
  try {
    const { plan, mode: requestedMode } = await request.json();

    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json(
        { error: "Invalid plan. Must be one of: sms_only, sms_and_chat, full" },
        { status: 400 }
      );
    }

    const mode = VALID_MODES.includes(requestedMode) ? requestedMode : "billing";

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: business, error: bizError } = await supabase
      .from("businesses")
      .select("id, has_ein, billing_pilot, billing_comped, billing_exempt")
      .eq("owner_id", user.id)
      .single<CheckoutBusinessRow>();

    if (bizError || !business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    if (business.has_ein !== true) {
      const state = await getOnboardingStateForBusinessId(business.id);
      return NextResponse.json(
        {
          error: NO_EIN_HELD_MESSAGE,
          code: "held_no_ein",
          state,
        },
        { status: 400 }
      );
    }

    if (
      mode === "onboarding" &&
      (await hasSatisfiedOnboardingBilling(supabase, business))
    ) {
      const launch = await attemptPaidLaunch(business.id, "onboarding_retry");
      if (launch.status !== "billing_required") {
        const state = await getOnboardingStateForBusinessId(business.id);
        if (
          launch.status === "submitted" ||
          launch.status === "already_submitted"
        ) {
          return NextResponse.json({ success: true, state });
        }
        if (launch.status === "in_progress") {
          return NextResponse.json({ success: true, inProgress: true, state });
        }

        return NextResponse.json(
          {
            error: launch.message,
            code: launch.status,
            state,
          },
          { status: 400 }
        );
      }
    }

    const priceId = stripePriceIds()[plan as SubscriptionPlan];
    const setupFeePriceId = stripeSetupFeePriceId();
    const origin = request.nextUrl.origin;
    const successPath =
      mode === "onboarding"
        ? "/onboarding?checkout=success&session_id={CHECKOUT_SESSION_ID}"
        : "/billing?success=true&session_id={CHECKOUT_SESSION_ID}";
    const cancelPath =
      mode === "onboarding"
        ? "/onboarding?checkout=canceled"
        : "/billing?canceled=true";

    const checkoutUrl = await createCheckoutSession(
      business.id,
      plan as SubscriptionPlan,
      priceId,
      setupFeePriceId,
      `${origin}${successPath}`,
      `${origin}${cancelPath}`,
      mode
    );

    return NextResponse.json({ url: checkoutUrl });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}

async function hasSatisfiedOnboardingBilling(
  supabase: Awaited<ReturnType<typeof createClient>>,
  business: CheckoutBusinessRow
): Promise<boolean> {
  if (business.billing_pilot || business.billing_comped || business.billing_exempt) {
    return true;
  }

  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, setup_fee_paid_at")
    .eq("business_id", business.id)
    .maybeSingle<CheckoutSubscriptionRow>();

  if (error) {
    throw error;
  }

  if (!data || !data.setup_fee_paid_at) {
    return false;
  }

  return data.status !== "past_due" && data.status !== "canceled";
}
