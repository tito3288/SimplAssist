import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canUseFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { isRicherWebsiteScanEnabledForBusiness } from "./rollout.server";

export const WEBSITE_SCAN_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
} as const;

export function websiteScanJson(
  body: unknown,
  init: { status?: number } = {},
): NextResponse {
  return NextResponse.json(body, {
    ...init,
    headers: WEBSITE_SCAN_NO_STORE_HEADERS,
  });
}

export function markWebsiteScanResponseNoStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", WEBSITE_SCAN_NO_STORE_HEADERS["Cache-Control"]);
  return response;
}

export function websiteScanRolloutDenied(
  businessId: string,
): NextResponse | null {
  return isRicherWebsiteScanEnabledForBusiness(businessId)
    ? null
    : websiteScanJson(
        {
          error: "The richer website scan is not enabled for this workspace yet.",
          code: "website_scan_not_enabled",
        },
        { status: 404 },
      );
}

export async function authorizeWebsiteScanMutation(input: {
  client: SupabaseClient;
  businessId: string;
  ownerId: string;
  trigger?: "onboarding" | "settings";
}): Promise<NextResponse | null> {
  const result = await input.client
    .from("businesses")
    .select("onboarding_completed_at")
    .eq("id", input.businessId)
    .eq("owner_id", input.ownerId)
    .maybeSingle();

  if (result.error) {
    console.error("[website-scan] Business state lookup failed:", result.error);
    return websiteScanJson(
      {
        error: "We couldn't verify website scan access. Please try again.",
        code: "website_scan_access_unavailable",
        retryable: true,
      },
      { status: 503 },
    );
  }
  if (!result.data) {
    return websiteScanJson(
      { error: "Workspace not found.", code: "website_scan_not_accessible" },
      { status: 404 },
    );
  }

  const completed =
    typeof result.data.onboarding_completed_at === "string" &&
    Boolean(result.data.onboarding_completed_at);
  if (input.trigger === "onboarding" && completed) {
    return websiteScanJson(
      {
        error: "Use Assistant Knowledge in Settings to rescan your website.",
        code: "website_scan_trigger_mismatch",
      },
      { status: 409 },
    );
  }
  if (input.trigger === "settings" && !completed) {
    return websiteScanJson(
      {
        error: "Finish onboarding before starting a Settings rescan.",
        code: "website_scan_trigger_mismatch",
      },
      { status: 409 },
    );
  }
  if (!completed) return null;

  try {
    const entitlements = await resolveBusinessEntitlements(input.businessId);
    if (canUseFeature(entitlements, "ai_customization")) return null;
    return websiteScanJson(
      {
        error:
          "Website rescans are available on plans with Assistant Customization.",
        code: "website_scan_plan_required",
      },
      { status: 403 },
    );
  } catch (error) {
    console.error("[website-scan] Entitlement lookup failed:", error);
    return websiteScanJson(
      {
        error: "We couldn't verify plan access. Please try again.",
        code: "website_scan_access_unavailable",
        retryable: true,
      },
      { status: 503 },
    );
  }
}

type RpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export function websiteScanRpcErrorResponse(
  error: RpcError,
): NextResponse {
  const message = `${error.message ?? ""} ${error.details ?? ""}`;
  if (message.includes("website_scan_daily_limit")) {
    return websiteScanJson(
      {
        error: "You can start up to three fresh website scans in 24 hours.",
        code: "website_scan_daily_limit",
      },
      { status: 429 },
    );
  }
  if (message.includes("website_scan_knowledge_floor")) {
    return websiteScanJson(
      {
        error:
          "Keep at least three distinct services and three answered FAQs before publishing.",
        code: "website_scan_knowledge_floor",
      },
      { status: 422 },
    );
  }
  if (message.includes("website_scan_plan_required")) {
    return websiteScanJson(
      {
        error:
          "Website rescans are available on plans with Assistant Customization.",
        code: "website_scan_plan_required",
      },
      { status: 403 },
    );
  }
  if (message.includes("website_scan_purpose_mismatch")) {
    return websiteScanJson(
      {
        error:
          "This scan can no longer be started from the current onboarding state.",
        code: "website_scan_trigger_mismatch",
      },
      { status: 409 },
    );
  }
  if (
    error.code === "40001" ||
    message.includes("stale") ||
    message.includes("website_scan_open_run_exists") ||
    message.includes("website_scan_retry_idempotency_conflict")
  ) {
    return websiteScanJson(
      {
        error:
          "This review changed in another tab or Settings. Refresh before trying again.",
        code: "website_scan_stale",
      },
      { status: 409 },
    );
  }
  if (
    error.code === "42501" ||
    message.includes("not_accessible") ||
    message.includes("inaccessible")
  ) {
    return websiteScanJson(
      { error: "Website scan not found.", code: "website_scan_not_found" },
      { status: 404 },
    );
  }
  if (error.code === "22023" || message.includes("invalid_website_scan")) {
    return websiteScanJson(
      { error: "The website scan request is invalid.", code: "invalid_request" },
      { status: 400 },
    );
  }

  console.error("[website-scan] Database operation failed:", error);
  return websiteScanJson(
    {
      error: "The website scan service is temporarily unavailable.",
      code: "website_scan_unavailable",
      retryable: true,
    },
    { status: 503 },
  );
}

export function websiteScanReadErrorResponse(error: unknown): NextResponse {
  console.error("[website-scan] Read failed:", error);
  return websiteScanJson(
    {
      error: "Website scan progress is temporarily unavailable.",
      code: "website_scan_unavailable",
      retryable: true,
    },
    { status: 503 },
  );
}
