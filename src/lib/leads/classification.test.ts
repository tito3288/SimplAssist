import { describe, expect, it } from "vitest";
import {
  classifyLead,
  extractEmail,
  extractProvidedPhone,
  hasContactIdentity,
  hasServiceIntent,
  hasUrgentIntent,
  isQuestion,
  normalizeEmail,
  normalizeLeadText,
  normalizeProvidedPhone,
  type LeadClassificationInput,
  type LeadMessageFact,
  type LeadStatus,
} from "./classification";

const customer = (content: string): LeadMessageFact => ({
  role: "customer",
  content,
});

function input(
  overrides: Partial<LeadClassificationInput> = {}
): LeadClassificationInput {
  return {
    currentStatus: "normal",
    contact: {},
    contactMessages: [],
    conversationMessages: [],
    hasConfirmedBooking: false,
    ...overrides,
  };
}

describe("lead text signals", () => {
  it("normalizes Unicode, casing, and whitespace", () => {
    expect(normalizeLeadText("  ＡＳＡＰ\n  TODAY ")).toBe("asap today");
  });

  it.each([
    "This is URGENT",
    "Can you come asap?",
    "I need this as soon as possible",
    "Please call right away.",
    "Can someone help today",
  ])("recognizes urgent phrase: %s", (message) => {
    expect(hasUrgentIntent(message)).toBe(true);
  });

  it.each([
    "There is snow outside",
    "The emergencyroom sign is broken",
    "We can talk todayish",
    "The word is asapphire",
  ])("does not match urgent substrings: %s", (message) => {
    expect(hasUrgentIntent(message)).toBe(false);
  });

  it.each([
    "How much does it cost?",
    "I'd like to book a consultation",
    "Do you provide this service?",
    "I'm interested in a quote",
  ])("recognizes service intent: %s", (message) => {
    expect(hasServiceIntent(message)).toBe(true);
  });

  it.each(["priced", "callback", "meetinghouse", "unavailableish"])(
    "does not match service-intent substrings: %s",
    (message) => {
      expect(hasServiceIntent(message)).toBe(false);
    }
  );

  it.each([
    "Can you help",
    "What services do you offer",
    "Hello. How much is it",
    "Hello\nCan somebody help",
    "“Can somebody help",
    "- Can somebody help",
    "This works?",
  ])("detects question phrasing: %s", (message) => {
    expect(isQuestion(message)).toBe(true);
  });

  it.each(["I can help", "That is what I need", "This works for me."])(
    "does not infer a question from an embedded interrogative: %s",
    (message) => {
      expect(isQuestion(message)).toBe(false);
    }
  );
});

describe("contact-data normalization", () => {
  it.each([
    [" PERSON@Example.COM ", "person@example.com"],
    ["first.last+tag@example.co.uk", "first.last+tag@example.co.uk"],
    ["missing-at.example.com", null],
    ["person@example", null],
    [".person@example.com", null],
    ["person..name@example.com", null],
    ["", null],
  ])("normalizes email %j", (raw, expected) => {
    expect(normalizeEmail(raw)).toBe(expected);
  });

  it("extracts a valid email without trailing punctuation", () => {
    expect(extractEmail("Email me at Person+tag@Example.com, please.")).toBe(
      "person+tag@example.com"
    );
  });

  it.each([
    "abc@foo@example.com",
    "foo..bar@example.com",
    ".foo@example.com",
  ])("does not extract a valid-looking suffix from invalid email %s", (value) => {
    expect(extractEmail(value)).toBeNull();
  });

  it.each([
    ["(317) 555-1234", "+13175551234"],
    ["317.555.1234", "+13175551234"],
    ["1-317-555-1234", "+13175551234"],
    ["+44 20 7946 0958", "+442079460958"],
    ["555-1234", null],
    ["+0123456789", null],
    ["317-CALL-NOW", null],
  ])("normalizes volunteered phone %j", (raw, expected) => {
    expect(normalizeProvidedPhone(raw)).toBe(expected);
  });

  it("extracts a formatted phone from customer text", () => {
    expect(extractProvidedPhone("Call me back at (317) 555-1234.")).toBe(
      "+13175551234"
    );
  });

  it("does not extract a phone from inside a longer numeric identifier", () => {
    expect(extractProvidedPhone("Order ID 1317555123456")).toBeNull();
  });

  it("does not treat a widget session identifier as contact identity", () => {
    expect(hasContactIdentity({})).toBe(false);
  });

  it("does not treat malformed canonical phone data as identity", () => {
    expect(hasContactIdentity({ phoneNumber: "unknown" })).toBe(false);
  });

  it.each([
    { name: "Sam" },
    { email: "sam@example.com" },
    { phoneNumber: "+13175551234" },
    { providedPhoneNumber: "(317) 555-1234" },
  ])("recognizes stored identity: %j", (contact) => {
    expect(hasContactIdentity(contact)).toBe(true);
  });
});

describe("lead tier classification", () => {
  it("classifies a confirmed linked booking as HOT without other signals", () => {
    expect(classifyLead(input({ hasConfirmedBooking: true }))).toEqual({
      status: "hot",
      reason: "booking_confirmed",
      changed: true,
    });
  });

  it.each([
    {
      contact: { email: "lead@example.com" },
      messages: [],
      reason: "email_captured",
    },
    {
      contact: {},
      messages: [customer("My email is lead@example.com")],
      reason: "email_captured",
    },
    {
      contact: { providedPhoneNumber: "(317) 555-1234" },
      messages: [],
      reason: "phone_captured",
    },
    {
      contact: {},
      messages: [customer("You can reach me at 317-555-1234")],
      reason: "phone_captured",
    },
  ])("classifies explicit contact info as HOT: $reason", ({
    contact,
    messages,
    reason,
  }) => {
    expect(
      classifyLead(
        input({
          contact,
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({ status: "hot", reason, changed: true });
  });

  it("classifies urgent intent plus SMS metadata identity as HOT", () => {
    const messages = [customer("This is an emergency")];
    expect(
      classifyLead(
        input({
          contact: { phoneNumber: "+13175551234" },
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({
      status: "hot",
      reason: "urgent_with_identity",
      changed: true,
    });
  });

  it("combines earlier urgency with identity captured later", () => {
    const messages = [customer("I need help immediately")];
    expect(
      classifyLead(
        input({
          contact: { name: "Sam" },
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toMatchObject({
      status: "hot",
      reason: "urgent_with_identity",
    });
  });

  it("does not make an SMS sender HOT from metadata alone", () => {
    const messages = [customer("Hello there")];
    expect(
      classifyLead(
        input({
          contact: { phoneNumber: "+13175551234" },
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({ status: "normal", reason: null, changed: false });
  });

  it("classifies anonymous urgent intent as WARM", () => {
    const messages = [customer("I need this right away")];
    expect(
      classifyLead(
        input({
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({
      status: "warm",
      reason: "urgent_intent",
      changed: true,
    });
  });

  it("keeps service intent WARM even when metadata identity exists", () => {
    const messages = [customer("Can I get a quote?")];
    expect(
      classifyLead(
        input({
          contact: { phoneNumber: "+13175551234" },
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({
      status: "warm",
      reason: "service_intent",
      changed: true,
    });
  });

  it("classifies two customer messages with a question as WARM", () => {
    const messages = [customer("Hello"), customer("Can somebody help")];
    expect(
      classifyLead(
        input({
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({
      status: "warm",
      reason: "engaged_questions",
      changed: true,
    });
  });

  it("does not count a single customer question as engaged", () => {
    const messages = [customer("Can somebody help")];
    expect(
      classifyLead(
        input({
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({ status: "normal", reason: null, changed: false });
  });

  it("does not count assistant, system, or human-agent questions", () => {
    const messages = [
      customer("Hello"),
      { role: "assistant", content: "How can I help?" },
      { role: "system", content: "Can the system help?" },
      { role: "human_agent", content: "What do you need?" },
    ];
    expect(
      classifyLead(
        input({
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({ status: "normal", reason: null, changed: false });
  });

  it("does not treat malformed contact data as HOT", () => {
    const messages = [customer("Email me at nope@example")];
    expect(
      classifyLead(
        input({
          contact: {
            email: "also-invalid",
            providedPhoneNumber: "555-1234",
          },
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({ status: "normal", reason: null, changed: false });
  });

  it.each<LeadStatus>(["warm", "hot"])(
    "never downgrades an existing %s lead",
    (currentStatus) => {
      expect(
        classifyLead(input({ currentStatus }))
      ).toEqual({
        status: currentStatus,
        reason: null,
        changed: false,
      });
    }
  );

  it("uses HOT precedence when warm and hot facts coexist", () => {
    const messages = [
      customer("How much does it cost?"),
      customer("I booked already"),
    ];
    expect(
      classifyLead(
        input({
          hasConfirmedBooking: true,
          contactMessages: messages,
          conversationMessages: messages,
        })
      )
    ).toEqual({
      status: "hot",
      reason: "booking_confirmed",
      changed: true,
    });
  });
});
