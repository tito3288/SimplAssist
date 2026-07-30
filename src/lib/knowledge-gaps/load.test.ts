import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeGap } from "@/types/database";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  gt: vi.fn(),
  limit: vi.fn(),
}));

import {
  KNOWLEDGE_GAP_PAGE_SIZE,
  loadKnowledgeGaps,
} from "./load";

function gap(index: number): KnowledgeGap {
  const id = `gap-${index.toString().padStart(4, "0")}`;
  return {
    id,
    business_id: "business-1",
    question_text: `Question ${index}`,
    normalized_question: `question ${index}`,
    ai_response_text: "Please contact us.",
    channel: "sms",
    conversation_id: null,
    source_message_id: null,
    occurrence_count: 1,
    status: "open",
    resolved_faq_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
  };
}

function client() {
  return { from: mocks.from } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  const query = {
    select: mocks.select,
    eq: mocks.eq,
    order: mocks.order,
    gt: mocks.gt,
    limit: mocks.limit,
  };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
  mocks.order.mockReturnValue(query);
  mocks.gt.mockReturnValue(query);
});

describe("loadKnowledgeGaps", () => {
  it("loads all pages past Supabase's API row cap", async () => {
    const firstPage = Array.from(
      { length: KNOWLEDGE_GAP_PAGE_SIZE },
      (_, index) => gap(index)
    );
    const secondPage = [gap(KNOWLEDGE_GAP_PAGE_SIZE)];
    mocks.limit
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: secondPage, error: null });

    const result = await loadKnowledgeGaps(client(), "business-1");

    expect(result).toEqual({
      data: [...firstPage, ...secondPage],
      error: null,
    });
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.from).toHaveBeenCalledWith("knowledge_gaps");
    expect(mocks.select).toHaveBeenCalledWith("*");
    expect(mocks.eq).toHaveBeenCalledWith("business_id", "business-1");
    expect(mocks.order).toHaveBeenCalledWith("id", { ascending: true });
    expect(mocks.gt).toHaveBeenCalledOnce();
    expect(mocks.gt).toHaveBeenCalledWith(
      "id",
      firstPage[firstPage.length - 1].id
    );
    expect(mocks.limit).toHaveBeenNthCalledWith(
      1,
      KNOWLEDGE_GAP_PAGE_SIZE
    );
    expect(mocks.limit).toHaveBeenNthCalledWith(
      2,
      KNOWLEDGE_GAP_PAGE_SIZE
    );
  });

  it("returns an explicit failure without presenting a partial list", async () => {
    const queryError = { message: "database unavailable" };
    mocks.limit
      .mockResolvedValueOnce({
        data: Array.from(
          { length: KNOWLEDGE_GAP_PAGE_SIZE },
          (_, index) => gap(index)
        ),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: queryError });

    await expect(
      loadKnowledgeGaps(client(), "business-1")
    ).resolves.toEqual({
      data: [],
      error: queryError,
    });
  });

  it("treats a null successful payload as an empty final page", async () => {
    mocks.limit.mockResolvedValue({ data: null, error: null });

    await expect(
      loadKnowledgeGaps(client(), "business-1")
    ).resolves.toEqual({
      data: [],
      error: null,
    });
  });
});
