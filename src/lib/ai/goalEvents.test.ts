import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  GoalEventInvariantCollisionError,
  finalizeGoalLinkEvent,
} from "./goalEvents";
import type { GoalLinkOfferedAction } from "./engine";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "00000000-0000-4000-8000-000000000002";
const CONTACT_ID = "00000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const SOURCE_MESSAGE_ID = "00000000-0000-4000-8000-000000000005";
const ASSISTANT_MESSAGE_ID = "00000000-0000-4000-8000-000000000006";
const OTHER_CONTACT_ID = "00000000-0000-4000-8000-000000000007";
const OTHER_CONVERSATION_ID = "00000000-0000-4000-8000-000000000008";
const OTHER_SOURCE_MESSAGE_ID = "00000000-0000-4000-8000-000000000009";
const OTHER_ASSISTANT_MESSAGE_ID = "00000000-0000-4000-8000-000000000010";
const IDEMPOTENCY_KEY = "opaque-goal-event-key";
const OCCURRED_AT = new Date("2026-08-10T12:30:45.123Z");

const action: GoalLinkOfferedAction = {
  kind: "goal_link_offered",
  goalAtEvent: "signup",
  channel: "sms",
  contactId: CONTACT_ID,
  conversationId: CONVERSATION_ID,
  sourceMessageId: SOURCE_MESSAGE_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
};

const insertedRow = {
  business_id: BUSINESS_ID,
  contact_id: CONTACT_ID,
  conversation_id: CONVERSATION_ID,
  source_message_id: SOURCE_MESSAGE_ID,
  assistant_message_id: ASSISTANT_MESSAGE_ID,
  goal_at_event: "signup",
  event_type: "link_sent",
  channel: "sms",
  occurred_at: OCCURRED_AT.toISOString(),
  idempotency_key: IDEMPOTENCY_KEY,
};

const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected goal event query" },
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["insert", "select", "eq", "maybeSingle"]) {
      chain[method] = vi.fn(() => chain);
    }
    const promise = Promise.resolve(result);
    (chain as Record<string, unknown>).then = promise.then.bind(promise);
    (chain as Record<string, unknown>).catch = promise.catch.bind(promise);
    chains.push(chain);
    return chain;
  });
}

function input(overrides: {
  businessId?: string;
  action?: GoalLinkOfferedAction;
  assistantMessageId?: string;
  occurredAt?: Date;
} = {}) {
  return {
    businessId: overrides.businessId ?? BUSINESS_ID,
    action: overrides.action ?? action,
    assistantMessageId:
      overrides.assistantMessageId ?? ASSISTANT_MESSAGE_ID,
    occurredAt: overrides.occurredAt ?? OCCURRED_AT,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queueResults();
});

afterEach(() => {
  expect(mocks.from).not.toHaveBeenCalledWith("businesses");
  expect(
    mocks.from.mock.calls.every(([table]) => table === "goal_events")
  ).toBe(true);
});

describe("finalizeGoalLinkEvent", () => {
  it.each(["sms", "web_chat"] as const)(
    "plain-inserts the explicit fully linked %s event after delivery proof",
    async (channel) => {
      queueResults({ data: null, error: null });
      const channelAction = { ...action, channel };

      await expect(
        finalizeGoalLinkEvent(input({ action: channelAction }))
      ).resolves.toBe("inserted");

      expect(mocks.from).toHaveBeenCalledOnce();
      expect(mocks.from).toHaveBeenCalledWith("goal_events");
      expect(chains[0].insert).toHaveBeenCalledWith({
        ...insertedRow,
        channel,
      });
      expect(chains[0].select).not.toHaveBeenCalled();
    }
  );

  it("inserts once and returns duplicate when the same immutable payload is finalized again", async () => {
    const insertError = { code: "23505", message: "unique violation" };
    queueResults(
      { data: null, error: null },
      { data: null, error: insertError },
      {
        data: {
          ...insertedRow,
          occurred_at: "2026-08-10T08:30:45.123-04:00",
        },
        error: null,
      }
    );

    await expect(finalizeGoalLinkEvent(input())).resolves.toBe("inserted");
    await expect(finalizeGoalLinkEvent(input())).resolves.toBe("duplicate");

    expect(chains[0].insert).toHaveBeenCalledWith(insertedRow);
    expect(chains[1].insert).toHaveBeenCalledWith(insertedRow);
    expect(chains[2].select).toHaveBeenCalledWith(
      "business_id, contact_id, conversation_id, source_message_id, assistant_message_id, goal_at_event, event_type, channel, occurred_at, idempotency_key"
    );
    expect(chains[2].eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
      ["idempotency_key", IDEMPOTENCY_KEY],
    ]);
    expect(chains[2].maybeSingle).toHaveBeenCalledOnce();
  });

  it("uses the pre-await delivery-time snapshot if the caller mutates its Date", async () => {
    const mutableOccurredAt = new Date(OCCURRED_AT);
    const insertResult = deferred<{
      data: null;
      error: { code: string; message: string };
    }>();
    queueResults(
      insertResult.promise,
      {
        data: {
          ...insertedRow,
          occurred_at: "2026-08-10T08:30:45.123-04:00",
        },
        error: null,
      }
    );

    const finalization = finalizeGoalLinkEvent(
      input({ occurredAt: mutableOccurredAt })
    );
    await vi.waitFor(() => expect(chains[0].insert).toHaveBeenCalledOnce());
    mutableOccurredAt.setUTCFullYear(2035);
    insertResult.resolve({
      data: null,
      error: { code: "23505", message: "unique violation" },
    });

    await expect(finalization).resolves.toBe("duplicate");
    expect(chains[0].insert).toHaveBeenCalledWith(insertedRow);
  });

  it("surfaces a same-assistant/new-key unique collision instead of calling it a duplicate", async () => {
    const insertError = {
      code: "23505",
      message: "assistant/type unique violation",
    };
    const newKeyAction = { ...action, idempotencyKey: "another-opaque-key" };
    queueResults(
      { data: null, error: insertError },
      { data: null, error: null }
    );

    const promise = finalizeGoalLinkEvent(input({ action: newKeyAction }));

    await expect(promise).rejects.toBeInstanceOf(
      GoalEventInvariantCollisionError
    );
    await expect(promise).rejects.toMatchObject({
      businessId: BUSINESS_ID,
      idempotencyKey: newKeyAction.idempotencyKey,
      cause: insertError,
    });
  });

  it.each([
    ["contact linkage", { contact_id: "different-contact" }],
    ["conversation linkage", { conversation_id: "different-conversation" }],
    ["source linkage", { source_message_id: "different-source" }],
    ["assistant linkage", { assistant_message_id: "different-assistant" }],
    ["captured goal", { goal_at_event: "quote" }],
    ["channel", { channel: "web_chat" }],
    ["delivery time", { occurred_at: "2026-08-10T12:30:45.124Z" }],
    [
      "sub-millisecond delivery time",
      { occurred_at: "2026-08-10T12:30:45.123999Z" },
    ],
    ["invalid delivery time", { occurred_at: "not-a-timestamp" }],
  ])("rejects a same-key duplicate with changed %s", async (_label, change) => {
    const insertError = { code: "23505", message: "unique violation" };
    queueResults(
      { data: null, error: insertError },
      { data: { ...insertedRow, ...change }, error: null }
    );

    await expect(finalizeGoalLinkEvent(input())).rejects.toMatchObject({
      name: "GoalEventInvariantCollisionError",
      businessId: BUSINESS_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      cause: insertError,
    });
  });

  it("allows the same opaque key to be inserted for different businesses", async () => {
    queueResults(
      { data: null, error: null },
      { data: null, error: null }
    );

    await expect(finalizeGoalLinkEvent(input())).resolves.toBe("inserted");
    const otherBusinessAction = {
      ...action,
      contactId: OTHER_CONTACT_ID,
      conversationId: OTHER_CONVERSATION_ID,
      sourceMessageId: OTHER_SOURCE_MESSAGE_ID,
    };
    await expect(
      finalizeGoalLinkEvent(
        input({
          businessId: OTHER_BUSINESS_ID,
          action: otherBusinessAction,
          assistantMessageId: OTHER_ASSISTANT_MESSAGE_ID,
        })
      )
    ).resolves.toBe("inserted");

    expect(chains[0].insert).toHaveBeenCalledWith(insertedRow);
    expect(chains[1].insert).toHaveBeenCalledWith({
      ...insertedRow,
      business_id: OTHER_BUSINESS_ID,
      contact_id: OTHER_CONTACT_ID,
      conversation_id: OTHER_CONVERSATION_ID,
      source_message_id: OTHER_SOURCE_MESSAGE_ID,
      assistant_message_id: OTHER_ASSISTANT_MESSAGE_ID,
    });
  });

  it("propagates non-unique insert failures", async () => {
    const insertError = { code: "23514", message: "validator rejected row" };
    queueResults({ data: null, error: insertError });

    await expect(finalizeGoalLinkEvent(input())).rejects.toBe(insertError);
    expect(mocks.from).toHaveBeenCalledOnce();
  });

  it("propagates a rejected insert request", async () => {
    const networkError = new Error("goal event insert network failure");
    queueResults(Promise.reject(networkError));

    await expect(finalizeGoalLinkEvent(input())).rejects.toBe(networkError);
    expect(mocks.from).toHaveBeenCalledOnce();
  });

  it("propagates duplicate lookup failures", async () => {
    const lookupError = { code: "08006", message: "connection failed" };
    queueResults(
      { data: null, error: { code: "23505", message: "unique violation" } },
      { data: null, error: lookupError }
    );

    await expect(finalizeGoalLinkEvent(input())).rejects.toBe(lookupError);
  });
});
