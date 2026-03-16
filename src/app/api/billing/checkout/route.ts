import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/stripe/checkout";
import { STRIPE_PRICE_IDS } from "@/lib/stripe/config";
import type { SubscriptionPlan } from "@/types/database";

const VALID_PLANS: SubscriptionPlan[] = ["sms_only", "sms_and_chat", "full"];

export async function POST(request: NextRequest) {
  try {
    const { plan } = await request.json();

    if (!VALID_PLANS.includes(plan)) {
      return NextResponse.json(
        { error: "Invalid plan. Must be one of: sms_only, sms_and_chat, full" },
        { status: 400 }
      );
    }

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

    const priceId = STRIPE_PRICE_IDS[plan as SubscriptionPlan];
    const origin = request.nextUrl.origin;

    const checkoutUrl = await createCheckoutSession(
      business.id,
      priceId,
      `${origin}/billing?success=true`,
      `${origin}/billing?canceled=true`
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
