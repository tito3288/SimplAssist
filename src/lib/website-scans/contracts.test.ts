import { describe, expect, it } from "vitest";

import type { WebsiteScanReviewDraft } from "./client";
import {
  toWebsiteScanPublishPayload,
  websiteScanReviewDraftSchema,
  WebsiteScanDraftValidationError,
} from "./contracts";

const SUGGESTION_ID = "10000000-0000-4000-a000-000000000001";
const QUESTION_ID = "20000000-0000-4000-a000-000000000002";
const TARGET_ID = "30000000-0000-4000-a000-000000000003";
const BASELINE_HASH = "a".repeat(64);

function draft(): WebsiteScanReviewDraft {
  return {
    overview: " A neighborhood plumbing company. ",
    overviewMetadata: { suggestionId: SUGGESTION_ID },
    services: [
      {
        id: SUGGESTION_ID,
        name: " Drain cleaning ",
        description: " Same-day appointments ",
        price: "",
        selected: true,
        evidence: [{ url: "https://example.com/services", excerpt: "Drain cleaning" }],
      },
      {
        id: "manual-service-2",
        name: "Unselected",
        selected: false,
      },
    ],
    faqs: [
      {
        id: SUGGESTION_ID,
        targetId: TARGET_ID,
        baselineHash: BASELINE_HASH,
        question: " Do you offer estimates? ",
        answer: " Yes. ",
        selected: true,
      },
    ],
    knowledgeItems: [
      {
        id: SUGGESTION_ID,
        kind: "policy",
        title: " Service area ",
        content: " We serve Marion County. ",
        selected: true,
      },
    ],
    questions: [
      {
        id: QUESTION_ID,
        question: "What is your cancellation policy?",
        answer: " Please give 24 hours notice. ",
        disposition: "answered",
      },
    ],
  };
}

describe("website scan review contracts", () => {
  it("accepts the bounded owner review shape and rejects unknown keys", () => {
    expect(websiteScanReviewDraftSchema.safeParse(draft()).success).toBe(true);
    expect(
      websiteScanReviewDraftSchema.safeParse({ ...draft(), rawMarkdown: "secret" })
        .success,
    ).toBe(false);
  });

  it("rejects non-HTTPS evidence links before they can be rendered", () => {
    const value = draft();
    value.services[0].evidence = [
      { url: "javascript:alert(1)", excerpt: "unsafe source" },
    ];

    expect(websiteScanReviewDraftSchema.safeParse(value).success).toBe(false);
  });

  it("builds the exact selected, evidence-free atomic publish payload", () => {
    const payload = toWebsiteScanPublishPayload(draft());

    expect(payload.services).toEqual([
      {
        suggestionId: SUGGESTION_ID,
        name: "Drain cleaning",
        description: "Same-day appointments",
        price: "",
      },
    ]);
    expect(payload.faqs[0]).toMatchObject({
      suggestionId: SUGGESTION_ID,
      targetId: TARGET_ID,
      baselineHash: BASELINE_HASH,
      question: "Do you offer estimates?",
      answer: "Yes.",
    });
    expect(payload.knowledge[0]).toMatchObject({
      suggestionId: SUGGESTION_ID,
      kind: "overview",
      content: "A neighborhood plumbing company.",
    });
    expect(payload.questions).toEqual([
      {
        questionId: QUESTION_ID,
        status: "answered",
        answer: "Please give 24 hours notice.",
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain("evidence");
    expect(JSON.stringify(payload)).not.toContain("Unselected");
  });

  it("requires a baseline hash before updating an existing target", () => {
    const value = draft();
    value.services[0] = {
      ...value.services[0],
      targetId: TARGET_ID,
    };

    expect(() => toWebsiteScanPublishPayload(value)).toThrow(
      WebsiteScanDraftValidationError,
    );
  });

  it("does not publish unanswered optional questions", () => {
    const value = draft();
    value.questions[0] = {
      ...value.questions[0],
      answer: "",
      disposition: "unanswered",
    };

    expect(toWebsiteScanPublishPayload(value).questions).toEqual([]);
  });

  it("keeps an existing overview when the owner does not approve the rescan change", () => {
    const value = draft();
    value.overviewMetadata = {
      suggestionId: SUGGESTION_ID,
      targetId: TARGET_ID,
      baselineHash: BASELINE_HASH,
      selected: false,
      changeType: "changed",
    };

    expect(toWebsiteScanPublishPayload(value).knowledge).toEqual([
      expect.objectContaining({ kind: "policy", title: "Service area" }),
    ]);
  });

  it("does not allow a first overview to be silently rejected", () => {
    const value = draft();
    value.overviewMetadata = {
      suggestionId: SUGGESTION_ID,
      selected: false,
      changeType: "new",
    };

    expect(() => toWebsiteScanPublishPayload(value)).toThrow(
      WebsiteScanDraftValidationError,
    );
  });
});
