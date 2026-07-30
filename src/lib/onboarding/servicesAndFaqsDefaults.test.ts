import { describe, expect, it } from "vitest";

import { buildServicesAndFaqsDefaults } from "./servicesAndFaqsDefaults";

const suggestions = [
  { question: "What are your hours?", answer: "" },
  { question: "Where are you located?", answer: "" },
  { question: "Do you offer estimates?", answer: "" },
];

describe("buildServicesAndFaqsDefaults", () => {
  it.each([
    ["missing scan", undefined, undefined],
    ["empty scan", [], []],
  ])("starts %s with three service and FAQ rows", (_label, scrapedServices, scrapedFaqs) => {
    const result = buildServicesAndFaqsDefaults({
      scrapedServices,
      scrapedFaqs,
      suggestedFaqs: suggestions,
    });

    expect(result.services).toHaveLength(3);
    expect(result.services.every((service) => service.name === "")).toBe(true);
    expect(result.services.every((service) => service.source === "manual")).toBe(
      true
    );
    expect(result.faqs).toEqual(
      suggestions.map((faq) => ({ ...faq, source: "suggested" }))
    );
    expect(result.usedSuggestedFaqs).toBe(true);
  });

  it("preserves partial scan results and pads each collection independently", () => {
    const result = buildServicesAndFaqsDefaults({
      scrapedServices: [{ name: "Drain cleaning", description: "Fast" }],
      scrapedFaqs: [
        { question: "What are your hours?", answer: "Always open" },
      ],
      suggestedFaqs: suggestions,
    });

    expect(result.services).toEqual([
      {
        name: "Drain cleaning",
        description: "Fast",
        price: "",
        source: "scraped",
      },
      { name: "", description: "", price: "", source: "manual" },
      { name: "", description: "", price: "", source: "manual" },
    ]);
    expect(result.faqs).toEqual([
      {
        question: "What are your hours?",
        answer: "Always open",
        source: "scraped",
      },
      { ...suggestions[1], source: "suggested" },
      { ...suggestions[2], source: "suggested" },
    ]);
    expect(result.usedSuggestedFaqs).toBe(true);
  });

  it("does not truncate complete scans with more than three rows", () => {
    const scannedServices = ["One", "Two", "Three", "Four"].map((name) => ({
      name,
    }));
    const scannedFaqs = ["One?", "Two?", "Three?", "Four?"].map(
      (question) => ({ question, answer: "Yes" })
    );

    const result = buildServicesAndFaqsDefaults({
      scrapedServices: scannedServices,
      scrapedFaqs: scannedFaqs,
      suggestedFaqs: suggestions,
    });

    expect(result.services).toHaveLength(4);
    expect(result.faqs).toHaveLength(4);
    expect(result.services.every((service) => service.source === "scraped")).toBe(
      true
    );
    expect(result.faqs.every((faq) => faq.source === "scraped")).toBe(true);
    expect(result.usedSuggestedFaqs).toBe(false);
  });

  it("lets saved data win wholesale when only saved FAQs exist", () => {
    const savedFaq = {
      question: "A saved question?",
      answer: "Saved answer",
      source: "scraped" as const,
    };
    const result = buildServicesAndFaqsDefaults({
      initialData: { services: [], faqs: [savedFaq] },
      scrapedServices: [{ name: "Scanned service" }],
      scrapedFaqs: [{ question: "Scanned FAQ?", answer: "Scanned answer" }],
      suggestedFaqs: suggestions,
    });

    expect(result.services.map((service) => service.name)).toEqual([
      "",
      "",
      "",
    ]);
    expect(result.services.every((service) => service.source === "manual")).toBe(
      true
    );
    expect(result.faqs[0]).toEqual(savedFaq);
    expect(result.faqs).not.toContainEqual({
      question: "Scanned FAQ?",
      answer: "Scanned answer",
      source: "scraped",
    });
  });

  it("preserves mixed saved sources when cloning resume data", () => {
    const result = buildServicesAndFaqsDefaults({
      initialData: {
        services: [
          {
            name: "Scanned service edited by owner",
            source: "scraped",
          },
          { name: "Owner service", source: "manual" },
          { name: "Suggested service", source: "suggested" },
        ],
        faqs: [
          {
            question: "Scanned question edited by owner?",
            answer: "Yes",
            source: "scraped",
          },
          {
            question: "Suggested question edited by owner?",
            answer: "Yes",
            source: "suggested",
          },
          {
            question: "Owner question?",
            answer: "Yes",
            source: "manual",
          },
        ],
      },
      scrapedServices: [{ name: "New scanned service" }],
      scrapedFaqs: [{ question: "New scanned FAQ?", answer: "No" }],
      suggestedFaqs: suggestions,
    });

    expect(result.services.map((service) => service.source)).toEqual([
      "scraped",
      "manual",
      "suggested",
    ]);
    expect(result.faqs.map((faq) => faq.source)).toEqual([
      "scraped",
      "suggested",
      "manual",
    ]);
    expect(result.services.some((service) => service.name === "New scanned service")).toBe(
      false
    );
  });

  it("skips normalized duplicate suggestions and pads with a blank if needed", () => {
    const result = buildServicesAndFaqsDefaults({
      scrapedFaqs: [
        { question: "  WHAT are   your hours? ", answer: "Weekdays" },
      ],
      suggestedFaqs: [
        suggestions[0],
        { question: "what ARE your HOURS?", answer: "" },
      ],
    });

    expect(result.faqs).toEqual([
      {
        question: "  WHAT are   your hours? ",
        answer: "Weekdays",
        source: "scraped",
      },
      { question: "", answer: "", source: "manual" },
      { question: "", answer: "", source: "manual" },
    ]);
  });

  it("does not mutate scans, saved data, or suggestion templates", () => {
    const initialData = {
      services: [{ name: "Saved", source: "manual" as const }],
      faqs: [
        {
          question: "Saved?",
          answer: "Yes",
          source: "suggested" as const,
        },
      ],
    };
    const scrapedServices = [{ name: "Scanned" }];
    const scrapedFaqs = [{ question: "Scanned?", answer: "Yes" }];
    const initialSnapshot = structuredClone(initialData);
    const servicesSnapshot = structuredClone(scrapedServices);
    const faqsSnapshot = structuredClone(scrapedFaqs);
    const suggestionsSnapshot = structuredClone(suggestions);

    const result = buildServicesAndFaqsDefaults({
      initialData,
      scrapedServices,
      scrapedFaqs,
      suggestedFaqs: suggestions,
    });
    result.services[0].name = "Edited default";
    result.faqs[0].answer = "Edited default";

    expect(result.services[0].source).toBe("manual");
    expect(result.faqs[0].source).toBe("suggested");
    expect(initialData).toEqual(initialSnapshot);
    expect(scrapedServices).toEqual(servicesSnapshot);
    expect(scrapedFaqs).toEqual(faqsSnapshot);
    expect(suggestions).toEqual(suggestionsSnapshot);
  });
});
