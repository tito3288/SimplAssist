import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  anthropicCreate: vi.fn(),
  from: vi.fn(),
  resolveBusinessEntitlements: vi.fn(),
  canUseFeature: vi.fn(),
  getOutboundSendContext: vi.fn(),
  findOrCreateContact: vi.fn(),
  getOrCreateConversation: vi.fn(),
  addMessage: vi.fn(),
  insertPausedSystemMessageIfNeeded: vi.fn(),
  preflightOutboundSms: vi.fn(),
  recordOutboundSmsUsage: vi.fn(),
}));

vi.mock("./client", () => ({
  telnyx: { messages: { send: mocks.send } },
}));
vi.mock("@/lib/anthropic/client", () => ({
  anthropic: { messages: { create: mocks.anthropicCreate } },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/billing/entitlements", () => ({
  resolveBusinessEntitlements: mocks.resolveBusinessEntitlements,
  canUseFeature: mocks.canUseFeature,
}));
vi.mock("./lookup", () => ({
  getOutboundSendContext: mocks.getOutboundSendContext,
}));
vi.mock("@/lib/ai/contacts", () => ({
  findOrCreateContact: mocks.findOrCreateContact,
}));
vi.mock("@/lib/ai/conversations", () => ({
  getOrCreateConversation: mocks.getOrCreateConversation,
  addMessage: mocks.addMessage,
}));
vi.mock("./pausedNotice", () => ({
  insertPausedSystemMessageIfNeeded: mocks.insertPausedSystemMessageIfNeeded,
}));
vi.mock("@/lib/billing/usage", () => ({
  preflightOutboundSms: mocks.preflightOutboundSms,
  recordOutboundSmsUsage: mocks.recordOutboundSmsUsage,
}));

import { sendMissedCallSMS } from "./missed-call";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CALLER = "+15745550100";
const BUSINESS_NUMBER = "+15745550200";
const STARTER = {
  businessId: BUSINESS_ID,
  plan: "sms_only",
  status: "active",
  source: "subscription",
  active: true,
  cancelAtPeriodEnd: false,
};

const tableResults = new Map<string, unknown>();

function setRows(language: "en" | "es" | "both") {
  tableResults.set("businesses", {
    data: {
      name: "Green Leaf Landscaping",
      email: "hello@example.com",
      phone_number: "+15745550300",
    },
    error: null,
  });
  tableResults.set("ai_settings", { data: { language }, error: null });
  tableResults.set("phone_numbers", {
    data: { phone_number: BUSINESS_NUMBER },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  tableResults.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);

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

  mocks.resolveBusinessEntitlements.mockResolvedValue(STARTER);
  mocks.canUseFeature.mockImplementation(
    (_entitlements: unknown, feature: string) => feature === "missed_call_sms"
  );
  mocks.getOutboundSendContext.mockResolvedValue({
    businessId: BUSINESS_ID,
    smsReady: true,
    blockReason: null,
    campaignStatus: "approved",
    assignmentStatus: "assigned",
    messagingProfileId: "profile_1",
  });
  mocks.findOrCreateContact.mockResolvedValue({ id: "contact_1" });
  mocks.getOrCreateConversation.mockResolvedValue({ id: "conversation_1" });
  mocks.preflightOutboundSms.mockResolvedValue({ allowed: true });
  mocks.send.mockResolvedValue({ data: { id: "telnyx_message_1" } });
  mocks.addMessage.mockResolvedValue({ id: "message_1" });
  mocks.recordOutboundSmsUsage.mockResolvedValue(undefined);
});

describe("sendMissedCallSMS", () => {
  it.each([
    [
      "en" as const,
      "Hi, this is Green Leaf Landscaping. We received your call and can help by text. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
    ],
    [
      "es" as const,
      "Hola, somos Green Leaf Landscaping. Recibimos su llamada y podemos ayudar por texto. La frecuencia de mensajes varia. Pueden aplicar tarifas de mensajes y datos. Responda HELP para ayuda o STOP para cancelar.",
    ],
    [
      "both" as const,
      "Hi, this is Green Leaf Landscaping. We received your call and can help by text. Msg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.",
    ],
  ])("sends the exact static %s template without Anthropic", async (language, expected) => {
    setRows(language);

    await sendMissedCallSMS(CALLER, BUSINESS_ID);

    expect(mocks.send).toHaveBeenCalledWith({
      from: BUSINESS_NUMBER,
      to: CALLER,
      text: expected,
      messaging_profile_id: "profile_1",
      type: "SMS",
    });
    expect(mocks.preflightOutboundSms).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      text: expected,
    });
    expect(mocks.getOrCreateConversation).toHaveBeenCalledWith(
      BUSINESS_ID,
      "contact_1",
      "sms",
      { defaultAiHandling: false }
    );
    expect(mocks.anthropicCreate).not.toHaveBeenCalled();
  });

  it("treats a canceled subscription as a known no-send decision", async () => {
    mocks.canUseFeature.mockReturnValue(false);

    await expect(
      sendMissedCallSMS(CALLER, BUSINESS_ID)
    ).resolves.toBeUndefined();

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rethrows indeterminate entitlement failures for the voice webhook retry path", async () => {
    mocks.resolveBusinessEntitlements.mockRejectedValue(
      new Error("subscription lookup failed")
    );

    await expect(sendMissedCallSMS(CALLER, BUSINESS_ID)).rejects.toThrow(
      "subscription lookup failed"
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rethrows a transient language-setting read error instead of silently defaulting", async () => {
    setRows("en");
    tableResults.set("ai_settings", {
      data: null,
      error: { message: "connection reset" },
    });

    await expect(sendMissedCallSMS(CALLER, BUSINESS_ID)).rejects.toThrow(
      "AI language setting read failed"
    );
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
