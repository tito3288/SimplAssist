import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  dedupeLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  insertPausedSystemMessageIfNeeded,
  type PausedReason,
} from "./pausedNotice";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000048";
const CONVERSATION_ID = "20000000-0000-4000-a000-000000000048";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dedupeLimit.mockResolvedValue({ data: [], error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.updateEq.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue({ eq: mocks.updateEq });

  const dedupe = {
    eq: vi.fn().mockReturnThis(),
    like: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    limit: mocks.dedupeLimit,
  };
  mocks.from.mockImplementation((table: string) => {
    if (table === "messages") {
      return {
        select: vi.fn(() => dedupe),
        insert: mocks.insert,
      };
    }
    if (table === "conversations") {
      return { update: mocks.update };
    }
    throw new Error(`Unexpected table ${table}`);
  });
});

describe("insertPausedSystemMessageIfNeeded operational notices", () => {
  it.each([
    ["account_suspended", "account operations are suspended"],
    ["texting_paused", "texting is paused for this account"],
    ["ai_replies_paused", "AI replies are paused for this account"],
  ] satisfies Array<[PausedReason, string]>)(
    "stores a dedupe-compatible internal notice for %s",
    async (reason, expectedCopy) => {
      await insertPausedSystemMessageIfNeeded({
        conversationId: CONVERSATION_ID,
        businessId: BUSINESS_ID,
        channel: "sms",
        context: "ai_reply",
        reason,
      });

      expect(mocks.insert).toHaveBeenCalledWith({
        conversation_id: CONVERSATION_ID,
        business_id: BUSINESS_ID,
        role: "system",
        content: expect.stringContaining("SMS sending is paused"),
        channel: "sms",
      });
      expect(mocks.insert.mock.calls[0]?.[0]?.content).toContain(expectedCopy);
    },
  );

  it("does not append a second operational notice inside the dedupe window", async () => {
    mocks.dedupeLimit.mockResolvedValue({
      data: [{ id: "existing-notice" }],
      error: null,
    });

    await insertPausedSystemMessageIfNeeded({
      conversationId: CONVERSATION_ID,
      businessId: BUSINESS_ID,
      channel: "sms",
      context: "mms_fallback",
      reason: "account_suspended",
    });

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
