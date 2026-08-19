import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { resolvePublicWidgetAccess } from "@/lib/widget/access.server";
import { acquireWidgetIngressTraffic } from "@/lib/widget/ingressTraffic.server";
import {
  isSameOriginWidgetPreview,
  normalizeWidgetOrigin,
} from "@/lib/widget/origin.server";
import {
  parseExactWidgetQuery,
  parseWidgetJson,
  widgetEndRequestSchema,
  widgetErrorResponse,
  widgetOptionsResponse,
} from "@/lib/widget/request.server";
import {
  readWidgetBearerToken,
  verifyWidgetToken,
} from "@/lib/widget/token.server";
import {
  acquireWidgetTraffic,
  deriveWidgetNetworkKey,
  deriveWidgetRequestKey,
} from "@/lib/widget/traffic.server";

export async function OPTIONS(request: NextRequest) {
  const query = parseExactWidgetQuery(request);
  const origin = normalizeWidgetOrigin(request.headers.get("origin"));
  if (!query.ok || !origin) return widgetErrorResponse("invalid_request", 400);
  return widgetOptionsResponse(origin.origin, "POST");
}

export async function POST(request: NextRequest) {
  try {
    const query = parseExactWidgetQuery(request);
    const parsedBody = await parseWidgetJson(request, widgetEndRequestSchema);
    const origin = normalizeWidgetOrigin(request.headers.get("origin"));
    if (!query.ok || !parsedBody.ok || !origin) {
      return widgetErrorResponse("invalid_request", 400);
    }
    const { businessId, sessionId, sessionNonce, preview } = parsedBody.data;
    if (
      query.data.businessId !== businessId ||
      query.data.sessionId !== sessionId
    ) {
      return widgetErrorResponse("invalid_request", 400);
    }

    let networkKey: string;
    try {
      networkKey = deriveWidgetNetworkKey(request);
      const ingress = await acquireWidgetIngressTraffic({
        endpoint: "end",
        networkKey,
      });
      if (ingress.status === "unavailable") {
        return widgetErrorResponse("service_unavailable", 503);
      }
      if (ingress.status === "rate_limited") {
        return widgetErrorResponse("rate_limited", 429, {
          retryAfterSeconds: ingress.retryAfterSeconds,
        });
      }
    } catch (error) {
      console.error("Widget end ingress control failed:", error);
      return widgetErrorResponse("service_unavailable", 503);
    }

    const verifiedPreview = preview === true;
    if (verifiedPreview) {
      if (!isSameOriginWidgetPreview(request, origin)) {
        return widgetErrorResponse("origin_not_allowed", 403);
      }
      const workspace = await requireWorkspaceRouteAccess();
      if (!workspace.ok) {
        if (workspace.response.status === 503) {
          return widgetErrorResponse("service_unavailable", 503, {
            origin: origin.origin,
          });
        }
        if (workspace.response.status === 403) {
          return widgetErrorResponse("origin_not_allowed", 403, {
            origin: origin.origin,
          });
        }
        return widgetErrorResponse("unauthorized", 401, {
          origin: origin.origin,
        });
      }
      if (workspace.access.business.id !== businessId) {
        return widgetErrorResponse("origin_not_allowed", 403, {
          origin: origin.origin,
        });
      }
    } else {
      if (!sessionNonce) return widgetErrorResponse("unauthorized", 401);
      const bearerToken = readWidgetBearerToken(request);
      if (!bearerToken) return widgetErrorResponse("unauthorized", 401);
      try {
        if (
          !verifyWidgetToken(bearerToken, {
            businessId,
            origin: origin.origin,
            sessionId,
            sessionNonce,
          })
        ) {
          return widgetErrorResponse("unauthorized", 401);
        }
      } catch (error) {
        console.error("Widget end token verification failed:", error);
        return widgetErrorResponse("service_unavailable", 503);
      }
    }

    let traffic;
    try {
      const trafficEndpoint = verifiedPreview ? "preview_end" : "end";
      traffic = await acquireWidgetTraffic({
        businessId,
        originHostname: origin.hostname,
        sessionId,
        endpoint: trafficEndpoint,
        networkKey,
        requestKey: deriveWidgetRequestKey({
          businessId,
          sessionId,
          endpoint: trafficEndpoint,
        }),
      });
    } catch (error) {
      console.error("Widget end traffic control failed:", error);
      return widgetErrorResponse("service_unavailable", 503, {
        origin: origin.origin,
      });
    }
    if (traffic.status === "unavailable") {
      return widgetErrorResponse("service_unavailable", 503, {
        origin: origin.origin,
      });
    }
    if (traffic.status === "origin_not_allowed") {
      return widgetErrorResponse("origin_not_allowed", 403, {
        origin: verifiedPreview ? origin.origin : undefined,
      });
    }
    if (traffic.status === "widget_inactive") {
      return publicJson({ success: true, available: false }, origin.origin);
    }
    if (traffic.status !== "allowed") {
      return widgetErrorResponse("rate_limited", 429, {
        origin: origin.origin,
        retryAfterSeconds: traffic.retryAfterSeconds,
      });
    }

    if (verifiedPreview) {
      const previewAvailability = await resolvePreviewWidget(businessId);
      if (previewAvailability === "unavailable") {
        return widgetErrorResponse("service_unavailable", 503, {
          origin: origin.origin,
        });
      }
      if (previewAvailability === "missing") {
        return widgetErrorResponse("origin_not_allowed", 403, {
          origin: origin.origin,
        });
      }
    } else {
      const access = await resolvePublicWidgetAccess(businessId, origin);
      if (access.status === "unavailable") {
        return widgetErrorResponse("service_unavailable", 503);
      }
      if (access.status === "forbidden") {
        return widgetErrorResponse("origin_not_allowed", 403);
      }
      if (!access.config.is_active) {
        return publicJson({ success: true, available: false }, origin.origin);
      }
    }

    try {
      const entitlements = await resolveBusinessEntitlements(businessId);
      if (!canUseFeature(entitlements, "web_chat")) {
        return NextResponse.json(
          { success: true, available: false },
          { headers: publicHeaders(origin.origin) },
        );
      }
    } catch (error) {
      if (error instanceof EntitlementResolutionError) {
        return widgetErrorResponse("service_unavailable", 503, {
          origin: origin.origin,
        });
      }
      throw error;
    }

    // Find contact by session_id
    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("business_id", businessId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (contactError) {
      console.error("Widget end contact lookup error:", contactError);
      return widgetErrorResponse("service_unavailable", 503, {
        origin: origin.origin,
      });
    }

    if (!contact) {
      return NextResponse.json(
        { success: true, available: true },
        { headers: publicHeaders(origin.origin) },
      );
    }

    // Find active conversation for this contact
    const { data: conversation, error: conversationError } = await supabaseAdmin
      .from("conversations")
      .select("id")
      .eq("business_id", businessId)
      .eq("contact_id", contact.id)
      .eq("status", "active")
      .maybeSingle();

    if (conversationError) {
      console.error("Widget end conversation lookup error:", conversationError);
      return widgetErrorResponse("service_unavailable", 503, {
        origin: origin.origin,
      });
    }

    if (conversation) {
      const { error: closeError } = await supabaseAdmin
        .from("conversations")
        .update({ status: "closed" })
        .eq("id", conversation.id);

      if (closeError) {
        console.error("Widget end close error:", closeError);
        return widgetErrorResponse("service_unavailable", 503, {
          origin: origin.origin,
        });
      }
    }

    return NextResponse.json(
      { success: true, available: true },
      { headers: publicHeaders(origin.origin) },
    );
  } catch (error) {
    console.error("Widget end conversation error:", error);
    return widgetErrorResponse("service_unavailable", 503);
  }
}

async function resolvePreviewWidget(
  businessId: string,
): Promise<"available" | "missing" | "unavailable"> {
  const { data, error } = await supabaseAdmin
    .from("widget_configs")
    .select("id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) {
    console.error("Widget end preview config lookup error:", error);
    return "unavailable";
  }
  return data ? "available" : "missing";
}

function publicHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function publicJson(body: unknown, origin: string): NextResponse {
  return NextResponse.json(body, { headers: publicHeaders(origin) });
}
