import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { WebsiteScanBaseline, WebsiteScanPage } from "./domain";
import {
  buildValidatedDraft,
  type RawWebsiteExtraction,
  WebsiteExtractionError,
} from "./extraction";

const page: WebsiteScanPage = {
  url: "https://example.com/services",
  title: "Services",
  markdown:
    "Acme Plumbing offers drain cleaning and pipe repair. Drain cleaning starts at $99. We provide a 30-day workmanship warranty.",
  contentHash: "hash",
  characterCount: 128,
};

function rawExtraction(): RawWebsiteExtraction {
  const sourcedNull = { value: null, evidence: [] };
  return {
    overview: {
      content: "Acme Plumbing provides drain cleaning and pipe repair services.",
      evidence: [{ sourceIndex: 0, excerpt: "Acme Plumbing offers drain cleaning and pipe repair." }],
    },
    business: {
      business_name: {
        value: "Acme Plumbing",
        evidence: [{ sourceIndex: 0, excerpt: "Acme Plumbing offers drain cleaning and pipe repair." }],
      },
      phone_number: sourcedNull,
      address: sourcedNull,
      city: sourcedNull,
      state: sourcedNull,
      zip: sourcedNull,
    },
    business_hours: [],
    services: [
      {
        name: "Drain Cleaning",
        description: "Professional drain cleaning.",
        price: "$99",
        evidence: [{ sourceIndex: 0, excerpt: "Drain cleaning starts at $99." }],
      },
      {
        name: "drain-cleaning",
        description: "Duplicate",
        price: "",
        evidence: [{ sourceIndex: 0, excerpt: "Drain cleaning starts at $99." }],
      },
      {
        name: "Emergency service",
        description: "Invented",
        price: "",
        evidence: [{ sourceIndex: 0, excerpt: "Available twenty-four hours every day." }],
      },
    ],
    faqs: [
      {
        question: "Do you offer a warranty?",
        answer: "Yes, a 30-day workmanship warranty.",
        evidence: [{ sourceIndex: 0, excerpt: "We provide a 30-day workmanship warranty." }],
      },
    ],
    knowledge: [
      {
        kind: "policy",
        category: "warranty",
        title: "Workmanship warranty",
        content: "Work is covered by a 30-day workmanship warranty.",
        evidence: [{ sourceIndex: 0, excerpt: "We provide a 30-day workmanship warranty." }],
      },
    ],
    questions: [
      {
        prompt: "What geographic service area do you cover?",
        reason: "A service area was not found on the website.",
        outputKind: "fact",
        outputTitle: "Service area",
      },
    ],
  };
}

describe("website knowledge extraction validation", () => {
  it("requires exact source evidence and deduplicates semantic suggestions", () => {
    const draft = buildValidatedDraft(rawExtraction(), [page], {}, { now: new Date("2026-01-01T00:00:00Z") });
    expect(draft.services).toHaveLength(1);
    expect(draft.services[0]).toMatchObject({
      name: "Drain Cleaning",
      selected: true,
      changeType: "new",
      targetId: null,
      sources: [{ url: page.url, excerpt: "Drain cleaning starts at $99." }],
    });
    expect(draft.profilePrefill.business_name).toBe("Acme Plumbing");
    expect(draft.overview).toMatchObject({
      selected: true,
      changeType: "new",
      targetId: null,
      baselineHash: null,
    });
    expect(draft.questions[0]).toMatchObject({ outputKind: "fact", outputTitle: "Service area" });
  });

  it("marks changed rows for keep-current review and reports only missing scraped rows", () => {
    const serviceContent = "Drain Cleaning|Old description|$89";
    const hash = fingerprint(serviceContent);
    const baseline: WebsiteScanBaseline = {
      overview: {
        id: "44444444-4444-4444-8444-444444444444",
        key: "overview",
        content: "overview|business_overview|Business overview|Old overview",
        baselineHash: fingerprint(
          "overview|business_overview|Business overview|Old overview"
        ),
        source: "scraped",
        ownerEdited: true,
      },
      services: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          key: "Drain Cleaning",
          content: serviceContent,
          baselineHash: hash,
          source: "scraped",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          key: "Pipe Repair",
          content: "Pipe Repair|Repair pipes|",
          baselineHash: fingerprint("Pipe Repair|Repair pipes|"),
          source: "scraped",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          key: "Owner-only service",
          content: "Owner-only service||",
          baselineHash: fingerprint("Owner-only service||"),
          source: "manual",
        },
      ],
    };

    const draft = buildValidatedDraft(rawExtraction(), [page], baseline);
    expect(draft.services[0]).toMatchObject({
      changeType: "changed",
      selected: false,
      targetId: "11111111-1111-4111-8111-111111111111",
      baselineHash: hash,
    });
    expect(draft.overview).toMatchObject({
      changeType: "changed",
      selected: false,
      targetId: "44444444-4444-4444-8444-444444444444",
    });
    expect(draft.missing).toEqual([
      expect.objectContaining({
        kind: "service",
        title: "Pipe Repair",
        selected: false,
        changeType: "missing",
      }),
    ]);
  });

  it("rejects a draft when the overview citation is not an exact page excerpt", () => {
    const raw = rawExtraction();
    raw.overview.evidence[0].excerpt = "A sentence that is not on the page.";
    expect(() => buildValidatedDraft(raw, [page])).toThrowError(WebsiteExtractionError);
  });
});

function fingerprint(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}
