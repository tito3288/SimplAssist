import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  adminFrom: vi.fn(),
  businessSelect: vi.fn(),
  businessOwnerEq: vi.fn(),
  businessMaybeSingle: vi.fn(),
  phoneSelect: vi.fn(),
  phoneBusinessEq: vi.fn(),
  phoneActiveEq: vi.fn(),
  phoneMaybeSingle: vi.fn(),
  businessUpdate: vi.fn(),
  businessUpdateEq: vi.fn(),
  businessUpdateSelect: vi.fn(),
  businessUpdateSingle: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.adminFrom },
}));

import { POST } from "./route";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const BUSINESS_ID = "00000000-0000-4000-8000-000000000002";
const FORWARD_TO_NUMBER = "+13175550123";
const SIMPLASSIST_NUMBER = "+13175550999";
const RESOLVED_AT = "2026-07-19T16:30:00.000Z";

let businessFromCalls = 0;

const businessLookupChain = {
  select: mocks.businessSelect,
  eq: mocks.businessOwnerEq,
  maybeSingle: mocks.businessMaybeSingle,
};

const phoneLookupChain = {
  select: mocks.phoneSelect,
  eq: vi.fn(),
  maybeSingle: mocks.phoneMaybeSingle,
};

const businessUpdateChain = {
  update: mocks.businessUpdate,
  eq: mocks.businessUpdateEq,
  select: mocks.businessUpdateSelect,
  single: mocks.businessUpdateSingle,
};

function makeRequest(body: unknown) {
  return new NextRequest(
    "http://localhost/api/settings/call-forwarding",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function makeRawRequest(body: string) {
  return new NextRequest(
    "http://localhost/api/settings/call-forwarding",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }
  );
}

function setBusiness(overrides: {
  call_forwarding_enabled?: boolean;
  forward_to_number?: string | null;
  call_forwarding_nudge_resolved_at?: string | null;
} = {}) {
  mocks.businessMaybeSingle.mockResolvedValue({
    data: {
      id: BUSINESS_ID,
      call_forwarding_enabled: false,
      forward_to_number: FORWARD_TO_NUMBER,
      call_forwarding_nudge_resolved_at: null,
      ...overrides,
    },
    error: null,
  });
}

function setUpdatedBusiness(
  callForwardingEnabled: boolean,
  forwardToNumber: string | null
) {
  mocks.businessUpdateSingle.mockResolvedValue({
    data: {
      call_forwarding_enabled: callForwardingEnabled,
      forward_to_number: forwardToNumber,
    },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(RESOLVED_AT));
  vi.spyOn(console, "error").mockImplementation(() => {});
  businessFromCalls = 0;

  mocks.getUser.mockResolvedValue({
    data: { user: { id: USER_ID } },
  });
  setBusiness();
  mocks.phoneMaybeSingle.mockResolvedValue({
    data: { phone_number: SIMPLASSIST_NUMBER },
    error: null,
  });
  setUpdatedBusiness(false, FORWARD_TO_NUMBER);

  mocks.businessSelect.mockReturnValue(businessLookupChain);
  mocks.businessOwnerEq.mockReturnValue(businessLookupChain);

  mocks.phoneSelect.mockReturnValue(phoneLookupChain);
  phoneLookupChain.eq.mockImplementation((column: string, value: unknown) => {
    if (column === "business_id") {
      mocks.phoneBusinessEq(column, value);
    } else if (column === "is_active") {
      mocks.phoneActiveEq(column, value);
    }
    return phoneLookupChain;
  });

  mocks.businessUpdate.mockReturnValue(businessUpdateChain);
  mocks.businessUpdateEq.mockReturnValue(businessUpdateChain);
  mocks.businessUpdateSelect.mockReturnValue(businessUpdateChain);

  mocks.adminFrom.mockImplementation((table: string) => {
    if (table === "businesses") {
      businessFromCalls += 1;
      return businessFromCalls === 1
        ? businessLookupChain
        : businessUpdateChain;
    }
    if (table === "phone_numbers") {
      return phoneLookupChain;
    }
    throw new Error(`Unexpected table: ${table}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/settings/call-forwarding", () => {
  it("returns 401 before reading business data when the user is unauthenticated", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const response = await POST(makeRawRequest("{"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("requires at least one setting in the payload", async () => {
    const response = await POST(makeRequest({}));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("rejects a supplied number that is not E.164", async () => {
    const response = await POST(
      makeRequest({ forwardToNumber: "(317) 555-0123" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Enter a valid E.164 phone number, like +13175551234",
      field: "forwardToNumber",
    });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it("turns forwarding off without overwriting the saved number", async () => {
    setBusiness({ call_forwarding_enabled: true });
    setUpdatedBusiness(false, FORWARD_TO_NUMBER);

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      call_forwarding_enabled: false,
    });
    expect(mocks.adminFrom).not.toHaveBeenCalledWith("phone_numbers");
    expect(await response.json()).toEqual({
      success: true,
      callForwardingEnabled: false,
      forwardToNumber: FORWARD_TO_NUMBER,
    });
  });

  it("turns forwarding on using the already-saved number", async () => {
    setUpdatedBusiness(true, FORWARD_TO_NUMBER);

    const response = await POST(makeRequest({ enabled: true }));

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      call_forwarding_enabled: true,
    });
    expect(await response.json()).toEqual({
      success: true,
      callForwardingEnabled: true,
      forwardToNumber: FORWARD_TO_NUMBER,
    });
  });

  it("preserves the original nudge resolution timestamp on later settings changes", async () => {
    const originalResolvedAt = "2026-07-01T12:00:00.000Z";
    setBusiness({
      call_forwarding_enabled: true,
      call_forwarding_nudge_resolved_at: originalResolvedAt,
    });
    setUpdatedBusiness(false, FORWARD_TO_NUMBER);

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: originalResolvedAt,
      call_forwarding_enabled: false,
    });
  });

  it("updates only a supplied number and normalizes surrounding whitespace", async () => {
    const newNumber = "+13175550456";
    setUpdatedBusiness(false, newNumber);

    const response = await POST(
      makeRequest({ forwardToNumber: `  ${newNumber}  ` })
    );

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      forward_to_number: newNumber,
    });
    expect(await response.json()).toEqual({
      success: true,
      callForwardingEnabled: false,
      forwardToNumber: newNumber,
    });
  });

  it("updates a number without changing forwarding when it is already on", async () => {
    const newNumber = "+13175550456";
    setBusiness({ call_forwarding_enabled: true });
    setUpdatedBusiness(true, newNumber);

    const response = await POST(makeRequest({ forwardToNumber: newNumber }));

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      forward_to_number: newNumber,
    });
    expect(await response.json()).toEqual({
      success: true,
      callForwardingEnabled: true,
      forwardToNumber: newNumber,
    });
  });

  it("keeps full-form payloads compatible", async () => {
    const newNumber = "+13175550456";
    setUpdatedBusiness(true, newNumber);

    const response = await POST(
      makeRequest({ enabled: true, forwardToNumber: newNumber })
    );

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      call_forwarding_enabled: true,
      forward_to_number: newNumber,
    });
  });

  it.each([null, "", "   "])(
    "clears a saved number while forwarding is off for %j",
    async (forwardToNumber) => {
      setUpdatedBusiness(false, null);

      const response = await POST(makeRequest({ forwardToNumber }));

      expect(response.status).toBe(200);
      expect(mocks.businessUpdate).toHaveBeenCalledWith({
        call_forwarding_nudge_resolved_at: RESOLVED_AT,
        forward_to_number: null,
      });
      expect(mocks.adminFrom).not.toHaveBeenCalledWith("phone_numbers");
      expect(await response.json()).toEqual({
        success: true,
        callForwardingEnabled: false,
        forwardToNumber: null,
      });
    }
  );

  it("rejects enabling forwarding when no number is saved", async () => {
    setBusiness({ forward_to_number: null });

    const response = await POST(makeRequest({ enabled: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Forward-to number is required when call forwarding is enabled",
      field: "forwardToNumber",
    });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("rejects clearing the number while forwarding remains enabled", async () => {
    setBusiness({ call_forwarding_enabled: true });

    const response = await POST(
      makeRequest({ forwardToNumber: null })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Forward-to number is required when call forwarding is enabled",
      field: "forwardToNumber",
    });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("allows a full update to disable forwarding and clear its number", async () => {
    setBusiness({ call_forwarding_enabled: true });
    setUpdatedBusiness(false, null);

    const response = await POST(
      makeRequest({ enabled: false, forwardToNumber: null })
    );

    expect(response.status).toBe(200);
    expect(mocks.businessUpdate).toHaveBeenCalledWith({
      call_forwarding_nudge_resolved_at: RESOLVED_AT,
      call_forwarding_enabled: false,
      forward_to_number: null,
    });
  });

  it("rejects the active SimplAssist number as the resulting destination", async () => {
    setBusiness({ forward_to_number: SIMPLASSIST_NUMBER });

    const response = await POST(makeRequest({ enabled: true }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Forward-to number cannot be your SimplAssist number",
      field: "forwardToNumber",
    });
    expect(mocks.phoneBusinessEq).toHaveBeenCalledWith(
      "business_id",
      BUSINESS_ID
    );
    expect(mocks.phoneActiveEq).toHaveBeenCalledWith("is_active", true);
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("returns the canonical state from the updated database row", async () => {
    setUpdatedBusiness(true, "+13175550777");

    const response = await POST(makeRequest({ enabled: true }));

    expect(response.status).toBe(200);
    expect(mocks.businessUpdateSelect).toHaveBeenCalledWith(
      "call_forwarding_enabled, forward_to_number"
    );
    expect(await response.json()).toEqual({
      success: true,
      callForwardingEnabled: true,
      forwardToNumber: "+13175550777",
    });
  });

  it("returns 404 when the authenticated owner has no business", async () => {
    mocks.businessMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Business not found" });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when business settings cannot be loaded", async () => {
    mocks.businessMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to load call forwarding settings",
    });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when the active number cannot be loaded", async () => {
    mocks.phoneMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    const response = await POST(makeRequest({ enabled: true }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to validate call forwarding settings",
    });
    expect(mocks.businessUpdate).not.toHaveBeenCalled();
  });

  it("returns 500 when the settings and nudge resolution cannot be saved", async () => {
    mocks.businessUpdateSingle.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to save call forwarding settings",
    });
  });

  it("treats a missing updated row as a save failure", async () => {
    mocks.businessUpdateSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(makeRequest({ enabled: false }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to save call forwarding settings",
    });
  });
});
