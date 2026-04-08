import { anthropic } from "@/lib/anthropic/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateContact, incrementLeadScore, updateContactName, updateContactEmail } from "./contacts";
import { getOrCreateConversation, addMessage, getConversationHistory } from "./conversations";
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
} from "@/types/database";
import type Anthropic from "@anthropic-ai/sdk";

const FALLBACK_MESSAGE =
  "Thanks for reaching out! We're having a brief technical issue. Please try again in a moment or call us directly.";

function scoreMessage(message: string): number {
  const lower = message.toLowerCase();
  let score = 0;

  if (/\b(price|pricing|cost|how much|rate|fee|quote)\b/.test(lower)) score += 2;
  if (/\b(book|booking|appointment|schedule|reserve)\b/.test(lower)) score += 3;
  if (/\b(service|offer|provide|do you do)\b/.test(lower)) score += 1;

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
  contactPhone: string | null
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
      const result = await createBooking(
        businessId,
        {
          customerName: toolInput.customer_name as string,
          customerPhone: (toolInput.customer_phone as string) || contactPhone || undefined,
          customerEmail: (toolInput.customer_email as string) || undefined,
          serviceName: toolInput.service_name as string,
          startTime: toolInput.start_time as string,
          durationMinutes: (toolInput.duration_minutes as number) || 30,
        },
        timezone
      );

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
  sessionId: string | null = null
): Promise<string> {
  try {
    const contact = await findOrCreateContact(
      businessId,
      contactPhone,
      contactEmail,
      channel,
      sessionId
    );

    const conversation = await getOrCreateConversation(
      businessId,
      contact.id,
      channel
    );

    await addMessage(conversation.id, businessId, "customer", message, channel);

    const [
      { data: business },
      { data: aiSettings },
      { data: services },
      { data: faqs },
      { data: businessHours },
      { data: calendarToken },
    ] = await Promise.all([
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
        .single(),
    ]);

    if (!business || !aiSettings) {
      return FALLBACK_MESSAGE;
    }

    const hasCalendar = !!calendarToken;
    const useTools = shouldIncludeCalendarTools(
      aiSettings as AISettings,
      hasCalendar
    );

    const systemPrompt = buildSystemPrompt(
      business as Business,
      aiSettings as AISettings,
      (services ?? []) as Service[],
      (faqs ?? []) as FAQ[],
      (businessHours ?? []) as BusinessHours[],
      hasCalendar,
      channel
    );

    const history = await getConversationHistory(conversation.id);

    const messages: Anthropic.MessageParam[] = buildConversationMessages(
      history,
      message
    );

    // Build tools array — contact tools are always available, calendar tools are conditional
    const tools: Anthropic.Tool[] = [...contactTools];
    if (useTools) {
      tools.push(...calendarTools);
    }

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
        } else {
          toolResult = await executeCalendarTool(
            businessId,
            toolUseBlock.name,
            toolUseBlock.input as Record<string, unknown>,
            (business as Business).timezone,
            contactPhone
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

    await addMessage(
      conversation.id,
      businessId,
      "assistant",
      responseText,
      channel
    );

    const leadScoreIncrease = scoreMessage(message);
    if (leadScoreIncrease > 0) {
      await incrementLeadScore(contact.id, leadScoreIncrease);
    }

    return responseText;
  } catch (error) {
    console.error("Error processing incoming message:", error);
    return FALLBACK_MESSAGE;
  }
}
