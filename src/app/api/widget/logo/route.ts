import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"];

export async function POST(request: NextRequest) {
  const workspace = await requireWorkspaceRouteAccess();
  if (!workspace.ok) return workspace.response;

  const { business } = workspace.access;

  try {
    const entitlements = await resolveBusinessEntitlements(business.id);
    if (!canUseFeature(entitlements, "widget_branding")) {
      return NextResponse.json(
        {
          error: "feature_unavailable",
          feature: "widget_branding",
          requiredPlan: requiredPlanForFeature("widget_branding"),
        },
        { status: 403 }
      );
    }
  } catch (error) {
    if (error instanceof EntitlementResolutionError) {
      return NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      );
    }
    throw error;
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: "Invalid file type. Use PNG, JPG, SVG, or WEBP." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "File too large. Max 2MB." },
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop() || "png";
    const filePath = `${business.id}/logo.${ext}`;

    // Upload to Supabase Storage (overwrite if exists)
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage
      .from("widget-logos")
      .upload(filePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("[logo-upload] Upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to upload logo" },
        { status: 500 }
      );
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from("widget-logos")
      .getPublicUrl(filePath);

    const publicUrl = urlData.publicUrl;

    // Update widget config with the logo URL
    const { error: configError } = await supabaseAdmin
      .from("widget_configs")
      .update({ logo_url: publicUrl })
      .eq("business_id", business.id);

    if (configError) {
      console.error("[logo-upload] Config update error:", configError);
      return NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      );
    }

    return NextResponse.json({ url: publicUrl });
  } catch (error) {
    console.error("[logo-upload] Error:", error);
    return NextResponse.json(
      { error: "Upload failed" },
      { status: 500 }
    );
  }
}
