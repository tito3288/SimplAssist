import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isE164PhoneNumber, normalizeE164Input } from "@/lib/phone/e164";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const CallForwardingUpdateSchema = z.object({
  enabled: z.boolean(),
  forwardToNumber: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CallForwardingUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const enabled = parsed.data.enabled;
  const forwardToNumber = normalizeE164Input(parsed.data.forwardToNumber);

  if (enabled && !forwardToNumber) {
    return NextResponse.json(
      {
        error: "Forward-to number is required when call forwarding is enabled",
        field: "forwardToNumber",
      },
      { status: 400 }
    );
  }

  if (forwardToNumber && !isE164PhoneNumber(forwardToNumber)) {
    return NextResponse.json(
      {
        error: "Enter a valid E.164 phone number, like +13175551234",
        field: "forwardToNumber",
      },
      { status: 400 }
    );
  }

  const { data: business, error: businessError } = await supabaseAdmin
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (businessError || !business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const { data: phoneNumberRow } = await supabaseAdmin
    .from("phone_numbers")
    .select("phone_number")
    .eq("business_id", business.id)
    .eq("is_active", true)
    .maybeSingle();

  if (
    forwardToNumber &&
    phoneNumberRow?.phone_number &&
    forwardToNumber === phoneNumberRow.phone_number
  ) {
    return NextResponse.json(
      {
        error: "Forward-to number cannot be your SimplAssist number",
        field: "forwardToNumber",
      },
      { status: 400 }
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({
      call_forwarding_enabled: enabled,
      forward_to_number: forwardToNumber || null,
    })
    .eq("id", business.id);

  if (updateError) {
    console.error(
      `[settings:call-forwarding] Failed to update for user ${user.id}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save call forwarding settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    callForwardingEnabled: enabled,
    forwardToNumber: forwardToNumber || null,
  });
}
