import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";

const widgetConfigMutationSchema = z
  .object({
    brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    position: z.enum(["bottom_right", "bottom_left"]),
    show_logo: z.boolean(),
    logo_url: z.union([z.string().url(), z.literal(""), z.null()]),
    welcome_message: z.string().trim().min(1).max(500),
    lead_capture_enabled: z.boolean(),
    lead_capture_timing: z.enum(["start", "after_3_messages", "on_booking"]),
    quick_replies: z.array(z.string().trim().max(50)).max(3),
    is_active: z.boolean(),
  })
  .strict();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    console.error("Widget mutation business lookup error:", businessError);
    return NextResponse.json(
      { error: "Service temporarily unavailable", retryable: true },
      { status: 503 }
    );
  }
  if (!business) {
    return NextResponse.json({ error: "Business not found" }, { status: 404 });
  }

  try {
    const entitlements = await resolveBusinessEntitlements(business.id);
    if (!canUseFeature(entitlements, "web_chat")) {
      return NextResponse.json(
        {
          error: "feature_unavailable",
          feature: "web_chat",
          requiredPlan: "sms_and_chat",
        },
        { status: 403 }
      );
    }
  } catch (error) {
    if (error instanceof EntitlementResolutionError) {
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503 }
      );
    }
    throw error;
  }

  let payload: z.infer<typeof widgetConfigMutationSchema>;
  try {
    const parsed = widgetConfigMutationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid widget configuration" },
        { status: 400 }
      );
    }
    payload = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { data: widgetConfig, error: updateError } = await supabaseAdmin
    .from("widget_configs")
    .update({
      ...payload,
      logo_url: payload.logo_url || null,
      quick_replies: payload.quick_replies.filter(Boolean),
    })
    .eq("business_id", business.id)
    .select("*")
    .maybeSingle();

  if (updateError) {
    console.error("Widget config update error:", updateError);
    return NextResponse.json(
      { error: "Service temporarily unavailable", retryable: true },
      { status: 503 }
    );
  }
  if (!widgetConfig) {
    return NextResponse.json(
      { error: "Widget configuration not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({ config: widgetConfig });
}

export async function GET(request: NextRequest) {
  try {
    const businessId = request.nextUrl.searchParams.get("businessId");

    if (!businessId) {
      return NextResponse.json(
        { error: "Missing businessId parameter" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: widgetConfig, error: widgetError } = await supabaseAdmin
      .from("widget_configs")
      .select("*")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle();

    if (widgetError) {
      console.error("Widget config lookup error:", widgetError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (!widgetConfig) {
      return NextResponse.json(
        { available: false },
        { headers: corsHeaders }
      );
    }

    try {
      const entitlements = await resolveBusinessEntitlements(businessId);
      if (!canUseFeature(entitlements, "web_chat")) {
        return NextResponse.json(
          { available: false },
          { headers: corsHeaders }
        );
      }
    } catch (error) {
      if (error instanceof EntitlementResolutionError) {
        return NextResponse.json(
          { error: "Service temporarily unavailable", retryable: true },
          { status: 503, headers: corsHeaders }
        );
      }
      throw error;
    }

    const { data: business, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("name")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError) {
      console.error("Widget business lookup error:", businessError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (!business) {
      return NextResponse.json(
        { available: false },
        { headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        available: true,
        businessName: business?.name || "Business",
        brandColor: widgetConfig.brand_color,
        position: widgetConfig.position,
        welcomeMessage: widgetConfig.welcome_message,
        showLogo: widgetConfig.show_logo,
        logoUrl: widgetConfig.logo_url,
        leadCaptureEnabled: widgetConfig.lead_capture_enabled,
        leadCaptureTiming: widgetConfig.lead_capture_timing,
        quickReplies: widgetConfig.quick_replies || [],
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Widget config error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
