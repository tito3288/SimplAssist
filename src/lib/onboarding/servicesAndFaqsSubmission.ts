import { z } from "zod";

import {
  MIN_VALID_FAQS,
  MIN_VALID_SERVICES,
  evaluateContentQuality,
  filterDistinctValidFaqs,
  filterDistinctValidServices,
} from "@/lib/contentQuality";
import type { ServicesAndFaqsValues } from "@/lib/onboarding/servicesAndFaqsDefaults";

const knowledgeSourceSchema = z.enum(["scraped", "manual", "suggested"]);

export const servicesAndFaqsSchema = z
  .object({
    services: z.array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        price: z.string().optional(),
        source: knowledgeSourceSchema,
      })
    ),
    faqs: z.array(
      z.object({
        question: z.string(),
        answer: z.string(),
        source: knowledgeSourceSchema,
      })
    ),
  })
  .superRefine((data, context) => {
    const quality = evaluateContentQuality(data);

    if (!quality.hasMinimumServices) {
      context.addIssue({
        code: "custom",
        path: ["services"],
        message: `Add at least ${MIN_VALID_SERVICES} distinct services with a name.`,
      });
    }

    if (!quality.hasMinimumFaqs) {
      context.addIssue({
        code: "custom",
        path: ["faqs"],
        message: `Answer at least ${MIN_VALID_FAQS} distinct FAQs.`,
      });
    }
  });

export type ServicesAndFaqsData = z.infer<typeof servicesAndFaqsSchema>;

type ServiceRpcRow = {
  name: string;
  description: string | null;
  price: string | null;
  source: ServicesAndFaqsValues["services"][number]["source"];
};

type FaqRpcRow = {
  question: string;
  answer: string;
  source: ServicesAndFaqsValues["faqs"][number]["source"];
};

export type ServicesAndFaqsSubmission = {
  cleanedData: ServicesAndFaqsValues;
  rpcArguments: {
    p_business_id: string;
    p_services: ServiceRpcRow[];
    p_faqs: FaqRpcRow[];
  };
};

/**
 * Applies the onboarding quality rules once, then builds the exact atomic RPC
 * arguments. Provenance is copied from each surviving row so text edits and
 * duplicate removal cannot reclassify scanned or suggested knowledge.
 */
export function prepareServicesAndFaqsSubmission(
  businessId: string,
  data: ServicesAndFaqsData
): ServicesAndFaqsSubmission {
  const cleanedData: ServicesAndFaqsValues = {
    services: filterDistinctValidServices(data.services).map((service) => ({
      name: service.name.trim(),
      description: service.description?.trim() || "",
      price: service.price?.trim() || "",
      source: service.source,
    })),
    faqs: filterDistinctValidFaqs(data.faqs).map((faq) => ({
      question: faq.question.trim(),
      answer: faq.answer.trim(),
      source: faq.source,
    })),
  };

  return {
    cleanedData,
    rpcArguments: {
      p_business_id: businessId,
      p_services: cleanedData.services.map((service) => ({
        name: service.name,
        description: service.description || null,
        price: service.price || null,
        source: service.source,
      })),
      p_faqs: cleanedData.faqs.map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        source: faq.source,
      })),
    },
  };
}
