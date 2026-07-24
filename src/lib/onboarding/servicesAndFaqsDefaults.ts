import {
  MIN_VALID_FAQS,
  MIN_VALID_SERVICES,
  normalizeKnowledgeKey,
} from "@/lib/contentQuality";

export type EditableService = {
  name: string;
  description?: string;
  price?: string;
};

export type EditableFaq = {
  question: string;
  answer: string;
};

export type ServicesAndFaqsValues = {
  services: EditableService[];
  faqs: EditableFaq[];
};

type BuildServicesAndFaqsDefaultsInput = {
  initialData?: ServicesAndFaqsValues;
  scrapedServices?: readonly EditableService[];
  scrapedFaqs?: readonly EditableFaq[];
  suggestedFaqs: readonly EditableFaq[];
};

export type ServicesAndFaqsDefaults = ServicesAndFaqsValues & {
  usedSuggestedFaqs: boolean;
};

const blankService = (): EditableService => ({
  name: "",
  description: "",
  price: "",
});

const blankFaq = (): EditableFaq => ({
  question: "",
  answer: "",
});

function cloneService(service: EditableService): EditableService {
  return {
    name: service.name,
    description: service.description ?? "",
    price: service.price ?? "",
  };
}

function cloneFaq(faq: EditableFaq): EditableFaq {
  return {
    question: faq.question,
    answer: faq.answer,
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

  const services = (
    hasSavedData ? initialData?.services : scrapedServices
  )?.map(cloneService) ?? [];
  const faqs = (
    hasSavedData ? initialData?.faqs : scrapedFaqs
  )?.map(cloneFaq) ?? [];

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

    faqs.push(cloneFaq(suggestedFaq));
    seenQuestions.add(key);
    usedSuggestedFaqs = true;
  }

  while (faqs.length < MIN_VALID_FAQS) {
    faqs.push(blankFaq());
  }

  return { services, faqs, usedSuggestedFaqs };
}
