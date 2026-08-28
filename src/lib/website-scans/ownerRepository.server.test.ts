import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildOwnerReviewDraft } from "./ownerRepository.server";

const OVERVIEW_ID = "10000000-0000-4000-a000-000000000001";
const SERVICE_ID = "20000000-0000-4000-a000-000000000002";
const MISSING_ID = "30000000-0000-4000-a000-000000000003";
const QUESTION_ID = "40000000-0000-4000-a000-000000000004";

describe("website scan owner review hydration", () => {
  it("maps the canonical worker draft rows into the owner UI contract", () => {
    const draft = buildOwnerReviewDraft({
      reviewDraft: {
        overview: { text: "Canonical worker shape" },
        profilePrefill: {},
        services: [],
        faqs: [],
        knowledge: [],
        questions: [],
        scanMeta: {},
      },
      profilePrefill: {
        business_name: "Acme Plumbing",
        phone_number: null,
        address: null,
        city: "Indianapolis",
        state: "IN",
        zip: null,
        business_hours: [
          {
            day: "monday",
            open_time: "09:00",
            close_time: "17:00",
            is_closed: false,
          },
        ],
      },
      suggestions: [
        {
          id: OVERVIEW_ID,
          kind: "overview",
          category: "business_overview",
          change_type: "new",
          target_id: null,
          baseline_hash: null,
          draft_payload: {
            content: "Acme serves homeowners across Indianapolis.",
            selected: true,
          },
        },
        {
          id: SERVICE_ID,
          kind: "service",
          category: "service",
          change_type: "changed",
          target_id: "50000000-0000-4000-a000-000000000005",
          baseline_hash: "a".repeat(64),
          draft_payload: {
            name: "Drain cleaning",
            description: "Residential drains",
            price: "Call for pricing",
            selected: false,
          },
        },
        {
          id: MISSING_ID,
          kind: "faq",
          category: "faq",
          change_type: "missing",
          target_id: "60000000-0000-4000-a000-000000000006",
          baseline_hash: "b".repeat(64),
          draft_payload: { question: "Do you offer estimates?" },
        },
      ],
      sources: [
        {
          suggestion_id: SERVICE_ID,
          source_url: "https://example.com/services",
          excerpt: "Residential drain cleaning",
        },
      ],
      questions: [
        {
          id: QUESTION_ID,
          category: "policy",
          question: "What is your cancellation policy?",
          status: "unanswered",
          answer: null,
        },
      ],
    });

    expect(draft.overview).toBe(
      "Acme serves homeowners across Indianapolis.",
    );
    expect(draft.overviewMetadata?.suggestionId).toBe(OVERVIEW_ID);
    expect(draft.overviewMetadata).toMatchObject({
      selected: true,
      changeType: "new",
    });
    expect(draft.businessInfo).toMatchObject({
      business_name: "Acme Plumbing",
      city: "Indianapolis",
      state: "IN",
    });
    expect(draft.businessHours).toHaveLength(1);
    expect(draft.services).toEqual([
      expect.objectContaining({
        id: SERVICE_ID,
        targetId: "50000000-0000-4000-a000-000000000005",
        baselineHash: "a".repeat(64),
        name: "Drain cleaning",
        selected: false,
        changeType: "changed",
        evidence: [
          {
            url: "https://example.com/services",
            excerpt: "Residential drain cleaning",
          },
        ],
      }),
    ]);
    expect(draft.missingItems).toEqual([
      { id: MISSING_ID, kind: "faq", title: "Do you offer estimates?" },
    ]);
    expect(draft.questions).toEqual([
      {
        id: QUESTION_ID,
        question: "What is your cancellation policy?",
        category: "policy",
        answer: "",
        disposition: "unanswered",
      },
    ]);
  });

  it("rehydrates authoritative conflict metadata and evidence after autosave", () => {
    const saved = {
      overview: "Owner-edited briefing",
      overviewMetadata: { suggestionId: OVERVIEW_ID, selected: true },
      services: [
        {
          id: SERVICE_ID,
          name: "Owner-edited service",
          selected: true,
          targetId: null,
          baselineHash: null,
          evidence: [{ url: "https://forged.example", excerpt: "forged" }],
        },
      ],
      faqs: [],
      knowledgeItems: [],
      questions: [],
    };
    const draft = buildOwnerReviewDraft({
      reviewDraft: saved,
      profilePrefill: {},
      suggestions: [
        {
          id: OVERVIEW_ID,
          kind: "overview",
          change_type: "changed",
          target_id: null,
          baseline_hash: null,
          draft_payload: { content: "Generated" },
        },
        {
          id: SERVICE_ID,
          kind: "service",
          target_id: "50000000-0000-4000-a000-000000000005",
          baseline_hash: "c".repeat(64),
          draft_payload: { name: "Generated" },
        },
      ],
      sources: [
        {
          suggestion_id: SERVICE_ID,
          source_url: "https://example.com/services",
          excerpt: "real evidence",
        },
      ],
      questions: [],
    });

    expect(draft.overview).toBe("Owner-edited briefing");
    expect(draft.overviewMetadata).toMatchObject({
      selected: true,
      changeType: "changed",
    });
    expect(draft.services[0]).toMatchObject({
      name: "Owner-edited service",
      targetId: "50000000-0000-4000-a000-000000000005",
      baselineHash: "c".repeat(64),
      evidence: [
        { url: "https://example.com/services", excerpt: "real evidence" },
      ],
    });
  });
});
