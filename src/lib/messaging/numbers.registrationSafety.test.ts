import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listPhoneNumbers: vi.fn(),
  createNumberOrder: vi.fn(),
  updatePhoneNumber: vi.fn(),
  updatePhoneMessaging: vi.fn(),
  from: vi.fn(),
}));

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

import {
  attachOwnedNumberToCustomerProfile,
  findOwnedNumberId,
  purchaseNumber,
} from "./numbers";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000381";
const PHONE_NUMBER = "+15745550381";
const PHONE_NUMBER_ID = "10000000-0000-4000-8000-000000000381";
const PROFILE_ID = "20000000-0000-4000-8000-000000000381";
const VOICE_ID = "12345678901";

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

beforeEach(() => {
  vi.clearAllMocks();
  setBusiness();
  mocks.listPhoneNumbers.mockResolvedValue({ data: [] });
  mocks.createNumberOrder.mockResolvedValue({
    data: {
      status: "success",
      phone_numbers: [{ id: PHONE_NUMBER_ID, phone_number: PHONE_NUMBER }],
    },
  });
  mocks.updatePhoneNumber.mockResolvedValue(undefined);
  mocks.updatePhoneMessaging.mockResolvedValue(undefined);
});

describe("number provisioning safety", () => {
  it("recovers only the exact business-scoped E.164 number and normalizes its id", async () => {
    mocks.listPhoneNumbers.mockResolvedValue({
      data: [
        { id: PHONE_NUMBER_ID, phone_number: "+15745550999" },
        {
          id: `  ${PHONE_NUMBER_ID.toUpperCase()}  `,
          phone_number: PHONE_NUMBER,
        },
      ],
    });

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).resolves.toBe(
      PHONE_NUMBER_ID
    );

    expect(mocks.listPhoneNumbers).toHaveBeenCalledWith({
      filter: {
        phone_number: "15745550381",
        customer_reference: BUSINESS_ID,
      },
    });
  });

  it("fails closed when the exact owned-number match has a malformed provider id", async () => {
    mocks.listPhoneNumbers.mockResolvedValue({
      data: [{ id: "legacy-non-uuid", phone_number: PHONE_NUMBER }],
    });

    await expect(findOwnedNumberId(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow(
      "Invalid Telnyx phone number id"
    );
  });

  it("places one scoped order with SDK retries disabled", async () => {
    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).resolves.toEqual({
      phoneNumber: PHONE_NUMBER,
      phoneNumberId: PHONE_NUMBER_ID,
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
  });

  it.each([
    ["messaging profile", { telnyx_messaging_profile_id: null }],
    ["voice application", { telnyx_voice_application_id: null }],
  ])("refuses to order without a %s", async (_label, overrides) => {
    setBusiness(overrides);

    await expect(purchaseNumber(PHONE_NUMBER, BUSINESS_ID)).rejects.toThrow();

    expect(mocks.createNumberOrder).not.toHaveBeenCalled();
  });

  it("rejects the protected legacy non-UUID id before any database or provider call", async () => {
    await expect(
      attachOwnedNumberToCustomerProfile(BUSINESS_ID, "legacy-protected-id")
    ).rejects.toThrow("Invalid Telnyx phone number id");

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.updatePhoneNumber).not.toHaveBeenCalled();
    expect(mocks.updatePhoneMessaging).not.toHaveBeenCalled();
  });

  it("normalizes a valid id before reasserting voice and messaging routing", async () => {
    await attachOwnedNumberToCustomerProfile(
      BUSINESS_ID,
      `  ${PHONE_NUMBER_ID.toUpperCase()}  `
    );

    expect(mocks.updatePhoneNumber).toHaveBeenCalledWith(PHONE_NUMBER_ID, {
      connection_id: VOICE_ID,
      customer_reference: BUSINESS_ID,
    });
    expect(mocks.updatePhoneMessaging).toHaveBeenCalledWith(PHONE_NUMBER_ID, {
      messaging_profile_id: PROFILE_ID,
    });
  });
});
