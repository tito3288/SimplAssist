import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPhoneNumbers: vi.fn(),
  createNumberOrder: vi.fn(),
  updatePhoneNumber: vi.fn(),
  updatePhoneMessaging: vi.fn(),
  from: vi.fn(),
  beginProviderCreateIntent: vi.fn(),
  resolveProviderCreateIntent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/messaging/client", () => ({
  telnyx: {
    phoneNumbers: {
      list: mocks.listPhoneNumbers,
      update: mocks.updatePhoneNumber,
      messaging: { update: mocks.updatePhoneMessaging },
    },
    numberOrders: { create: mocks.createNumberOrder },
    availablePhoneNumbers: { list: vi.fn() },
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));
vi.mock("@/lib/messaging/registration/providerCreateIntent", () => ({
  beginProviderCreateIntent: mocks.beginProviderCreateIntent,
  resolveProviderCreateIntent: mocks.resolveProviderCreateIntent,
}));

import {
  attachOwnedNumberToCustomerProfile,
  findOwnedNumberId,
  normalizeTelnyxPhoneNumberResourceId,
  purchaseNumber,
  PurchasedNumberResolutionError,
} from "./numbers";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000381";
const PHONE_NUMBER = "+15745550381";
// Deliberately exceeds Number.MAX_SAFE_INTEGER. Telnyx resource IDs must stay
// strings through lookup, persistence, and provider updates.
const PHONE_NUMBER_RESOURCE_ID = "3026446889630303742";
const NUMBER_ORDER_ID = "a0000000-0000-4000-8000-000000000381";
const NUMBER_ORDER_PHONE_NUMBER_ID = "b0000000-0000-4000-8000-000000000381";
const PROFILE_ID = "20000000-0000-4000-8000-000000000381";
const VOICE_ID = "12345678901";

type PhoneNumberListItem = {
  id?: string;
  phone_number?: string;
  customer_reference?: string | null;
  record_type?: string;
};

function phoneNumberList(
  items: PhoneNumberListItem[],
  options: {
    throwAfter?: number;
    error?: Error;
    onExhausted?: () => void;
  } = {}
) {
  return {
    data: items,
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < items.length; index += 1) {
        yield items[index];
        if (options.throwAfter === index + 1) {
          throw options.error ?? new Error("later Telnyx page failed");
        }
      }
      options.onExhausted?.();
    },
  };
}

function setBusiness(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "single"]) {
    chain[method] = vi.fn(() => chain);
  }
  chain.single.mockResolvedValue({
    data: {
      telnyx_messaging_profile_id: PROFILE_ID,
      telnyx_voice_application_id: VOICE_ID,
      ...overrides,
    },
    error: null,
  });
  mocks.from.mockReturnValue(chain);
  return chain;
}

function setOwnedNumberList(
  id: string = PHONE_NUMBER_RESOURCE_ID,
  phoneNumber: string = PHONE_NUMBER
) {
  mocks.listPhoneNumbers.mockResolvedValue(
    phoneNumberList([ownedNumber({ id, phone_number: phoneNumber })])
  );
}

function ownedNumber(
  overrides: PhoneNumberListItem = {}
): PhoneNumberListItem {
  return {
    id: PHONE_NUMBER_RESOURCE_ID,
    phone_number: PHONE_NUMBER,
    customer_reference: BUSINESS_ID,
    record_type: "phone_number",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setBusiness();
  mocks.listPhoneNumbers.mockResolvedValue(phoneNumberList([]));
  mocks.createNumberOrder.mockResolvedValue({
    data: {
      id: NUMBER_ORDER_ID,
      status: "success",
      phone_numbers: [
        {
          id: NUMBER_ORDER_PHONE_NUMBER_ID,
          phone_number: PHONE_NUMBER,
          record_type: "number_order_phone_number",
        },
      ],
    },
  });
  mocks.updatePhoneNumber.mockResolvedValue(undefined);
  mocks.updatePhoneMessaging.mockResolvedValue(undefined);
  mocks.beginProviderCreateIntent.mockResolvedValue(
    "c0000000-0000-4000-8000-000000000381"
  );
  mocks.resolveProviderCreateIntent.mockResolvedValue(undefined);
});

describe("managed phone-number resource IDs", () => {
  it("normalizes a decimal string without numeric coercion", () => {
    expect(
      normalizeTelnyxPhoneNumberResourceId(
        `  ${PHONE_NUMBER_RESOURCE_ID}  `,
        "from test"
      )
    ).toBe(PHONE_NUMBER_RESOURCE_ID);
    expect(BigInt(PHONE_NUMBER_RESOURCE_ID)).toBeGreaterThan(
      BigInt(Number.MAX_SAFE_INTEGER)
    );
  });

  it.each([
    NUMBER_ORDER_PHONE_NUMBER_ID,
    "legacy-non-uuid",
    "123-not-decimal",
    "",
    3026446889630303742,
    null,
  ])("rejects a non-decimal managed resource id (%s)", (value) => {
    expect(() =>
      normalizeTelnyxPhoneNumberResourceId(value, "from test")
    ).toThrow("Invalid Telnyx phone number resource id");
  });
});

describe("owned-number lookup", () => {
  it("exhausts the provider iterator before returning the one exact business-scoped match", async () => {
    const onExhausted = vi.fn();
    mocks.listPhoneNumbers.mockResolvedValue(
      phoneNumberList(
        [
          ownedNumber({
            id: "3026446889630303999",
            phone_number: "+15745550999",
          }),
          ownedNumber({
            id: `  ${PHONE_NUMBER_RESOURCE_ID}  `,
            phone_number: PHONE_NUMBER,
          }),
          ownedNumber({
            id: "3026446889630303888",
            phone_number: "+15745550888",
          }),
        ],
        { onExhausted }
      )
    );

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).resolves.toBe(
      PHONE_NUMBER_RESOURCE_ID
    );

    expect(onExhausted).toHaveBeenCalledOnce();
    expect(mocks.listPhoneNumbers).toHaveBeenCalledWith({
      filter: {
        phone_number: "15745550381",
        customer_reference: BUSINESS_ID,
      },
    });
  });

  it("returns null only after a complete list has no exact E.164 match", async () => {
    const onExhausted = vi.fn();
    mocks.listPhoneNumbers.mockResolvedValue(
      phoneNumberList(
        [ownedNumber({ phone_number: "+15745550999" })],
        { onExhausted }
      )
    );

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).resolves.toBeNull();
    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it("ignores exact E.164 candidates whose response reference or resource type does not match", async () => {
    const onExhausted = vi.fn();
    mocks.listPhoneNumbers.mockResolvedValue(
      phoneNumberList(
        [
          ownedNumber({ customer_reference: "other-business" }),
          ownedNumber({ record_type: "number_order_phone_number" }),
        ],
        { onExhausted }
      )
    );

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).resolves.toBeNull();
    expect(onExhausted).toHaveBeenCalledOnce();
  });

  it("fails closed when a later result makes the exact match ambiguous", async () => {
    mocks.listPhoneNumbers.mockResolvedValue(
      phoneNumberList([
        ownedNumber(),
        ownedNumber({ id: "3026446889630303999" }),
      ])
    );

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "found 2 exact matches"
    );
  });

  it("fails closed when the exact match has a malformed managed resource id", async () => {
    setOwnedNumberList(NUMBER_ORDER_PHONE_NUMBER_ID);

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "Invalid Telnyx phone number resource id"
    );
  });

  it("fails closed when listing errors before returning results", async () => {
    mocks.listPhoneNumbers.mockRejectedValue(new Error("Telnyx list unavailable"));

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "Telnyx list unavailable"
    );
  });

  it("never returns a candidate from a partial iterator that later errors", async () => {
    mocks.listPhoneNumbers.mockResolvedValue(
      phoneNumberList(
        [ownedNumber()],
        { throwAfter: 1, error: new Error("next page failed") }
      )
    );

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "next page failed"
    );
  });
});

describe("number purchase ID provenance", () => {
  it("places one scoped order, then returns only the exhausted owned-list ID as the managed resource ID", async () => {
    setOwnedNumberList();

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).resolves.toEqual({
      phoneNumber: PHONE_NUMBER,
      phoneNumberId: PHONE_NUMBER_RESOURCE_ID,
      numberOrderId: NUMBER_ORDER_ID,
      numberOrderPhoneNumberId: NUMBER_ORDER_PHONE_NUMBER_ID,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "success",
    });

    expect(mocks.createNumberOrder).toHaveBeenCalledWith(
      {
        phone_numbers: [{ phone_number: PHONE_NUMBER }],
        connection_id: VOICE_ID,
        messaging_profile_id: PROFILE_ID,
        customer_reference: BUSINESS_ID,
      },
      { maxRetries: 0 }
    );
    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      spec: {
        eventType: "phone_number_order_create_intent",
        resourceType: "phone_number",
      },
      rawPayload: { phoneNumber: PHONE_NUMBER },
    });
    expect(
      mocks.beginProviderCreateIntent.mock.invocationCallOrder[0]
    ).toBeLessThan(mocks.createNumberOrder.mock.invocationCallOrder[0]);
    expect(mocks.listPhoneNumbers).toHaveBeenCalledWith({
      filter: {
        phone_number: "15745550381",
        customer_reference: BUSINESS_ID,
      },
    });
    expect(mocks.createNumberOrder.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listPhoneNumbers.mock.invocationCallOrder[0]
    );
  });

  it("does not require order UUIDs when the complete owned list resolves the managed resource", async () => {
    mocks.createNumberOrder.mockResolvedValue({
      data: {
        status: "pending",
        phone_numbers: [{ phone_number: PHONE_NUMBER }],
      },
    });
    setOwnedNumberList();

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).resolves.toEqual({
      phoneNumber: PHONE_NUMBER,
      phoneNumberId: PHONE_NUMBER_RESOURCE_ID,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "pending",
    });
  });

  it("treats malformed order UUIDs as absent provenance, never as managed IDs", async () => {
    mocks.createNumberOrder.mockResolvedValue({
      data: {
        id: "not-an-order-uuid",
        status: "success",
        phone_numbers: [
          { id: "also-not-a-uuid", phone_number: PHONE_NUMBER },
        ],
      },
    });
    setOwnedNumberList();

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).resolves.toEqual({
      phoneNumber: PHONE_NUMBER,
      phoneNumberId: PHONE_NUMBER_RESOURCE_ID,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "success",
    });
  });

  it("throws a typed post-order error with both provenance UUIDs when a complete list has zero matches", async () => {
    mocks.listPhoneNumbers.mockResolvedValue(phoneNumberList([]));

    const error = await purchaseNumber(PHONE_NUMBER, BUSINESS_ID).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(PurchasedNumberResolutionError);
    expect(error).toMatchObject({
      phoneNumber: PHONE_NUMBER,
      numberOrderId: NUMBER_ORDER_ID,
      numberOrderPhoneNumberId: NUMBER_ORDER_PHONE_NUMBER_ID,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "success",
    });
    expect((error as Error).cause).toBeInstanceOf(Error);
  });

  it("exposes absent order UUID provenance on a typed resolution failure", async () => {
    mocks.createNumberOrder.mockResolvedValue({
      data: { status: "success", phone_numbers: [] },
    });

    const error = await purchaseNumber(PHONE_NUMBER, BUSINESS_ID).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(PurchasedNumberResolutionError);
    expect(error).toMatchObject({
      phoneNumber: PHONE_NUMBER,
      numberOrderId: undefined,
      numberOrderPhoneNumberId: undefined,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "success",
    });
  });

  it.each([
    [
      "list request error",
      () => mocks.listPhoneNumbers.mockRejectedValue(new Error("list unavailable")),
    ],
    [
      "malformed managed id",
      () => setOwnedNumberList(NUMBER_ORDER_PHONE_NUMBER_ID),
    ],
    [
      "multiple exact matches",
      () =>
        mocks.listPhoneNumbers.mockResolvedValue(
          phoneNumberList([
            ownedNumber(),
            ownedNumber({ id: "3026446889630303999" }),
          ])
        ),
    ],
    [
      "partial iterator",
      () =>
        mocks.listPhoneNumbers.mockResolvedValue(
          phoneNumberList(
            [ownedNumber()],
            { throwAfter: 1 }
          )
        ),
    ],
  ])("wraps a post-order %s as purchased-but-unresolved", async (_label, setup) => {
    setup();

    const error = await purchaseNumber(PHONE_NUMBER, BUSINESS_ID).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(PurchasedNumberResolutionError);
    expect(error).toMatchObject({
      phoneNumber: PHONE_NUMBER,
      numberOrderId: NUMBER_ORDER_ID,
      numberOrderPhoneNumberId: NUMBER_ORDER_PHONE_NUMBER_ID,
      providerCreateIntentId: "c0000000-0000-4000-8000-000000000381",
      status: "success",
    });
  });

  it("does not perform ownership resolution for a provider-declared failed order", async () => {
    mocks.createNumberOrder.mockResolvedValue({
      data: { status: "failure", phone_numbers: [] },
    });

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "Telnyx number order failed"
    );
    expect(mocks.listPhoneNumbers).not.toHaveBeenCalled();
    expect(mocks.resolveProviderCreateIntent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      spec: {
        eventType: "phone_number_order_create_intent",
        resourceType: "phone_number",
      },
      intentId: "c0000000-0000-4000-8000-000000000381",
    });
  });

  it("leaves the durable intent unresolved when the paid POST outcome is ambiguous", async () => {
    mocks.createNumberOrder.mockRejectedValue(new Error("provider timeout"));

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "provider timeout"
    );

    expect(mocks.beginProviderCreateIntent).toHaveBeenCalledOnce();
    expect(mocks.resolveProviderCreateIntent).not.toHaveBeenCalled();
    expect(mocks.listPhoneNumbers).not.toHaveBeenCalled();
  });

  it("never sends a second paid POST while a prior order intent is unresolved", async () => {
    mocks.beginProviderCreateIntent.mockRejectedValue(
      new Error("unresolved provider attempt")
    );

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "unresolved provider attempt"
    );

    expect(mocks.createNumberOrder).not.toHaveBeenCalled();
    expect(mocks.listPhoneNumbers).not.toHaveBeenCalled();
    expect(mocks.resolveProviderCreateIntent).not.toHaveBeenCalled();
  });

  it("resolves only the exact intent for the proven Telnyx 422/10027 rejection", async () => {
    const definiteRejection = {
      status: 422,
      error: {
        errors: [
          {
            code: "10027",
            detail:
              "We don't recognize the number(s) ['+18886951631']. Did you first search for the number(s)?",
            source: { pointer: "/" },
          },
        ],
      },
    };
    mocks.createNumberOrder.mockRejectedValue(definiteRejection);

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toBe(
      definiteRejection
    );

    expect(mocks.resolveProviderCreateIntent).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      spec: {
        eventType: "phone_number_order_create_intent",
        resourceType: "phone_number",
      },
      intentId: "c0000000-0000-4000-8000-000000000381",
    });
  });

  it.each([
    { status: 500, error: { errors: [{ code: "10007" }] } },
    {
      status: 422,
      error: {
        errors: [
          {
            code: "different-code",
            detail: "different validation response",
            source: { pointer: "/" },
          },
        ],
      },
    },
  ])("keeps every non-allowlisted provider rejection unresolved", async (error) => {
    mocks.createNumberOrder.mockRejectedValue(error);

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toBe(error);
    expect(mocks.resolveProviderCreateIntent).not.toHaveBeenCalled();
  });

  it.each([
    ["messaging profile", { telnyx_messaging_profile_id: null }],
    ["voice application", { telnyx_voice_application_id: null }],
  ])("refuses to order without a %s", async (_label, overrides) => {
    setBusiness(overrides);

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow();

    expect(mocks.createNumberOrder).not.toHaveBeenCalled();
    expect(mocks.listPhoneNumbers).not.toHaveBeenCalled();
  });
});

describe("managed phone-number attachment", () => {
  it("rejects a number-order child UUID before any database or provider call", async () => {
    await expect(
      attachOwnedNumberToCustomerProfile(
        BUSINESS_ID,
        NUMBER_ORDER_PHONE_NUMBER_ID
      )
    ).rejects.toThrow("Invalid Telnyx phone number resource id");

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updatePhoneNumber).not.toHaveBeenCalled();
    expect(mocks.updatePhoneMessaging).not.toHaveBeenCalled();
  });

  it("normalizes a decimal resource ID before reasserting voice and messaging routing", async () => {
    await attachOwnedNumberToCustomerProfile(
      BUSINESS_ID,
      `  ${PHONE_NUMBER_RESOURCE_ID}  `
    );

    expect(mocks.updatePhoneNumber).toHaveBeenCalledWith(
      PHONE_NUMBER_RESOURCE_ID,
      {
        connection_id: VOICE_ID,
        customer_reference: BUSINESS_ID,
      }
    );
    expect(mocks.updatePhoneMessaging).toHaveBeenCalledWith(
      PHONE_NUMBER_RESOURCE_ID,
      {
        messaging_profile_id: PROFILE_ID,
      }
    );
  });
});
