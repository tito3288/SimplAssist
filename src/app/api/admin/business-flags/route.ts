import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const flagsSchema = z.object({
  businessId: z.string().uuid(),
  billing_pilot: z.boolean(),
  billing_comped: z.boolean(),
  billing_exempt: z.boolean(),
  telnyx_submission_disabled: z.boolean(),
  sms_overage_opt_in: z.boolean(),
  billing_admin_notes: z.string().max(1000).nullable().optional(),
});

export async function POST(request: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = flagsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid business flags", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { businessId, ...flags } = parsed.data;
  const now = new Date().toISOString();
  const { data: updated, error } = await supabaseAdmin
    .from("businesses")
    .update({
      ...flags,
      sms_overage_opted_in_at: flags.sms_overage_opt_in ? now : null,
      sms_overage_opted_in_by: flags.sms_overage_opt_in ? admin.id : null,
      billing_flags_updated_at: now,
      billing_flags_updated_by: admin.id,
    })
    .eq("id", businessId)
    .select("id");

  if (error) {
    console.error(`[admin:business-flags] Failed to update ${businessId}:`, error);
    return NextResponse.json(
      { error: "Failed to update business flags" },
      { status: 500 }
    );
  }

  // A valid-UUID businessId matching zero rows must not report success.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
