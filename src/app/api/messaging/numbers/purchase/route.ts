import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { purchaseNumber } from "@/lib/messaging/numbers";
import { ensureCampaignAssignmentForBusiness } from "@/lib/messaging/registration/phoneNumberAssignment";

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
    .select("id")
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

  try {
    const purchased = await purchaseNumber(phoneNumber, business.id);
    console.log(
      `[purchase] Telnyx order for ${purchased.phoneNumber} status=${purchased.status} id=${purchased.phoneNumberId}`
    );

    const { data: record, error: insertError } = await supabase
      .from("phone_numbers")
      .insert({
        business_id: business.id,
        phone_number: purchased.phoneNumber,
        telnyx_phone_number_id: purchased.phoneNumberId,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error saving number:", insertError);
      return NextResponse.json(
        { error: "Number purchased but failed to save" },
        { status: 500 }
      );
    }

    await supabase.from("businesses").update({
      sms_consent_agreed: true,
      sms_consent_agreed_at: new Date().toISOString(),
    }).eq("id", business.id);

    try {
      await ensureCampaignAssignmentForBusiness(business.id, {
        force: true,
        reason: "number_purchase",
      });
    } catch (assignmentError) {
      console.error(
        `[purchase] Number ${purchased.phoneNumber} saved but assignment helper failed:`,
        assignmentError
      );
    }

    return NextResponse.json({ number: record });
  } catch (error) {
    console.error("Error purchasing number:", error);
    return NextResponse.json(
      { error: "Failed to purchase number" },
      { status: 500 }
    );
  }
}
