import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { releaseNumber } from "@/lib/twilio/client";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { numberId } = await request.json();

  if (!numberId) {
    return NextResponse.json(
      { error: "Number ID is required" },
      { status: 400 }
    );
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) {
    return NextResponse.json(
      { error: "Business not found" },
      { status: 404 }
    );
  }

  const { data: twilioNumber, error: lookupError } = await supabase
    .from("twilio_numbers")
    .select("*")
    .eq("id", numberId)
    .eq("business_id", business.id)
    .single();

  if (lookupError || !twilioNumber) {
    return NextResponse.json(
      { error: "Number not found" },
      { status: 404 }
    );
  }

  try {
    await releaseNumber(twilioNumber.twilio_sid);

    await supabase.from("twilio_numbers").delete().eq("id", numberId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error releasing number:", error);
    return NextResponse.json(
      { error: "Failed to release number" },
      { status: 500 }
    );
  }
}
