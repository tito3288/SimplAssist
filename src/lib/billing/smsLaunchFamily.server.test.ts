import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { claimSmsLaunchPlanFamily } from "./smsLaunchFamily.server";

const BUSINESS_ID = "10000000-0000-4000-a059-000000000091";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("claimSmsLaunchPlanFamily", () => {
  it("claims the SMS family through the service-only locked RPC", async () => {
    await expect(claimSmsLaunchPlanFamily(BUSINESS_ID)).resolves.toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("claim_business_plan_family", {
      p_business_id: BUSINESS_ID,
      p_family: "sms",
      p_claimed_by: "sms_launch",
    });
  });

  it.each([
    "plan_family_transition_not_supported",
    "business_plan_family_evidence_conflict",
  ])("maps known family denial %s to false", async (message) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(claimSmsLaunchPlanFamily(BUSINESS_ID)).resolves.toBe(false);
  });

  it("throws on an unknown claim failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "database unavailable" },
    });
    await expect(claimSmsLaunchPlanFamily(BUSINESS_ID)).rejects.toThrow(
      "Failed to claim SMS family",
    );
  });

  it("fails closed on an invalid RPC response", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await expect(claimSmsLaunchPlanFamily(BUSINESS_ID)).rejects.toThrow(
      "invalid response",
    );
  });
});
