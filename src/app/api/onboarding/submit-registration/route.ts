import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runFullRegistration } from "@/lib/messaging/registration";

const MISSING_NUMBER_MESSAGE =
  "Choose your SimplAssist number before submitting SMS registration.";

const MISSING_COMPLIANCE_MESSAGE =
  "Finish business verification before submitting SMS registration.";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't submit your SMS registration right now. Please try again or contact support.";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at, telnyx_campaign_id")
    .eq("owner_id", user.id)
    .single();

  if (businessError || !business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  if (!business.compliance_info_completed_at) {
    return NextResponse.json(
      { error: MISSING_COMPLIANCE_MESSAGE, code: "missing_compliance_info" },
      { status: 400 }
    );
  }

  const { data: phoneNumberRow, error: phoneNumberError } = await supabase
    .from("phone_numbers")
    .select("id, phone_number")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (phoneNumberError) {
    console.error(
      `[onboarding:submit-registration] Failed to read active number for ${business.id}:`,
      phoneNumberError
    );
    return NextResponse.json(
      { error: "Failed to check your phone number" },
      { status: 500 }
    );
  }

  if (!phoneNumberRow?.phone_number) {
    return NextResponse.json(
      { error: MISSING_NUMBER_MESSAGE, code: "missing_phone_number" },
      { status: 400 }
    );
  }

  if (business.telnyx_campaign_id) {
    return NextResponse.json({ success: true });
  }

  try {
    await runFullRegistration(business.id);
  } catch (err) {
    console.error(
      `[onboarding:submit-registration] Registration failed for ${business.id}:`,
      err
    );
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
