import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  AIProcessingBlockedError,
  AIProcessingIdempotencyConflictError,
  AIProcessingInProgressError,
  AIProcessingStateError,
  AIReplyLimitReachedError,
  processIncomingMessageDetailed,
} from "@/lib/ai/engine";
import { finalizeGoalLinkEvent } from "@/lib/ai/goalEvents";
import { recordKnowledgeGap } from "@/lib/ai/knowledgeGaps";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import {
  OperationalControlsResolutionError,
  resolveBusinessOperationalControls,
  resolveOperationalBlockReason,
} from "@/lib/account/operationalControls.server";
import {
  buildAiConversationSourceKey,
  buildWebChatSessionSourceKey,
} from "@/lib/metrics/sourceKeys.server";
import { recordBusinessMetricEventBestEffort } from "@/lib/metrics/recording.server";
import { requireWorkspaceRouteAccess } from "@/lib/customer/workspaceRouteResponse.server";
import { resolvePublicWidgetAccess } from "@/lib/widget/access.server";
import { buildWidgetChatRequestFingerprint } from "@/lib/widget/idempotency.server";
import { acquireWidgetIngressTraffic } from "@/lib/widget/ingressTraffic.server";
import {
  isSameOriginWidgetPreview,
  normalizeWidgetOrigin,
} from "@/lib/widget/origin.server";
import {
  parseExactWidgetQuery,
  parseWidgetJson,
  widgetChatRequestSchema,
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
  releaseWidgetTraffic,
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
    const parsedBody = await parseWidgetJson(request, widgetChatRequestSchema);
    const origin = normalizeWidgetOrigin(request.headers.get("origin"));
    if (!query.ok || !parsedBody.ok || !origin) {
      return widgetErrorResponse("invalid_request", 400);
    }
    const body = parsedBody.data;
    const {
      businessId,
      message,
      sessionId,
      visitorEmail,
      visitorName,
      preview,
      clientMessageId,
      sessionNonce,
    } = body;
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
        endpoint: "chat",
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
      console.error("Widget chat ingress control failed:", error);
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
      if (!sessionNonce) {
        return widgetErrorResponse("unauthorized", 401);
      }
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
        console.error("Widget token verification failed:", error);
        return widgetErrorResponse("service_unavailable", 503);
      }
    }

    let traffic;
    try {
      const trafficEndpoint = verifiedPreview ? "preview_chat" : "chat";
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
          clientMessageId,
        }),
      });
    } catch (error) {
      console.error("Widget chat traffic control failed:", error);
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
      return unavailableChatResponse(origin.origin);
    }
    if (traffic.status !== "allowed") {
      return widgetErrorResponse("rate_limited", 429, {
        origin: origin.origin,
        retryAfterSeconds: traffic.retryAfterSeconds,
      });
    }

    try {
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
          return unavailableChatResponse(origin.origin);
        }
      }

      // Live web chat must reach the engine's exact completed-reply recovery
      // before any mutable billing or operational read. The engine owns every
      // pre-generation gate for canonical signed live requests. Preview has no
      // durable request identity, so it retains route-level entry gates.
      if (verifiedPreview) {
        try {
          const entitlements = await resolveBusinessEntitlements(businessId);
          if (!canUseFeature(entitlements, "web_chat")) {
            return NextResponse.json(
              { available: false, response: null },
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

        const entryOperationalResponse = await enforceWidgetOperationalState(
          businessId,
          origin.origin,
        );
        if (entryOperationalResponse) return entryOperationalResponse;
      }

      let result: Awaited<ReturnType<typeof processIncomingMessageDetailed>>;
      try {
        result = await processIncomingMessageDetailed(
          businessId,
          null,
          visitorEmail || null,
          message,
          "web_chat",
          sessionId || null,
          {
            persistBookingRequests: !verifiedPreview,
            isPreview: verifiedPreview,
            contactName: visitorName,
            webChatRequest: verifiedPreview
              ? undefined
              : {
                  clientMessageId,
                  requestFingerprint: buildWidgetChatRequestFingerprint({
                    businessId,
                    origin: origin.origin,
                    sessionId,
                    clientMessageId,
                    message,
                    visitorEmail,
                    visitorName,
                  }),
                },
          },
        );
      } catch (error) {
        // Re-checks inside the AI engine close the race where a downgrade or DB
        // failure occurs after this route's initial authorization decision.
        if (
          error instanceof AIProcessingBlockedError &&
          isWidgetUnavailableBlockReason(error.reason)
        ) {
          return unavailableChatResponse(origin.origin);
        }
        if (error instanceof OperationalControlsResolutionError) {
          return retryableChatUnavailableResponse(origin.origin);
        }
        if (error instanceof AIReplyLimitReachedError) {
          return assistantUnavailableResponse(origin.origin);
        }
        if (error instanceof AIProcessingInProgressError) {
          return widgetErrorResponse("rate_limited", 429, {
            origin: origin.origin,
            retryAfterSeconds: error.retryAfterSeconds,
          });
        }
        if (error instanceof AIProcessingIdempotencyConflictError) {
          return NextResponse.json(
            { error: "request_conflict", retryable: false },
            { status: 409, headers: publicHeaders(origin.origin) },
          );
        }
        if (
          error instanceof EntitlementResolutionError ||
          error instanceof AIProcessingStateError
        ) {
          return widgetErrorResponse("service_unavailable", 503, {
            origin: origin.origin,
          });
        }
        throw error;
      }

      if (verifiedPreview) {
        // Preview replies are neither persisted nor recoverable, so a final
        // fresh pause may still suppress their display. A live engine result
        // is already a committed customer outcome and must always be returned.
        const finalOperationalResponse = await enforceWidgetOperationalState(
          businessId,
          origin.origin,
        );
        if (finalOperationalResponse) return finalOperationalResponse;
      }

      if (!verifiedPreview && result.actions.length > 0) {
        if (!result.assistantMessageId) {
          console.error(
            "[widget:chat] Goal event finalization skipped: missing assistant message proof.",
            {
              businessId,
              conversationId: result.conversationId,
              sourceMessageId: result.sourceMessageId,
            },
          );
        } else {
          const goalEventOccurredAt = new Date();
          for (const action of result.actions) {
            try {
              await finalizeGoalLinkEvent({
                businessId,
                action,
                assistantMessageId: result.assistantMessageId,
                occurredAt: goalEventOccurredAt,
              });
            } catch (error) {
              console.error(
                "[widget:chat] Goal event finalization failed:",
                {
                  businessId,
                  conversationId: action.conversationId,
                  sourceMessageId: action.sourceMessageId,
                },
                error,
              );
            }
          }
        }
      }

      if (result.conversationId) {
        const occurredAt = new Date();
        try {
          recordBusinessMetricEventBestEffort({
            businessId,
            metricKey: "web_chat_session_engaged",
            quantity: 1,
            occurredAt,
            sourceKey: buildWebChatSessionSourceKey(businessId, sessionId),
            origin: null,
          });
        } catch {
          console.error("[widget:chat] Metric recording failed:", {
            businessId,
            metricKey: "web_chat_session_engaged",
          });
        }

        try {
          recordBusinessMetricEventBestEffort({
            businessId,
            metricKey: "ai_conversation_engaged",
            quantity: 1,
            occurredAt,
            sourceKey: buildAiConversationSourceKey(
              result.conversationId,
              occurredAt,
            ),
            origin: null,
          });
        } catch {
          console.error("[widget:chat] Metric recording failed:", {
            businessId,
            metricKey: "ai_conversation_engaged",
          });
        }
      }

      if (result.knowledgeGapDetected && result.sourceMessageId) {
        const sourceMessageId = result.sourceMessageId;
        void recordKnowledgeGap({
          businessId,
          sourceMessageId,
          aiResponseText: result.text,
        }).catch((error) => {
          console.error(
            "[widget:chat] Knowledge gap capture failed:",
            { businessId, sourceMessageId },
            error,
          );
        });
      }

      return NextResponse.json(
        { available: true, response: result.text, sessionId },
        { headers: publicHeaders(origin.origin) },
      );
    } finally {
      await releaseWidgetTraffic(traffic.lease);
    }
  } catch (error) {
    console.error("Widget chat error:", error);
    return widgetErrorResponse("service_unavailable", 503);
  }
}

async function enforceWidgetOperationalState(
  businessId: string,
  origin: string,
): Promise<NextResponse | null> {
  try {
    const controls = await resolveBusinessOperationalControls(businessId);
    return resolveOperationalBlockReason(controls, ["ai_replies"]) === null
      ? null
      : unavailableChatResponse(origin);
  } catch (error) {
    if (error instanceof OperationalControlsResolutionError) {
      console.error("Widget chat operational controls lookup error:", error);
      return retryableChatUnavailableResponse(origin);
    }
    throw error;
  }
}

function isWidgetUnavailableBlockReason(reason: string): boolean {
  return (
    reason === "feature_not_entitled" ||
    reason === "account_suspended" ||
    reason === "ai_replies_paused"
  );
}

function unavailableChatResponse(origin: string): NextResponse {
  return NextResponse.json(
    { available: false, response: null },
    { headers: publicHeaders(origin) },
  );
}

function assistantUnavailableResponse(origin: string): NextResponse {
  return NextResponse.json(
    {
      available: true,
      response: null,
      mode: "lead_capture",
      reason: "assistant_unavailable",
    },
    { headers: publicHeaders(origin) },
  );
}

function retryableChatUnavailableResponse(origin: string): NextResponse {
  return widgetErrorResponse("service_unavailable", 503, { origin });
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
    console.error("Widget preview config lookup error:", error);
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
