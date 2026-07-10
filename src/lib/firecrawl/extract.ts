import { anthropic } from "@/lib/anthropic/client";

interface ExtractedService {
  name: string;
  description: string | null;
  price: string | null;
}

interface ExtractedFAQ {
  question: string;
  answer: string;
}

interface ExtractedBusinessHours {
  day: string;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

export interface ExtractedBusinessInfo {
  business_name: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  services: ExtractedService[];
  faqs: ExtractedFAQ[];
  business_hours: ExtractedBusinessHours[] | null;
}

const EMPTY_RESULT: ExtractedBusinessInfo = {
  business_name: null,
  phone_number: null,
  address: null,
  city: null,
  state: null,
  zip: null,
  services: [],
  faqs: [],
  business_hours: null,
};

// This extractor only powers the onboarding "Scan website" convenience: its
// output pre-fills editable form fields the customer reviews before saving.
// So on any failure we log loudly (a silent swallow here hid a dead model id
// for the life of the feature) and return EMPTY_RESULT — an empty scan is a
// safe non-event, whereas junk would become bad pre-fills the customer has to
// undo. Every failure path below prefers empty over bad.
export async function extractBusinessInfo(
  rawContent: string
): Promise<ExtractedBusinessInfo> {
  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: `You are a business information extractor. Given website content, extract the following into a JSON object:
{
  business_name: string or null,
  phone_number: string or null,
  address: string or null,
  city: string or null,
  state: string or null,
  zip: string or null,
  services: [{ name: string, description: string or null, price: string or null }],
  faqs: [{ question: string, answer: string }],
  business_hours: [{ day: string, open_time: string, close_time: string, is_closed: boolean }] or null
}
Return ONLY valid JSON, no explanation or markdown.`,
      messages: [{ role: "user", content: rawContent }],
    });
  } catch (error) {
    console.error(
      "[firecrawl:extract] Anthropic extraction request failed; returning empty result:",
      error
    );
    return EMPTY_RESULT;
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    console.error(
      "[firecrawl:extract] Extraction response had no text block; returning empty result."
    );
    return EMPTY_RESULT;
  }

  let parsed: unknown;
  try {
    // Models often wrap JSON in a ```json fence despite the instruction;
    // strip it so a well-formed extraction isn't lost to a parse error.
    // Trim FIRST so the ^/$ anchors reach the fences even when the model
    // adds surrounding whitespace/newlines (JS `$` without `m` won't match
    // before a trailing newline, which would otherwise defeat the strip).
    const cleaned = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (error) {
    console.error(
      "[firecrawl:extract] Failed to parse extraction JSON; returning empty result:",
      error,
      `raw (first 300 chars): ${textBlock.text.slice(0, 300)}`
    );
    return EMPTY_RESULT;
  }

  return normalizeExtracted(parsed);
}

// Coerce arbitrary parsed JSON into the known shape, dropping anything
// malformed. Prefer empty over bad: a field that isn't the expected type
// becomes null/[] rather than flowing through as a garbage pre-fill.
function normalizeExtracted(value: unknown): ExtractedBusinessInfo {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    console.error(
      "[firecrawl:extract] Extraction JSON was not an object; returning empty result."
    );
    return EMPTY_RESULT;
  }
  const raw = value as Record<string, unknown>;

  return {
    business_name: cleanString(raw.business_name),
    phone_number: cleanString(raw.phone_number),
    address: cleanString(raw.address),
    city: cleanString(raw.city),
    state: cleanString(raw.state),
    zip: cleanString(raw.zip),
    services: cleanServices(raw.services),
    faqs: cleanFaqs(raw.faqs),
    business_hours: cleanHours(raw.business_hours),
  };
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanServices(value: unknown): ExtractedService[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const svc = entry as Record<string, unknown>;
    const name = cleanString(svc.name);
    // A service with no name is unusable as a pre-fill — drop it.
    if (!name) return [];
    return [
      {
        name,
        description: cleanString(svc.description),
        price: cleanString(svc.price),
      },
    ];
  });
}

function cleanFaqs(value: unknown): ExtractedFAQ[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const faq = entry as Record<string, unknown>;
    const question = cleanString(faq.question);
    const answer = cleanString(faq.answer);
    // Both halves are required for a usable FAQ pre-fill.
    if (!question || !answer) return [];
    return [{ question, answer }];
  });
}

function cleanHours(value: unknown): ExtractedBusinessHours[] | null {
  if (!Array.isArray(value)) return null;
  const hours = value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const h = entry as Record<string, unknown>;
    const day = cleanString(h.day);
    if (!day) return [];
    return [
      {
        day,
        open_time: cleanString(h.open_time) ?? "",
        close_time: cleanString(h.close_time) ?? "",
        is_closed: typeof h.is_closed === "boolean" ? h.is_closed : false,
      },
    ];
  });
  return hours.length > 0 ? hours : null;
}
