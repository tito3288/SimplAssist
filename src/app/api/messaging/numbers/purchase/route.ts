import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getA2pRiskClearanceForBusiness } from "@/lib/messaging/registration/riskScreening";

export async function POST(request: NextRequest) {
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
    .select("id, compliance_info_completed_at")
    .eq("owner_id", user.id)
    .single();

  if (bizError || !business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  const { phoneNumber } = await request.json();

  if (!phoneNumber) {
    return NextResponse.json(
      { error: "Phone number is required" },
      { status: 400 }
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
    const areaCode = phoneNumber.replace(/^\+?1?/, "").slice(0, 3);
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
