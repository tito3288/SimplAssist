import type { Metadata } from "next";
import { InboxLayout } from "@/components/conversations/InboxLayout";
import { assertDemoPagesEnabled } from "../_lib/guard";
import { DemoShell } from "../_components/demo-shell";
import { DEMO_BUSINESS } from "../_fixtures/business";
import { buildConversationFixtures } from "../_fixtures/conversations";

/**
 * /demo/conversations — the real inbox UI on fixture data, for marketing
 * screenshots. Dev-only (404s in production builds); zero network I/O.
 */

export const dynamic = "force-dynamic";

// Gating in generateMetadata (as well as the component) makes the 404 a true
// HTTP 404 — metadata resolves before streaming starts, so the status code
// can still be set. Gating only in the component yields a soft 404 (200 +
// not-found body) because the shell has already been flushed.
export function generateMetadata(): Metadata {
  assertDemoPagesEnabled();
  return {
    title: "SimplAssist — Demo (dev only)",
    robots: { index: false, follow: false },
  };
}

export default function DemoConversationsPage() {
  assertDemoPagesEnabled();
  const { conversations, messagesById } = buildConversationFixtures(new Date());

  return (
    <DemoShell activePath="/conversations">
      <div className="h-[calc(100vh-4rem)]">
        <InboxLayout
          conversations={conversations}
          businessId={DEMO_BUSINESS.businessId}
          smsReady={true}
          smsBlockReason={null}
          initialSelectedId={conversations[0].id}
          demoMessagesById={messagesById}
        />
      </div>
    </DemoShell>
  );
}
