import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  results: new Map<string, { data: unknown; error: unknown }>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

import {
  preflightOutboundSms,
  recordInboundMessagingUsage,
} from "./usage";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000032";
const PERIOD_ID = "20000000-0000-4000-a000-000000000032";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.clear();
  mocks.results.set("businesses", {
    data: {
      id: BUSINESS_ID,
      billing_pilot: false,
      billing_comped: false,
      billing_exempt: false,
      telnyx_submission_disabled: false,
      sms_overage_opt_in: false,
    },
    error: null,
  });
  mocks.results.set("subscriptions", {
    data: {
      plan: "sms_only",
      status: "active",
      current_period_start: "2026-07-01T00:00:00.000Z",
      current_period_end: "2026-08-01T00:00:00.000Z",
    },
    error: null,
  });
  mocks.results.set("billing_usage_periods", {
    data: {
      id: PERIOD_ID,
      included_sms_parts: 500,
      inbound_sms_parts: 1,
      outbound_sms_parts: 1,
      warning_80_sent_at: null,
      hard_limit_reached_at: null,
    },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "eq",
      "is",
      "single",
      "maybeSingle",
    ]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.single.mockImplementation(async () => mocks.results.get(table));
    chain.maybeSingle.mockImplementation(async () => mocks.results.get(table));
    return chain;
  });
});

describe("preflightOutboundSms", () => {
  it("keeps outbound SMS available during Stripe past_due recovery", async () => {
    mocks.results.set("subscriptions", {
      data: {
        plan: "sms_only",
        status: "past_due",
        current_period_start: "2026-07-01T00:00:00.000Z",
        current_period_end: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({
      allowed: true,
      businessId: BUSINESS_ID,
      periodId: PERIOD_ID,
    });
  });

  it("still blocks a known canceled subscription", async () => {
    mocks.results.set("subscriptions", {
      data: {
        plan: "sms_only",
        status: "canceled",
        current_period_start: "2026-07-01T00:00:00.000Z",
        current_period_end: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: false, reason: "canceled" });
  });

  it("lets a canceled subscription take precedence over billing override flags", async () => {
    mocks.results.set("businesses", {
      data: {
        id: BUSINESS_ID,
        billing_pilot: true,
        billing_comped: false,
        billing_exempt: false,
        telnyx_submission_disabled: false,
        sms_overage_opt_in: false,
      },
      error: null,
    });
    mocks.results.set("subscriptions", {
      data: {
        plan: "full",
        status: "canceled",
        current_period_start: "2026-07-01T00:00:00.000Z",
        current_period_end: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: false, reason: "canceled" });
  });

  it("fails retryably on malformed synchronized billing values", async () => {
    mocks.results.set("subscriptions", {
      data: {
        plan: "mystery_plan",
        status: "active",
        current_period_start: "2026-07-01T00:00:00.000Z",
        current_period_end: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).rejects.toThrow("malformed billing values");
  });

  it("throws instead of treating a subscription query error as no plan", async () => {
    mocks.results.set("subscriptions", {
      data: null,
      error: { message: "temporary database failure" },
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).rejects.toThrow("temporary database failure");
  });
});

describe("recordInboundMessagingUsage", () => {
  it("records the ledger event and counter through one atomic RPC", async () => {
    await recordInboundMessagingUsage({
      businessId: BUSINESS_ID,
      text: "Hello",
      mediaCount: 1,
      source: "telnyx_webhook",
      providerEventId: "telnyx:event-32",
      providerMessageId: "message-32",
      metadata: { webhookType: "message.received" },
    });

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("record_billing_usage_event", {
      p_business_id: BUSINESS_ID,
      p_usage_period_id: PERIOD_ID,
      p_idempotency_key: "telnyx:event-32",
      p_direction: "inbound",
      p_channel: "mms",
      p_source: "telnyx_webhook",
      p_sms_parts: 1,
      p_mms_events: 1,
      p_provider_message_id: "message-32",
      p_metadata: {
        mediaCount: 1,
        webhookType: "message.received",
      },
    });
  });

  it("accepts an idempotent duplicate response without another app-side increment", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    await expect(
      recordInboundMessagingUsage({
        businessId: BUSINESS_ID,
        text: "Hello",
        mediaCount: 0,
        source: "telnyx_webhook",
        providerEventId: "telnyx:event-32",
      })
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("rejects a malformed RPC result so a provider boundary can retry", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await expect(
      recordInboundMessagingUsage({
        businessId: BUSINESS_ID,
        text: "Hello",
        mediaCount: 0,
        source: "telnyx_webhook",
        providerEventId: "telnyx:event-32",
      })
    ).rejects.toThrow("invalid response");
  });
});
