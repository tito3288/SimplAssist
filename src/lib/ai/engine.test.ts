import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  from: vi.fn(),
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
  shouldIncludeCalendarTools: vi.fn(),
}));

vi.mock("@/lib/anthropic/client", () => ({
  anthropic: { messages: { create: mocks.anthropicCreate } },
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
vi.mock("./tools", () => ({
  calendarTools: [
    {
      name: "check_availability",
      description: "calendar",
      input_schema: { type: "object", properties: {} },
    },
  ],
  shouldIncludeCalendarTools: mocks.shouldIncludeCalendarTools,
}));
vi.mock("@/lib/google/calendar", () => ({
  checkAvailability: vi.fn(),
  createBooking: vi.fn(),
}));

import {
  AIProcessingStateError,
  processIncomingMessage,
} from "./engine";

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
  mocks.incrementLeadScore.mockResolvedValue(undefined);
  setAiData();
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
});
