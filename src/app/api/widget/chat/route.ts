import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  AIProcessingBlockedError,
  AIProcessingStateError,
  processIncomingMessageDetailed,
} from "@/lib/ai/engine";
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { businessId, message, sessionId, visitorEmail } = body;

    if (!businessId || !message || !sessionId) {
      return NextResponse.json(
        { error: "Missing required fields: businessId, message, sessionId" },
        { status: 400, headers: corsHeaders }
      );
    }

    const { data: widgetConfig, error: widgetError } = await supabaseAdmin
      .from("widget_configs")
      .select("id")
      .eq("business_id", businessId)
      .eq("is_active", true)
      .maybeSingle();

    if (widgetError) {
      console.error("Widget chat config lookup error:", widgetError);
      return NextResponse.json(
        { error: "Service temporarily unavailable", retryable: true },
        { status: 503, headers: corsHeaders }
      );
    }

    if (!widgetConfig) {
      return NextResponse.json(
        { available: false, response: null },
        { headers: corsHeaders }
      );
    }

    try {
      const entitlements = await resolveBusinessEntitlements(businessId);
      if (!canUseFeature(entitlements, "web_chat")) {
        return NextResponse.json(
          { available: false, response: null },
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

    const entryOperationalResponse = await enforceWidgetOperationalState(
      businessId
    );
    if (entryOperationalResponse) return entryOperationalResponse;

    let result: Awaited<ReturnType<typeof processIncomingMessageDetailed>>;
    try {
      result = await processIncomingMessageDetailed(
        businessId,
        null,
        visitorEmail || null,
        message,
        "web_chat",
        sessionId || null
      );
    } catch (error) {
      // Re-checks inside the AI engine close the race where a downgrade or DB
      // failure occurs after this route's initial authorization decision.
      if (
        error instanceof AIProcessingBlockedError &&
        isWidgetUnavailableBlockReason(error.reason)
      ) {
        return unavailableChatResponse();
      }
      if (error instanceof OperationalControlsResolutionError) {
        return retryableChatUnavailableResponse();
      }
      if (
        error instanceof EntitlementResolutionError ||
        error instanceof AIProcessingStateError
      ) {
        return NextResponse.json(
          { error: "Service temporarily unavailable", retryable: true },
          { status: 503, headers: corsHeaders }
        );
      }
      throw error;
    }

    // Repeat the uncached read before response-side effects to close the gap
    // between the AI engine's final return and knowledge-gap capture.
    const finalOperationalResponse = await enforceWidgetOperationalState(
      businessId
    );
    if (finalOperationalResponse) return finalOperationalResponse;

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
            occurredAt
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
          error
        );
      });
    }

    return NextResponse.json(
      { available: true, response: result.text, sessionId },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Widget chat error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders }
    );
  }
}

async function enforceWidgetOperationalState(
  businessId: string
): Promise<NextResponse | null> {
  try {
    const controls = await resolveBusinessOperationalControls(businessId);
    return resolveOperationalBlockReason(controls, ["ai_replies"]) === null
      ? null
      : unavailableChatResponse();
  } catch (error) {
    if (error instanceof OperationalControlsResolutionError) {
      console.error("Widget chat operational controls lookup error:", error);
      return retryableChatUnavailableResponse();
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

function unavailableChatResponse(): NextResponse {
  return NextResponse.json(
    { available: false, response: null },
    { headers: corsHeaders }
  );
}

function retryableChatUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: "Service temporarily unavailable", retryable: true },
    { status: 503, headers: corsHeaders }
  );
}
