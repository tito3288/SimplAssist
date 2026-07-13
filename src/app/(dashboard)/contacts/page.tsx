import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ContactStats from "@/components/contacts/ContactStats";
import ContactsTable from "@/components/contacts/ContactsTable";

export default async function ContactsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Get the user's business
  const { data: business } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", user.id)
    .single();

  if (!business) redirect("/onboarding");

  // Fetch contacts and conversations in parallel
  const [contactsResult, conversationsResult] = await Promise.all([
    supabase
      .from("contacts")
      .select("*")
      .eq("business_id", business.id)
      .order("last_contacted_at", { ascending: false }),
    supabase
      .from("conversations")
      .select("*")
      .eq("business_id", business.id),
  ]);

  const contacts = contactsResult.data ?? [];
  const conversations = conversationsResult.data ?? [];

  // Compute conversation count per contact
  const countMap: Record<string, number> = {};
  for (const conv of conversations) {
    countMap[conv.contact_id] = (countMap[conv.contact_id] ?? 0) + 1;
  }

  const contactsWithCount = contacts.map((c) => ({
    ...c,
    conversation_count: countMap[c.id] ?? 0,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 dark:text-[#f5f5f5]">Contacts</h1>
        <p className="mt-1 text-sm text-stone-500 dark:text-[#bdbdbf]">
          Manage your leads and customer contacts
        </p>
      </div>

      <ContactStats contacts={contacts} />
      <ContactsTable
        contacts={contactsWithCount}
        conversations={conversations}
      />
    </div>
  );
}
