import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runFullRegistration } from "@/lib/messaging/registration";

const REGISTRATION_FAILURE_MESSAGE =
  "Couldn't register your business with carriers right now. Please try again or contact support.";

const brandVerificationServerSchema = z.object({
  businessId: z.string().uuid(),
  legal_business_name: z.string().min(1),
  business_entity_type: z.enum(["llc", "c_corp", "s_corp", "nonprofit", "partnership"]),
  business_registration_state: z.string().min(2),
  ein: z.string().regex(/^\d{2}-\d{7}$/),
  authorized_rep_name: z.string().min(1),
  authorized_rep_title: z.string().min(1),
  authorized_rep_email: z.string().email(),
  authorized_rep_phone: z.string().min(10),
  use_case_description: z.string().min(40),
  estimated_monthly_volume: z.enum(["under_1k", "1k_10k", "10k_100k", "over_100k"]),
  sample_messages: z.array(z.string().min(1)).min(3).max(5),
  opt_in_description: z.string().min(40),
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

  const { data: business, error: ownershipError } = await supabase
    .from("businesses")
    .select("id, compliance_info_completed_at")
    .eq("id", data.businessId)
    .eq("owner_id", user.id)
    .single();

  if (ownershipError || !business) {
    return NextResponse.json(
      { error: "Business not found or unauthorized" },
      { status: 403 }
    );
  }

  const setOnceTimestamp = business.compliance_info_completed_at
    ? {}
    : { compliance_info_completed_at: new Date().toISOString() };

  const { error: updateError } = await supabaseAdmin
    .from("businesses")
    .update({
      legal_business_name: data.legal_business_name,
      business_entity_type: data.business_entity_type,
      business_registration_state: data.business_registration_state,
      tax_id_type: "ein",
      ein: data.ein,
      authorized_rep_name: data.authorized_rep_name,
      authorized_rep_title: data.authorized_rep_title,
      authorized_rep_email: data.authorized_rep_email,
      authorized_rep_phone: data.authorized_rep_phone,
      use_case_description: data.use_case_description,
      estimated_monthly_volume: data.estimated_monthly_volume,
      sample_messages: data.sample_messages,
      opt_in_description: data.opt_in_description,
      ...setOnceTimestamp,
    })
    .eq("id", data.businessId);

  if (updateError) {
    console.error(
      `[onboarding:brand-verification] Failed to persist compliance fields for ${data.businessId}:`,
      updateError
    );
    return NextResponse.json(
      { error: "Failed to save brand verification info" },
      { status: 500 }
    );
  }

  try {
    await runFullRegistration(data.businessId);
  } catch (err) {
    console.error(
      `[onboarding:brand-verification] Registration failed for ${data.businessId}:`,
      err
    );
    return NextResponse.json(
      { error: REGISTRATION_FAILURE_MESSAGE },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
