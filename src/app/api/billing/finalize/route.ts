import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/client";
import { syncCheckoutSession } from "@/lib/stripe/subscriptionSync";
import { finalizePaidCheckout } from "@/lib/billing/finalizePaidCheckout.server";
import { getOnboardingStateForBusinessId } from "@/lib/onboarding/state";
import {
  partnerManagedBillingMessage,
  resolveAssignedPartnerName,
} from "@/lib/billing/partnerManagedBilling.server";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import type { BillingMode } from "@/types/database";

type FinalizeBusinessRow = {
  id: string;
  partner_id: string | null;
  billing_mode: BillingMode;
};

export async function POST(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const supabase = await createClient();

  // Resolve the signed-in owner's billing authority before touching Stripe.
  // Partner-managed accounts never retrieve or synchronize a stale Checkout
  // Session, even if one was created before the assignment changed.
  const { data: initialBusiness } = await supabase
    .from("businesses")
    .select("id, partner_id, billing_mode")
    .eq("id", workspace.access.business.id)
    .eq("owner_id", workspace.access.user.id)
    .single<FinalizeBusinessRow>();

  if (!initialBusiness) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 },
    );
  }

  if (initialBusiness.billing_mode !== "stripe") {
    return partnerBillingResponse(initialBusiness.partner_id);
  }

  const { sessionId } = (await request.json().catch(() => ({}))) as {
    sessionId?: string;
  };

  if (!sessionId || !sessionId.startsWith("cs_")) {
    return NextResponse.json(
      { error: "A valid checkout session is required" },
      { status: 400 },
    );
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const businessId = session.metadata?.business_id;

  if (!businessId) {
    return NextResponse.json(
      { error: "Checkout session is missing business metadata" },
      { status: 400 },
    );
  }

  if (businessId !== initialBusiness.id) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 },
    );
  }

  // Re-read after the remote Stripe call. An administrator can assign partner
  // billing while a Checkout Session is outstanding; this closes that stale
  // finalize window before subscription retrieval, local synchronization, or
  // launch. Migration 044's guarded sync RPC remains the final race defense.
  const { data: business } = await supabase
    .from("businesses")
    .select("id, partner_id, billing_mode")
    .eq("id", businessId)
    .eq("owner_id", workspace.access.user.id)
    .single<FinalizeBusinessRow>();

  if (!business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 },
    );
  }

  if (business.billing_mode !== "stripe") {
    return partnerBillingResponse(business.partner_id);
  }

  const synced = await syncCheckoutSession(session);
  if (!synced) {
    return NextResponse.json(
      { error: "Checkout session could not be finalized" },
      { status: 400 },
    );
  }

  const launch = await finalizePaidCheckout(synced, "stripe_finalize");
  const state = await getOnboardingStateForBusinessId(businessId);

  if (
    launch.status === "completed" ||
    launch.status === "submitted" ||
    launch.status === "already_submitted"
  ) {
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
    { status },
  );
}

async function partnerBillingResponse(partnerId: string | null) {
  const partnerName = await resolveAssignedPartnerName(partnerId);
  return NextResponse.json(
    {
      error: "billing_managed_by_partner",
      message: partnerManagedBillingMessage(partnerName),
    },
    { status: 409 },
  );
}
