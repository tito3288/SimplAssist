import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { POST } from "./route";

const BUSINESS_ID = "00000000-0000-4000-8000-000000000123";
const PARTNER_ID = "00000000-0000-4000-8000-000000000456";
const ADMIN_ID = "00000000-0000-4000-8000-000000000999";

function request(body: unknown) {
  return new NextRequest(
    "http://localhost/api/admin/business-partner-billing",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
}

function invalidJsonRequest() {
  return new NextRequest(
    "http://localhost/api/admin/business-partner-billing",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    }
  );
}

function rpcAssignment(
  billingMode: "stripe" | "invoiced" | "comped" = "invoiced",
  partnerId: string | null = PARTNER_ID,
  partnerPlan: "sms_only" | "sms_and_chat" | "full" | null =
    billingMode === "stripe" ? null : "sms_and_chat"
) {
  return {
    business_id: BUSINESS_ID,
    partner_id: partnerId,
    billing_mode: billingMode,
    partner_plan: partnerPlan,
    billing_comped: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.rpc.mockResolvedValue({
    data: [rpcAssignment()],
    error: null,
  });
});

describe("POST /api/admin/business-partner-billing", () => {
  it("returns a non-disclosing 404 before parsing JSON or calling the RPC", async () => {
    mocks.getAdminUser.mockResolvedValue(null);

    const response = await POST(invalidJsonRequest());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and a strict invalid payload before the RPC", async () => {
    const invalidJson = await POST(invalidJsonRequest());
    expect(invalidJson.status).toBe(400);

    const extraActor = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
        partnerPlan: "sms_and_chat",
        p_actor_user_id: "00000000-0000-4000-8000-000000000111",
      })
    );
    expect(extraActor.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects partner plus Stripe without calling the RPC", async () => {
    const response = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "stripe",
        partnerPlan: null,
      })
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "unsupported_partner_stripe",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["invoiced", "comped"] as const)(
    "rejects unassigned plus %s without calling the RPC",
    async (billingMode) => {
      const response = await POST(
        request({
          businessId: BUSINESS_ID,
          partnerId: null,
          billingMode,
          partnerPlan: "sms_and_chat",
        })
      );

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "partner_required",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it("rejects a missing or unknown plan before the RPC", async () => {
    const missingPlan = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
      })
    );
    expect(missingPlan.status).toBe(400);
    await expect(missingPlan.json()).resolves.toMatchObject({
      error: "invalid_assignment",
    });

    const unknownPlan = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
        partnerPlan: "starter",
      })
    );
    expect(unknownPlan.status).toBe(400);
    await expect(unknownPlan.json()).resolves.toMatchObject({
      error: "invalid_assignment",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["stripe", null, "sms_only"],
    ["invoiced", PARTNER_ID, null],
    ["comped", PARTNER_ID, null],
  ] as const)(
    "rejects plan/mode mismatch for %s before the RPC",
    async (billingMode, partnerId, partnerPlan) => {
      const response = await POST(
        request({
          businessId: BUSINESS_ID,
          partnerId,
          billingMode,
          partnerPlan,
        })
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "invalid_partner_plan",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["stripe", null, null],
    ["invoiced", PARTNER_ID, "sms_only"],
    ["invoiced", PARTNER_ID, "sms_and_chat"],
    ["comped", PARTNER_ID, "full"],
  ] as const)(
    "allows %s / %s / %s and uses the session actor",
    async (billingMode, partnerId, partnerPlan) => {
      mocks.rpc.mockResolvedValue({
        data: [rpcAssignment(billingMode, partnerId, partnerPlan)],
        error: null,
      });

      const response = await POST(
        request({
          businessId: BUSINESS_ID,
          partnerId,
          billingMode,
          partnerPlan,
        })
      );

      expect(response.status).toBe(200);
      expect(mocks.rpc).toHaveBeenCalledOnce();
      expect(mocks.rpc).toHaveBeenCalledWith(
        "assign_business_partner_billing",
        {
          p_business_id: BUSINESS_ID,
          p_partner_id: partnerId,
          p_billing_mode: billingMode,
          p_actor_user_id: ADMIN_ID,
          p_partner_plan: partnerPlan,
        }
      );
    }
  );

  it.each([
    ["subscription_exists", 409],
    ["partner_required", 409],
    ["partner_inactive", 409],
    ["business_not_found", 404],
  ] as const)("maps RPC error %s to %s", async (code, status) => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: code },
    });

    const response = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
        partnerPlan: "sms_and_chat",
      })
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ error: code });
  });

  it("projects only the five approved RPC result fields", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          ...rpcAssignment("comped", PARTNER_ID, "full"),
          owner_id: "should-not-leak",
          billing_admin_notes: "should-not-leak",
        },
      ],
      error: null,
    });

    const response = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "comped",
        partnerPlan: "full",
      })
    );

    await expect(response.json()).resolves.toEqual({
      success: true,
      assignment: rpcAssignment("comped", PARTNER_ID, "full"),
    });
  });

  it("fails closed for an unknown RPC error or malformed RPC result", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "unexpected_failure" },
    });

    const unknownError = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
        partnerPlan: "sms_and_chat",
      })
    );
    expect(unknownError.status).toBe(500);

    mocks.rpc.mockResolvedValueOnce({
      data: [{ ...rpcAssignment(), billing_comped: "yes" }],
      error: null,
    });
    const malformedResult = await POST(
      request({
        businessId: BUSINESS_ID,
        partnerId: PARTNER_ID,
        billingMode: "invoiced",
        partnerPlan: "sms_and_chat",
      })
    );
    expect(malformedResult.status).toBe(500);
    consoleError.mockRestore();
  });
});
