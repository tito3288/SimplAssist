import { describe, expect, it } from "vitest";

import {
  FAQ_ANSWER_MAX_LENGTH,
  MIN_VALID_FAQS,
  MIN_VALID_SERVICES,
  evaluateContentQuality,
  filterDistinctValidFaqs,
  filterDistinctValidServices,
  isValidFaq,
  isValidService,
  normalizeKnowledgeKey,
} from "./contentQuality";

const services = (names: string[]) =>
  names.map((name) => ({ name, description: "", price: "" }));

const faqs = (questions: string[]) =>
  questions.map((question) => ({ question, answer: "A useful answer" }));

describe("content quality policy", () => {
  it("uses one trim, whitespace, and case-insensitive uniqueness key", () => {
    expect(normalizeKnowledgeKey("  Emergency   PLUMBING \n Service  ")).toBe(
      "emergency plumbing service"
    );
    expect(normalizeKnowledgeKey(null)).toBe("");
  });

  it("accepts service names without requiring a description or price", () => {
    expect(isValidService({ name: "Drain cleaning" })).toBe(true);
    expect(isValidService({ name: "   ", is_active: true })).toBe(false);
    expect(isValidService({ name: "Drain cleaning", is_active: false })).toBe(
      false
    );
    expect(isValidService({ name: "Drain cleaning", is_active: null })).toBe(
      false
    );
  });

  it("requires a complete active FAQ within the answer limit", () => {
    expect(isValidFaq({ question: "Hours?", answer: "9 to 5" })).toBe(true);
    expect(isValidFaq({ question: "Hours?", answer: "   " })).toBe(false);
    expect(
      isValidFaq({
        question: "Hours?",
        answer: "x".repeat(FAQ_ANSWER_MAX_LENGTH),
      })
    ).toBe(true);
    expect(
      isValidFaq({
        question: "Hours?",
        answer: "x".repeat(FAQ_ANSWER_MAX_LENGTH + 1),
      })
    ).toBe(false);
    expect(
      isValidFaq({
        question: "Hours?",
        answer: ` ${"x".repeat(FAQ_ANSWER_MAX_LENGTH - 1)} `,
      })
    ).toBe(false);
    expect(
      isValidFaq({ question: "Hours?", answer: "9 to 5", is_active: false })
    ).toBe(false);
    expect(
      isValidFaq({ question: "Hours?", answer: "9 to 5", is_active: null })
    ).toBe(false);
  });

  it("keeps only the first distinct valid active entry", () => {
    const serviceRows = [
      { name: "Drain Cleaning" },
      { name: " drain   cleaning " },
      { name: "Water heaters", is_active: false },
      { name: "Repiping" },
    ];
    const faqRows = [
      { question: "What are your hours?", answer: "Weekdays" },
      { question: " what   ARE your HOURS? ", answer: "Every day" },
      { question: "Where are you?", answer: "" },
      { question: "Do you travel?", answer: "Yes" },
    ];

    expect(filterDistinctValidServices(serviceRows)).toEqual([
      serviceRows[0],
      serviceRows[3],
    ]);
    expect(filterDistinctValidFaqs(faqRows)).toEqual([
      faqRows[0],
      faqRows[3],
    ]);
  });

  it("is ready at exactly three distinct services and three FAQs", () => {
    const serviceRows = services(["One", "Two", "Three"]);
    const faqRows = faqs(["One?", "Two?", "Three?"]);
    const result = evaluateContentQuality({
      services: serviceRows,
      faqs: faqRows,
    });

    expect(result).toMatchObject({
      validServiceCount: MIN_VALID_SERVICES,
      validFaqCount: MIN_VALID_FAQS,
      hasMinimumServices: true,
      hasMinimumFaqs: true,
      meetsMinimum: true,
      servicesReady: true,
      faqsReady: true,
      ready: true,
    });
    expect(evaluateContentQuality(serviceRows, faqRows)).toEqual(result);
    expect(evaluateContentQuality(null, faqRows)).toMatchObject({
      validServiceCount: 0,
      validFaqCount: MIN_VALID_FAQS,
      ready: false,
    });
  });

  it.each([
    {
      serviceNames: ["One", "Two"],
      faqQuestions: ["One?", "Two?", "Three?"],
      serviceReady: false,
      faqReady: true,
    },
    {
      serviceNames: ["One", "Two", "Three"],
      faqQuestions: ["One?", "Two?"],
      serviceReady: true,
      faqReady: false,
    },
  ])(
    "is not ready when either section is below its threshold",
    ({ serviceNames, faqQuestions, serviceReady, faqReady }) => {
      expect(
        evaluateContentQuality({
          services: services(serviceNames),
          faqs: faqs(faqQuestions),
        })
      ).toMatchObject({
        hasMinimumServices: serviceReady,
        hasMinimumFaqs: faqReady,
        meetsMinimum: false,
      });
    }
  );
});
