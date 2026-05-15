import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Channel } from "@/types/database";

// Shared marker so the dedupe LIKE query stays robust against copy changes.
// Every paused-system message we insert MUST contain this substring.
const PAUSED_MARKER = "SMS campaign is awaiting carrier approval";

const PAUSED_COPY: Record<PausedContext, string> = {
  missed_call: `Auto-reply paused — your ${PAUSED_MARKER}.`,
  ai_reply: `AI reply paused — your ${PAUSED_MARKER}.`,
  mms_fallback: `Auto-reply paused — your ${PAUSED_MARKER}.`,
};

export type PausedContext = "missed_call" | "ai_reply" | "mms_fallback";

const DEDUPE_WINDOW_MINUTES = 30;

// Inserts a role:"system" message describing why an automated send was
// blocked, unless an identical paused message already exists in the same
// conversation within the last 30 minutes (dedupe to keep the inbox clean
// when a customer sends multiple inbounds during the approval window).
//
// Never throws — paused-notice failures must not bubble up and break the
// already-degraded webhook handler. Logs and moves on.
export async function insertPausedSystemMessageIfNeeded(args: {
  conversationId: string;
  businessId: string;
  channel: Channel;
  context: PausedContext;
}): Promise<void> {
  try {
    const cutoff = new Date(
      Date.now() - DEDUPE_WINDOW_MINUTES * 60_000
    ).toISOString();

    const { data: recent, error: recentError } = await supabaseAdmin
      .from("messages")
      .select("id")
      .eq("conversation_id", args.conversationId)
      .eq("role", "system")
      .like("content", `%${PAUSED_MARKER}%`)
      .gte("created_at", cutoff)
      .limit(1);

    if (recentError) {
      console.warn(
        `[pausedNotice] dedupe lookup failed for conversation ${args.conversationId}:`,
        recentError
      );
      // Fall through and attempt insert anyway — duplicate notices are
      // better than no notices.
    } else if (recent && recent.length > 0) {
      console.warn(
        `[pausedNotice] skipping duplicate paused message in conversation ${args.conversationId} (last one within ${DEDUPE_WINDOW_MINUTES} min)`
      );
      return;
    }

    const { error: insertError } = await supabaseAdmin.from("messages").insert({
      conversation_id: args.conversationId,
      business_id: args.businessId,
      role: "system",
      content: PAUSED_COPY[args.context],
      channel: args.channel,
    });

    if (insertError) {
      console.error(
        `[pausedNotice] failed to insert paused system message in conversation ${args.conversationId}:`,
        insertError
      );
      return;
    }

    await supabaseAdmin
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", args.conversationId);
  } catch (err) {
    console.error("[pausedNotice] unexpected error:", err);
  }
}
