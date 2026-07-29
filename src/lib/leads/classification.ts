export type LeadStatus = "normal" | "warm" | "hot";

export type LeadClassificationReason =
  | "booking_confirmed"
  | "email_captured"
  | "phone_captured"
  | "urgent_with_identity"
  | "urgent_intent"
  | "service_intent"
  | "engaged_questions";

export interface LeadMessageFact {
  role: string;
  content: string;
}

export interface LeadContactFacts {
  name?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  providedPhoneNumber?: string | null;
}

export interface LeadClassificationInput {
  currentStatus: LeadStatus;
  contact: LeadContactFacts;
  /** Customer messages from every conversation belonging to this contact. */
  contactMessages: LeadMessageFact[];
  /** Messages from the conversation currently being evaluated. */
  conversationMessages: LeadMessageFact[];
  hasConfirmedBooking: boolean;
}

export interface LeadClassificationResult {
  status: LeadStatus;
  reason: LeadClassificationReason | null;
  changed: boolean;
}

export const URGENT_PHRASES = [
  "urgent",
  "urgently",
  "asap",
  "as soon as possible",
  "immediately",
  "emergency",
  "today",
  "now",
  "right away",
] as const;

export const SERVICE_INTENT_PHRASES = [
  "price",
  "pricing",
  "cost",
  "how much",
  "rate",
  "fee",
  "quote",
  "cheap",
  "cheapest",
  "budget",
  "afford",
  "estimate",
  "pay",
  "payment",
  "book",
  "booking",
  "appointment",
  "schedule",
  "reserve",
  "set up a time",
  "consultation",
  "meet",
  "meeting",
  "call",
  "demo",
  "service",
  "offer",
  "provide",
  "do you do",
  "available",
  "help me",
  "need",
  "looking for",
  "interested",
] as const;

const LEAD_STATUS_RANK: Record<LeadStatus, number> = {
  normal: 0,
  warm: 1,
  hot: 2,
};

const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
const PHONE_CHARACTERS_REGEX = /^[+\d\s().-]+$/;
const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const EMAIL_CANDIDATE_REGEX =
  /(?<![a-z0-9.!#$%&'*+/=?^_`{|}~@-])[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+(?![a-z0-9@-])/gi;
const PHONE_CANDIDATE_REGEX =
  /(?<!\d)(?:\+[1-9][\d\s().-]{6,}\d|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?!\d)/g;
const QUESTION_START_REGEX =
  /(?:^|[.!]\s+|[\r\n]+\s*)["'“”‘’(\[{•-]*\s*(?:who|what|when|where|why|how|can|could|would|do|does|is|are)\b/i;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseRegex(phrases: readonly string[]): RegExp {
  const alternatives = [...phrases]
    .sort((left, right) => right.length - left.length)
    .map((phrase) => escapeRegex(phrase).replace(/\s+/g, "\\s+"))
    .join("|");

  return new RegExp(
    `(?:^|[^a-z0-9])(?:${alternatives})(?=$|[^a-z0-9])`,
    "i"
  );
}

const URGENT_REGEX = phraseRegex(URGENT_PHRASES);
const SERVICE_INTENT_REGEX = phraseRegex(SERVICE_INTENT_PHRASES);

export function normalizeLeadText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

export function hasUrgentIntent(value: string): boolean {
  return URGENT_REGEX.test(normalizeLeadText(value));
}

export function hasServiceIntent(value: string): boolean {
  return SERVICE_INTENT_REGEX.test(normalizeLeadText(value));
}

export function isQuestion(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase().trim();
  return normalized.includes("?") || QUESTION_START_REGEX.test(normalized);
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? "").normalize("NFKC").trim().toLowerCase();
  const localPart = normalized.split("@", 1)[0] ?? "";
  if (
    normalized.length === 0 ||
    normalized.length > 320 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !EMAIL_REGEX.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function extractEmail(value: string): string | null {
  const matches = value.normalize("NFKC").match(EMAIL_CANDIDATE_REGEX) ?? [];
  for (const match of matches) {
    const normalized = normalizeEmail(match);
    if (normalized) return normalized;
  }
  return null;
}

export function normalizeProvidedPhone(
  value: string | null | undefined
): string | null {
  const trimmed = (value ?? "").normalize("NFKC").trim();
  if (!trimmed || !PHONE_CHARACTERS_REGEX.test(trimmed)) return null;

  const digits = trimmed.replace(/\D/g, "");
  let candidate: string;

  if (trimmed.startsWith("+")) {
    candidate = `+${digits}`;
  } else if (digits.length === 10) {
    candidate = `+1${digits}`;
  } else if (digits.length === 11 && digits.startsWith("1")) {
    candidate = `+${digits}`;
  } else {
    return null;
  }

  return E164_PHONE_REGEX.test(candidate) ? candidate : null;
}

export function extractProvidedPhone(value: string): string | null {
  const matches = value.normalize("NFKC").match(PHONE_CANDIDATE_REGEX) ?? [];
  for (const match of matches) {
    const normalized = normalizeProvidedPhone(match);
    if (normalized) return normalized;
  }
  return null;
}

export function hasContactIdentity(contact: LeadContactFacts): boolean {
  return Boolean(
    contact.name?.trim() ||
      normalizeEmail(contact.email) ||
      normalizeProvidedPhone(contact.phoneNumber) ||
      normalizeProvidedPhone(contact.providedPhoneNumber)
  );
}

function customerMessages(messages: LeadMessageFact[]): LeadMessageFact[] {
  return messages.filter((message) => message.role === "customer");
}

function higherStatus(current: LeadStatus, candidate: LeadStatus): LeadStatus {
  return LEAD_STATUS_RANK[candidate] > LEAD_STATUS_RANK[current]
    ? candidate
    : current;
}

function result(
  currentStatus: LeadStatus,
  candidateStatus: LeadStatus,
  reason: LeadClassificationReason
): LeadClassificationResult {
  const status = higherStatus(currentStatus, candidateStatus);
  return {
    status,
    reason: status === currentStatus ? null : reason,
    changed: status !== currentStatus,
  };
}

export function classifyLead(
  input: LeadClassificationInput
): LeadClassificationResult {
  if (input.currentStatus === "hot") {
    return { status: "hot", reason: null, changed: false };
  }

  const allCustomerMessages = customerMessages(input.contactMessages);
  const conversationCustomerMessages = customerMessages(
    input.conversationMessages
  );
  const capturedEmail =
    normalizeEmail(input.contact.email) ??
    allCustomerMessages
      .map((message) => extractEmail(message.content))
      .find((email): email is string => email !== null) ??
    null;
  const capturedPhone =
    normalizeProvidedPhone(input.contact.providedPhoneNumber) ??
    allCustomerMessages
      .map((message) => extractProvidedPhone(message.content))
      .find((phone): phone is string => phone !== null) ??
    null;
  const urgent = allCustomerMessages.some((message) =>
    hasUrgentIntent(message.content)
  );
  const serviceIntent = allCustomerMessages.some((message) =>
    hasServiceIntent(message.content)
  );
  const engagedWithQuestion =
    conversationCustomerMessages.length >= 2 &&
    conversationCustomerMessages.some((message) =>
      isQuestion(message.content)
    );
  const identity =
    hasContactIdentity(input.contact) ||
    capturedEmail !== null ||
    capturedPhone !== null;

  if (input.hasConfirmedBooking) {
    return result(input.currentStatus, "hot", "booking_confirmed");
  }
  if (capturedEmail) {
    return result(input.currentStatus, "hot", "email_captured");
  }
  if (capturedPhone) {
    return result(input.currentStatus, "hot", "phone_captured");
  }
  if (urgent && identity) {
    return result(input.currentStatus, "hot", "urgent_with_identity");
  }
  if (urgent) {
    return result(input.currentStatus, "warm", "urgent_intent");
  }
  if (serviceIntent) {
    return result(input.currentStatus, "warm", "service_intent");
  }
  if (engagedWithQuestion) {
    return result(input.currentStatus, "warm", "engaged_questions");
  }

  return {
    status: input.currentStatus,
    reason: null,
    changed: false,
  };
}
