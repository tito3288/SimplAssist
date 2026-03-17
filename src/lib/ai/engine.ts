import { anthropic } from "@/lib/anthropic/client";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { findOrCreateContact, incrementLeadScore } from "./contacts";
import { getOrCreateConversation, addMessage, getConversationHistory } from "./conversations";
import { buildSystemPrompt, buildConversationMessages } from "./prompt";
import type {
  Business,
  AISettings,
  Service,
  FAQ,
  BusinessHours,
  Channel,
} from "@/types/database";

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

export async function processIncomingMessage(
  businessId: string,
  contactPhone: string | null,
  contactEmail: string | null,
  message: string,
  channel: Channel
): Promise<string> {
  try {
    const contact = await findOrCreateContact(
      businessId,
      contactPhone,
      contactEmail,
      channel
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
    ]);

    if (!business || !aiSettings) {
      return FALLBACK_MESSAGE;
    }

    const systemPrompt = buildSystemPrompt(
      business as Business,
      aiSettings as AISettings,
      (services ?? []) as Service[],
      (faqs ?? []) as FAQ[],
      (businessHours ?? []) as BusinessHours[]
    );

    const history = await getConversationHistory(conversation.id);

    const messages = buildConversationMessages(history, message);

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-20250404",
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const responseText =
      response.content[0].type === "text"
        ? response.content[0].text
        : FALLBACK_MESSAGE;

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
