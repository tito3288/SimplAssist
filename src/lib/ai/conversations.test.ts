import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  addMessage,
  addInboundMessageOnce,
  addWebChatInboundMessageOnce,
  getConversationHistory,
  getOrCreateConversation,
  WebChatMessageIdempotencyConflictError,
} from "./conversations";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const CONTACT_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";

const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
      "select",
      "eq",
      "neq",
      "or",
      "order",
      "limit",
      "maybeSingle",
      "single",
      "insert",
      "update",
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queueResults();
});

describe("getOrCreateConversation", () => {
  it("reuses the latest handed-off conversation instead of creating a new AI thread", async () => {
    const handedOff = {
      id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      contact_id: CONTACT_ID,
      channel: "sms",
      status: "handed_off",
      is_ai_handling: false,
    };
    queueResults({ data: handedOff, error: null });

    await expect(
      getOrCreateConversation(BUSINESS_ID, CONTACT_ID, "sms")
    ).resolves.toEqual(handedOff);

    expect(chains[0].neq).toHaveBeenCalledWith("status", "closed");
    expect(chains[0].order.mock.calls).toEqual([
      ["is_ai_handling", { ascending: true }],
      ["status", { ascending: false }],
      ["last_message_at", { ascending: false }],
      ["started_at", { ascending: false }],
    ]);
    expect(chains[0].insert).not.toHaveBeenCalled();
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("creates new Starter conversations directly in manual mode", async () => {
    const created = {
      id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      contact_id: CONTACT_ID,
      channel: "sms",
      status: "handed_off",
      is_ai_handling: false,
    };
    queueResults(
      { data: null, error: null },
      { data: created, error: null }
    );

    await expect(
      getOrCreateConversation(BUSINESS_ID, CONTACT_ID, "sms", {
        defaultAiHandling: false,
      })
    ).resolves.toEqual(created);

    expect(chains[1].insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "handed_off",
        is_ai_handling: false,
      })
    );
  });

  it("recovers a unique-insert race by returning the canonical manual conversation", async () => {
    const handedOff = {
      id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      contact_id: CONTACT_ID,
      channel: "sms",
      status: "handed_off",
      is_ai_handling: false,
    };
    queueResults(
      { data: null, error: null },
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: handedOff, error: null }
    );

    await expect(
      getOrCreateConversation(BUSINESS_ID, CONTACT_ID, "sms")
    ).resolves.toEqual(handedOff);

    expect(chains[2].order).toHaveBeenCalledWith("is_ai_handling", {
      ascending: true,
    });
    expect(mocks.from).toHaveBeenCalledTimes(3);
  });

  it("converges parallel callers on the same open manual conversation", async () => {
    const handedOff = {
      id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      contact_id: CONTACT_ID,
      channel: "sms",
      status: "handed_off",
      is_ai_handling: false,
    };
    queueResults(
      { data: null, error: null },
      { data: null, error: null },
      { data: handedOff, error: null },
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: handedOff, error: null }
    );

    const [first, second] = await Promise.all([
      getOrCreateConversation(BUSINESS_ID, CONTACT_ID, "sms", {
        defaultAiHandling: false,
      }),
      getOrCreateConversation(BUSINESS_ID, CONTACT_ID, "sms", {
        defaultAiHandling: false,
      }),
    ]);

    expect(first.id).toBe(CONVERSATION_ID);
    expect(second.id).toBe(CONVERSATION_ID);
    expect(first.is_ai_handling).toBe(false);
    expect(second.is_ai_handling).toBe(false);
    expect(mocks.from).toHaveBeenCalledTimes(5);
  });
});

describe("addInboundMessageOnce", () => {
  it("returns the previously persisted message when Telnyx retries the same event", async () => {
    const existing = {
      id: "message_1",
      conversation_id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      role: "customer",
      content: "Hello",
      channel: "sms",
      provider_event_id: "telnyx:message.received:evt_1",
      created_at: "2026-07-18T12:00:00.000Z",
    };
    queueResults(
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: existing, error: null },
      { data: null, error: null }
    );

    await expect(
      addInboundMessageOnce(
        CONVERSATION_ID,
        BUSINESS_ID,
        "Hello",
        "sms",
        "telnyx:message.received:evt_1"
      )
    ).resolves.toEqual(existing);

    expect(chains[1].eq).toHaveBeenCalledWith(
      "provider_event_id",
      "telnyx:message.received:evt_1"
    );
    expect(mocks.from).toHaveBeenCalledTimes(3);
    expect(chains[2].eq).toHaveBeenCalledWith("business_id", BUSINESS_ID);
    expect(chains[2].or).toHaveBeenCalledWith(
      "last_message_at.is.null,last_message_at.lt.2026-07-18T12:00:00.000Z"
    );
  });
});

describe("metered web-chat message persistence", () => {
  it("persists assistant reservation proof only when explicitly supplied", async () => {
    const assistant = {
      id: "00000000-0000-4000-8000-000000000010",
      conversation_id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      role: "assistant",
      content: "Hello!",
      channel: "web_chat",
      created_at: "2026-08-18T12:00:00.000Z",
    };
    queueResults(
      { data: assistant, error: null },
      { data: null, error: null },
    );

    await addMessage(
      CONVERSATION_ID,
      BUSINESS_ID,
      "assistant",
      "Hello!",
      "web_chat",
      {
        aiReplyReservationId: "00000000-0000-4000-8000-000000000011",
        aiReplyReservationAttemptToken:
          "00000000-0000-4000-8000-000000000012",
      },
    );

    expect(chains[0].insert).toHaveBeenCalledWith({
      conversation_id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      role: "assistant",
      content: "Hello!",
      channel: "web_chat",
      ai_reply_reservation_id: "00000000-0000-4000-8000-000000000011",
      ai_reply_reservation_attempt_token:
        "00000000-0000-4000-8000-000000000012",
    });
  });

  it("uses a content-free stable provider key and returns an exact retry", async () => {
    const existing = {
      id: "00000000-0000-4000-8000-000000000013",
      conversation_id: CONVERSATION_ID,
      business_id: BUSINESS_ID,
      role: "customer",
      content: "Can I book?",
      channel: "web_chat",
      provider_event_id: "widget:opaque",
      created_at: "2026-08-18T12:00:00.000Z",
    };
    queueResults(
      { data: null, error: { code: "23505", message: "duplicate" } },
      { data: existing, error: null },
      { data: null, error: null },
    );

    await expect(
      addWebChatInboundMessageOnce(
        "00000000-0000-4000-8000-000000000099",
        BUSINESS_ID,
        "Can I book?",
        "00000000-0000-4000-8000-000000000014",
      ),
    ).resolves.toEqual(existing);

    const inserted = chains[0].insert.mock.calls[0]?.[0] as {
      provider_event_id: string;
    };
    expect(inserted.provider_event_id).toMatch(/^widget:[0-9a-f]{64}$/);
    expect(inserted.provider_event_id).not.toContain("Can I book?");
    expect(inserted.provider_event_id).not.toContain(BUSINESS_ID);
    expect(chains[2].eq).toHaveBeenCalledWith("id", CONVERSATION_ID);
    expect(chains[2].eq).toHaveBeenCalledWith("business_id", BUSINESS_ID);
  });

  it("fails closed when a client message id is reused with other content", async () => {
    queueResults(
      { data: null, error: { code: "23505", message: "duplicate" } },
      {
        data: {
          id: "00000000-0000-4000-8000-000000000013",
          conversation_id: CONVERSATION_ID,
          business_id: BUSINESS_ID,
          role: "customer",
          content: "Original content",
          channel: "web_chat",
        },
        error: null,
      },
    );

    await expect(
      addWebChatInboundMessageOnce(
        CONVERSATION_ID,
        BUSINESS_ID,
        "Changed content",
        "00000000-0000-4000-8000-000000000014",
      ),
    ).rejects.toBeInstanceOf(WebChatMessageIdempotencyConflictError);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });
});

describe("getConversationHistory", () => {
  it("returns the newest limited window in chronological order", async () => {
    const newestFirst = [
      {
        id: "message_23",
        conversation_id: CONVERSATION_ID,
        created_at: "2026-07-18T12:00:03.000Z",
        role: "customer",
        content: "new inbound",
        channel: "sms",
      },
      {
        id: "message_22",
        conversation_id: CONVERSATION_ID,
        created_at: "2026-07-18T12:00:02.000Z",
        role: "assistant",
        content: "recent reply",
        channel: "sms",
      },
      {
        id: "message_21",
        conversation_id: CONVERSATION_ID,
        created_at: "2026-07-18T12:00:01.000Z",
        role: "customer",
        content: "recent question",
        channel: "sms",
      },
    ];
    queueResults({ data: newestFirst, error: null });

    const history = await getConversationHistory(CONVERSATION_ID, 20);

    expect(chains[0].order.mock.calls).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(chains[0].limit).toHaveBeenCalledWith(20);
    expect(history.map((message) => message.id)).toEqual([
      "message_21",
      "message_22",
      "message_23",
    ]);
    expect(history.at(-1)?.content).toBe("new inbound");
  });
});
