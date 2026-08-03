import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createBillingPortalSession } from "@/lib/stripe/checkout";
import { publicAppOrigin } from "@/lib/billing/publicAppOrigin";
import {
  partnerManagedBillingMessage,
  resolveAssignedPartnerName,
} from "@/lib/billing/partnerManagedBilling.server";
import type { BillingMode } from "@/types/database";

type PortalBusinessRow = {
  id: string;
  partner_id: string | null;
  billing_mode: BillingMode;
};

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: business } = await supabase
      .from("businesses")
      .select("id, partner_id, billing_mode")
      .eq("owner_id", user.id)
      .single<PortalBusinessRow>();

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    if (business.billing_mode !== "stripe") {
      const partnerName = await resolveAssignedPartnerName(business.partner_id);
      return NextResponse.json(
        {
          error: "billing_managed_by_partner",
          message: partnerManagedBillingMessage(partnerName),
        },
        { status: 409 }
      );
    }

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("business_id", business.id)
      .single();

    if (!subscription?.stripe_customer_id) {
      return NextResponse.json(
        { error: "No active subscription found" },
        { status: 400 }
      );
    }

    const origin = publicAppOrigin(request.nextUrl.origin);
    const portalUrl = await createBillingPortalSession(
      subscription.stripe_customer_id,
      `${origin}/billing`
    );

    return NextResponse.json({ url: portalUrl });
  } catch (error) {
    console.error("Portal error:", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
