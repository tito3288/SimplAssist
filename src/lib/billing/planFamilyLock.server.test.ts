import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  businessPlanFamily,
  claimCheckoutPlanFamily,
  DirectCheckoutPlanClaimUnavailableError,
  PlanFamilyTransitionNotSupportedError,
} from "./planFamilyLock.server";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("businessPlanFamily", () => {
  it("keeps Chat Only incomparable with every SMS-bearing plan", () => {
    expect(businessPlanFamily("chat_only")).toBe("chat_only");
    expect(businessPlanFamily("sms_only")).toBe("sms");
    expect(businessPlanFamily("sms_and_chat")).toBe("sms");
    expect(businessPlanFamily("full")).toBe("sms");
  });
});

describe("claimCheckoutPlanFamily", () => {
  it("uses only the service-owned exact-plan claim", async () => {
    await claimCheckoutPlanFamily("business-1", "chat_only", true);

    expect(mocks.rpc).toHaveBeenCalledWith("claim_direct_checkout_plan", {
      p_business_id: "business-1",
      p_plan: "chat_only",
      p_require_intent: true,
    });
  });

  it("keeps legacy and canceled-subscription acquisition independent of intent", async () => {
    await claimCheckoutPlanFamily("business-1", "sms_only");

    expect(mocks.rpc).toHaveBeenCalledWith("claim_direct_checkout_plan", {
      p_business_id: "business-1",
      p_plan: "sms_only",
      p_require_intent: false,
    });
  });

  it("surfaces the stable transition conflict", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "plan_family_transition_not_supported" },
    });

    await expect(
      claimCheckoutPlanFamily("business-1", "sms_and_chat"),
    ).rejects.toBeInstanceOf(PlanFamilyTransitionNotSupportedError);
  });

  it("fails closed on database errors or a disappeared business", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "connection lost" },
    });
    await expect(
      claimCheckoutPlanFamily("business-1", "sms_only"),
    ).rejects.toThrow("connection lost");

    mocks.rpc.mockResolvedValueOnce({ data: false, error: null });
    await expect(
      claimCheckoutPlanFamily("business-1", "sms_only"),
    ).rejects.toBeInstanceOf(DirectCheckoutPlanClaimUnavailableError);
  });
});
