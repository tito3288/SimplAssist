import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  Channel,
  KnowledgeGap,
  KnowledgeGapStatus,
} from "@/types/database";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

import KnowledgeGapsDashboard from "./KnowledgeGapsDashboard";

function gap({
  id,
  question,
  status,
  occurrenceCount,
  channel = "sms",
  lastSeenAt = "2026-07-30T18:15:00.000Z",
}: {
  id: string;
  question: string;
  status: KnowledgeGapStatus;
  occurrenceCount: number;
  channel?: Channel;
  lastSeenAt?: string;
}): KnowledgeGap {
  return {
    id,
    business_id: "business-1",
    question_text: question,
    normalized_question: question.toLowerCase(),
    ai_response_text: "Please contact us for details.",
    channel,
    conversation_id: `conversation-${id}`,
    source_message_id: `message-${id}`,
    occurrence_count: occurrenceCount,
    status,
    resolved_faq_id: status === "resolved" ? `faq-${id}` : null,
    created_at: "2026-07-01T12:00:00.000Z",
    last_seen_at: lastSeenAt,
    updated_at: lastSeenAt,
  };
}

function renderDashboard(
  initialGaps: KnowledgeGap[],
  loadError: string | null = null
) {
  return renderToStaticMarkup(
    <KnowledgeGapsDashboard
      businessId="business-1"
      initialGaps={initialGaps}
      loadError={loadError}
      timeZone="America/Indiana/Indianapolis"
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({});
});

describe("KnowledgeGapsDashboard initial UI", () => {
  it("shows lifecycle counts while defaulting the list to most-asked open gaps", () => {
    const markup = renderDashboard([
      gap({
        id: "open-once",
        question: "Single question",
        status: "open",
        occurrenceCount: 1,
        lastSeenAt: "2026-07-29T18:15:00.000Z",
      }),
      gap({
        id: "open-repeated",
        question: "Repeated question",
        status: "open",
        occurrenceCount: 4,
        channel: "web_chat",
      }),
      gap({
        id: "resolved",
        question: "Resolved question",
        status: "resolved",
        occurrenceCount: 3,
      }),
      gap({
        id: "dismissed",
        question: "Dismissed question",
        status: "dismissed",
        occurrenceCount: 2,
      }),
    ]);

    expect(markup).toContain('aria-label="Knowledge gap counts"');
    expect(markup).toMatch(/Open<\/p><p[^>]*>2<\/p>/);
    expect(markup).toMatch(/Resolved<\/p><p[^>]*>1<\/p>/);
    expect(markup).toMatch(/Dismissed<\/p><p[^>]*>1<\/p>/);
    expect(markup).toMatch(
      /<button[^>]*aria-pressed="true"[^>]*>Open<\/button>/
    );
    expect(markup).toMatch(
      /<option value="most_asked"[^>]*selected[^>]*>Most asked<\/option>/
    );
    expect(markup.indexOf("Repeated question")).toBeLessThan(
      markup.indexOf("Single question")
    );
    expect(markup).not.toContain("Resolved question");
    expect(markup).not.toContain("Dismissed question");
  });

  it("renders owner actions and singular/plural metadata for open rows", () => {
    const markup = renderDashboard([
      gap({
        id: "one",
        question: "One occurrence",
        status: "open",
        occurrenceCount: 1,
      }),
      gap({
        id: "many",
        question: "Many occurrences",
        status: "open",
        occurrenceCount: 2,
        channel: "web_chat",
      }),
    ]);

    expect(markup).toContain("Asked 1 time");
    expect(markup).toContain("Asked 2 times");
    expect(markup).toContain("SMS");
    expect(markup).toContain("Web Chat");
    expect(markup).toContain("Answer this");
    expect(markup).toContain("Dismiss");
    expect(markup).toContain("Last seen Jul 30, 2026, 2:15 PM");
  });

  it("renders a useful zero state for the default open filter", () => {
    const markup = renderDashboard([]);

    expect(markup).toContain("No open knowledge gaps");
    expect(markup).toContain(
      "Unresolved customer questions will appear here."
    );
    expect(markup).not.toContain("Answer this");
  });

  it("shows an explicit load failure without misleading counts or zero state", () => {
    const markup = renderDashboard(
      [],
      "Knowledge gaps could not be loaded."
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Knowledge gaps are temporarily unavailable");
    expect(markup).toContain("Refresh the page to try again.");
    expect(markup).not.toContain('aria-label="Knowledge gap counts"');
    expect(markup).not.toContain("No open knowledge gaps");
  });
});
