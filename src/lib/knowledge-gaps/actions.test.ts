import { beforeEach, describe, expect, it, vi } from "vitest";
import { FAQ_ANSWER_MAX_LENGTH } from "@/lib/contentQuality";
import {
  CONVERSION_ERROR_MESSAGE,
  DISMISSAL_ERROR_MESSAGE,
  DUPLICATE_FAQ_MESSAGE,
  GAP_NO_LONGER_OPEN_MESSAGE,
  dismissKnowledgeGap,
  resolveKnowledgeGapWithFaq,
  validateKnowledgeGapFaq,
  type KnowledgeGapMutationClient,
} from "./actions";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

function client(): KnowledgeGapMutationClient {
  return {
    rpc: mocks.rpc,
    from: mocks.from,
  } as unknown as KnowledgeGapMutationClient;
}

function dismissalQuery(
  result: {
    data: { id: string } | null;
    error: { code?: string; message: string } | null;
  }
) {
  const query = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };

  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.select.mockReturnValue(query);
  mocks.from.mockReturnValue(query);

  return query;
}

describe("validateKnowledgeGapFaq", () => {
  it.each([
    ["   ", "An answer", "A question is required."],
    ["A question", " \n ", "An answer is required."],
  ])("validates trimmed required fields", (question, answer, message) => {
    expect(validateKnowledgeGapFaq(question, answer)).toBe(message);
  });

  it("enforces the trimmed 2,000-character answer limit", () => {
    expect(
      validateKnowledgeGapFaq(
        "A question",
        ` ${"a".repeat(FAQ_ANSWER_MAX_LENGTH)} `
      )
    ).toBeNull();
    expect(
      validateKnowledgeGapFaq(
        "A question",
        "a".repeat(FAQ_ANSWER_MAX_LENGTH + 1)
      )
    ).toBe("Answer must be 2,000 characters or less.");
  });
});

describe("resolveKnowledgeGapWithFaq", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validation errors without calling the database", async () => {
    const result = await resolveKnowledgeGapWithFaq(client(), {
      gapId: "gap-1",
      question: "Question",
      answer: " ",
    });

    expect(result).toEqual({
      ok: false,
      message: "An answer is required.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("sends exact RPC arguments and returns trimmed values after success", async () => {
    mocks.rpc.mockResolvedValue({ data: "faq-1", error: null });

    const result = await resolveKnowledgeGapWithFaq(client(), {
      gapId: "gap-1",
      question: "  Do you offer free trials?  ",
      answer: "  Please call us to discuss trial options. \n",
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "resolve_knowledge_gap_with_faq",
      {
        p_gap_id: "gap-1",
        p_question: "Do you offer free trials?",
        p_answer: "Please call us to discuss trial options.",
      }
    );
    expect(result).toEqual({
      ok: true,
      faqId: "faq-1",
      question: "Do you offer free trials?",
      answer: "Please call us to discuss trial options.",
    });
  });

  it("maps normalized duplicate FAQ errors to helpful guidance", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: "23505",
        message:
          "An active FAQ with the same normalized question already exists",
      },
    });

    await expect(
      resolveKnowledgeGapWithFaq(client(), {
        gapId: "gap-1",
        question: "Do you offer free trials?",
        answer: "Yes.",
      })
    ).resolves.toEqual({
      ok: false,
      message: DUPLICATE_FAQ_MESSAGE,
    });
  });

  it("maps thrown duplicate errors without exposing database details", async () => {
    mocks.rpc.mockRejectedValue({
      code: "23505",
      message: "duplicate key value contains private details",
    });

    await expect(
      resolveKnowledgeGapWithFaq(client(), {
        gapId: "gap-1",
        question: "Question",
        answer: "Answer",
      })
    ).resolves.toEqual({
      ok: false,
      message: DUPLICATE_FAQ_MESSAGE,
    });
  });

  it.each(["P0002", "40001"])(
    "maps a %s lifecycle race to refresh guidance",
    async (code) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code, message: "private database detail" },
      });

      await expect(
        resolveKnowledgeGapWithFaq(client(), {
          gapId: "gap-1",
          question: "Question",
          answer: "Answer",
        })
      ).resolves.toEqual({
        ok: false,
        message: GAP_NO_LONGER_OPEN_MESSAGE,
      });
    }
  );

  it.each([
    {
      name: "RPC error",
      setup: () =>
        mocks.rpc.mockResolvedValue({
          data: null,
          error: { code: "23514", message: "invalid FAQ" },
        }),
    },
    {
      name: "missing FAQ id",
      setup: () => mocks.rpc.mockResolvedValue({ data: null, error: null }),
    },
    {
      name: "unexpected rejection",
      setup: () => mocks.rpc.mockRejectedValue(new Error("network failed")),
    },
  ])("returns a generic conversion error for $name", async ({ setup }) => {
    setup();

    await expect(
      resolveKnowledgeGapWithFaq(client(), {
        gapId: "gap-1",
        question: "Question",
        answer: "Answer",
      })
    ).resolves.toEqual({
      ok: false,
      message: CONVERSION_ERROR_MESSAGE,
    });
  });
});

describe("dismissKnowledgeGap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("guards the owner update by business, gap, and open status", async () => {
    const query = dismissalQuery({
      data: { id: "gap-1" },
      error: null,
    });

    const result = await dismissKnowledgeGap(client(), {
      businessId: "business-1",
      gapId: "gap-1",
    });

    expect(mocks.from).toHaveBeenCalledWith("knowledge_gaps");
    expect(query.update).toHaveBeenCalledWith({ status: "dismissed" });
    expect(query.eq).toHaveBeenNthCalledWith(
      1,
      "business_id",
      "business-1"
    );
    expect(query.eq).toHaveBeenNthCalledWith(2, "id", "gap-1");
    expect(query.eq).toHaveBeenNthCalledWith(3, "status", "open");
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.maybeSingle).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true });
  });

  it("detects a no-row race instead of reporting a successful dismissal", async () => {
    dismissalQuery({ data: null, error: null });

    await expect(
      dismissKnowledgeGap(client(), {
        businessId: "business-1",
        gapId: "gap-1",
      })
    ).resolves.toEqual({
      ok: false,
      message: GAP_NO_LONGER_OPEN_MESSAGE,
    });
  });

  it("returns a generic error for database failures", async () => {
    dismissalQuery({
      data: null,
      error: { code: "42501", message: "private database detail" },
    });

    await expect(
      dismissKnowledgeGap(client(), {
        businessId: "business-1",
        gapId: "gap-1",
      })
    ).resolves.toEqual({
      ok: false,
      message: DISMISSAL_ERROR_MESSAGE,
    });
  });

  it("returns a generic error for unexpected query failures", async () => {
    mocks.from.mockImplementation(() => {
      throw new Error("client failed");
    });

    await expect(
      dismissKnowledgeGap(client(), {
        businessId: "business-1",
        gapId: "gap-1",
      })
    ).resolves.toEqual({
      ok: false,
      message: DISMISSAL_ERROR_MESSAGE,
    });
  });
});
