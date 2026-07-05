import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeUsStateCode } from "@/lib/usStates";

function hasFirstAndLastName(value: string): boolean {
  return value.trim().split(/\s+/).length >= 2;
}

const brandVerificationServerSchema = z.object({
  businessId: z.string().uuid(),
  legal_business_name: z.string().min(1),
  business_entity_type: z.enum(["llc", "c_corp", "s_corp", "nonprofit", "partnership"]),
  business_registration_state: z
    .string()
    .min(2)
    .refine((value) => Boolean(normalizeUsStateCode(value))),
  ein: z.string().regex(/^\d{2}-\d{7}$/),
  authorized_rep_name: z
    .string()
    .min(1)
    .refine(
      hasFirstAndLastName,
      "Representative name must include first and last name"
    ),
  authorized_rep_title: z.string().min(1),
  authorized_rep_email: z.string().email(),
  authorized_rep_phone: z.string().min(10),
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

  const parsed = brandVerificationServerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid form data", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const data = parsed.data;
  const registrationStateCode = normalizeUsStateCode(data.business_registration_state);

  if (!registrationStateCode) {
    return NextResponse.json(
      { error: "Invalid state of registration" },
      { status: 400 }
    );
  }

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select("id")
    .eq("id", data.businessId)
    .eq("owner_id", user.id)
    .single();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({
      legal_business_name: data.legal_business_name,
      business_entity_type: data.business_entity_type,
      business_registration_state: registrationStateCode,
      tax_id_type: "ein" as const,
      ein: data.ein,
      authorized_rep_name: data.authorized_rep_name,
      authorized_rep_title: data.authorized_rep_title,
      authorized_rep_email: data.authorized_rep_email,
      authorized_rep_phone: data.authorized_rep_phone,
      onboarding_step: "sms_use_case",
      onboarding_last_saved_at: now,
    })
    .eq("id", data.businessId);

  if (updateError) {
    console.error(
      `[onboarding:brand-verification] Failed to save legal fields for ${data.businessId}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save business verification info" },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
