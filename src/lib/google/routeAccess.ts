import { NextResponse } from "next/server";
import {
  canUseFeature,
  EntitlementResolutionError,
  requiredPlanForFeature,
  resolveBusinessEntitlements,
  type BusinessEntitlements,
  type FeatureKey,
} from "@/lib/billing/entitlements";
import { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (businessError) {
    console.error("[feature-access] Business lookup failed:", businessError);
    return {
      ok: false,
      response: NextResponse.json(
        { error: "service_unavailable", retryable: true },
        { status: 503 }
      ),
    };
  }

  if (!business) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      ),
    };
  }

  try {
    const entitlements = await resolveBusinessEntitlements(business.id);
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
