import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: expiredBusinesses, error: queryError } = await supabaseAdmin
    .from("businesses")
    .select("id, owner_id")
    .not("deleted_at", "is", null)
    .lt("deletion_scheduled_for", new Date().toISOString());

  if (queryError) {
    console.error("[cleanup] Query error:", queryError);
    return NextResponse.json({ error: "Failed to query expired accounts" }, { status: 500 });
  }

  if (!expiredBusinesses || expiredBusinesses.length === 0) {
    return NextResponse.json({ success: true, deleted_count: 0 });
  }

  let deletedCount = 0;

  for (const business of expiredBusinesses) {
    try {
      // 1. Get conversation IDs for this business
      const { data: conversations } = await supabaseAdmin
        .from("conversations")
        .select("id")
        .eq("business_id", business.id);

      const conversationIds = (conversations || []).map((c) => c.id);

      // 2. Anonymize messages — replace content but keep role and timestamps
      if (conversationIds.length > 0) {
        await supabaseAdmin
          .from("messages")
          .update({ content: "[deleted]" })
          .in("conversation_id", conversationIds);
      }

      // 3. Anonymize contacts — strip PII, keep lead_score and timestamps
      await supabaseAdmin
        .from("contacts")
        .update({ name: null, email: null, phone_number: null, notes: null })
        .eq("business_id", business.id);

      // 4. Hard delete config tables (cascades don't apply here since we keep the business row)
      await supabaseAdmin.from("ai_settings").delete().eq("business_id", business.id);
      await supabaseAdmin.from("services").delete().eq("business_id", business.id);
      await supabaseAdmin.from("faqs").delete().eq("business_id", business.id);
      await supabaseAdmin.from("business_hours").delete().eq("business_id", business.id);
      await supabaseAdmin.from("phone_numbers").delete().eq("business_id", business.id);
      await supabaseAdmin.from("widget_configs").delete().eq("business_id", business.id);
      await supabaseAdmin.from("google_calendar_tokens").delete().eq("business_id", business.id);
      await supabaseAdmin.from("subscriptions").delete().eq("business_id", business.id);

      // 5. Scrub PII from business row but keep it as a tombstone for analytics FKs
      await supabaseAdmin
        .from("businesses")
        .update({
          name: "[deleted]",
          email: null,
          phone_number: null,
          website_url: null,
          address: null,
          city: null,
          state: null,
          zip: null,
          owner_id: null,
        })
        .eq("id", business.id);

      // 6. Delete the Supabase auth user
      if (business.owner_id) {
        await supabaseAdmin.auth.admin.deleteUser(business.owner_id);
      }

      deletedCount++;
      console.log(`[cleanup] Permanently cleaned business ${business.id}`);
    } catch (err) {
      console.error(`[cleanup] Failed to clean business ${business.id}:`, err);
    }
  }

  return NextResponse.json({ success: true, deleted_count: deletedCount });
}
