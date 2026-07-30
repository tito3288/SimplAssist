import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
  },
}));

import { recordKnowledgeGap } from "./knowledgeGaps";

const INPUT = {
  businessId: "00000000-0000-4000-8000-000000000001",
  sourceMessageId: "00000000-0000-4000-8000-000000000002",
  aiResponseText: "I don't see free trials mentioned. Please call us.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.rpc.mockResolvedValue({ data: "gap-1", error: null });
});

describe("recordKnowledgeGap", () => {
  it("passes the capture fields to the service-role RPC", async () => {
    await expect(recordKnowledgeGap(INPUT)).resolves.toBe(true);

    expect(mocks.rpc).toHaveBeenCalledWith("record_knowledge_gap", {
      p_business_id: INPUT.businessId,
      p_source_message_id: INPUT.sourceMessageId,
      p_ai_response_text: INPUT.aiResponseText,
    });
  });

  it("returns false instead of throwing when the RPC reports an error", async () => {
    const error = { message: "database unavailable" };
    mocks.rpc.mockResolvedValue({ data: null, error });

    await expect(recordKnowledgeGap(INPUT)).resolves.toBe(false);

    expect(console.error).toHaveBeenCalledWith(
      `[knowledge-gaps] Capture failed for business=${INPUT.businessId} source_message=${INPUT.sourceMessageId}:`,
      error
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      INPUT.aiResponseText
    );
  });

  it("returns false instead of throwing when the RPC rejects", async () => {
    const error = new Error("connection reset");
    mocks.rpc.mockRejectedValue(error);

    await expect(recordKnowledgeGap(INPUT)).resolves.toBe(false);

    expect(console.error).toHaveBeenCalledWith(
      `[knowledge-gaps] Capture threw for business=${INPUT.businessId} source_message=${INPUT.sourceMessageId}:`,
      error
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      INPUT.aiResponseText
    );
  });
});
