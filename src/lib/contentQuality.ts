export const MIN_VALID_SERVICES = 3;
export const MIN_VALID_FAQS = 3;
export const FAQ_ANSWER_MAX_LENGTH = 2000;

export type ServiceKnowledgeContent = {
  name?: string | null;
  is_active?: boolean | null;
};

export type FaqKnowledgeContent = {
  question?: string | null;
  answer?: string | null;
  is_active?: boolean | null;
};

export type ContentQualityInput = {
  services?: readonly ServiceKnowledgeContent[] | null;
  faqs?: readonly FaqKnowledgeContent[] | null;
};

export type ContentQualityEvaluation = {
  validServiceCount: number;
  validFaqCount: number;
  hasMinimumServices: boolean;
  hasMinimumFaqs: boolean;
  meetsMinimum: boolean;
  servicesReady: boolean;
  faqsReady: boolean;
  ready: boolean;
};

/**
 * Builds the comparison key used for knowledge-base uniqueness. We retain the
 * customer's original capitalization and spacing when saving; this normalized
 * representation is only for validation and counting.
 */
export function normalizeKnowledgeKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Form and scan rows omit `is_active`, so omission means active. Persisted
 * legacy rows can explicitly contain null, which the database and AI queries
 * treat as inactive.
 */
function isKnowledgeRowActive(
  row: ServiceKnowledgeContent | FaqKnowledgeContent
): boolean {
  return Object.prototype.hasOwnProperty.call(row, "is_active")
    ? row.is_active === true
    : true;
}

export function isValidService(service: ServiceKnowledgeContent): boolean {
  return (
    isKnowledgeRowActive(service) &&
    normalizeKnowledgeKey(service.name).length > 0
  );
}

export function isValidFaq(faq: FaqKnowledgeContent): boolean {
  if (!isKnowledgeRowActive(faq)) return false;

  const question = normalizeKnowledgeKey(faq.question);
  const answer = typeof faq.answer === "string" ? faq.answer : "";

  return (
    question.length > 0 &&
    answer.trim().length > 0 &&
    answer.length <= FAQ_ANSWER_MAX_LENGTH
  );
}

function filterDistinctValid<T>(
  rows: readonly T[] | null | undefined,
  isValid: (row: T) => boolean,
  keyFor: (row: T) => string
): T[] {
  const distinct: T[] = [];
  const seen = new Set<string>();

  for (const row of rows ?? []) {
    if (!isValid(row)) continue;

    const key = keyFor(row);
    if (seen.has(key)) continue;

    seen.add(key);
    distinct.push(row);
  }

  return distinct;
}

export function filterDistinctValidServices<
  T extends ServiceKnowledgeContent,
>(services: readonly T[] | null | undefined): T[] {
  return filterDistinctValid(
    services,
    isValidService,
    (service) => normalizeKnowledgeKey(service.name)
  );
}

export function filterDistinctValidFaqs<T extends FaqKnowledgeContent>(
  faqs: readonly T[] | null | undefined
): T[] {
  return filterDistinctValid(
    faqs,
    isValidFaq,
    (faq) => normalizeKnowledgeKey(faq.question)
  );
}

export function evaluateContentQuality(
  input: ContentQualityInput
): ContentQualityEvaluation;
export function evaluateContentQuality(
  services: readonly ServiceKnowledgeContent[] | null | undefined,
  faqs: readonly FaqKnowledgeContent[] | null | undefined
): ContentQualityEvaluation;
export function evaluateContentQuality(
  inputOrServices:
    | ContentQualityInput
    | readonly ServiceKnowledgeContent[]
    | null
    | undefined,
  faqRows?: readonly FaqKnowledgeContent[] | null
): ContentQualityEvaluation {
  const { services, faqs } =
    Array.isArray(inputOrServices) || inputOrServices == null
    ? { services: inputOrServices, faqs: faqRows }
    : ((inputOrServices ?? {}) as ContentQualityInput);
  const validServiceCount = filterDistinctValidServices(services).length;
  const validFaqCount = filterDistinctValidFaqs(faqs).length;
  const hasMinimumServices = validServiceCount >= MIN_VALID_SERVICES;
  const hasMinimumFaqs = validFaqCount >= MIN_VALID_FAQS;
  const meetsMinimum = hasMinimumServices && hasMinimumFaqs;

  return {
    validServiceCount,
    validFaqCount,
    hasMinimumServices,
    hasMinimumFaqs,
    meetsMinimum,
    // Readiness aliases keep call sites expressive while exposing stable,
    // explicit minimum fields to server-side launch enforcement.
    servicesReady: hasMinimumServices,
    faqsReady: hasMinimumFaqs,
    ready: meetsMinimum,
  };
}
