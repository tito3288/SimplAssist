import { anthropic } from "@/lib/anthropic/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { findOrCreateContact, incrementLeadScore, updateContactName, updateContactEmail } from "./contacts";
import {
  getOrCreateConversation,
  addMessage,
  getConversationAiState,
  getConversationHistory,
  isAiHandlingActive,
} from "./conversations";
import { buildSystemPrompt, buildConversationMessages } from "./prompt";
import { calendarTools, shouldIncludeCalendarTools } from "./tools";
import { checkAvailability, createBooking } from "@/lib/google/calendar";
import type {
  Business,
  AISettings,
  Service,
  FAQ,
  BusinessHours,
  Channel,
  Contact,
  Conversation,
} from "@/types/database";
import type Anthropic from "@anthropic-ai/sdk";

const FALLBACK_MESSAGE =
  "Thanks for reaching out! We're having a brief technical issue. Please try again in a moment or call us directly.";

export class AIProcessingBlockedError extends Error {
  constructor(
    readonly reason: "feature_not_entitled" | "conversation_in_manual_mode"
  ) {
    super(
      reason === "feature_not_entitled"
        ? "AI processing is not included in this business's current plan."
        : "AI processing is disabled while this conversation is in Human mode."
    );
    this.name = "AIProcessingBlockedError";
  }
}

export class AIProcessingStateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIProcessingStateError";
  }
}

export interface ProcessIncomingMessageOptions {
  persistAssistant?: boolean;
  /** Set false only when the caller has already durably stored this message. */
  persistCustomer?: boolean;
  /** Required with persistCustomer=false so direct bookings remain retry-stable. */
  sourceMessageId?: string;
  contact?: Contact;
  conversation?: Conversation;
}

function scoreMessage(message: string): number {
  const lower = message.toLowerCase();
  let score = 0;

  if (/\b(price|pricing|cost|how much|rate|fee|quote|cheap|cheapest|budget|afford|estimate|pay|payment)\b/.test(lower)) score += 2;
  if (/\b(book|booking|appointment|schedule|reserve|set up a time|consultation|meet|meeting|call|demo)\b/.test(lower)) score += 3;
  if (/\b(service|offer|provide|do you do|available|help me|need|looking for|interested)\b/.test(lower)) score += 1;

  return score;
}

const contactTools: Anthropic.Tool[] = [
  {
    name: "save_contact_name",
    description: "Save the customer's name to their contact record. Call this when the customer tells you their name.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The customer's name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "save_contact_email",
    description: "Save the customer's email to their contact record. Call this when the customer provides their email address.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: {
          type: "string",
          description: "The customer's email address",
        },
      },
      required: ["email"],
    },
  },
];

async function executeContactTool(
  contactId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    if (toolName === "save_contact_name") {
      const name = toolInput.name as string;
      await updateContactName(contactId, name);
      return `Contact name saved: ${name}`;
    }
    if (toolName === "save_contact_email") {
      const email = toolInput.email as string;
      await updateContactEmail(contactId, email);
      return `Contact email saved: ${email}`;
    }
    return "Unknown tool.";
  } catch (error) {
    console.error(`[contact-tool] Error executing ${toolName}:`, error);
    return "Contact info saved.";
  }
}

async function executeCalendarTool(
  businessId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  timezone: string,
  contactPhone: string | null,
  contactId: string,
  conversationId: string,
  sourceMessageId: string | null
): Promise<string> {
  try {
    if (toolName === "check_availability") {
      const date = toolInput.date as string;
      const slots = await checkAvailability(businessId, date, timezone);

      if (slots.length === 0) {
        return "No available slots on that date. The business may be closed or fully booked.";
      }

      return `Available times on ${date}: ${slots.join(", ")}`;
    }

    if (toolName === "create_booking") {
      if (!sourceMessageId) {
        throw new AIProcessingStateError(
          "Direct booking requires a durably persisted source message."
        );
      }
      const customerEmail = (toolInput.customer_email as string) || undefined;
      const result = await createBooking(
        businessId,
        {
          customerName: toolInput.customer_name as string,
          customerPhone: (toolInput.customer_phone as string) || contactPhone || undefined,
          customerEmail,
          serviceName: toolInput.service_name as string,
          startTime: toolInput.start_time as string,
          durationMinutes: (toolInput.duration_minutes as number) || 30,
        },
        timezone,
        {
          contactId,
          conversationId,
          sourceMessageId,
        }
      );

      // Save email to contact as a safety net
      if (customerEmail) {
        await updateContactEmail(contactId, customerEmail).catch(() => {});
      }

      return `Appointment booked successfully! ${result.summary} at ${result.startTime}. Event ID: ${result.eventId}`;
    }

    return "Unknown tool.";
  } catch (error) {
    console.error(`[calendar-tool] Error executing ${toolName}:`, error);
    return "Calendar is temporarily unavailable. Please collect the customer's booking details instead and let them know someone will confirm.";
  }
}

export async function processIncomingMessage(
  businessId: string,
  contactPhone: string | null,
  contactEmail: string | null,
  message: string,
  channel: Channel,
  sessionId: string | null = null,
  options: ProcessIncomingMessageOptions = {}
): Promise<string> {
  try {
    // Resolve at the execution boundary even when an upstream webhook already
    // checked the plan. This closes the downgrade/cancel race before any
    // Anthropic request and avoids trusting a stale long-lived decision.
    const entitlements = await resolveBusinessEntitlements(businessId);
    const requiredFeature =
      channel === "sms" ? "ai_sms_conversations" : "web_chat";

    if (!canUseFeature(entitlements, requiredFeature)) {
      throw new AIProcessingBlockedError("feature_not_entitled");
    }

    let contact: Contact;
    try {
      contact =
        options.contact ??
        (await findOrCreateContact(
          businessId,
          contactPhone,
          contactEmail,
          channel,
          sessionId
        ));
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not resolve a contact for business ${businessId}.`,
        { cause: error }
      );
    }

    if (contact.business_id !== businessId) {
      throw new AIProcessingStateError(
        `Contact ${contact.id} does not belong to business ${businessId}.`
      );
    }

    let conversation: Conversation;
    try {
      conversation =
        options.conversation ??
        (await getOrCreateConversation(businessId, contact.id, channel));
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not resolve a conversation for contact ${contact.id}.`,
        { cause: error }
      );
    }

    if (
      conversation.business_id !== businessId ||
      conversation.contact_id !== contact.id ||
      conversation.channel !== channel
    ) {
      throw new AIProcessingStateError(
        `Conversation ${conversation.id} does not match the AI request context.`
      );
    }

    // Defense in depth: the webhook checks this before dispatching AI, and the
    // engine re-reads it so a human takeover that races processing still wins.
    if (channel === "sms") {
      let currentState: Pick<
        Conversation,
        "id" | "status" | "is_ai_handling"
      >;
      try {
        currentState = await getConversationAiState(conversation.id);
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not determine AI state for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
      if (!isAiHandlingActive(currentState)) {
        throw new AIProcessingBlockedError("conversation_in_manual_mode");
      }
    }

    let sourceMessageId = options.sourceMessageId ?? null;
    if (options.persistCustomer !== false) {
      try {
        const persistedMessage = await addMessage(
          conversation.id,
          businessId,
          "customer",
          message,
          channel
        );
        sourceMessageId = persistedMessage.id;
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not persist the customer message for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
    }

    let stateResults;
    try {
      stateResults = await Promise.all([
        supabaseAdmin
          .from("businesses")
          .select("*")
          .eq("id", businessId)
          .single(),
        supabaseAdmin
          .from("ai_settings")
          .select("*")
          .eq("business_id", businessId)
          .single(),
        supabaseAdmin
          .from("services")
          .select("*")
          .eq("business_id", businessId)
          .eq("is_active", true),
        supabaseAdmin
          .from("faqs")
          .select("*")
          .eq("business_id", businessId)
          .eq("is_active", true),
        supabaseAdmin
          .from("business_hours")
          .select("*")
          .eq("business_id", businessId),
        supabaseAdmin
          .from("google_calendar_tokens")
          .select("id")
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not load AI context for business ${businessId}.`,
        { cause: error }
      );
    }

    const [
      businessResult,
      aiSettingsResult,
      servicesResult,
      faqsResult,
      businessHoursResult,
      calendarTokenResult,
    ] = stateResults;
    const contextError = stateResults.find((result) => result.error)?.error;
    if (contextError) {
      throw new AIProcessingStateError(
        `Could not load AI context for business ${businessId}.`,
        { cause: contextError }
      );
    }

    const business = businessResult.data;
    const aiSettings = aiSettingsResult.data;
    const services = servicesResult.data;
    const faqs = faqsResult.data;
    const businessHours = businessHoursResult.data;
    const calendarToken = calendarTokenResult.data;

    if (!business || !aiSettings) {
      throw new AIProcessingStateError(
        `Business ${businessId} is missing required AI configuration.`
      );
    }

    const canBookDirectly = canUseFeature(entitlements, "direct_booking");
    const hasCalendar = canBookDirectly && !!calendarToken;
    const useTools = shouldIncludeCalendarTools(
      aiSettings as AISettings,
      hasCalendar
    );

    // Stored settings survive downgrades, but features above the current plan
    // are made inert at execution time. Growth may customize AI while only
    // Full may inject advanced guardrails into the model prompt.
    const effectiveAiSettings: AISettings = {
      ...(aiSettings as AISettings),
      guardrails: canUseFeature(entitlements, "advanced_guardrails")
        ? (aiSettings as AISettings).guardrails
        : [],
    };

    const systemPrompt = buildSystemPrompt(
      business as Business,
      effectiveAiSettings,
      (services ?? []) as Service[],
      (faqs ?? []) as FAQ[],
      (businessHours ?? []) as BusinessHours[],
      hasCalendar,
      channel
    );

    let history;
    try {
      history = await getConversationHistory(conversation.id);
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not load conversation history for ${conversation.id}.`,
        { cause: error }
      );
    }

    // The current customer message is already in history (either persisted
    // above or by a durable webhook caller), so do not append it a second time.
    const messages: Anthropic.MessageParam[] = buildConversationMessages(history);

    // Build tools array — contact tools are always available, calendar tools are conditional
    const tools: Anthropic.Tool[] = [...contactTools];
    if (useTools) {
      tools.push(...calendarTools);
    }
    const enabledToolNames = new Set(tools.map((tool) => tool.name));

    // Build API params
    const apiParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: systemPrompt,
      messages,
      tools,
    };

    let response = await anthropic.messages.create(apiParams);
    let loopCount = 0;
    const maxLoops = 3;

    // Tool-calling loop
    while (response.stop_reason === "tool_use" && loopCount < maxLoops) {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Execute ALL tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUseBlock of toolUseBlocks) {
        let toolResult: string;
        if (toolUseBlock.name === "save_contact_name" || toolUseBlock.name === "save_contact_email") {
          toolResult = await executeContactTool(
            contact.id,
            toolUseBlock.name,
            toolUseBlock.input as Record<string, unknown>
          );
        } else if (!enabledToolNames.has(toolUseBlock.name)) {
          toolResult =
            "That tool is not enabled for this business. Do not perform the action.";
        } else {
          toolResult = await executeCalendarTool(
            businessId,
            toolUseBlock.name,
            toolUseBlock.input as Record<string, unknown>,
            (business as Business).timezone,
            contactPhone,
            contact.id,
            conversation.id,
            sourceMessageId
          );
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: toolResult,
        });
      }

      // Add assistant's response (with tool uses) and ALL tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: toolResults,
      });

      // Update apiParams with the extended messages
      apiParams.messages = messages;
      response = await anthropic.messages.create(apiParams);
      loopCount++;
    }

    // Extract the final text response
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const responseText = textBlock?.text || FALLBACK_MESSAGE;

    if (options.persistAssistant !== false) {
      try {
        await addMessage(
          conversation.id,
          businessId,
          "assistant",
          responseText,
          channel
        );
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not persist the assistant message for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
    }

    const leadScoreIncrease = scoreMessage(message);
    if (leadScoreIncrease > 0) {
      await incrementLeadScore(contact.id, leadScoreIncrease);
    }

    return responseText;
  } catch (error) {
    if (
      error instanceof AIProcessingBlockedError ||
      error instanceof AIProcessingStateError ||
      error instanceof EntitlementResolutionError
    ) {
      throw error;
    }
    console.error("Error processing incoming message:", error);
    return FALLBACK_MESSAGE;
  }
}
