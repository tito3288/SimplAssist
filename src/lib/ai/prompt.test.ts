import { describe, expect, it } from "vitest";
import type { AISettings, Business, FAQ, Service } from "@/types/database";
import { buildSystemPrompt } from "./prompt";

const PHONE_NUMBER = "+1 574-555-0100";
const EMAIL = "help@acme.test";

const BASE_BUSINESS = {
  id: "business-1",
  owner_id: "owner-1",
  name: "Acme Plumbing",
  business_type: "plumber",
  business_type_other: null,
  timezone: "UTC",
  phone_number: null,
  email: null,
  address: null,
  city: null,
  state: null,
  zip: null,
} satisfies Partial<Business>;

const AI_SETTINGS = {
  id: "settings-1",
  business_id: "business-1",
  tone: "balanced",
  business_voice: "we",
  language: "en",
  sms_response_delay_seconds: 0,
  guardrails: ["promise fixed pricing"],
  booking_enabled: true,
  booking_mode: "collect_info",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
} satisfies AISettings;

const SERVICES: Service[] = [
  {
    id: "service-1",
    business_id: "business-1",
    name: "Starter Plan",
    description: "Routine plumbing maintenance",
    price: "49",
    is_active: true,
  },
];

const FAQS: FAQ[] = [
  {
    id: "faq-1",
    business_id: "business-1",
    question: "Do you provide estimates?",
    answer: "Yes, estimates are available by appointment.",
    source: "manual",
    is_active: true,
  },
];

const CHANNEL_CASES = [
  {
    channel: "sms",
    ownChannelInstruction: "This is an SMS conversation",
    otherChannelInstruction: "This is a website chat conversation",
  },
  {
    channel: "web_chat",
    ownChannelInstruction: "This is a website chat conversation",
    otherChannelInstruction: "This is an SMS conversation",
  },
] as const;

const CONTACT_CASES = [
  {
    label: "phone and email",
    phone_number: PHONE_NUMBER,
    email: EMAIL,
    expectedHandoff:
      `suggest the customer call ${PHONE_NUMBER} during business hours or email ${EMAIL}`,
  },
  {
    label: "phone only",
    phone_number: PHONE_NUMBER,
    email: null,
    expectedHandoff:
      `suggest the customer call ${PHONE_NUMBER} during business hours`,
  },
  {
    label: "email only",
    phone_number: null,
    email: EMAIL,
    expectedHandoff: `suggest the customer email ${EMAIL}`,
  },
  {
    label: "no configured contact method",
    phone_number: null,
    email: null,
    expectedHandoff:
      "invite the customer to contact the business directly without inventing contact details",
  },
  {
    label: "blank contact values",
    phone_number: "   ",
    email: "   ",
    expectedHandoff:
      "invite the customer to contact the business directly without inventing contact details",
  },
] as const;

function business(
  overrides: Pick<Partial<Business>, "phone_number" | "email"> = {}
): Business {
  return { ...BASE_BUSINESS, ...overrides } as Business;
}

function promptFor(
  channel: "sms" | "web_chat",
  contact: Pick<Partial<Business>, "phone_number" | "email"> = {
    phone_number: PHONE_NUMBER,
    email: EMAIL,
  },
  services: Service[] = SERVICES,
  faqs: FAQ[] = FAQS
): string {
  return buildSystemPrompt(
    business(contact),
    AI_SETTINGS,
    services,
    faqs,
    [],
    false,
    channel
  );
}

function knowledgeGapSection(prompt: string): string {
  const heading = "KNOWLEDGE BOUNDARIES AND GAPS:";
  const nextHeading = "CUSTOMER CARE SMS COMPLIANCE:";
  const start = prompt.indexOf(heading);
  const end = prompt.indexOf(nextHeading, start + heading.length);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return prompt.slice(start, end);
}

describe.each(CHANNEL_CASES)(
  "buildSystemPrompt knowledge-gap policy for $channel",
  ({ channel, ownChannelInstruction, otherChannelInstruction }) => {
    it("includes the shared gap rules without displacing existing prompt behavior", () => {
      const prompt = promptFor(channel);
      const gapSection = knowledgeGapSection(prompt);

      expect(
        prompt.match(/KNOWLEDGE BOUNDARIES AND GAPS:/g)
      ).toHaveLength(1);
      expect(gapSection).toContain("name the specific missing topic");
      expect(gapSection).toContain(
        `"I don't see free trials mentioned in our current info," instead of a generic "I don't have information about that."`
      );
      expect(gapSection).toContain(
        `CRITICAL: Missing information means unknown, never "no."`
      );
      expect(gapSection).toContain(
        "NEVER state or imply that the business does not offer"
      );
      expect(gapSection).toContain(
        `Forbidden when based only on missing information: "We don't offer free trials."`
      );
      expect(gapSection).toContain(
        `Allowed: "I don't see a free trial mentioned in our current info."`
      );
      expect(gapSection).toContain(
        "If a closely related service or FAQ appears in the provided business information"
      );
      expect(gapSection).toContain(
        "Do not stretch unrelated information into an answer."
      );
      expect(gapSection).toContain(
        "Under no circumstances invent or infer services, prices, promotions or trials, policies, hours, or availability."
      );
      expect(gapSection).toContain(
        "do not promise a callback, escalation, staff follow-up"
      );
      expect(gapSection).toContain(
        "do not override STRICT RULES, BOOKING, successful tool results, CUSTOMER CARE SMS COMPLIANCE, or CONTACT COLLECTION timing."
      );

      expect(prompt).toContain(ownChannelInstruction);
      expect(prompt).not.toContain(otherChannelInstruction);
      expect(prompt).toContain(
        "Use a warm but professional tone. Be approachable yet polished."
      );
      expect(prompt).toContain("- DO NOT promise fixed pricing");
      expect(prompt).toContain(
        "When a customer wants to book, collect their name, preferred date/time, and service needed."
      );
      expect(prompt).toContain(
        "- Starter Plan: Routine plumbing maintenance ($49)"
      );
      expect(prompt).toContain("Q: Do you provide estimates?");
      expect(prompt).toContain(
        "A: Yes, estimates are available by appointment."
      );
      expect(prompt.indexOf("GENERAL INSTRUCTIONS:")).toBeLessThan(
        prompt.indexOf("KNOWLEDGE BOUNDARIES AND GAPS:")
      );
      expect(prompt.indexOf("KNOWLEDGE BOUNDARIES AND GAPS:")).toBeLessThan(
        prompt.indexOf("CUSTOMER CARE SMS COMPLIANCE:")
      );
      expect(prompt.indexOf("CUSTOMER CARE SMS COMPLIANCE:")).toBeLessThan(
        prompt.indexOf("CONTACT COLLECTION:")
      );
    });

    it("keeps the gap policy when services and FAQs are empty", () => {
      const prompt = promptFor(channel, undefined, [], []);
      const gapSection = knowledgeGapSection(prompt);

      expect(prompt).not.toContain("SERVICES:");
      expect(prompt).not.toContain("FREQUENTLY ASKED QUESTIONS:");
      expect(gapSection).toContain(
        `CRITICAL: Missing information means unknown, never "no."`
      );
      expect(gapSection).toContain(
        `suggest the customer call ${PHONE_NUMBER} during business hours or email ${EMAIL}`
      );
    });

    it.each(CONTACT_CASES)(
      "builds a truthful handoff with $label",
      ({ phone_number, email, expectedHandoff }) => {
        const prompt = promptFor(channel, { phone_number, email });
        const gapSection = knowledgeGapSection(prompt);
        const handoffLine = gapSection
          .split("\n")
          .find((line) =>
            line.startsWith(
              "- If any part of the question remains unresolved, end with a natural, tone-matched handoff:"
            )
          );

        expect(handoffLine).toBe(
          `- If any part of the question remains unresolved, end with a natural, tone-matched handoff: ${expectedHandoff}. Do not invent a contact method or ask the customer for their contact information as the handoff.`
        );
        expect(gapSection).not.toContain("undefined");
        expect(gapSection).not.toContain("null");
        if (!phone_number?.trim()) {
          expect(gapSection).not.toContain("call ");
          expect(prompt).not.toContain("Phone:");
        }
        if (!email?.trim()) {
          expect(gapSection).not.toContain("email ");
          expect(prompt).not.toContain("Email:");
        }
      }
    );

    if (channel === "sms") {
      it("adds the SMS-specific near-miss length limit", () => {
        expect(knowledgeGapSection(promptFor(channel))).toContain(
          "For SMS, keep the entire knowledge-gap response compact. Near-miss information gets at most one short sentence before the handoff."
        );
      });
    } else {
      it("retains web-chat guidance without adding the SMS-only gap limit", () => {
        const prompt = promptFor(channel);

        expect(prompt).toContain(
          "Keep answers short by default but you can be more detailed when the question warrants it."
        );
        expect(knowledgeGapSection(prompt)).not.toContain(
          "For SMS, keep the entire knowledge-gap response compact."
        );
      });
    }
  }
);
