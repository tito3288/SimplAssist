import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  BookingRequestInvariantCollisionError,
  buildBookingRequestIdempotencyKey,
  recordBookingRequest,
  type RecordBookingRequestInput,
} from "./bookingRequests";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_BUSINESS_ID = "00000000-0000-4000-8000-000000000002";
const CONTACT_ID = "00000000-0000-4000-8000-000000000003";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const SOURCE_MESSAGE_A = "00000000-0000-4000-8000-000000000005";
const SOURCE_MESSAGE_B = "00000000-0000-4000-8000-000000000006";

const baseInput: RecordBookingRequestInput = {
  businessId: BUSINESS_ID,
  contactId: CONTACT_ID,
  conversationId: CONVERSATION_ID,
  sourceMessageId: SOURCE_MESSAGE_A,
  requestedService: "Haircut",
  requestedTimeText: "next Tuesday after lunch",
  customerName: "Avery Customer",
  customerPhone: "+13175550100",
  customerEmail: "avery@example.com",
};

const immutableRow = {
  business_id: BUSINESS_ID,
  contact_id: CONTACT_ID,
  conversation_id: CONVERSATION_ID,
  source_message_id: SOURCE_MESSAGE_A,
  requested_service: "Haircut",
  requested_time_text: "next Tuesday after lunch",
  customer_name: "Avery Customer",
  customer_phone: "+13175550100",
  customer_email: "avery@example.com",
  idempotency_key:
    "Cg5yxEA-e8AhhWlcCo24d3V0GRxN_YS2s0zXTw1WiCA",
};

const chains: Array<Record<string, ReturnType<typeof vi.fn>>> = [];

function queueResults(...results: unknown[]) {
  const queue = [...results];
  chains.length = 0;
  mocks.from.mockImplementation(() => {
    const result = queue.shift() ?? {
      data: null,
      error: { message: "Unexpected booking request query" },
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

beforeEach(() => {
  vi.clearAllMocks();
  queueResults();
});

afterEach(() => {
  expect(
    mocks.from.mock.calls.every(([table]) => table === "booking_requests")
  ).toBe(true);
});

describe("buildBookingRequestIdempotencyKey", () => {
  it("builds a stable opaque SHA-256 base64url key from the v1 namespace, business, and source message", () => {
    const key = buildBookingRequestIdempotencyKey(
      BUSINESS_ID,
      SOURCE_MESSAGE_A
    );

    expect(key).toBe("Cg5yxEA-e8AhhWlcCo24d3V0GRxN_YS2s0zXTw1WiCA");
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain(BUSINESS_ID);
    expect(key).not.toContain(SOURCE_MESSAGE_A);
    expect(
      buildBookingRequestIdempotencyKey(BUSINESS_ID, SOURCE_MESSAGE_A)
    ).toBe(key);
    expect(
      buildBookingRequestIdempotencyKey(BUSINESS_ID, SOURCE_MESSAGE_B)
    ).not.toBe(key);
    expect(
      buildBookingRequestIdempotencyKey(OTHER_BUSINESS_ID, SOURCE_MESSAGE_A)
    ).not.toBe(key);
  });
});

describe("recordBookingRequest", () => {
  it("plain-inserts linked request text and customer snapshots byte-for-byte", async () => {
    queueResults({ data: null, error: null });
    const rawInput: RecordBookingRequestInput = {
      ...baseInput,
      requestedService: "  Sports massage — lower back  ",
      requestedTimeText: "next Tue after 3-ish, if that works",
      customerName: "  Avery C.  ",
      customerPhone: "(317) 555-0100 ext. 4",
      customerEmail: " Avery+appointments@Example.COM ",
    };

    await expect(recordBookingRequest(rawInput)).resolves.toBe("inserted");

    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("booking_requests");
    expect(chains[0].insert).toHaveBeenCalledWith({
      business_id: BUSINESS_ID,
      contact_id: CONTACT_ID,
      conversation_id: CONVERSATION_ID,
      source_message_id: SOURCE_MESSAGE_A,
      requested_service: "  Sports massage — lower back  ",
      requested_time_text: "next Tue after 3-ish, if that works",
      customer_name: "  Avery C.  ",
      customer_phone: "(317) 555-0100 ext. 4",
      customer_email: " Avery+appointments@Example.COM ",
      idempotency_key:
        "Cg5yxEA-e8AhhWlcCo24d3V0GRxN_YS2s0zXTw1WiCA",
      status: "new",
    });
    expect(chains[0].select).not.toHaveBeenCalled();
  });

  it("persists not specified as ordinary request text and maps omitted snapshots to null", async () => {
    queueResults({ data: null, error: null });

    await expect(
      recordBookingRequest({
        businessId: BUSINESS_ID,
        contactId: CONTACT_ID,
        conversationId: CONVERSATION_ID,
        sourceMessageId: SOURCE_MESSAGE_A,
        requestedService: "not specified",
        requestedTimeText: "not specified",
      })
    ).resolves.toBe("inserted");

    expect(chains[0].insert).toHaveBeenCalledWith({
      ...immutableRow,
      requested_service: "not specified",
      requested_time_text: "not specified",
      customer_name: null,
      customer_phone: null,
      customer_email: null,
      status: "new",
    });
  });

  it("turns blank optional snapshots into null without trimming nonblank values", async () => {
    queueResults({ data: null, error: null });

    await expect(
      recordBookingRequest({
        ...baseInput,
        customerName: " \t\n",
        customerPhone: "  +1 raw phone  ",
        customerEmail: "\r\n",
      })
    ).resolves.toBe("inserted");

    expect(chains[0].insert).toHaveBeenCalledWith({
      ...immutableRow,
      customer_name: null,
      customer_phone: "  +1 raw phone  ",
      customer_email: null,
      status: "new",
    });
  });

  it("accepts an exact retry as duplicate even after the request is handled", async () => {
    const insertError = { code: "23505", message: "unique violation" };
    queueResults(
      { data: null, error: insertError },
      {
        data: {
          ...immutableRow,
          status: "handled",
          handled_at: "2026-08-11T18:00:00.000Z",
        },
        error: null,
      }
    );

    await expect(recordBookingRequest(baseInput)).resolves.toBe("duplicate");

    expect(chains[1].select).toHaveBeenCalledWith(
      "business_id, contact_id, conversation_id, source_message_id, requested_service, requested_time_text, customer_name, customer_phone, customer_email, idempotency_key"
    );
    expect(chains[1].eq.mock.calls).toEqual([
      ["business_id", BUSINESS_ID],
      [
        "idempotency_key",
        "Cg5yxEA-e8AhhWlcCo24d3V0GRxN_YS2s0zXTw1WiCA",
      ],
    ]);
    expect(chains[1].maybeSingle).toHaveBeenCalledOnce();
  });

  it.each([
    ["business linkage", { business_id: OTHER_BUSINESS_ID }],
    ["contact linkage", { contact_id: "different-contact" }],
    ["conversation linkage", { conversation_id: "different-conversation" }],
    ["source linkage", { source_message_id: "different-source" }],
    ["requested service", { requested_service: "Color service" }],
    ["requested time", { requested_time_text: "Friday morning" }],
    ["customer name", { customer_name: "Different Customer" }],
    ["customer phone", { customer_phone: "+13175550199" }],
    ["customer email", { customer_email: "different@example.com" }],
    ["idempotency key", { idempotency_key: "different-key" }],
  ])("rejects a same-key collision with changed %s", async (_label, change) => {
    const insertError = { code: "23505", message: "unique violation" };
    queueResults(
      { data: null, error: insertError },
      { data: { ...immutableRow, ...change }, error: null }
    );

    await expect(recordBookingRequest(baseInput)).rejects.toMatchObject({
      name: "BookingRequestInvariantCollisionError",
      businessId: BUSINESS_ID,
      idempotencyKey:
        "Cg5yxEA-e8AhhWlcCo24d3V0GRxN_YS2s0zXTw1WiCA",
      cause: insertError,
    });
  });

  it("rejects a unique collision when the immutable row cannot be found", async () => {
    const insertError = { code: "23505", message: "unique violation" };
    queueResults(
      { data: null, error: insertError },
      { data: null, error: null }
    );

    await expect(recordBookingRequest(baseInput)).rejects.toBeInstanceOf(
      BookingRequestInvariantCollisionError
    );
  });

  it("propagates non-unique insert failures", async () => {
    const insertError = { code: "23514", message: "validator rejected row" };
    queueResults({ data: null, error: insertError });

    await expect(recordBookingRequest(baseInput)).rejects.toBe(insertError);
    expect(mocks.from).toHaveBeenCalledOnce();
  });

  it("propagates rejected inserts and duplicate lookup failures", async () => {
    const networkError = new Error("booking request insert network failure");
    queueResults(Promise.reject(networkError));
    await expect(recordBookingRequest(baseInput)).rejects.toBe(networkError);

    vi.clearAllMocks();
    const lookupError = { code: "08006", message: "connection failed" };
    queueResults(
      { data: null, error: { code: "23505", message: "unique violation" } },
      { data: null, error: lookupError }
    );
    await expect(recordBookingRequest(baseInput)).rejects.toBe(lookupError);
  });

  it("treats one source message as one request while a later message in the same conversation creates another", async () => {
    const rows: Array<Record<string, unknown>> = [];
    mocks.from.mockImplementation(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        const duplicate = rows.some(
          (existing) =>
            existing.business_id === row.business_id &&
            existing.idempotency_key === row.idempotency_key
        );
        if (duplicate) {
          return {
            data: null,
            error: { code: "23505", message: "unique violation" },
          };
        }
        rows.push({
          ...row,
          id: `request-${rows.length + 1}`,
          status: "new",
          handled_at: null,
        });
        return { data: null, error: null };
      }),
      select: vi.fn(() => {
        const filters: Record<string, unknown> = {};
        const lookup = {
          eq: vi.fn((column: string, value: unknown) => {
            filters[column] = value;
            return lookup;
          }),
          maybeSingle: vi.fn(async () => ({
            data:
              rows.find((row) =>
                Object.entries(filters).every(
                  ([column, value]) => row[column] === value
                )
              ) ?? null,
            error: null,
          })),
        };
        return lookup;
      }),
    }));

    await expect(recordBookingRequest(baseInput)).resolves.toBe("inserted");
    expect(rows).toHaveLength(1);

    rows[0].status = "handled";
    rows[0].handled_at = "2026-08-11T18:00:00.000Z";

    await expect(recordBookingRequest(baseInput)).resolves.toBe("duplicate");
    expect(rows).toHaveLength(1);

    await expect(
      recordBookingRequest({
        ...baseInput,
        sourceMessageId: SOURCE_MESSAGE_B,
      })
    ).resolves.toBe("inserted");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.source_message_id)).toEqual([
      SOURCE_MESSAGE_A,
      SOURCE_MESSAGE_B,
    ]);
    expect(rows[0].status).toBe("handled");
    expect(rows[1].status).toBe("new");
    expect(rows[0].idempotency_key).not.toBe(rows[1].idempotency_key);
  });
});
