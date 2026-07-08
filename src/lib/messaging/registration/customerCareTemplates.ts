import type { BusinessType } from "@/types/database";

export interface CustomerCareTemplateInput {
  businessName: string;
  businessType?: BusinessType | null;
  businessTypeOther?: string | null;
  services?: { name: string; description?: string | null }[];
  bookingEnabled?: boolean;
}

export interface CustomerCareTemplateCopy {
  serviceCategory: string;
  useCaseDescription: string;
  sampleMessages: string[];
  optInDescription: string;
}

const BUSINESS_TYPE_SERVICE_LABELS: Partial<Record<BusinessType, string>> = {
  plumber: "plumbing services",
  dentist: "dental appointment questions",
  restaurant: "restaurant inquiries",
  car_wash: "car wash services",
  salon: "salon services",
  hvac: "HVAC services",
  auto_shop: "auto repair services",
  real_estate: "real estate inquiries",
  legal: "legal service inquiries",
  financial: "financial service inquiries",
  insurance: "insurance service inquiries",
  retail: "retail store questions",
  general: "the services offered by the business",
  other: "the services offered by the business",
};

const UNSUPPORTED_CLAIM_PATTERNS = [
  /\bappointment reminders?\b/i,
  /\bautomatic booking\b/i,
  /\bbook appointments? automatically\b/i,
  /\bpromo(tional|tions?)?\b/i,
  /\bcoupons?\b/i,
  /\bdiscounts?\b/i,
  /\bblast(s|ing)?\b/i,
  /\bcold outreach\b/i,
  /\bcold sms\b/i,
  /\bcold email\b/i,
  /\blead lists?\b/i,
  /\bpurchased leads?\b/i,
  /\baffiliate marketing\b/i,
];

export function buildCustomerCareTemplateCopy(
  input: CustomerCareTemplateInput
): CustomerCareTemplateCopy {
  const businessName = cleanBusinessName(input.businessName);
  const serviceCategory = deriveServiceCategory(input);

  return {
    serviceCategory,
    useCaseDescription: [
      `${businessName} will use SMS for customer care conversations with people who contact the business.`,
      `Messages may include replies to customer questions, missed-call follow-ups, service inquiry responses, and next-step coordination related to ${serviceCategory}.`,
      "This campaign is limited to one-to-one customer support replies and service coordination.",
    ].join(" "),
    sampleMessages: [
      `Thanks for contacting ${businessName}. We received your message and can help with your question about ${serviceCategory}. What can we help you with today?`,
      `Hi, this is ${businessName}. We saw your missed call and wanted to follow up. What service or question can we help with? Reply STOP to opt out.`,
      `Thanks for your interest in ${businessName}. We can help coordinate next steps for your inquiry. What day and time works best for a quick call?`,
    ],
    optInDescription: [
      `Customers opt in by contacting ${businessName} through the business website, website chat, phone call, or SMS.`,
      `${businessName} uses SMS to respond to customer questions, follow up on missed calls, and coordinate service inquiries.`,
      "Customers can reply STOP to opt out.",
    ].join(" "),
  };
}

export function validateCustomerCareCopy(input: {
  useCaseDescription: string;
  sampleMessages: string[];
  optInDescription: string;
}): string[] {
  const errors: string[] = [];
  const allText = [
    input.useCaseDescription,
    input.optInDescription,
    ...input.sampleMessages,
  ].join("\n");

  if (/\[.+?\]/.test(allText)) {
    errors.push("Carrier review text cannot contain placeholders.");
  }

  if (!input.sampleMessages.some((message) => /\bstop\b/i.test(message))) {
    errors.push("At least one sample message must include STOP opt-out wording.");
  }

  const textWithoutAllowedDisclaimers = allText.replace(
    /this campaign will not be used for mass marketing, promotional blasts, cold outreach, or affiliate marketing\./gi,
    ""
  );
  const unsupported = UNSUPPORTED_CLAIM_PATTERNS.find((pattern) =>
    pattern.test(textWithoutAllowedDisclaimers)
  );
  if (unsupported) {
    errors.push(
      "SMS registration text must stay limited to Customer Care, not marketing, blasts, coupons, cold outreach, affiliate marketing, or unsupported automation."
    );
  }

  return errors;
}

function deriveServiceCategory(input: CustomerCareTemplateInput): string {
  const firstService = input.services?.find((service) => service.name?.trim());
  if (firstService?.name) {
    return normalizeServicePhrase(firstService.name);
  }

  if (input.businessType === "other" && input.businessTypeOther?.trim()) {
    return normalizeServicePhrase(input.businessTypeOther);
  }

  return (
    (input.businessType && BUSINESS_TYPE_SERVICE_LABELS[input.businessType]) ||
    "the services offered by the business"
  );
}

function normalizeServicePhrase(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "the services offered by the business";
  if (/\b(services|questions|inquiries|appointments)\b/i.test(cleaned)) {
    return cleaned.toLowerCase();
  }
  return `${cleaned.toLowerCase()} services`;
}

function cleanBusinessName(value: string): string {
  const cleaned = value.trim();
  return cleaned || "Your Business";
}
