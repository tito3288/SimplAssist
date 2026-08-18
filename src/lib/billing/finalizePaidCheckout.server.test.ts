import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attemptPaidLaunch: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/launch", () => ({
  attemptPaidLaunch: mocks.attemptPaidLaunch,
}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { finalizePaidCheckout } from "./finalizePaidCheckout.server";
import type { SyncedCheckout } from "@/lib/stripe/subscriptionSync";

const SYNCED: SyncedCheckout = {
  businessId: "10000000-0000-4000-a000-000000000001",
  customerId: "cus_chat_only",
  subscriptionId: "sub_chat_only",
  plan: "chat_only",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attemptPaidLaunch.mockResolvedValue({ status: "submitted" });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("finalizePaidCheckout", () => {
  it.each(["sms_only", "sms_and_chat", "full"] as const)(
    "preserves the established Telnyx launch dispatch for %s",
    async (plan) => {
      const synced = { ...SYNCED, plan };

      await expect(
        finalizePaidCheckout(synced, "stripe_webhook"),
      ).resolves.toEqual({ status: "submitted" });

      expect(mocks.attemptPaidLaunch).toHaveBeenCalledWith(
        synced.businessId,
        "stripe_webhook",
      );
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it("completes Chat Only atomically without entering the SMS/Telnyx launch", async () => {
    await expect(
      finalizePaidCheckout(SYNCED, "stripe_finalize"),
    ).resolves.toEqual({ status: "completed" });

    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "finalize_chat_only_onboarding_if_paid",
      {
        p_business_id: SYNCED.businessId,
        p_stripe_customer_id: SYNCED.customerId,
        p_stripe_subscription_id: SYNCED.subscriptionId,
      },
    );
  });

  it("treats repeated Chat Only completion as an idempotent success", async () => {
    await expect(
      finalizePaidCheckout(SYNCED, "stripe_webhook"),
    ).resolves.toEqual({ status: "completed" });
    await expect(
      finalizePaidCheckout(SYNCED, "stripe_webhook"),
    ).resolves.toEqual({ status: "completed" });

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it("fails closed when exact direct paid authority no longer matches", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      finalizePaidCheckout(SYNCED, "stripe_finalize"),
    ).resolves.toEqual({
      status: "billing_required",
      message:
        "An active Chat Only subscription is required to complete setup.",
    });

    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });

  it.each([null, 1, "true", { completed: true }])(
    "rejects malformed guarded-RPC response %#",
    async (data) => {
      mocks.rpc.mockResolvedValue({ data, error: null });

      await expect(
        finalizePaidCheckout(SYNCED, "stripe_webhook"),
      ).rejects.toThrow("returned an invalid response");
      expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
    },
  );

  it("throws a retryable error on persistence failure and succeeds on retry", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "serialization failure" },
      })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(
      finalizePaidCheckout(SYNCED, "stripe_webhook"),
    ).rejects.toThrow("serialization failure");
    await expect(
      finalizePaidCheckout(SYNCED, "stripe_webhook"),
    ).resolves.toEqual({ status: "completed" });
    expect(mocks.attemptPaidLaunch).not.toHaveBeenCalled();
  });
});
