import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  OperationalControlsResolutionError: class OperationalControlsResolutionError extends Error {
    readonly retryable = true;
    readonly code: string;
    readonly businessId: string;

    constructor(args: {
      code: string;
      businessId: string;
      message: string;
    }) {
      super(args.message);
      this.name = "OperationalControlsResolutionError";
      this.code = args.code;
      this.businessId = args.businessId;
    }
  },
  anthropicCreate: vi.fn(),
  from: vi.fn(),
  resolveBusinessOperationalControls: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  findOrCreateContact: vi.fn(),
  incrementLeadScore: vi.fn(),
  updateContactName: vi.fn(),
  updateContactEmail: vi.fn(),
  getOrCreateConversation: vi.fn(),
  addMessage: vi.fn(),
  getConversationAiState: vi.fn(),
  getConversationHistory: vi.fn(),
  buildSystemPrompt: vi.fn(),
  buildConversationMessages: vi.fn(),
  parseKnowledgeGapSignal: vi.fn(),
  shouldIncludeCalendarTools: vi.fn(),
  checkAvailability: vi.fn(),
  createBooking: vi.fn(),
}));

vi.mock("@/lib/anthropic/client", () => ({
  anthropic: { messages: { create: mocks.anthropicCreate } },
}));
vi.mock("@/lib/account/operationalControls.server", () => ({
  OperationalControlsResolutionError:
    mocks.OperationalControlsResolutionError,
  resolveBusinessOperationalControls: mocks.resolveBusinessOperationalControls,
  resolveOperationalBlockReason: (
    controls: {
      operationsSuspendedAt: string | null;
      aiRepliesPausedAt: string | null;
      textingPausedAt: string | null;
      bookingsPausedAt: string | null;
    },
    requiredServices: string[] = []
  ) => {
    if (controls.operationsSuspendedAt !== null) return "account_suspended";
    for (const service of requiredServices) {
      if (service === "ai_replies" && controls.aiRepliesPausedAt !== null) {
        return "ai_replies_paused";
      }
      if (service === "texting" && controls.textingPausedAt !== null) {
        return "texting_paused";
      }
      if (service === "bookings" && controls.bookingsPausedAt !== null) {
        return "bookings_paused";
      }
    }
    return null;
  },
  isOperationalControlsResolutionError: (error: unknown) =>
    error instanceof mocks.OperationalControlsResolutionError,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/billing/entitlements", () => ({
  EntitlementResolutionError: class EntitlementResolutionError extends Error {},
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("./contacts", () => ({
  findOrCreateContact: mocks.findOrCreateContact,
  incrementLeadScore: mocks.incrementLeadScore,
  updateContactName: mocks.updateContactName,
  updateContactEmail: mocks.updateContactEmail,
}));
vi.mock("./conversations", () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  addMessage: mocks.addMessage,
  getConversationAiState: mocks.getConversationAiState,
  getConversationHistory: mocks.getConversationHistory,
  isAiHandlingActive: (conversation: {
    status: string;
    is_ai_handling: boolean;
  }) => conversation.status === "active" && conversation.is_ai_handling,
}));
vi.mock("./prompt", () => ({
  buildSystemPrompt: mocks.buildSystemPrompt,
  buildConversationMessages: mocks.buildConversationMessages,
}));
vi.mock("./knowledgeGapSignal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./knowledgeGapSignal")>();
  mocks.parseKnowledgeGapSignal.mockImplementation(
    actual.parseKnowledgeGapSignal
  );
  return {
    ...actual,
    parseKnowledgeGapSignal: mocks.parseKnowledgeGapSignal,
  };
});
vi.mock("./tools", () => ({
  calendarTools: [
    {
      name: "check_availability",
      description: "calendar",
      input_schema: { type: "object", properties: {} },
    },
    {
      name: "create_booking",
      description: "calendar",
      input_schema: { type: "object", properties: {} },
    },
  ],
  shouldIncludeCalendarTools: mocks.shouldIncludeCalendarTools,
}));
vi.mock("@/lib/google/calendar", () => ({
  checkAvailability: mocks.checkAvailability,
  createBooking: mocks.createBooking,
}));

import {
  AIProcessingBlockedError,
  AIProcessingStateError,
  processIncomingMessage,
  processIncomingMessageDetailed,
} from "./engine";
import { OperationalControlsResolutionError } from "@/lib/account/operationalControls.server";
import { KNOWLEDGE_GAP_SIGNAL } from "./knowledgeGapSignal";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CONTACT = {
  id: "00000000-0000-4000-8000-000000000002",
  business_id: BUSINESS_ID,
  phone_number: "+15745550100",
};
const CONVERSATION = {
  id: "00000000-0000-4000-8000-000000000003",
  business_id: BUSINESS_ID,
  contact_id: CONTACT.id,
  channel: "sms",
  status: "active",
  is_ai_handling: true,
};
const GROWTH = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
};
const STARTER = { ...GROWTH, plan: "sms_only" };
const FULL = { ...GROWTH, plan: "full" };
const ACTIVE_CONTROLS = {
  businessId: BUSINESS_ID,
  operationsSuspendedAt: null,
  aiRepliesPausedAt: null,
  textingPausedAt: null,
  bookingsPausedAt: null,
};

function operationalControls(
  overrides: Partial<{
    operationsSuspendedAt: string | null;
    aiRepliesPausedAt: string | null;
    textingPausedAt: string | null;
    bookingsPausedAt: string | null;
  }> = {}
) {
  return { ...ACTIVE_CONTROLS, ...overrides };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const tableResults = new Map<string, unknown>();

function setAiData() {
  tableResults.set("businesses", {
    data: { id: BUSINESS_ID, name: "Test Biz", timezone: "America/New_York" },
    error: null,
  });
  tableResults.set("ai_settings", {
    data: {
      id: "settings_1",
      business_id: BUSINESS_ID,
      tone: "friendly",
      business_voice: "we",
      language: "en",
      sms_response_delay_seconds: 0,
      guardrails: ["promise a price"],
      booking_enabled: true,
      booking_mode: "schedule_direct",
    },
    error: null,
  });
  tableResults.set("services", { data: [], error: null });
  tableResults.set("faqs", { data: [], error: null });
  tableResults.set("business_hours", { data: [], error: null });
  tableResults.set("google_calendar_tokens", {
    data: { id: "calendar_1" },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);

  mocks.from.mockImplementation((table: string) => {
    const result = tableResults.get(table) ?? {
      data: null,
      error: { message: `Unexpected ${table} query` },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "single", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });

  mocks.resolveBusinessEntitlements.mockResolvedValue(GROWTH);
  mocks.resolveBusinessOperationalControls.mockResolvedValue(ACTIVE_CONTROLS);
  mocks.canUseFeature.mockImplementation(
    (entitlements: { active: boolean; plan: string }, feature: string) => {
      if (!entitlements.active) return false;
      if (feature === "advanced_guardrails") {
        return entitlements.plan === "full";
      }
      if (
        feature === "ai_sms_conversations" ||
        feature === "web_chat" ||
        feature === "direct_booking"
      ) {
        return entitlements.plan === "sms_and_chat" || entitlements.plan === "full";
      }
      return true;
    }
  );
  mocks.findOrCreateContact.mockResolvedValue(CONTACT);
  mocks.getOrCreateConversation.mockResolvedValue(CONVERSATION);
  mocks.getConversationAiState.mockResolvedValue(CONVERSATION);
  mocks.addMessage.mockResolvedValue({ id: "message_1" });
  mocks.getConversationHistory.mockResolvedValue([
    { role: "customer", content: "Can I book?" },
  ]);
  mocks.buildSystemPrompt.mockReturnValue("SYSTEM PROMPT");
  mocks.buildConversationMessages.mockReturnValue([
    { role: "user", content: "Can I book?" },
  ]);
  mocks.shouldIncludeCalendarTools.mockImplementation(
    (_settings: unknown, hasCalendar: boolean) => hasCalendar
  );
  mocks.anthropicCreate.mockResolvedValue({
    stop_reason: "end_turn",
    content: [{ type: "text", text: "Absolutely." }],
  });
  mocks.createBooking.mockResolvedValue({
    eventId: "google_event_1",
    summary: "Estimate - Pat",
    startTime: "2026-08-01T10:00:00",
    endTime: "2026-08-01T10:30:00",
  });
  mocks.incrementLeadScore.mockResolvedValue(undefined);
  setAiData();
});

describe("processIncomingMessage operational controls", () => {
  it.each([
    ["account_suspended", { operationsSuspendedAt: "2026-08-04T12:00:00Z" }],
    ["ai_replies_paused", { aiRepliesPausedAt: "2026-08-04T12:00:00Z" }],
    ["texting_paused", { textingPausedAt: "2026-08-04T12:00:00Z" }],
  ] as const)(
    "throws the typed %s entry block before contact, persistence, or Anthropic",
    async (reason, controls) => {
      mocks.resolveBusinessOperationalControls.mockResolvedValue(
        operationalControls(controls)
      );

      const promise = processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "What is the price?",
        "sms"
      );

      await expect(promise).rejects.toMatchObject({
        name: "AIProcessingBlockedError",
        reason,
      });
      await expect(promise).rejects.toBeInstanceOf(AIProcessingBlockedError);
      expect(mocks.findOrCreateContact).not.toHaveBeenCalled();
      expect(mocks.getOrCreateConversation).not.toHaveBeenCalled();
      expect(mocks.addMessage).not.toHaveBeenCalled();
      expect(mocks.anthropicCreate).not.toHaveBeenCalled();
      expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
    }
  );

  it("uses suspension, then texting, then AI precedence for SMS", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        operationsSuspendedAt: "2026-08-04T12:00:00Z",
        textingPausedAt: "2026-08-04T12:01:00Z",
        aiRepliesPausedAt: "2026-08-04T12:02:00Z",
      })
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "account_suspended" });

    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        textingPausedAt: "2026-08-04T12:01:00Z",
        aiRepliesPausedAt: "2026-08-04T12:02:00Z",
      })
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "texting_paused" });
  });

  it("blocks every post-Anthropic side effect when AI pauses while the request is pending", async () => {
    const pendingAnthropic = deferred<{
      stop_reason: "tool_use";
      content: Array<{
        type: "tool_use";
        id: string;
        name: string;
        input: { name: string };
      }>;
    }>();
    mocks.anthropicCreate.mockReturnValueOnce(pendingAnthropic.promise);

    const processing = processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "My name is Pat and I need a price.",
      "sms"
    );

    await vi.waitFor(() => {
      expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    });
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        aiRepliesPausedAt: "2026-08-04T12:00:00Z",
      })
    );
    pendingAnthropic.resolve({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "save_contact_name",
          input: { name: "Pat" },
        },
      ],
    });

    await expect(processing).rejects.toMatchObject({
      reason: "ai_replies_paused",
    });
    expect(mocks.updateContactName).not.toHaveBeenCalled();
    expect(mocks.updateContactEmail).not.toHaveBeenCalled();
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.addMessage).toHaveBeenCalledWith(
      CONVERSATION.id,
      BUSINESS_ID,
      "customer",
      "My name is Pat and I need a price.",
      "sms"
    );
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("rechecks a pause that lands before a pending Anthropic failure instead of returning fallback text", async () => {
    const pendingAnthropic = deferred<never>();
    const anthropicError = new Error("Anthropic unavailable");
    mocks.anthropicCreate.mockReturnValueOnce(pendingAnthropic.promise);

    const processing = processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "What is the price?",
      "sms"
    );

    await vi.waitFor(() => {
      expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    });
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        aiRepliesPausedAt: "2026-08-04T12:00:00Z",
      })
    );
    pendingAnthropic.reject(anthropicError);

    await expect(processing).rejects.toMatchObject({
      name: "AIProcessingBlockedError",
      reason: "ai_replies_paused",
    });
    expect(console.error).toHaveBeenCalledWith(
      "Error processing incoming message:",
      anthropicError
    );
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.updateContactName).not.toHaveBeenCalled();
    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("rethrows indeterminate state at the fallback boundary after a pending Anthropic failure", async () => {
    const pendingAnthropic = deferred<never>();
    const anthropicError = new Error("Anthropic unavailable");
    const resolutionError = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "operational state unavailable",
    });
    mocks.anthropicCreate.mockReturnValueOnce(pendingAnthropic.promise);

    const processing = processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "What is the price?",
      "sms"
    );

    await vi.waitFor(() => {
      expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    });
    mocks.resolveBusinessOperationalControls.mockRejectedValue(resolutionError);
    pendingAnthropic.reject(anthropicError);

    await expect(processing).rejects.toBe(resolutionError);
    expect(console.error).toHaveBeenCalledWith(
      "Error processing incoming message:",
      anthropicError
    );
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("keeps the generic fallback only when the fresh fallback-boundary check is active", async () => {
    const anthropicError = new Error("Anthropic unavailable");
    mocks.anthropicCreate.mockRejectedValueOnce(anthropicError);

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "What is the price?",
        "sms"
      )
    ).resolves.toContain("We're having a brief technical issue.");

    expect(mocks.resolveBusinessOperationalControls).toHaveBeenCalledTimes(3);
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "Error processing incoming message:",
      anthropicError
    );
  });

  it("freshly checks each contact tool execution in a multi-tool response", async () => {
    mocks.anthropicCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "save_contact_name",
          input: { name: "Pat" },
        },
        {
          type: "tool_use",
          id: "tool_2",
          name: "save_contact_email",
          input: { email: "pat@example.com" },
        },
      ],
    });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // first Anthropic request
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // first contact tool
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // second contact tool

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "I'm Pat; use pat@example.com.",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.updateContactName).toHaveBeenCalledWith(CONTACT.id, "Pat");
    expect(mocks.updateContactEmail).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("freshly checks a calendar tool before any calendar mutation", async () => {
    mocks.anthropicCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "create_booking",
          input: {
            customer_name: "Pat",
            service_name: "Estimate",
            start_time: "2026-08-05T10:00:00-04:00",
          },
        },
      ],
    });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // Anthropic request
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // calendar tool

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Book that appointment.",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.checkAvailability).not.toHaveBeenCalled();
    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "AIProcessingBlockedError",
      () => new AIProcessingBlockedError("ai_replies_paused"),
    ],
    [
      "AIProcessingStateError",
      () => new AIProcessingStateError("contact state unavailable"),
    ],
    [
      "OperationalControlsResolutionError",
      () =>
        new OperationalControlsResolutionError({
          code: "business_lookup_failed",
          businessId: BUSINESS_ID,
          message: "operational state unavailable",
        }),
    ],
  ])(
    "rethrows %s from a contact mutation without continuing the model loop",
    async (_label, createError) => {
      const typedError = createError();
      mocks.anthropicCreate.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "save_contact_name",
            input: { name: "Pat" },
          },
        ],
      });
      mocks.updateContactName.mockRejectedValueOnce(typedError);

      await expect(
        processIncomingMessage(
          BUSINESS_ID,
          "+15745550100",
          null,
          "I'm Pat and need a price.",
          "sms"
        )
      ).rejects.toBe(typedError);

      expect(mocks.updateContactName).toHaveBeenCalledOnce();
      expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
      expect(mocks.addMessage).toHaveBeenCalledTimes(1);
      expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
      expect(mocks.parseKnowledgeGapSignal).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalledWith(
        "[contact-tool] Error executing save_contact_name:",
        typedError
      );
    }
  );

  it.each([
    [
      "AIProcessingBlockedError",
      () => new AIProcessingBlockedError("account_suspended"),
    ],
    [
      "OperationalControlsResolutionError",
      () =>
        new OperationalControlsResolutionError({
          code: "business_lookup_failed",
          businessId: BUSINESS_ID,
          message: "operational state unavailable",
        }),
    ],
  ])(
    "rethrows %s from a calendar helper without continuing the model loop",
    async (_label, createError) => {
      const typedError = createError();
      mocks.anthropicCreate.mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "check_availability",
            input: { date: "2026-08-05" },
          },
        ],
      });
      mocks.checkAvailability.mockRejectedValueOnce(typedError);

      await expect(
        processIncomingMessage(
          BUSINESS_ID,
          "+15745550100",
          null,
          "Can I book and get a price?",
          "sms"
        )
      ).rejects.toBe(typedError);

      expect(mocks.checkAvailability).toHaveBeenCalledOnce();
      expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
      expect(mocks.addMessage).toHaveBeenCalledTimes(1);
      expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
      expect(mocks.parseKnowledgeGapSignal).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalledWith(
        "[calendar-tool] Error executing check_availability:",
        typedError
      );
    }
  );

  it("retains friendly contact-tool fallback text for an ordinary mutation failure", async () => {
    const contactError = new Error("contact provider unavailable");
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "save_contact_name",
            input: { name: "Pat" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Thanks, Pat." }],
      });
    mocks.updateContactName.mockRejectedValueOnce(contactError);

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "I'm Pat.",
        "sms"
      )
    ).resolves.toBe("Thanks, Pat.");

    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(2);
    expect(mocks.anthropicCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: [
              expect.objectContaining({ content: "Contact info saved." }),
            ],
          }),
        ]),
      })
    );
    expect(mocks.addMessage).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "[contact-tool] Error executing save_contact_name:",
      contactError
    );
  });

  it("retains friendly calendar fallback text for an ordinary provider failure", async () => {
    const calendarError = new Error("calendar provider unavailable");
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "check_availability",
            input: { date: "2026-08-05" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I can collect your details." }],
      });
    mocks.checkAvailability.mockRejectedValueOnce(calendarError);

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Can I book?",
        "sms"
      )
    ).resolves.toBe("I can collect your details.");

    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(2);
    expect(mocks.anthropicCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: [
              expect.objectContaining({
                content:
                  "Calendar is temporarily unavailable. Please collect the customer's booking details instead and let them know someone will confirm.",
              }),
            ],
          }),
        ]),
      })
    );
    expect(mocks.addMessage).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      "[calendar-tool] Error executing check_availability:",
      calendarError
    );
  });

  it("freshly checks before every Anthropic request in the tool loop", async () => {
    mocks.anthropicCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "save_contact_name",
          input: { name: "Pat" },
        },
      ],
    });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // first Anthropic request
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // contact tool
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // second Anthropic request

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "I'm Pat.",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.updateContactName).toHaveBeenCalledOnce();
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
  });

  it("checks immediately before assistant persistence", async () => {
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // Anthropic request
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // assistant persistence

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("checks immediately before lead-score mutation", async () => {
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // Anthropic request
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // lead-score mutation

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "What is the price?",
        "sms",
        null,
        { persistAssistant: false }
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
  });

  it("checks again before returning a generated response", async () => {
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // Anthropic request
      .mockResolvedValueOnce(
        operationalControls({
          aiRepliesPausedAt: "2026-08-04T12:00:00Z",
        })
      ); // final return

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms",
        null,
        { persistAssistant: false }
      )
    ).rejects.toMatchObject({ reason: "ai_replies_paused" });

    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("rethrows resolver uncertainty at engine entry without creating a fallback", async () => {
    const resolutionError = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "operational state unavailable",
    });
    mocks.resolveBusinessOperationalControls.mockRejectedValue(resolutionError);

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBe(resolutionError);

    expect(mocks.findOrCreateContact).not.toHaveBeenCalled();
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("fails closed when the operational resolver throws an untyped error", async () => {
    mocks.resolveBusinessOperationalControls.mockRejectedValue(
      new Error("unexpected resolver failure")
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBeInstanceOf(AIProcessingStateError);

    expect(mocks.findOrCreateContact).not.toHaveBeenCalled();
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("rethrows resolver uncertainty after generation without persisting or returning fallback text", async () => {
    const resolutionError = new OperationalControlsResolutionError({
      code: "business_lookup_failed",
      businessId: BUSINESS_ID,
      message: "operational state unavailable",
    });
    mocks.resolveBusinessOperationalControls
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // engine entry
      .mockResolvedValueOnce(ACTIVE_CONTROLS) // Anthropic request
      .mockRejectedValueOnce(resolutionError); // assistant persistence

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBe(resolutionError);

    expect(mocks.anthropicCreate).toHaveBeenCalledOnce();
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });

  it("blocks texting-paused SMS while allowing web chat", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        textingPausedAt: "2026-08-04T12:00:00Z",
      })
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({ reason: "texting_paused" });

    mocks.getOrCreateConversation.mockResolvedValue({
      ...CONVERSATION,
      channel: "web_chat",
    });
    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        null,
        "pat@example.com",
        "Hello",
        "web_chat",
        "session-1"
      )
    ).resolves.toBe("Absolutely.");

    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("does not let a bookings-only pause block ordinary AI", async () => {
    mocks.resolveBusinessOperationalControls.mockResolvedValue(
      operationalControls({
        bookingsPausedAt: "2026-08-04T12:00:00Z",
      })
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).resolves.toBe("Absolutely.");

    expect(mocks.anthropicCreate).toHaveBeenCalledOnce();
  });
});

describe("processIncomingMessage entitlement and takeover defenses", () => {
  it("rejects Starter SMS before creating a contact or calling Anthropic", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER);

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({
      reason: "feature_not_entitled",
    });

    expect(mocks.findOrCreateContact).not.toHaveBeenCalled();
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("rejects a manual SMS conversation before persistence or Anthropic", async () => {
    mocks.getConversationAiState.mockResolvedValue({
      ...CONVERSATION,
      status: "handed_off",
      is_ai_handling: false,
    });

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toMatchObject({
      reason: "conversation_in_manual_mode",
    });

    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("fails safely when the current Human/AI state cannot be read", async () => {
    mocks.getConversationAiState.mockRejectedValue(
      new Error("connection reset")
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBeInstanceOf(AIProcessingStateError);

    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("surfaces contact persistence uncertainty instead of composing a fallback reply", async () => {
    mocks.findOrCreateContact.mockRejectedValue(
      new Error("contacts database unavailable")
    );

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBeInstanceOf(AIProcessingStateError);

    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("surfaces AI context query errors before calling Anthropic", async () => {
    tableResults.set("ai_settings", {
      data: null,
      error: { message: "connection reset" },
    });

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Hello",
        "sms"
      )
    ).rejects.toBeInstanceOf(AIProcessingStateError);

    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("strips advanced guardrails for Growth while retaining entitled booking tools", async () => {
    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Can I book?",
        "sms"
      )
    ).resolves.toBe("Absolutely.");

    expect(mocks.buildSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guardrails: [] }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      "sms"
    );
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "check_availability" }),
        ]),
      })
    );
    expect(mocks.buildConversationMessages).toHaveBeenCalledWith(
      expect.any(Array)
    );
  });

  it("applies saved advanced guardrails for Full", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue(FULL);

    await processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Can I book?",
      "sms"
    );

    expect(mocks.buildSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guardrails: ["promise a price"] }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      true,
      "sms"
    );
  });

  it("omits Calendar context and tools when direct booking is not entitled", async () => {
    mocks.canUseFeature.mockImplementation(
      (_entitlements: unknown, feature: string) =>
        feature === "ai_sms_conversations"
    );

    await processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Can I book?",
      "sms"
    );

    expect(mocks.buildSystemPrompt).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      false,
      "sms"
    );
    expect(mocks.anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.not.arrayContaining([
          expect.objectContaining({ name: "check_availability" }),
        ]),
      })
    );
  });

  it("refuses a create_booking tool call when direct booking tools are disabled", async () => {
    mocks.shouldIncludeCalendarTools.mockReturnValue(false);
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "create_booking",
            input: {
              customer_name: "Pat",
              service_name: "Estimate",
              start_time: "2026-08-01T10:00:00",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I can collect your details." }],
      });

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Please book that.",
        "sms"
      )
    ).resolves.toBe("I can collect your details.");

    expect(mocks.createBooking).not.toHaveBeenCalled();
  });

  it("does not insert the inbound message twice when the webhook already persisted it", async () => {
    await processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Can I book?",
      "sms",
      null,
      {
        persistCustomer: false,
        persistAssistant: false,
        contact: CONTACT as never,
        conversation: CONVERSATION as never,
      }
    );

    expect(mocks.resolveBusinessEntitlements).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.getConversationHistory).toHaveBeenCalledWith(CONVERSATION.id);
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
  });

  it("links a direct booking to the customer message persisted by the engine", async () => {
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "create_booking",
            input: {
              customer_name: "Pat",
              service_name: "Estimate",
              start_time: "2026-08-01T10:00:00",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Booked." }],
      });

    await processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Please book that.",
      "sms"
    );

    expect(mocks.createBooking).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.objectContaining({
        customerName: "Pat",
        serviceName: "Estimate",
      }),
      "America/New_York",
      {
        contactId: CONTACT.id,
        conversationId: CONVERSATION.id,
        sourceMessageId: "message_1",
      }
    );
  });

  it("uses a webhook-persisted source message for retry-stable direct booking", async () => {
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "create_booking",
            input: {
              customer_name: "Pat",
              service_name: "Estimate",
              start_time: "2026-08-01T10:00:00",
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Booked." }],
      });

    await processIncomingMessage(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Please book that.",
      "sms",
      null,
      {
        persistCustomer: false,
        persistAssistant: false,
        sourceMessageId: "provider_message_1",
        contact: CONTACT as never,
        conversation: CONVERSATION as never,
      }
    );

    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.createBooking).toHaveBeenCalledWith(
      BUSINESS_ID,
      expect.anything(),
      "America/New_York",
      expect.objectContaining({ sourceMessageId: "provider_message_1" })
    );
  });

  it("surfaces unlinked direct booking state instead of feeding it back to Anthropic", async () => {
    mocks.anthropicCreate.mockResolvedValueOnce({
      stop_reason: "tool_use",
      content: [
        {
          type: "tool_use",
          id: "tool_1",
          name: "create_booking",
          input: {
            customer_name: "Pat",
            service_name: "Estimate",
            start_time: "2026-08-01T10:00:00",
          },
        },
      ],
    });

    await expect(
      processIncomingMessage(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Please book that.",
        "sms",
        null,
        {
          persistCustomer: false,
          persistAssistant: false,
          contact: CONTACT as never,
          conversation: CONVERSATION as never,
        }
      )
    ).rejects.toBeInstanceOf(AIProcessingStateError);

    expect(mocks.createBooking).not.toHaveBeenCalled();
    expect(mocks.anthropicCreate).toHaveBeenCalledTimes(1);
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.incrementLeadScore).not.toHaveBeenCalled();
  });
});

describe("processIncomingMessageDetailed knowledge-gap signaling", () => {
  it("returns gap metadata and persists only the cleaned response", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: `I don't see free trials mentioned. Please call us.\n${KNOWLEDGE_GAP_SIGNAL}`,
        },
      ],
    });

    await expect(
      processIncomingMessageDetailed(
        BUSINESS_ID,
        "+15745550100",
        null,
        "Do you offer free trials?",
        "sms"
      )
    ).resolves.toEqual({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: CONVERSATION.id,
      sourceMessageId: "message_1",
    });

    expect(mocks.addMessage).toHaveBeenNthCalledWith(
      2,
      CONVERSATION.id,
      BUSINESS_ID,
      "assistant",
      "I don't see free trials mentioned. Please call us.",
      "sms"
    );
  });

  it("classifies the final response after the tool loop", async () => {
    mocks.anthropicCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool_1",
            name: "save_contact_name",
            input: { name: "Pat" },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: `Thanks, Pat. I don't see trial details. Please call us.\n${KNOWLEDGE_GAP_SIGNAL}`,
          },
        ],
      });

    const result = await processIncomingMessageDetailed(
      BUSINESS_ID,
      "+15745550100",
      null,
      "I'm Pat. Is there a free trial?",
      "sms"
    );

    expect(result).toMatchObject({
      text: "Thanks, Pat. I don't see trial details. Please call us.",
      knowledgeGapDetected: true,
    });
    expect(mocks.updateContactName).toHaveBeenCalledWith(CONTACT.id, "Pat");
    expect(mocks.parseKnowledgeGapSignal).toHaveBeenCalledTimes(1);
  });

  it("returns caller-owned persistence references without writing messages", async () => {
    const result = await processIncomingMessageDetailed(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Do you offer free trials?",
      "sms",
      null,
      {
        persistCustomer: false,
        persistAssistant: false,
        sourceMessageId: "provider-message-1",
        contact: CONTACT as never,
        conversation: CONVERSATION as never,
      }
    );

    expect(result).toEqual({
      text: "Absolutely.",
      knowledgeGapDetected: false,
      conversationId: CONVERSATION.id,
      sourceMessageId: "provider-message-1",
    });
    expect(mocks.addMessage).not.toHaveBeenCalled();
  });

  it("uses the fallback when stripping leaves no customer-visible text", async () => {
    mocks.anthropicCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: KNOWLEDGE_GAP_SIGNAL }],
    });

    const result = await processIncomingMessageDetailed(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Do you offer free trials?",
      "sms"
    );

    expect(result.text).toContain("We're having a brief technical issue.");
    expect(result.knowledgeGapDetected).toBe(true);
    expect(mocks.addMessage).toHaveBeenNthCalledWith(
      2,
      CONVERSATION.id,
      BUSINESS_ID,
      "assistant",
      result.text,
      "sms"
    );
  });

  it("exact-strips the sentinel and disables classification if parsing throws", async () => {
    const parserError = new Error("parser failure");
    mocks.parseKnowledgeGapSignal.mockImplementationOnce(() => {
      throw parserError;
    });
    mocks.anthropicCreate.mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: `Please call us.\n${KNOWLEDGE_GAP_SIGNAL}`,
        },
      ],
    });

    const result = await processIncomingMessageDetailed(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Do you offer free trials?",
      "sms"
    );

    expect(result).toMatchObject({
      text: "Please call us.",
      knowledgeGapDetected: false,
    });
    expect(console.error).toHaveBeenCalledWith(
      "[ai-engine] Knowledge-gap signal parsing failed:",
      parserError
    );
  });
});
