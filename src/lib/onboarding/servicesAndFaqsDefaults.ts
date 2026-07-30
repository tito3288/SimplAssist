import {
  MIN_VALID_FAQS,
  MIN_VALID_SERVICES,
  normalizeKnowledgeKey,
} from "@/lib/contentQuality";
import type { KnowledgeSource } from "@/types/database";

export type ScannedService = {
  name: string;
  description?: string;
  price?: string;
};

export type ScannedFaq = {
  question: string;
  answer: string;
};

export type EditableService = ScannedService & {
  source: KnowledgeSource;
};

export type EditableFaq = ScannedFaq & {
  source: KnowledgeSource;
};

export type ServicesAndFaqsValues = {
  services: EditableService[];
  faqs: EditableFaq[];
};

type BuildServicesAndFaqsDefaultsInput = {
  initialData?: ServicesAndFaqsValues;
  scrapedServices?: readonly ScannedService[];
  scrapedFaqs?: readonly ScannedFaq[];
  suggestedFaqs: readonly ScannedFaq[];
};

export type ServicesAndFaqsDefaults = ServicesAndFaqsValues & {
  usedSuggestedFaqs: boolean;
};

const blankService = (): EditableService => ({
  name: "",
  description: "",
  price: "",
  source: "manual",
});

const blankFaq = (): EditableFaq => ({
  question: "",
  answer: "",
  source: "manual",
});

function cloneService(
  service: ScannedService,
  source: KnowledgeSource
): EditableService {
  return {
    name: service.name,
    description: service.description ?? "",
    price: service.price ?? "",
    source,
  };
}

function cloneFaq(faq: ScannedFaq, source: KnowledgeSource): EditableFaq {
  return {
    question: faq.question,
    answer: faq.answer,
    source,
  };
}

/**
 * Produces editable onboarding rows without mutating input data. If either
 * saved collection has content, both saved collections win as a unit and scan
 * results are ignored so a resume can never overwrite customer work.
 */
export function buildServicesAndFaqsDefaults({
  initialData,
  scrapedServices,
  scrapedFaqs,
  suggestedFaqs,
}: BuildServicesAndFaqsDefaultsInput): ServicesAndFaqsDefaults {
  const hasSavedData = Boolean(
    initialData &&
      (initialData.services.length > 0 || initialData.faqs.length > 0)
  );

  const services = hasSavedData
    ? (initialData?.services ?? []).map((service) =>
        cloneService(service, service.source)
      )
    : (scrapedServices ?? []).map((service) =>
        cloneService(service, "scraped")
      );
  const faqs = hasSavedData
    ? (initialData?.faqs ?? []).map((faq) => cloneFaq(faq, faq.source))
    : (scrapedFaqs ?? []).map((faq) => cloneFaq(faq, "scraped"));

  while (services.length < MIN_VALID_SERVICES) {
    services.push(blankService());
  }

  let usedSuggestedFaqs = false;
  const seenQuestions = new Set(
    faqs
      .map((faq) => normalizeKnowledgeKey(faq.question))
      .filter(Boolean)
  );

  for (const suggestedFaq of suggestedFaqs) {
    if (faqs.length >= MIN_VALID_FAQS) break;

    const key = normalizeKnowledgeKey(suggestedFaq.question);
    if (!key || seenQuestions.has(key)) continue;

    faqs.push(cloneFaq(suggestedFaq, "suggested"));
    seenQuestions.add(key);
    usedSuggestedFaqs = true;
  }

  while (faqs.length < MIN_VALID_FAQS) {
    faqs.push(blankFaq());
  }

  return { services, faqs, usedSuggestedFaqs };
}
