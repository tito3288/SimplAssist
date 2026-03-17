import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InboxLayout } from "@/components/conversations/InboxLayout";
import type { Conversation, Contact } from "@/types/database";

export type ConversationWithContact = Conversation & {
  contact: Pick<Contact, "id" | "name" | "phone_number" | "email">;
  last_message_preview?: string;
};

export default async function ConversationsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) redirect("/onboarding");

  const { data: conversations } = await supabase
    .from("conversations")
    .select(
      `
      *,
      contact:contacts!contact_id (
        id,
        name,
        phone_number,
        email
      )
    `
    )
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false });

  // Fetch the last message for each conversation
  const conversationsWithPreviews: ConversationWithContact[] = await Promise.all(
    (conversations ?? []).map(async (conv: ConversationWithContact) => {
      const { data: lastMessage } = await supabase
        .from("messages")
        .select("content")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      return {
        ...conv,
        last_message_preview: lastMessage?.content ?? undefined,
      };
    })
  );

  return (
    <div className="h-[calc(100vh-4rem)]">
      <InboxLayout
        conversations={conversationsWithPreviews}
        businessId={business.id}
      />
    </div>
  );
}
