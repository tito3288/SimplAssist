-- Phase 5 of per-customer A2P 10DLC: extend messages.role to allow 'system'.
--
-- Phase 5 hard-blocks customer-facing SMS sends when campaign_status != 'approved'.
-- When an automated send path (missed-call auto-SMS, AI reply in the messaging
-- webhook, MMS fallback) is blocked, we still want the customer to see WHY
-- their reply didn't go out — so we insert a 'system' message into the
-- conversation explaining "Auto-reply paused — your SMS campaign is awaiting
-- carrier approval." Distinct from 'assistant' so the dashboard can render it
-- as a centered system notice rather than an AI bubble.
--
-- See src/app/api/messaging/webhook/route.ts (post-Phase-5) and
-- src/lib/messaging/missed-call.ts for the insertion sites, and
-- src/components/conversations/MessageThread.tsx for the render path.

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_role_check
  CHECK (role IN ('customer','assistant','human_agent','system'));
