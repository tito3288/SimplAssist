import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Contact, Channel } from "@/types/database";

export async function findOrCreateContact(
  businessId: string,
  phone: string | null,
  email: string | null,
  channel: Channel
): Promise<Contact> {
  let existing: Contact | null = null;

  if (channel === "sms" && phone) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("business_id", businessId)
      .eq("phone_number", phone)
      .single();
    existing = data;
  } else if (channel === "web_chat" && email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("*")
      .eq("business_id", businessId)
      .eq("email", email)
      .single();
    existing = data;
  }

  if (existing) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    return data as Contact;
  }

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      business_id: businessId,
      phone_number: phone,
      email: email,
      source_channel: channel,
      lead_score: 0,
      last_contacted_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Contact;
}

export async function updateContactName(
  contactId: string,
  name: string
): Promise<void> {
  await supabaseAdmin
    .from("contacts")
    .update({ name })
    .eq("id", contactId);
}

export async function incrementLeadScore(
  contactId: string,
  amount: number
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("lead_score")
    .eq("id", contactId)
    .single();

  const currentScore = data?.lead_score ?? 0;

  await supabaseAdmin
    .from("contacts")
    .update({ lead_score: currentScore + amount })
    .eq("id", contactId);
}
