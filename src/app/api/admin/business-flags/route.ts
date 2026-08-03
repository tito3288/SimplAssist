import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/admin/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

const flagsSchema = z.object({
  businessId: z.string().uuid(),
  expectedBillingMode: z.enum(["stripe", "invoiced", "comped"]),
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

  const {
    businessId,
    expectedBillingMode,
    billing_pilot,
    billing_comped,
    billing_exempt,
    telnyx_submission_disabled,
    sms_overage_opt_in,
    billing_admin_notes,
  } = parsed.data;
  const now = new Date().toISOString();
  const updateValues =
    expectedBillingMode === "stripe"
      ? {
          billing_pilot,
          billing_comped,
          billing_exempt,
          telnyx_submission_disabled,
          sms_overage_opt_in,
          billing_admin_notes,
          sms_overage_opted_in_at: sms_overage_opt_in ? now : null,
          sms_overage_opted_in_by: sms_overage_opt_in ? admin.id : null,
          billing_flags_updated_at: now,
          billing_flags_updated_by: admin.id,
        }
      : {
          // Native partner billing owns all entitlement and allowance fields.
          // Ignore their submitted values rather than rejecting the request:
          // an assignment may retain a historical overage opt-in, and that
          // must not prevent unrelated operational controls from being saved.
          telnyx_submission_disabled,
          billing_admin_notes,
          billing_flags_updated_at: now,
          billing_flags_updated_by: admin.id,
        };
  const updateQuery = supabaseAdmin
    .from("businesses")
    .update(updateValues)
    .eq("id", businessId)
    .eq("billing_mode", expectedBillingMode);

  // The expected-mode predicate is evaluated by Postgres as part of the
  // UPDATE. It protects both directions of a concurrent assignment change:
  // a stale Stripe form cannot restore legacy overrides on native partner
  // billing, and a stale partner form cannot alter Stripe-mode flags.

  const { data: updated, error } = await updateQuery.select(
    "id, billing_mode"
  );

  if (error) {
    console.error(`[admin:business-flags] Failed to update ${businessId}:`, error);
    return NextResponse.json(
      { error: "Failed to update business flags" },
      { status: 500 }
    );
  }

  // A valid-UUID businessId matching zero rows must not report success.
  if (!updated || updated.length === 0) {
    const { data: current, error: lookupError } = await supabaseAdmin
      .from("businesses")
      .select("id, billing_mode")
      .eq("id", businessId)
      .maybeSingle<{ id: string; billing_mode: string }>();

    if (lookupError) {
      console.error(
        `[admin:business-flags] Failed to verify ${businessId}:`,
        lookupError
      );
      return NextResponse.json(
        { error: "Failed to update business flags" },
        { status: 500 }
      );
    }
    if (!current) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }
    if (current.billing_mode !== "stripe") {
      return NextResponse.json(
        {
          error: "partner_billing_owns_legacy_flags",
          message:
            "Partner billing owns plan entitlements and SMS allowances for this business.",
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      {
        error: "billing_mode_changed",
        message: "Billing mode changed while flags were being saved. Retry.",
      },
      { status: 409 }
    );
  }

  return NextResponse.json({ success: true });
}
