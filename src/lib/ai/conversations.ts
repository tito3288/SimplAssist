import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Conversation, Message, Channel, MessageRole } from "@/types/database";

export async function getOrCreateConversation(
  businessId: string,
  contactId: string,
  channel: Channel
): Promise<Conversation> {
  const { data: existing } = await supabaseAdmin
    .from("conversations")
    .select("*")
    .eq("business_id", businessId)
    .eq("contact_id", contactId)
    .eq("channel", channel)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing as Conversation;

  const { data, error } = await supabaseAdmin
    .from("conversations")
    .insert({
      business_id: businessId,
      contact_id: contactId,
      channel,
      status: "active",
      is_ai_handling: true,
      started_at: new Date().toISOString(),
      last_message_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Conversation;
}

export async function addMessage(
  conversationId: string,
  businessId: string,
  role: MessageRole,
  content: string,
  channel: Channel
): Promise<Message> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .insert({
      conversation_id: conversationId,
      business_id: businessId,
      role,
      content,
      channel,
    })
    .select("*")
    .single();

  if (error) throw error;

  await supabaseAdmin
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversationId);

  return data as Message;
}

export async function getConversationHistory(
  conversationId: string,
  limit: number = 20
): Promise<Message[]> {
  const { data, error } = await supabaseAdmin
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function closeConversation(
  conversationId: string
): Promise<void> {
  await supabaseAdmin
    .from("conversations")
    .update({ status: "closed" })
    .eq("id", conversationId);
}
