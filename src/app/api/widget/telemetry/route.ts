import { NextRequest, NextResponse } from "next/server";
import {
  resolveBusinessOperationalControls,
  resolveOperationalBlockReason,
} from "@/lib/account/operationalControls.server";
import {
  canUseFeature,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { resolvePublicWidgetAccess } from "@/lib/widget/access.server";
import { requireWidgetEdgeOrigin } from "@/lib/widget/edgeOrigin.server";
import { acquireWidgetIngressTraffic } from "@/lib/widget/ingressTraffic.server";
import { normalizeWidgetOrigin } from "@/lib/widget/origin.server";
import { arePublicWidgetProactiveInvitationsEnabledForBusiness } from "@/lib/widget/proactiveInvitations.server";
import {
  parseExactWidgetQuery,
  parseWidgetJson,
  widgetErrorResponse,
  widgetOptionsResponse,
  widgetTelemetryRequestSchema,
} from "@/lib/widget/request.server";
import { recordWidgetEngagementEvent } from "@/lib/widget/telemetry.server";
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
  const edgeRejection = requireWidgetEdgeOrigin(request);
  if (edgeRejection) return edgeRejection;

  const query = parseExactWidgetQuery(request);
  const origin = normalizeWidgetOrigin(request.headers.get("origin"));
  if (!query.ok || !origin) return widgetErrorResponse("invalid_request", 400);
  return widgetOptionsResponse(origin.origin, "POST");
}

export async function POST(request: NextRequest) {
  let responseOrigin: string | undefined;
  try {
    const edgeRejection = requireWidgetEdgeOrigin(request);
    if (edgeRejection) return edgeRejection;

    const query = parseExactWidgetQuery(request);
    const body = await parseWidgetJson(request, widgetTelemetryRequestSchema);
    const origin = normalizeWidgetOrigin(request.headers.get("origin"));
    if (!query.ok || !body.ok || !origin) {
      return widgetErrorResponse("invalid_request", 400);
    }
    responseOrigin = origin.origin;
    if (
      query.data.businessId !== body.data.businessId ||
      query.data.sessionId !== body.data.sessionId
    ) {
      return widgetErrorResponse("invalid_request", 400);
    }

    let networkKey: string;
    try {
      networkKey = deriveWidgetNetworkKey(request);
      const ingress = await acquireWidgetIngressTraffic({
        endpoint: "telemetry",
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
      console.error("Widget telemetry ingress control failed:", error);
      return widgetErrorResponse("service_unavailable", 503);
    }

    const bearer = readWidgetBearerToken(request);
    if (!bearer) return widgetErrorResponse("unauthorized", 401);
    try {
      if (
        !verifyWidgetToken(bearer, {
          businessId: body.data.businessId,
          origin: origin.origin,
          sessionId: body.data.sessionId,
          sessionNonce: body.data.sessionNonce,
        })
      ) {
        return widgetErrorResponse("unauthorized", 401);
      }
    } catch (error) {
      console.error("Widget telemetry token verification failed:", error);
      return widgetErrorResponse("service_unavailable", 503);
    }

    let traffic;
    try {
      traffic = await acquireWidgetTraffic({
        businessId: body.data.businessId,
        originHostname: origin.hostname,
        sessionId: body.data.sessionId,
        endpoint: "telemetry",
        networkKey,
        requestKey: deriveWidgetRequestKey({
          businessId: body.data.businessId,
          sessionId: body.data.sessionId,
          endpoint: "telemetry",
        }),
      });
    } catch (error) {
      console.error("Widget telemetry traffic control failed:", error);
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
      return widgetErrorResponse("origin_not_allowed", 403);
    }
    if (traffic.status === "widget_inactive") {
      return widgetErrorResponse("origin_not_allowed", 403, {
        origin: origin.origin,
      });
    }
    if (traffic.status !== "allowed") {
      return widgetErrorResponse("rate_limited", 429, {
        origin: origin.origin,
        retryAfterSeconds: traffic.retryAfterSeconds,
      });
    }

    const access = await resolvePublicWidgetAccess(
      body.data.businessId,
      origin,
    );
    if (access.status === "unavailable") {
      return widgetErrorResponse("service_unavailable", 503, {
        origin: origin.origin,
      });
    }
    if (access.status === "forbidden" || !access.config.is_active) {
      return widgetErrorResponse("origin_not_allowed", 403, {
        origin: origin.origin,
      });
    }
    const proactiveSource =
      body.data.source === "proactive_timer" ||
      body.data.source === "proactive_scroll";
    if (
      proactiveSource &&
      (access.config.proactive_invitation_enabled !== true ||
        !arePublicWidgetProactiveInvitationsEnabledForBusiness(
          body.data.businessId,
        ))
    ) {
      return widgetErrorResponse("origin_not_allowed", 403, {
        origin: origin.origin,
      });
    }

    const [entitlements, controls] = await Promise.all([
      resolveBusinessEntitlements(body.data.businessId),
      resolveBusinessOperationalControls(body.data.businessId),
    ]);
    if (
      !canUseFeature(entitlements, "web_chat") ||
      resolveOperationalBlockReason(controls, ["ai_replies"]) !== null
    ) {
      return widgetErrorResponse("origin_not_allowed", 403, {
        origin: origin.origin,
      });
    }

    await recordWidgetEngagementEvent({
      businessId: body.data.businessId,
      sessionId: body.data.sessionId,
      eventType: body.data.eventType,
      source: body.data.source,
      deviceBucket: body.data.deviceBucket,
      promptVersion: body.data.promptVersion,
    });

    return NextResponse.json(
      { success: true },
      { headers: publicHeaders(origin.origin) },
    );
  } catch (error) {
    console.error("Widget engagement telemetry error:", error);
    return widgetErrorResponse("service_unavailable", 503, {
      origin: responseOrigin,
    });
  }
}

function publicHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}
