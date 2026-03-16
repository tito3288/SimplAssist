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

export async function extractBusinessInfo(
  rawContent: string
): Promise<ExtractedBusinessInfo> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-20250404",
      max_tokens: 2048,
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

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return EMPTY_RESULT;
    }

    const parsed = JSON.parse(textBlock.text) as ExtractedBusinessInfo;
    return parsed;
  } catch {
    return EMPTY_RESULT;
  }
}
