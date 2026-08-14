import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isNanpTollFreeNumber } from "@/lib/messaging/numbers";
import { getA2pRiskClearanceForBusiness } from "@/lib/messaging/registration/riskScreening";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

const CANONICAL_US_E164_PATTERN = /^\+1\d{10}$/;

export async function POST(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        error: "Phone number must be in +1 followed by 10 digits format",
        code: "invalid_phone_number",
      },
      { status: 400 }
    );
  }

  const phoneNumber =
    typeof requestBody === "object" && requestBody !== null
      ? (requestBody as { phoneNumber?: unknown }).phoneNumber
      : undefined;

  if (typeof phoneNumber !== "string" || phoneNumber.length === 0) {
    return NextResponse.json(
      { error: "Phone number is required", code: "invalid_phone_number" },
      { status: 400 }
    );
  }

  if (!CANONICAL_US_E164_PATTERN.test(phoneNumber)) {
    return NextResponse.json(
      {
        error: "Phone number must be in +1 followed by 10 digits format",
        code: "invalid_phone_number",
      },
      { status: 400 }
    );
  }

  if (isNanpTollFreeNumber(phoneNumber)) {
    return NextResponse.json(
      {
        error:
          "Toll-free numbers are not supported for 10DLC registration. Choose a local U.S. number.",
        code: "toll_free_not_supported",
      },
      { status: 400 }
    );
  }

  const { data: business, error: bizError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at")
    .eq("owner_id", user.id)
    .single();

  if (bizError || !business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      {
        error:
          "Finish business verification before choosing your SimplAssist number",
      },
      { status: 400 }
    );
  }

  const riskClearance = await getA2pRiskClearanceForBusiness(business.id);
  if (!riskClearance.cleared) {
    return NextResponse.json(
      {
        error: riskClearance.message,
        code: "a2p_risk_review_required",
        riskReview: riskClearance,
      },
      { status: 400 }
    );
  }

  try {
    const { data: existingNumber, error: existingNumberError } = await supabase
      .from("phone_numbers")
      .select("*")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (existingNumberError) {
      console.error("Error checking existing number:", existingNumberError);
      return NextResponse.json(
        { error: "Failed to check existing phone number" },
        { status: 500 }
      );
    }

    if (existingNumber) {
      const now = new Date().toISOString();
      await supabase
        .from("businesses")
        .update({
          sms_consent_agreed: true,
          sms_consent_agreed_at: now,
          pending_phone_number: null,
          pending_phone_number_area_code: null,
          pending_phone_number_selected_at: null,
          pending_phone_number_failure_reason: null,
          onboarding_step: "review_submit",
          onboarding_last_saved_at: now,
        })
        .eq("id", business.id);

      return NextResponse.json({ number: existingNumber });
    }

    const now = new Date().toISOString();
    const areaCode = phoneNumber.slice(2, 5);
    const { data: record, error: updateError } = await supabase
      .from("businesses")
      .update({
        sms_consent_agreed: true,
        sms_consent_agreed_at: now,
        pending_phone_number: phoneNumber,
        pending_phone_number_area_code: areaCode,
        pending_phone_number_selected_at: now,
        pending_phone_number_failure_reason: null,
        onboarding_step: "review_submit",
        onboarding_last_saved_at: now,
      })
      .eq("id", business.id)
      .select("pending_phone_number")
      .single();

    if (updateError || !record?.pending_phone_number) {
      console.error("Error saving selected number:", updateError);
      return NextResponse.json(
        { error: "Failed to save selected number" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      number: { phone_number: record.pending_phone_number, pending: true },
    });
  } catch (error) {
    console.error("Error selecting number:", error);
    return NextResponse.json(
      { error: "Failed to select number" },
      { status: 500 }
    );
  }
}
