import { NextResponse } from "next/server";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  type BusinessEntitlements,
  type FeatureKey,
} from "@/lib/billing/entitlements";
import {
  getDashboardBusinessContext,
  getDashboardEntitlements,
} from "@/lib/dashboard/context";

type ServerSupabaseClient = Extract<
  Awaited<ReturnType<typeof getDashboardBusinessContext>>,
  { status: "resolved" }
>["supabase"];

export type AuthenticatedFeatureAccess =
  | {
      ok: true;
      businessId: string;
      entitlements: BusinessEntitlements;
      supabase: ServerSupabaseClient;
    }
  | { ok: false; response: NextResponse };

/**
 * Authenticate the dashboard owner and resolve an authoritative feature
 * decision before any Google token read or provider API call occurs.
 */
export async function requireAuthenticatedFeature(
  feature: FeatureKey
): Promise<AuthenticatedFeatureAccess> {
  const context = await getDashboardBusinessContext();
  if (context.status === "unauthenticated") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  if (context.status === "business_lookup_failed") {
    console.error("[feature-access] Business lookup failed:", context.error);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      ),
    };
  }

  if (context.status === "business_not_found") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      ),
    };
  }

  const { business, supabase } = context;
  try {
    const entitlements = await getDashboardEntitlements(business.id);
    if (!canUseFeature(entitlements, feature)) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: "feature_unavailable",
            feature,
            requiredPlan: requiredPlanForFeature(feature),
          },
          { status: 403 }
        ),
      };
    }

    return {
      ok: true,
      businessId: business.id,
      entitlements,
      supabase,
    };
  } catch (error) {
    if (error instanceof EntitlementResolutionError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "service_unavailable", retryable: true },
          { status: 503 }
        ),
      };
    }
    throw error;
  }
}
