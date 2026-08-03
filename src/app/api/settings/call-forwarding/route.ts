import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isE164PhoneNumber, normalizeE164Input } from "@/lib/phone/e164";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

const CallForwardingUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  forwardToNumber: z.string().nullable().optional(),
}).refine(
  (data) => data.enabled !== undefined || data.forwardToNumber !== undefined,
  { message: "At least one call forwarding setting is required" }
);

export async function POST(request: NextRequest) {
  const workspaceGate = await requireWorkspaceRouteAccess();
  if (!workspaceGate.ok) return workspaceGate.response;

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

  const hasEnabledUpdate = parsed.data.enabled !== undefined;
  const hasForwardToNumberUpdate = parsed.data.forwardToNumber !== undefined;
  const requestedForwardToNumber = hasForwardToNumberUpdate
    ? normalizeE164Input(parsed.data.forwardToNumber) || null
    : undefined;

  if (
    requestedForwardToNumber &&
    !isE164PhoneNumber(requestedForwardToNumber)
  ) {
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
    .select(
      "id, call_forwarding_enabled, forward_to_number, call_forwarding_nudge_resolved_at"
    )
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    console.error(
      `[settings:call-forwarding] Failed to load business for user ${user.id}:`,
      businessError
    );
    return NextResponse.json(
      { error: "Failed to load call forwarding settings" },
      { status: 500 }
    );
  }

  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  const enabled = hasEnabledUpdate
    ? parsed.data.enabled!
    : business.call_forwarding_enabled;
  const forwardToNumber = hasForwardToNumberUpdate
    ? requestedForwardToNumber!
    : business.forward_to_number;

  if (enabled && !forwardToNumber) {
    return NextResponse.json(
      {
        error: "Forward-to number is required when call forwarding is enabled",
        field: "forwardToNumber",
      },
      { status: 400 }
    );
  }

  const shouldValidateForwardToNumber = Boolean(
    forwardToNumber && (enabled || hasForwardToNumberUpdate)
  );

  if (
    shouldValidateForwardToNumber &&
    forwardToNumber &&
    !isE164PhoneNumber(forwardToNumber)
  ) {
    return NextResponse.json(
      {
        error: "Enter a valid E.164 phone number, like +13175551234",
        field: "forwardToNumber",
      },
      { status: 400 }
    );
  }

  let phoneNumberRow: { phone_number: string } | null = null;
  if (shouldValidateForwardToNumber) {
    const { data, error: phoneNumberError } = await supabaseAdmin
      .from("phone_numbers")
      .select("phone_number")
      .eq("business_id", business.id)
      .eq("is_active", true)
      .maybeSingle();

    if (phoneNumberError) {
      console.error(
        `[settings:call-forwarding] Failed to load active number for business ${business.id}:`,
        phoneNumberError
      );
      return NextResponse.json(
        { error: "Failed to validate call forwarding settings" },
        { status: 500 }
      );
    }

    phoneNumberRow = data;
  }

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

  const settingsUpdate: Record<string, boolean | string | null> = {
    call_forwarding_nudge_resolved_at:
      business.call_forwarding_nudge_resolved_at ?? new Date().toISOString(),
  };
  if (hasEnabledUpdate) {
    settingsUpdate.call_forwarding_enabled = parsed.data.enabled!;
  }
  if (hasForwardToNumberUpdate) {
    settingsUpdate.forward_to_number = requestedForwardToNumber!;
  }

  const { data: updatedBusiness, error: updateError } = await supabaseAdmin
    .from("businesses")
    .update(settingsUpdate)
    .eq("id", business.id)
    .select("call_forwarding_enabled, forward_to_number")
    .single();

  if (updateError || !updatedBusiness) {
    console.error(
      `[settings:call-forwarding] Failed to update for user ${user.id}:`,
      updateError ?? "No updated business returned"
    );
    return NextResponse.json(
      { error: "Failed to save call forwarding settings" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    callForwardingEnabled: updatedBusiness.call_forwarding_enabled,
    forwardToNumber: updatedBusiness.forward_to_number,
  });
}
