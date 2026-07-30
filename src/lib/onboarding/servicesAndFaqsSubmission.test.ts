import { describe, expect, it } from "vitest";

import {
  prepareServicesAndFaqsSubmission,
  servicesAndFaqsSchema,
} from "./servicesAndFaqsSubmission";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000041";

describe("prepareServicesAndFaqsSubmission", () => {
  it("keeps valid provenance through form-schema validation", () => {
    const parsed = servicesAndFaqsSchema.parse({
      services: [
        { name: "One", source: "scraped" },
        { name: "Two", source: "manual" },
        { name: "Three", source: "suggested" },
      ],
      faqs: [
        { question: "One?", answer: "Yes", source: "suggested" },
        { question: "Two?", answer: "Yes", source: "scraped" },
        { question: "Three?", answer: "Yes", source: "manual" },
      ],
    });

    expect(parsed.services.map((row) => row.source)).toEqual([
      "scraped",
      "manual",
      "suggested",
    ]);
    expect(parsed.faqs.map((row) => row.source)).toEqual([
      "suggested",
      "scraped",
      "manual",
    ]);
    expect(() =>
      servicesAndFaqsSchema.parse({
        ...parsed,
        services: [
          ...parsed.services.slice(0, 2),
          { name: "Three", source: "unknown" },
        ],
      })
    ).toThrow();
  });

  it("preserves provenance while trimming rows and building both RPC payloads", () => {
    const input = {
      services: [
        {
          name: "  Drain cleaning  ",
          description: "  Same-day appointments  ",
          price: "  $99  ",
          source: "scraped" as const,
        },
        {
          name: "Owner-added service",
          description: "",
          price: "",
          source: "manual" as const,
        },
        {
          name: "Suggested service edited by owner",
          source: "suggested" as const,
        },
      ],
      faqs: [
        {
          question: "  Do you offer estimates?  ",
          answer: "  Call for details.  ",
          source: "suggested" as const,
        },
        {
          question: "Scanned question edited by owner?",
          answer: "  Yes.  ",
          source: "scraped" as const,
        },
        {
          question: "Owner question?",
          answer: "Owner answer.",
          source: "manual" as const,
        },
      ],
    };
    const snapshot = structuredClone(input);

    const result = prepareServicesAndFaqsSubmission(BUSINESS_ID, input);

    expect(result.cleanedData).toEqual({
      services: [
        {
          name: "Drain cleaning",
          description: "Same-day appointments",
          price: "$99",
          source: "scraped",
        },
        {
          name: "Owner-added service",
          description: "",
          price: "",
          source: "manual",
        },
        {
          name: "Suggested service edited by owner",
          description: "",
          price: "",
          source: "suggested",
        },
      ],
      faqs: [
        {
          question: "Do you offer estimates?",
          answer: "Call for details.",
          source: "suggested",
        },
        {
          question: "Scanned question edited by owner?",
          answer: "Yes.",
          source: "scraped",
        },
        {
          question: "Owner question?",
          answer: "Owner answer.",
          source: "manual",
        },
      ],
    });
    expect(result.rpcArguments).toEqual({
      p_business_id: BUSINESS_ID,
      p_services: [
        {
          name: "Drain cleaning",
          description: "Same-day appointments",
          price: "$99",
          source: "scraped",
        },
        {
          name: "Owner-added service",
          description: null,
          price: null,
          source: "manual",
        },
        {
          name: "Suggested service edited by owner",
          description: null,
          price: null,
          source: "suggested",
        },
      ],
      p_faqs: result.cleanedData.faqs,
    });
    expect(input).toEqual(snapshot);
  });

  it("keeps the first valid duplicate row and its source", () => {
    const result = prepareServicesAndFaqsSubmission(BUSINESS_ID, {
      services: [
        { name: " Drain Cleaning ", source: "scraped" },
        { name: "drain   cleaning", source: "manual" },
        { name: "Repairs", source: "manual" },
      ],
      faqs: [
        {
          question: "Do you offer estimates?",
          answer: "Scanned answer",
          source: "scraped",
        },
        {
          question: "  DO you offer   estimates? ",
          answer: "Owner answer",
          source: "manual",
        },
        {
          question: "Where are you located?",
          answer: "Downtown",
          source: "suggested",
        },
      ],
    });

    expect(result.cleanedData.services).toEqual([
      {
        name: "Drain Cleaning",
        description: "",
        price: "",
        source: "scraped",
      },
      {
        name: "Repairs",
        description: "",
        price: "",
        source: "manual",
      },
    ]);
    expect(result.cleanedData.faqs).toEqual([
      {
        question: "Do you offer estimates?",
        answer: "Scanned answer",
        source: "scraped",
      },
      {
        question: "Where are you located?",
        answer: "Downtown",
        source: "suggested",
      },
    ]);
    expect(result.rpcArguments.p_services.map((row) => row.source)).toEqual([
      "scraped",
      "manual",
    ]);
    expect(result.rpcArguments.p_faqs.map((row) => row.source)).toEqual([
      "scraped",
      "suggested",
    ]);
  });
});
