import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AISettings,
  Business,
  BusinessHours,
  FAQ,
  Service,
} from "@/types/database";
import { KNOWLEDGE_GAP_SIGNAL } from "./knowledgeGapSignal";
import { buildSystemPrompt } from "./prompt";
import { CREATE_BOOKING_START_TIME_CONTRACT } from "./tools";

const PHONE_NUMBER = "+1 574-555-0100";
const EMAIL = "help@acme.test";
const DAY_NAMES_FOR_TEST = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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
    source: "manual",
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
  overrides: Partial<Business> = {}
): Business {
  return { ...BASE_BUSINESS, ...overrides } as Business;
}

function promptFor(
  channel: "sms" | "web_chat",
  businessOverrides: Partial<Business> = {
    phone_number: PHONE_NUMBER,
    email: EMAIL,
  },
  services: Service[] = SERVICES,
  faqs: FAQ[] = FAQS,
  businessHours: BusinessHours[] = []
): string {
  return buildSystemPrompt(
    business(businessOverrides),
    AI_SETTINGS,
    services,
    faqs,
    businessHours,
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

function expectedKnowledgeGapSection(channel: "sms" | "web_chat"): string {
  return [
    "KNOWLEDGE BOUNDARIES AND GAPS:",
    `- When the current business information does not fully answer a customer's question, name the specific missing topic. Say, for example, "I don't see free trials mentioned in our current info," instead of a generic "I don't have information about that."`,
    `- CRITICAL: Missing information means unknown, never "no." NEVER state or imply that the business does not offer, provide, allow, support, or have something solely because it is not mentioned.`,
    `- Forbidden when based only on missing information: "We don't offer free trials." Allowed: "I don't see a free trial mentioned in our current info."`,
    "- If a closely related service or FAQ appears in the provided business information and is permitted by any STRICT RULES, briefly share only that accurate information, clearly distinguish it from the unresolved topic, then hand off. Do not stretch unrelated information into an answer.",
    "- Under no circumstances invent or infer services, prices, promotions or trials, policies, hours, or availability. Use only the provided business information and successful tool results for business-specific claims.",
    `- If any part of the question remains unresolved, end with a natural, tone-matched handoff: suggest the customer call ${PHONE_NUMBER} during business hours or email ${EMAIL}. Do not invent a contact method or ask the customer for their contact information as the handoff.`,
    "- For a knowledge-gap handoff, do not promise a callback, escalation, staff follow-up, or any action the engine did not actually create.",
    "- Match the configured tone and language; the examples above illustrate the rule, not a required canned script.",
    ...(channel === "sms"
      ? [
          "- For SMS, keep the entire knowledge-gap response compact. Near-miss information gets at most one short sentence before the handoff.",
        ]
      : []),
    "- These knowledge-gap rules do not override STRICT RULES, BOOKING, successful tool results, CUSTOMER CARE SMS COMPLIANCE, or CONTACT COLLECTION timing.",
    "",
    "",
  ].join("\n");
}

describe("buildSystemPrompt booking operational availability", () => {
  it.each(["collect_info", "schedule_direct"] as const)(
    "overrides saved %s booking behavior without mutating the settings",
    (bookingMode) => {
      const settings: AISettings = {
        ...AI_SETTINGS,
        booking_mode: bookingMode,
        guardrails: [...AI_SETTINGS.guardrails],
      };
      const savedSettings = {
        ...settings,
        guardrails: [...settings.guardrails],
      };

      const prompt = buildSystemPrompt(
        business({ phone_number: PHONE_NUMBER, email: EMAIL }),
        settings,
        SERVICES,
        FAQS,
        [],
        true,
        "sms",
        false
      );

      expect(prompt).toContain(
        "Booking is currently unavailable. Do not collect booking details, offer appointment times, check availability, or claim that an appointment can be scheduled."
      );
      expect(prompt).not.toContain(
        "collect their name, preferred date/time, and service needed"
      );
      expect(prompt).not.toContain("Use the check_availability tool");
      expect(prompt).not.toContain("Booking confirmation:");
      expect(prompt).not.toContain("in the middle of a booking");
      expect(prompt).toContain(
        "When the customer provides their email, you MUST call the save_contact_email tool immediately to save it. Do not skip this step."
      );
      expect(settings).toEqual(savedSettings);
    }
  );
});

describe("buildSystemPrompt direct-booking timestamp contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T02:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("states the business IANA timezone and exact no-offset contract", () => {
    const settings: AISettings = {
      ...AI_SETTINGS,
      booking_mode: "schedule_direct",
    };
    const prompt = buildSystemPrompt(
      business({ timezone: "America/Indiana/Indianapolis" }),
      settings,
      SERVICES,
      FAQS,
      [],
      true,
      "sms"
    );

    expect(prompt).toContain("TODAY'S DATE: Wednesday, August 5, 2026");
    expect(prompt).toContain(
      "BUSINESS TIMEZONE (IANA): America/Indiana/Indianapolis"
    );
    expect(prompt).toContain(CREATE_BOOKING_START_TIME_CONTRACT);
    expect(prompt).toContain(
      "Interpret the timestamp in the business timezone above; never convert it to UTC or add an offset."
    );
    expect(prompt).toContain(
      "always include the customer_email and format start_time exactly as required above"
    );
  });

  it.each([
    { bookingMode: "collect_info" as const, calendarConnected: true },
    { bookingMode: "schedule_direct" as const, calendarConnected: false },
  ])(
    "omits the tool timestamp contract outside connected direct booking %#",
    ({ bookingMode, calendarConnected }) => {
      const prompt = buildSystemPrompt(
        business({ timezone: "America/Indiana/Indianapolis" }),
        { ...AI_SETTINGS, booking_mode: bookingMode },
        SERVICES,
        FAQS,
        [],
        calendarConnected,
        "sms"
      );

      expect(prompt).not.toContain("BUSINESS TIMEZONE (IANA):");
      expect(prompt).not.toContain(CREATE_BOOKING_START_TIME_CONTRACT);
    }
  );
});

describe.each(CHANNEL_CASES)(
  "buildSystemPrompt knowledge-gap policy for $channel",
  ({ channel, ownChannelInstruction, otherChannelInstruction }) => {
    it("preserves the existing knowledge-boundaries section verbatim", () => {
      expect(knowledgeGapSection(promptFor(channel))).toBe(
        expectedKnowledgeGapSection(channel)
      );
    });

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

describe.each(CHANNEL_CASES)(
  "buildSystemPrompt internal knowledge-gap signal for $channel",
  ({ channel }) => {
    it("adds the exact internal signal instructions at the end", () => {
      const prompt = promptFor(channel);
      const heading = "KNOWLEDGE GAP SIGNALING (INTERNAL):";
      const signalingSection = prompt.slice(prompt.indexOf(heading));

      expect(prompt.match(/KNOWLEDGE GAP SIGNALING \(INTERNAL\):/g)).toHaveLength(
        1
      );
      expect(prompt.match(/\[\[SIMPLASSIST_KNOWLEDGE_GAP_V1\]\]/g)).toHaveLength(
        1
      );
      expect(signalingSection).toContain(
        `append ${KNOWLEDGE_GAP_SIGNAL} exactly once on its own final line`
      );
      expect(signalingSection).toContain(
        "This includes a near-miss answer that shares related business information"
      );
      expect(signalingSection).toContain(
        "Do not append the signal when the supplied business information or successful tool results fully answer the question."
      );
      expect(signalingSection).toContain(
        "The signal is internal metadata, not customer-facing content."
      );
      expect(prompt.endsWith(signalingSection)).toBe(true);
      expect(prompt.indexOf("CONTACT COLLECTION:")).toBeLessThan(
        prompt.indexOf(heading)
      );
    });
  }
);

describe.each(CHANNEL_CASES)(
  "buildSystemPrompt business information for $channel",
  ({ channel }) => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-02-02T12:00:00.000Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("renders a compact, trimmed address from nonempty components", () => {
      const prompt = promptFor(channel, {
        address: "  123 Main Street  ",
        city: "  Indianapolis ",
        state: "  IN ",
        zip: " 46201  ",
      });

      expect(prompt).toContain(
        "\nAddress: 123 Main Street, Indianapolis, IN 46201\n"
      );
      expect(prompt).not.toContain("Address:   ");
    });

    it("joins only the address components that contain text", () => {
      const prompt = promptFor(channel, {
        address: " ",
        city: " Indianapolis ",
        state: null,
        zip: " 46201 ",
      });

      expect(prompt).toContain("\nAddress: Indianapolis 46201\n");
      expect(prompt).not.toContain("Address: ,");
    });

    it("omits an address and hours when those values are unset", () => {
      const prompt = promptFor(channel, {
        address: "   ",
        city: null,
        state: " ",
        zip: null,
      });

      expect(prompt).not.toContain("\nAddress:");
      expect(prompt).not.toContain("\nBUSINESS HOURS:");
      expect(prompt).not.toContain("\nToday:");
      expect(prompt).not.toContain("\nCurrently:");
    });

    it("shows a partial schedule without inferring today's status", () => {
      const today = new Date(
        new Date().toLocaleString("en-US", { timeZone: "UTC" })
      ).getDay();
      const scheduledDay = (today + 1) % 7;
      const businessHours: BusinessHours[] = [
        {
          id: "hours-1",
          business_id: "business-1",
          day_of_week: scheduledDay,
          open_time: "09:00",
          close_time: "17:00",
          is_closed: false,
        },
      ];
      const prompt = promptFor(
        channel,
        undefined,
        SERVICES,
        FAQS,
        businessHours
      );

      expect(prompt).toContain("\nBUSINESS HOURS:");
      expect(prompt).toContain(
        `${DAY_NAMES_FOR_TEST[scheduledDay]}: 09:00 - 17:00`
      );
      expect(prompt).not.toContain("\nToday:");
      expect(prompt).not.toContain("\nCurrently:");
    });

    it("keeps an explicit closed-today row factual", () => {
      const today = new Date(
        new Date().toLocaleString("en-US", { timeZone: "UTC" })
      ).getDay();
      const businessHours: BusinessHours[] = [
        {
          id: "hours-1",
          business_id: "business-1",
          day_of_week: today,
          open_time: "09:00",
          close_time: "17:00",
          is_closed: true,
        },
      ];
      const prompt = promptFor(
        channel,
        undefined,
        SERVICES,
        FAQS,
        businessHours
      );

      expect(prompt).toContain("\nToday: Closed today");
      expect(prompt).toContain("\nCurrently: CLOSED");
    });
  }
);
