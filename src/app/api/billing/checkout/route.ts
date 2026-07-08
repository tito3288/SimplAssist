import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { stripePriceIds, stripeSetupFeePriceId } from "@/lib/stripe/config";
import type { SubscriptionPlan } from "@/types/database";

const VALID_PLANS: SubscriptionPlan[] = ["sms_only", "sms_and_chat", "full"];
const VALID_MODES = ["onboarding", "billing"] as const;

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
      .select("id")
      .eq("owner_id", user.id)
      .single();

    if (bizError || !business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
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
