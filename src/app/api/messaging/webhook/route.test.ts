import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  unwrap: vi.fn(),
  send: vi.fn(),
  claimMessagingWebhookEvent: vi.fn(),
  completeMessagingWebhookEvent: vi.fn(),
  releaseMessagingWebhookClaim: vi.fn(),
  from: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  findOrCreateContact: vi.fn(),
  getOrCreateConversation: vi.fn(),
  addInboundMessageOnce: vi.fn(),
  addMessage: vi.fn(),
  getConversationAiState: vi.fn(),
  processIncomingMessageDetailed: vi.fn(),
  recordKnowledgeGap: vi.fn(),
  getOutboundSendContext: vi.fn(),
  resolveOutboundSmsOperationalAccess: vi.fn(),
  insertPausedSystemMessageIfNeeded: vi.fn(),
  recordInboundMessagingUsage: vi.fn(),
  preflightOutboundSms: vi.fn(),
  recordOutboundSmsUsage: vi.fn(),
}));

vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    webhooks: { unwrap: mocks.unwrap },
    messages: { send: mocks.send },
  },
}));
vi.mock("@/lib/messaging/idempotency", () => ({
  claimMessagingWebhookEvent: mocks.claimMessagingWebhookEvent,
  completeMessagingWebhookEvent: mocks.completeMessagingWebhookEvent,
  releaseMessagingWebhookClaim: mocks.releaseMessagingWebhookClaim,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("@/lib/ai/contacts", () => ({
  findOrCreateContact: mocks.findOrCreateContact,
}));
vi.mock("@/lib/ai/conversations", () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  addInboundMessageOnce: mocks.addInboundMessageOnce,
  addMessage: mocks.addMessage,
  getConversationAiState: mocks.getConversationAiState,
  isAiHandlingActive: (conversation: {
    status: string;
    is_ai_handling: boolean;
  }) => conversation.status === "active" && conversation.is_ai_handling,
}));
vi.mock("@/lib/ai/engine", () => ({
  processIncomingMessageDetailed: mocks.processIncomingMessageDetailed,
}));
vi.mock("@/lib/ai/knowledgeGaps", () => ({
  recordKnowledgeGap: mocks.recordKnowledgeGap,
}));
vi.mock("@/lib/messaging/lookup", () => ({
  getOutboundSendContext: mocks.getOutboundSendContext,
}));
vi.mock("@/lib/messaging/outboundSmsOperational.server", () => ({
  resolveOutboundSmsOperationalAccess:
    mocks.resolveOutboundSmsOperationalAccess,
  isOutboundSmsOperationalBlockReason: (reason: string) =>
    ["account_suspended", "texting_paused", "ai_replies_paused"].includes(
      reason
    ),
}));
vi.mock("@/lib/messaging/pausedNotice", () => ({
  insertPausedSystemMessageIfNeeded: mocks.insertPausedSystemMessageIfNeeded,
}));
vi.mock("@/lib/billing/usage", () => ({
  recordInboundMessagingUsage: mocks.recordInboundMessagingUsage,
  preflightOutboundSms: mocks.preflightOutboundSms,
  recordOutboundSmsUsage: mocks.recordOutboundSmsUsage,
}));

import { POST as messagingWebhook } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CONTACT = {
  id: "00000000-0000-4000-8000-000000000002",
  business_id: BUSINESS_ID,
  phone_number: "+15745550100",
};
const ACTIVE_CONVERSATION = {
  id: "00000000-0000-4000-8000-000000000003",
  business_id: BUSINESS_ID,
  contact_id: CONTACT.id,
  channel: "sms",
  status: "active",
  is_ai_handling: true,
};
const GROWTH_ENTITLEMENTS = {
  businessId: BUSINESS_ID,
  plan: "sms_and_chat",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
};
const STARTER_ENTITLEMENTS = {
  ...GROWTH_ENTITLEMENTS,
  plan: "sms_only",
};
const CANCELED_ENTITLEMENTS = {
  ...GROWTH_ENTITLEMENTS,
  status: "canceled",
  active: false,
};
const MMS_FALLBACK_WITHOUT_OPT_OUT =
  "I can't process images yet — please describe what you need in text and I'll help.";

const tableQueues = new Map<string, unknown[]>();

function queueTable(table: string, ...results: unknown[]) {
  tableQueues.set(table, [...results]);
}

function inboundEvent(
  overrides: Partial<{
    id: string;
    text: string;
    media: unknown[];
  }> = {}
) {
  return {
    data: {
      id: overrides.id ?? "evt_inbound_1",
      event_type: "message.received",
      payload: {
        from: { phone_number: "+15745550100" },
        to: [{ phone_number: "+15745550200" }],
        text: overrides.text ?? "Can I get an estimate?",
        media: overrides.media ?? [],
      },
    },
  };
}

function request(body = "{\"data\":\"signed payload\"}") {
  return new NextRequest("http://localhost/api/messaging/webhook", {
    method: "POST",
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableQueues.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);

  mocks.from.mockImplementation((table: string) => {
    const result = tableQueues.get(table)?.shift() ?? {
      data: null,
      error: { message: `Unexpected ${table} query` },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
      "select",
      "eq",
      "maybeSingle",
      "single",
      "insert",
      "update",
      "limit",
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    return chain;
  });

  mocks.unwrap.mockResolvedValue(inboundEvent());
  mocks.claimMessagingWebhookEvent.mockResolvedValue({
    outcome: "claimed",
    claimToken: "claim-token-1",
  });
  mocks.completeMessagingWebhookEvent.mockResolvedValue(undefined);
  mocks.releaseMessagingWebhookClaim.mockResolvedValue(undefined);
  mocks.resolveBusinessEntitlements.mockResolvedValue(GROWTH_ENTITLEMENTS);
  mocks.canUseFeature.mockImplementation(
    (entitlements: { active: boolean; plan: string }, feature: string) =>
      entitlements.active &&
      (feature !== "ai_sms_conversations" ||
        entitlements.plan === "sms_and_chat" ||
        entitlements.plan === "full")
  );
  mocks.findOrCreateContact.mockResolvedValue(CONTACT);
  mocks.getOrCreateConversation.mockResolvedValue(ACTIVE_CONVERSATION);
  mocks.addInboundMessageOnce.mockResolvedValue({ id: "message_1" });
  mocks.recordInboundMessagingUsage.mockResolvedValue(undefined);
  mocks.getOutboundSendContext.mockResolvedValue({
    businessId: BUSINESS_ID,
    smsReady: true,
    blockReason: null,
    campaignStatus: "approved",
    assignmentStatus: "assigned",
    messagingProfileId: "profile_1",
  });
  mocks.resolveOutboundSmsOperationalAccess.mockResolvedValue({
    allowed: true,
  });
  mocks.processIncomingMessageDetailed.mockResolvedValue({
    text: "Yes, we can help.",
    knowledgeGapDetected: false,
    conversationId: ACTIVE_CONVERSATION.id,
    sourceMessageId: "message_1",
  });
  mocks.recordKnowledgeGap.mockResolvedValue(undefined);
  mocks.getConversationAiState.mockResolvedValue(ACTIVE_CONVERSATION);
  mocks.preflightOutboundSms.mockResolvedValue({ allowed: true });
  mocks.send.mockResolvedValue({ data: { id: "telnyx_message_1" } });
  mocks.addMessage.mockResolvedValue({ id: "assistant_message_1" });
  mocks.recordOutboundSmsUsage.mockResolvedValue(undefined);
  queueTable(
    "phone_numbers",
    { data: { business_id: BUSINESS_ID }, error: null }
  );
  queueTable("messages", { data: { id: "prior_assistant" }, error: null });
});

describe("POST /api/messaging/webhook", () => {
  it("persists a Starter inbound message and skips every automated reply path", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER_ENTITLEMENTS);

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        providerEventId: "telnyx:message.received:evt_inbound_1",
      })
    );
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledWith(
      ACTIVE_CONVERSATION.id,
      BUSINESS_ID,
      "Can I get an estimate?",
      "sms",
      "telnyx:message.received:evt_inbound_1"
    );
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith(
      BUSINESS_ID,
      CONTACT.id,
      "sms",
      { defaultAiHandling: false }
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.preflightOutboundSms).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("ai_settings");
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
  });

  it("persists a canceled account's lead but sends no AI or outbound message", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue(CANCELED_ENTITLEMENTS);

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledTimes(1);
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledTimes(1);
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledTimes(1);
  });

  it("derives a stable namespaced SHA-256 key when Telnyx omits an event id", async () => {
    const event = inboundEvent();
    delete (event.data as { id?: string }).id;
    mocks.unwrap.mockResolvedValue(event);
    mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER_ENTITLEMENTS);
    const rawBody = "{\"signed\":\"same bytes on every retry\"}";
    const expectedHash = createHash("sha256").update(rawBody).digest("hex");

    const response = await messagingWebhook(request(rawBody));

    expect(response.status).toBe(200);
    expect(mocks.claimMessagingWebhookEvent).toHaveBeenCalledWith(
      `telnyx:message.received:${expectedHash}`
    );
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledWith(
      ACTIVE_CONVERSATION.id,
      BUSINESS_ID,
      expect.any(String),
      "sms",
      `telnyx:message.received:${expectedHash}`
    );
  });

  it("keeps a handed-off Growth conversation in Human mode with no AI, delay, or Telnyx send", async () => {
    const handedOff = {
      ...ACTIVE_CONVERSATION,
      status: "handed_off",
      is_ai_handling: false,
    };
    mocks.getOrCreateConversation.mockResolvedValue(handedOff);

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.addInboundMessageOnce).toHaveBeenCalled();
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.preflightOutboundSms).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith("ai_settings");
  });

  it("also honors is_ai_handling=false when the stored status is still active", async () => {
    mocks.getOrCreateConversation.mockResolvedValue({
      ...ACTIVE_CONVERSATION,
      status: "active",
      is_ai_handling: false,
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.addInboundMessageOnce).toHaveBeenCalled();
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("does not send when a human takes over while an AI reply is being generated", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.getConversationAiState.mockResolvedValueOnce({
      ...ACTIVE_CONVERSATION,
      status: "handed_off",
      is_ai_handling: false,
    });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => {
      expect(mocks.processIncomingMessageDetailed).toHaveBeenCalled();
      expect(mocks.getConversationAiState).toHaveBeenCalled();
    });
    expect(mocks.preflightOutboundSms).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("restores AI replies after the same conversation is toggled back to active", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.processIncomingMessageDetailed).toHaveBeenCalledWith(
      BUSINESS_ID,
      "+15745550100",
      null,
      "Can I get an estimate?",
      "sms",
      null,
      expect.objectContaining({
        persistCustomer: false,
        persistAssistant: false,
        sourceMessageId: "message_1",
        conversation: ACTIVE_CONVERSATION,
      })
    );
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "+15745550200",
        to: "+15745550100",
        text: "Yes, we can help.",
      })
    );
    expect(mocks.preflightOutboundSms).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      text: "Yes, we can help.",
      purpose: "ai_reply",
    });
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(2);
    expect(
      mocks.preflightOutboundSms.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[1]
    );
    expect(
      mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("captures a signaled first-reply gap only after send and persistence, including opt-out copy", async () => {
    // The contact/conversation can survive a failed first attempt. With no
    // prior assistant SMS in the transcript, the successful retry must still
    // carry the required opt-out suffix.
    queueTable("messages", { data: null, error: null });
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: ACTIVE_CONVERSATION.id,
      sourceMessageId: "message_1",
    });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() =>
      expect(mocks.recordKnowledgeGap).toHaveBeenCalledTimes(1)
    );
    const finalReply =
      "I don't see free trials mentioned. Please call us.\n\nReply STOP to opt out.";
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        text: finalReply,
      })
    );
    expect(mocks.addMessage).toHaveBeenCalledWith(
      ACTIVE_CONVERSATION.id,
      BUSINESS_ID,
      "assistant",
      finalReply,
      "sms"
    );
    expect(mocks.recordKnowledgeGap).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      sourceMessageId: "message_1",
      aiResponseText: finalReply,
    });
    expect(mocks.send.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.addMessage.mock.invocationCallOrder[0]
    );
    expect(mocks.addMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.recordKnowledgeGap.mock.invocationCallOrder[0]
    );
    expect(
      mocks.recordOutboundSmsUsage.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.recordKnowledgeGap.mock.invocationCallOrder[0]);
  });

  it("keeps SMS delivery and billing complete when gap capture unexpectedly rejects", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: ACTIVE_CONVERSATION.id,
      sourceMessageId: "message_1",
    });
    const captureError = new Error("capture failed");
    mocks.recordKnowledgeGap.mockRejectedValue(captureError);

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[messaging:webhook] Knowledge gap capture failed:",
        { businessId: BUSINESS_ID, sourceMessageId: "message_1" },
        captureError
      )
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.addMessage).toHaveBeenCalledTimes(1);
    expect(mocks.recordOutboundSmsUsage).toHaveBeenCalledTimes(1);
    expect(console.error).not.toHaveBeenCalledWith(
      "[messaging:webhook] AI reply processing failed:",
      expect.anything()
    );
  });

  it("does not capture a signaled gap when the SMS send fails", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: ACTIVE_CONVERSATION.id,
      sourceMessageId: "message_1",
    });
    mocks.send.mockRejectedValue(new Error("Telnyx unavailable"));

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[messaging:webhook] AI reply processing failed:",
        expect.any(Error)
      )
    );
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("does not capture a signaled gap when assistant transcript persistence fails", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.processIncomingMessageDetailed.mockResolvedValue({
      text: "I don't see free trials mentioned. Please call us.",
      knowledgeGapDetected: true,
      conversationId: ACTIVE_CONVERSATION.id,
      sourceMessageId: "message_1",
    });
    mocks.addMessage.mockRejectedValue(new Error("Transcript unavailable"));

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.addMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(console.error).toHaveBeenCalledWith(
        "[messaging:webhook] AI reply processing failed:",
        expect.any(Error)
      )
    );
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("retries without AI when prior-reply state cannot be read", async () => {
    queueTable("messages", {
      data: null,
      error: { message: "connection reset" },
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.completeMessagingWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("keeps Growth AI enabled while Stripe is past_due", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue({
      ...GROWTH_ENTITLEMENTS,
      status: "past_due",
    });
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.processIncomingMessageDetailed).toHaveBeenCalled();
    expect(mocks.preflightOutboundSms).toHaveBeenCalled();
  });

  it("keeps the inherited AI SMS flow enabled for Full", async () => {
    mocks.resolveBusinessEntitlements.mockResolvedValue({
      ...GROWTH_ENTITLEMENTS,
      plan: "full",
    });
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.processIncomingMessageDetailed).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      expect.anything(),
      "sms",
      null,
      expect.objectContaining({
        conversation: ACTIVE_CONVERSATION,
      })
    );
  });

  it("records manual MMS without sending the canned fallback", async () => {
    mocks.unwrap.mockResolvedValue(
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] })
    );
    mocks.getOrCreateConversation.mockResolvedValue({
      ...ACTIVE_CONVERSATION,
      status: "handed_off",
      is_ai_handling: false,
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaCount: 1 })
    );
    expect(mocks.addInboundMessageOnce).toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records Starter MMS without sending the canned fallback", async () => {
    mocks.unwrap.mockResolvedValue(
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] })
    );
    mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER_ENTITLEMENTS);

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledWith(
      expect.objectContaining({ mediaCount: 1 })
    );
    expect(mocks.addInboundMessageOnce).toHaveBeenCalled();
    expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    [
      "account suspension",
      "account_suspended",
      inboundEvent(),
      "ai_reply",
    ],
    [
      "texting pause",
      "texting_paused",
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] }),
      "mms_fallback",
    ],
    ["AI pause", "ai_replies_paused", inboundEvent(), "ai_reply"],
  ] as const)(
    "persists inbound activity, records one internal notice, and completes the claim during %s",
    async (_, reason, event, purpose) => {
      mocks.unwrap.mockResolvedValue(event);
      mocks.resolveOutboundSmsOperationalAccess.mockResolvedValue({
        allowed: false,
        reason,
      });

      const response = await messagingWebhook(request());

      expect(response.status).toBe(200);
      expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledOnce();
      expect(mocks.addInboundMessageOnce).toHaveBeenCalledOnce();
      expect(
        mocks.recordInboundMessagingUsage.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[0]
      );
      expect(
        mocks.addInboundMessageOnce.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[0]
      );
      expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledWith(
        BUSINESS_ID,
        purpose
      );
      expect(mocks.insertPausedSystemMessageIfNeeded).toHaveBeenCalledWith({
        conversationId: ACTIVE_CONVERSATION.id,
        businessId: BUSINESS_ID,
        channel: "sms",
        context: purpose,
        reason,
      });
      expect(
        mocks.insertPausedSystemMessageIfNeeded.mock.invocationCallOrder[0]
      ).toBeLessThan(
        mocks.completeMessagingWebhookEvent.mock.invocationCallOrder[0]
      );
      expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
        "telnyx:message.received:evt_inbound_1",
        "claim-token-1"
      );
      expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
      expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
      expect(mocks.getOutboundSendContext).not.toHaveBeenCalled();
      expect(mocks.preflightOutboundSms).not.toHaveBeenCalled();
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.recordOutboundSmsUsage).not.toHaveBeenCalled();
    }
  );

  it("releases the claim only after preserving inbound activity when operational state is indeterminate", async () => {
    mocks.resolveOutboundSmsOperationalAccess.mockRejectedValue(
      new Error("operational state unavailable")
    );

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalledOnce();
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledOnce();
    expect(mocks.completeMessagingWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("adds opt-out copy to the first automated MMS fallback", async () => {
    mocks.unwrap.mockResolvedValue(
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] })
    );
    queueTable("messages", { data: null, error: null });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    const expected =
      "I can't process images yet — please describe what you need in text and I'll help.\n\nReply STOP to opt out.";
    expect(mocks.preflightOutboundSms).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      text: expected,
      purpose: "mms_fallback",
    });
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(2);
    expect(
      mocks.preflightOutboundSms.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[1]
    );
    expect(
      mocks.resolveOutboundSmsOperationalAccess.mock.invocationCallOrder[1]
    ).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: expected })
    );
    expect(mocks.addMessage).toHaveBeenCalledWith(
      ACTIVE_CONVERSATION.id,
      BUSINESS_ID,
      "assistant",
      expected,
      "sms"
    );
    expect(mocks.recordOutboundSmsUsage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expected })
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
  });

  it("does not repeat opt-out copy on later automated MMS fallbacks", async () => {
    mocks.unwrap.mockResolvedValue(
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] })
    );

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ text: "I can't process images yet — please describe what you need in text and I'll help." })
    );
  });

  it("blocks MMS at the final gate when texting pauses after preflight", async () => {
    mocks.unwrap.mockResolvedValue(
      inboundEvent({ text: "", media: [{ content_type: "image/jpeg" }] })
    );
    mocks.resolveOutboundSmsOperationalAccess
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "texting_paused",
      });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() =>
      expect(mocks.insertPausedSystemMessageIfNeeded).toHaveBeenCalledWith({
        conversationId: ACTIVE_CONVERSATION.id,
        businessId: BUSINESS_ID,
        channel: "sms",
        context: "mms_fallback",
        reason: "texting_paused",
      })
    );
    expect(mocks.preflightOutboundSms).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      text: MMS_FALLBACK_WITHOUT_OPT_OUT,
      purpose: "mms_fallback",
    });
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.recordOutboundSmsUsage).not.toHaveBeenCalled();
  });

  it("blocks an AI reply at the final gate when AI pauses after preflight", async () => {
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });
    mocks.resolveOutboundSmsOperationalAccess
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: "ai_replies_paused",
      });

    const response = await messagingWebhook(request());
    expect(response.status).toBe(200);

    await vi.waitFor(() =>
      expect(mocks.insertPausedSystemMessageIfNeeded).toHaveBeenCalledWith({
        conversationId: ACTIVE_CONVERSATION.id,
        businessId: BUSINESS_ID,
        channel: "sms",
        context: "ai_reply",
        reason: "ai_replies_paused",
      })
    );
    expect(mocks.preflightOutboundSms).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      text: "Yes, we can help.",
      purpose: "ai_reply",
    });
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(2);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.addMessage).not.toHaveBeenCalled();
    expect(mocks.recordOutboundSmsUsage).not.toHaveBeenCalled();
    expect(mocks.recordKnowledgeGap).not.toHaveBeenCalled();
  });

  it("does not replay a suppressed inbound after reactivation and processes only a newly delivered event", async () => {
    mocks.claimMessagingWebhookEvent
      .mockResolvedValueOnce({
        outcome: "claimed",
        claimToken: "claim-token-paused",
      })
      .mockResolvedValueOnce({ outcome: "completed", claimToken: null })
      .mockResolvedValueOnce({
        outcome: "claimed",
        claimToken: "claim-token-new",
      });
    mocks.resolveOutboundSmsOperationalAccess
      .mockResolvedValueOnce({
        allowed: false,
        reason: "account_suspended",
      })
      .mockResolvedValue({ allowed: true });

    const suppressed = await messagingWebhook(request());
    expect(suppressed.status).toBe(200);
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-paused"
    );

    const duplicateAfterReactivation = await messagingWebhook(request());
    expect(duplicateAfterReactivation.status).toBe(200);
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(1);
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledTimes(1);
    expect(mocks.send).not.toHaveBeenCalled();

    mocks.unwrap.mockResolvedValue(inboundEvent({ id: "evt_inbound_new" }));
    queueTable("phone_numbers", {
      data: { business_id: BUSINESS_ID },
      error: null,
    });
    queueTable("ai_settings", {
      data: { sms_response_delay_seconds: 0 },
      error: null,
    });

    const newlyDelivered = await messagingWebhook(request());
    expect(newlyDelivered.status).toBe(200);

    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledOnce());
    expect(mocks.addInboundMessageOnce).toHaveBeenCalledTimes(2);
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_new",
      "claim-token-new"
    );
    expect(mocks.resolveOutboundSmsOperationalAccess).toHaveBeenCalledTimes(3);
  });

  it("releases the claim and returns 500 when entitlement state is indeterminate", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new Error("subscription lookup failed")
    );

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
    expect(mocks.recordInboundMessagingUsage).not.toHaveBeenCalled();
    expect(mocks.addInboundMessageOnce).not.toHaveBeenCalled();
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
  });

  it("releases the claim and returns 500 when durable message persistence fails", async () => {
    mocks.addInboundMessageOnce.mockRejectedValue(new Error("DB unavailable"));

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.recordInboundMessagingUsage).toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
  });

  it("does not dispatch AI when completing the owned claim fails", async () => {
    mocks.completeMessagingWebhookEvent.mockRejectedValue(
      new Error("completion RPC unavailable")
    );

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );
    expect(mocks.processIncomingMessageDetailed).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("treats phone lookup errors as retryable but an unknown number as permanent", async () => {
    queueTable("phone_numbers", {
      data: null,
      error: { message: "connection reset" },
    });

    const failed = await messagingWebhook(request());
    expect(failed.status).toBe(500);
    expect(mocks.releaseMessagingWebhookClaim).toHaveBeenCalledWith(
      "telnyx:message.received:evt_inbound_1",
      "claim-token-1"
    );

    vi.clearAllMocks();
    mocks.unwrap.mockResolvedValue(inboundEvent({ id: "evt_unknown" }));
    mocks.claimMessagingWebhookEvent.mockResolvedValue({
      outcome: "claimed",
      claimToken: "claim-token-unknown",
    });
    mocks.completeMessagingWebhookEvent.mockResolvedValue(undefined);
    mocks.releaseMessagingWebhookClaim.mockResolvedValue(undefined);
    queueTable("phone_numbers", { data: null, error: null });

    const unknown = await messagingWebhook(request());
    expect(unknown.status).toBe(200);
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_unknown",
      "claim-token-unknown"
    );
    expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
  });

  it("acknowledges a completed duplicate without processing it again", async () => {
    mocks.claimMessagingWebhookEvent.mockResolvedValue({
      outcome: "completed",
      claimToken: null,
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.recordInboundMessagingUsage).not.toHaveBeenCalled();
    expect(mocks.addInboundMessageOnce).not.toHaveBeenCalled();
    expect(mocks.completeMessagingWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
  });

  it("returns 500 for an in-progress duplicate so a later provider retry is preserved", async () => {
    mocks.claimMessagingWebhookEvent.mockResolvedValue({
      outcome: "in_progress",
      claimToken: null,
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(500);
    expect(mocks.recordInboundMessagingUsage).not.toHaveBeenCalled();
    expect(mocks.addInboundMessageOnce).not.toHaveBeenCalled();
    expect(mocks.completeMessagingWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
  });

  it("returns 403 for an invalid signature without claiming the event", async () => {
    mocks.unwrap.mockRejectedValue(new Error("invalid signature"));

    const response = await messagingWebhook(request());

    expect(response.status).toBe(403);
    expect(mocks.claimMessagingWebhookEvent).not.toHaveBeenCalled();
    expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
  });

  it("acknowledges a permanently malformed payload and keeps its claim", async () => {
    mocks.unwrap.mockResolvedValue({
      data: {
        id: "evt_malformed",
        event_type: "message.received",
        payload: { text: "missing phone numbers" },
      },
    });

    const response = await messagingWebhook(request());

    expect(response.status).toBe(200);
    expect(mocks.claimMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_malformed"
    );
    expect(mocks.completeMessagingWebhookEvent).toHaveBeenCalledWith(
      "telnyx:message.received:evt_malformed",
      "claim-token-1"
    );
    expect(mocks.releaseMessagingWebhookClaim).not.toHaveBeenCalled();
    expect(mocks.recordInboundMessagingUsage).not.toHaveBeenCalled();
  });
});
