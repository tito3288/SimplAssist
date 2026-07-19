import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  addInboundMessageOnce,
  getConversationHistory,
  getOrCreateConversation,
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
