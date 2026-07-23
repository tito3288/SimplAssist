import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

import {
  ActiveSmsNumberLookupError,
  getActiveSmsNumberForBusiness,
} from "./phoneNumberLookup";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";

let query: Record<string, ReturnType<typeof vi.fn>>;

function setLookupResult(result: unknown) {
  query = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    query[method] = vi.fn(() => query);
  }

  const promise = Promise.resolve(result);
  Object.assign(query, {
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  });
  mocks.from.mockReturnValue(query);
}

beforeEach(() => {
  vi.clearAllMocks();
  setLookupResult({ data: [], error: null });
});

describe("getActiveSmsNumberForBusiness", () => {
  it("reads at most two active phone_numbers rows and returns the sole E.164 number", async () => {
    setLookupResult({
      data: [{ phone_number: "  +13175550123  " }],
      error: null,
    });

    await expect(getActiveSmsNumberForBusiness(BUSINESS_ID)).resolves.toBe(
      "+13175550123"
    );

    expect(mocks.from).toHaveBeenCalledOnce();
    expect(mocks.from).toHaveBeenCalledWith("phone_numbers");
    expect(query.select).toHaveBeenCalledWith("phone_number");
    expect(query.eq).toHaveBeenNthCalledWith(1, "business_id", BUSINESS_ID);
    expect(query.eq).toHaveBeenNthCalledWith(2, "is_active", true);
    expect(query.order).toHaveBeenCalledWith("created_at", {
      ascending: false,
    });
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it.each([{ data: [], error: null }, { data: null, error: null }])(
    "returns null only when no active row exists",
    async (result) => {
      setLookupResult(result);

      await expect(getActiveSmsNumberForBusiness(BUSINESS_ID)).resolves.toBeNull();
    }
  );

  it("fails closed when the database lookup fails", async () => {
    setLookupResult({
      data: null,
      error: { message: "database unavailable" },
    });

    await expect(getActiveSmsNumberForBusiness(BUSINESS_ID)).rejects.toMatchObject({
      name: "ActiveSmsNumberLookupError",
      code: "lookup_failed",
      message: expect.stringContaining(BUSINESS_ID),
    });
  });

  it("fails closed when more than one active number exists", async () => {
    setLookupResult({
      data: [
        { phone_number: "+13175550123" },
        { phone_number: "+13175550124" },
      ],
      error: null,
    });

    await expect(getActiveSmsNumberForBusiness(BUSINESS_ID)).rejects.toMatchObject({
      name: "ActiveSmsNumberLookupError",
      code: "multiple_active_numbers",
    });
  });

  it.each([
    "",
    "13175550123",
    "+03175550123",
    "+1317-555-0123",
    "+1234567",
    "+1234567890123456",
  ])("fails closed for malformed active number %j", async (phoneNumber) => {
    setLookupResult({ data: [{ phone_number: phoneNumber }], error: null });

    try {
      await getActiveSmsNumberForBusiness(BUSINESS_ID);
      throw new Error("Expected active-number lookup to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ActiveSmsNumberLookupError);
      expect(error).toMatchObject({ code: "invalid_e164" });
    }
  });
});
