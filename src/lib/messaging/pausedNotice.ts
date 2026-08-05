import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Channel, SmsBlockReason } from "@/types/database";

// Shared marker so the dedupe LIKE query stays robust against copy changes.
// Every paused-system message we insert MUST contain this substring.
const PAUSED_MARKER = "SMS sending is paused";

const CONTEXT_PREFIX: Record<PausedContext, string> = {
  missed_call: "Auto-reply paused",
  ai_reply: "AI reply paused",
  mms_fallback: "Auto-reply paused",
};

export type PausedContext = "missed_call" | "ai_reply" | "mms_fallback";

export type PausedReason = Extract<
  SmsBlockReason,
  "campaign_not_approved" | "assignment_pending" | "assignment_failed"
> |
  "usage_limit_reached" |
  "billing_paused" |
  "submission_disabled" |
  "account_suspended" |
  "texting_paused" |
  "ai_replies_paused";

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
  reason?: PausedReason;
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
      content: pausedCopy(args.context, args.reason ?? "campaign_not_approved"),
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

function pausedCopy(context: PausedContext, reason: PausedReason): string {
  const prefix = CONTEXT_PREFIX[context];
  switch (reason) {
    case "account_suspended":
      return `${prefix} - ${PAUSED_MARKER} because account operations are suspended.`;
    case "texting_paused":
      return `${prefix} - ${PAUSED_MARKER} because texting is paused for this account.`;
    case "ai_replies_paused":
      return `${prefix} - ${PAUSED_MARKER} because AI replies are paused for this account.`;
    case "assignment_pending":
      return `${prefix} - ${PAUSED_MARKER} while Telnyx links this phone number to the approved SMS campaign.`;
    case "assignment_failed":
      return `${prefix} - ${PAUSED_MARKER} because Telnyx phone number assignment needs attention.`;
    case "usage_limit_reached":
      return `${prefix} - ${PAUSED_MARKER} because this account has used all included SMS parts for the current billing period.`;
    case "billing_paused":
      return `${prefix} - ${PAUSED_MARKER} because the subscription needs attention.`;
    case "submission_disabled":
      return `${prefix} - ${PAUSED_MARKER} because SMS registration is disabled for this account.`;
    case "campaign_not_approved":
    default:
      return `${prefix} - ${PAUSED_MARKER} while your SMS campaign is awaiting carrier approval.`;
  }
}
