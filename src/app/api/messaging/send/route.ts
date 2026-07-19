import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { telnyx } from "@/lib/messaging/client";
import {
  getOutboundSendContext,
  smsBlockCode,
  smsBlockMessage,
} from "@/lib/messaging/lookup";
import {
  preflightOutboundSms,
  recordOutboundSmsUsage,
} from "@/lib/billing/usage";
import {
  decideFeatureAccess,
  isEntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { to, message, businessId } = await request.json();

    if (!to || !message || !businessId) {
      return NextResponse.json(
        { error: "Missing required fields: to, message, businessId" },
        { status: 400 }
      );
    }

    const { data: business, error: businessLookupError } = await supabase
      .from("businesses")
      .select("id")
      .eq("id", businessId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (businessLookupError) {
      console.error(
        "[messaging/send] Business authorization lookup failed:",
        businessLookupError
      );
      return NextResponse.json(
        { error: "Unable to verify business access", retryable: true },
        { status: 503 }
      );
    }

    if (!business) {
      return NextResponse.json(
        { error: "Business not found or unauthorized" },
        { status: 403 }
      );
    }

    let entitlements;
    try {
      entitlements = await resolveBusinessEntitlements(businessId);
    } catch (error) {
      if (isEntitlementResolutionError(error)) {
        console.error("[messaging/send] Entitlement lookup failed:", error);
        return NextResponse.json(
          { error: "Unable to verify plan access", retryable: true },
          { status: 503 }
        );
      }
      throw error;
    }

    const access = decideFeatureAccess(entitlements, "manual_sms");
    if (!access.allowed) {
      return NextResponse.json(
        { error: "SMS sending is not available on the current plan" },
        { status: 403 }
      );
    }

    const { data: phoneNumberRow, error: phoneLookupError } = await supabase
      .from("phone_numbers")
      .select("phone_number")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle();

    if (phoneLookupError) {
      console.error(
        "[messaging/send] Active phone number lookup failed:",
        phoneLookupError
      );
      return NextResponse.json(
        { error: "Unable to verify the sending number", retryable: true },
        { status: 503 }
      );
    }

    if (!phoneNumberRow) {
      return NextResponse.json(
        { error: "No active phone number found for this business" },
        { status: 404 }
      );
    }

    const sendContext = await getOutboundSendContext(
      phoneNumberRow.phone_number
    );

    if (!sendContext.smsReady) {
      return NextResponse.json(
        {
          error: smsBlockCode(sendContext.blockReason),
          message: smsBlockMessage(sendContext.blockReason),
          assignmentStatus: sendContext.assignmentStatus,
          assignmentFailureReason: sendContext.assignmentFailureReason,
        },
        { status: 403 }
      );
    }

    if (!sendContext.messagingProfileId) {
      return NextResponse.json(
        { error: "Messaging profile not configured for this business" },
        { status: 500 }
      );
    }

    const usage = await preflightOutboundSms({ businessId, text: message });
    if (!usage.allowed) {
      return NextResponse.json(
        { error: usage.reason, message: usage.message },
        { status: 403 }
      );
    }

    const result = await telnyx.messages.send({
      to,
      from: phoneNumberRow.phone_number,
      text: message,
      messaging_profile_id: sendContext.messagingProfileId,
      type: "SMS",
    });

    await recordOutboundSmsUsage({
      businessId,
      text: message,
      source: "manual_dashboard_send",
      providerMessageId: result.data?.id ?? null,
      idempotencyKey: result.data?.id
        ? `outbound:manual:${result.data.id}`
        : undefined,
      metadata: { to, from: phoneNumberRow.phone_number },
    });

    return NextResponse.json({ success: true, id: result.data?.id });
  } catch (error) {
    console.error("Error sending SMS:", error);
    return NextResponse.json(
      { error: "Failed to send SMS" },
      { status: 500 }
    );
  }
}
