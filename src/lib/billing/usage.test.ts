import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  results: new Map<string, QueryResult>(),
  queuedResults: new Map<string, QueryResult[]>(),
  writes: [] as Array<{
    table: string;
    operation: "insert" | "update";
    values: unknown;
  }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}));

import {
  preflightOutboundSms as preflightOutboundSmsWithPurpose,
  recordInboundMessagingUsage,
  recordOutboundSmsUsage,
  usageBlockMessage,
} from "./usage";

function preflightOutboundSms(
  args: Omit<
    Parameters<typeof preflightOutboundSmsWithPurpose>[0],
    "purpose"
  > &
    Partial<
      Pick<Parameters<typeof preflightOutboundSmsWithPurpose>[0], "purpose">
    >,
) {
  return preflightOutboundSmsWithPurpose({
    purpose: "manual_dashboard_send",
    ...args,
  });
}

const BUSINESS_ID = "10000000-0000-4000-a000-000000000032";
const PERIOD_ID = "20000000-0000-4000-a000-000000000032";

const defaultBusiness = {
  id: BUSINESS_ID,
  operations_suspended_at: null,
  ai_replies_paused_at: null,
  texting_paused_at: null,
  bookings_paused_at: null,
  billing_mode: "stripe",
  partner_plan: null,
  billing_pilot: false,
  billing_comped: false,
  billing_exempt: false,
  telnyx_submission_disabled: false,
  sms_overage_opt_in: false,
};

const defaultSubscription = {
  plan: "sms_only",
  status: "active",
  current_period_start: "2026-07-01T00:00:00.000Z",
  current_period_end: "2026-08-01T00:00:00.000Z",
};

const defaultUsagePeriod = {
  id: PERIOD_ID,
  plan: "sms_only",
  included_sms_parts: 500,
  inbound_sms_parts: 1,
  outbound_sms_parts: 1,
  warning_80_sent_at: null,
  hard_limit_reached_at: null,
};

describe("usageBlockMessage", () => {
  it("keeps the disabled-SMS dashboard message product-neutral", () => {
    const message = usageBlockMessage("telnyx_submission_disabled");

    expect(message).toBe(
      "SMS sending is disabled for this account. Contact support if this looks wrong.",
    );
    expect(message).not.toContain("SimplAssist");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.results.clear();
  mocks.queuedResults.clear();
  mocks.writes.length = 0;
  mocks.results.set("businesses", {
    data: { ...defaultBusiness },
    error: null,
  });
  mocks.results.set("subscriptions", {
    data: { ...defaultSubscription },
    error: null,
  });
  mocks.results.set("billing_usage_periods", {
    data: { ...defaultUsagePeriod },
    error: null,
  });
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "is"]) {
      chain[method] = vi.fn(() => chain);
    }
    chain.insert = vi.fn((values: unknown) => {
      mocks.writes.push({ table, operation: "insert", values });
      return chain;
    });
    chain.update = vi.fn((values: unknown) => {
      mocks.writes.push({ table, operation: "update", values });
      return chain;
    });
    const nextResult = async () => {
      const queued = mocks.queuedResults.get(table);
      if (queued?.length) return queued.shift();
      return mocks.results.get(table);
    };
    chain.single = vi.fn(nextResult);
    chain.maybeSingle = vi.fn(nextResult);
    return chain;
  });
});

describe("preflightOutboundSms", () => {
  it("blocks suspension before billing-period writes and gives it precedence", async () => {
    setBusiness({
      operations_suspended_at: "2026-08-04T12:00:00.000Z",
      texting_paused_at: "2026-08-04T12:01:00.000Z",
      ai_replies_paused_at: "2026-08-04T12:02:00.000Z",
    });

    await expect(
      preflightOutboundSms({
        businessId: BUSINESS_ID,
        text: "Hello",
        purpose: "ai_reply",
      }),
    ).resolves.toMatchObject({
      allowed: false,
      reason: "account_suspended",
    });
    expect(mocks.writes).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    "manual_dashboard_send",
    "missed_call",
    "ai_reply",
    "mms_fallback",
  ] as const)("blocks texting for %s", async (purpose) => {
    setBusiness({ texting_paused_at: "2026-08-04T12:00:00.000Z" });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello", purpose }),
    ).resolves.toMatchObject({ allowed: false, reason: "texting_paused" });
  });

  it.each(["ai_reply", "mms_fallback"] as const)(
    "blocks an AI pause for %s",
    async (purpose) => {
      setBusiness({ ai_replies_paused_at: "2026-08-04T12:00:00.000Z" });

      await expect(
        preflightOutboundSms({
          businessId: BUSINESS_ID,
          text: "Hello",
          purpose,
        }),
      ).resolves.toMatchObject({
        allowed: false,
        reason: "ai_replies_paused",
      });
    },
  );

  it.each(["manual_dashboard_send", "missed_call"] as const)(
    "does not apply an AI pause to %s",
    async (purpose) => {
      setBusiness({ ai_replies_paused_at: "2026-08-04T12:00:00.000Z" });

      await expect(
        preflightOutboundSms({
          businessId: BUSINESS_ID,
          text: "Hello",
          purpose,
        }),
      ).resolves.toMatchObject({ allowed: true });
    },
  );

  it("fails closed when the operational timestamps are malformed", async () => {
    setBusiness({ operations_suspended_at: "not-a-timestamp" });

    await expect(
      preflightOutboundSms({
        businessId: BUSINESS_ID,
        text: "Hello",
        purpose: "manual_dashboard_send",
      }),
    ).rejects.toMatchObject({
      name: "OperationalControlsResolutionError",
      code: "malformed_business",
      retryable: true,
    });
  });

  it("types a business lookup failure as retryable operational uncertainty", async () => {
    mocks.results.set("businesses", {
      data: null,
      error: { message: "temporary business lookup failure" },
    });

    await expect(
      preflightOutboundSms({
        businessId: BUSINESS_ID,
        text: "Hello",
        purpose: "manual_dashboard_send",
      }),
    ).rejects.toMatchObject({
      name: "OperationalControlsResolutionError",
      code: "business_lookup_failed",
      retryable: true,
    });
  });

  it("keeps outbound SMS available during Stripe past_due recovery", async () => {
    setSubscription({ status: "past_due" });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({
      allowed: true,
      businessId: BUSINESS_ID,
      periodId: PERIOD_ID,
    });
  });

  it("still blocks a known canceled subscription", async () => {
    setSubscription({ status: "canceled" });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: false, reason: "canceled" });
  });

  it("lets a canceled subscription take precedence over partner billing and overrides", async () => {
    setBusiness({
      billing_mode: "comped",
      partner_plan: "full",
      billing_pilot: true,
      billing_comped: true,
      billing_exempt: true,
      sms_overage_opt_in: true,
    });
    setSubscription({ plan: "full", status: "canceled" });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: false, reason: "canceled" });
  });

  it("fails retryably on malformed synchronized billing values", async () => {
    setSubscription({ plan: "mystery_plan" });

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

  it.each([
    ["invoiced", "sms_only", 500],
    ["invoiced", "sms_and_chat", 1500],
    ["invoiced", "full", 2500],
    ["comped", "sms_only", 500],
    ["comped", "sms_and_chat", 1500],
    ["comped", "full", 2500],
  ])(
    "activates %s partner billing with the %s plan and a %i-part snapshot",
    async (billingMode, partnerPlan, includedSmsParts) => {
      setBusiness({
        billing_mode: billingMode,
        partner_plan: partnerPlan,
      });
      setNoSubscription();
      queueResults(
        "billing_usage_periods",
        { data: null, error: null },
        {
          data: usagePeriod({
            plan: partnerPlan,
            included_sms_parts: includedSmsParts,
          }),
          error: null,
        }
      );

      await expect(
        preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
      ).resolves.toMatchObject({
        allowed: true,
        businessId: BUSINESS_ID,
        periodId: PERIOD_ID,
      });

      expect(mocks.writes).toContainEqual({
        table: "billing_usage_periods",
        operation: "insert",
        values: expect.objectContaining({
          business_id: BUSINESS_ID,
          plan: partnerPlan,
          included_sms_parts: includedSmsParts,
        }),
      });
    }
  );

  it("never grants partner overages through legacy flags or sms_overage_opt_in", async () => {
    setBusiness({
      billing_mode: "comped",
      partner_plan: "sms_only",
      billing_pilot: true,
      billing_comped: true,
      billing_exempt: true,
      sms_overage_opt_in: true,
    });
    setNoSubscription();
    setUsagePeriod({
      plan: "sms_only",
      included_sms_parts: 500,
      inbound_sms_parts: 250,
      outbound_sms_parts: 250,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "usage_limit_reached",
    });

    expect(mocks.writes).toContainEqual({
      table: "billing_usage_periods",
      operation: "update",
      values: {
        hard_limit_reached_at: expect.any(String),
      },
    });
  });

  it.each([
    ["sms_only", 500, "full", 2500],
    ["full", 2500, "sms_only", 500],
  ])(
    "reconciles a current partner period from %s/%i to %s/%i",
    async (oldPlan, oldCap, newPlan, newCap) => {
      setBusiness({ billing_mode: "invoiced", partner_plan: newPlan });
      setNoSubscription();
      queueResults(
        "billing_usage_periods",
        {
          data: usagePeriod({
            plan: oldPlan,
            included_sms_parts: oldCap,
            inbound_sms_parts: 10,
            outbound_sms_parts: 10,
          }),
          error: null,
        },
        {
          data: usagePeriod({
            plan: newPlan,
            included_sms_parts: newCap,
            inbound_sms_parts: 10,
            outbound_sms_parts: 10,
          }),
          error: null,
        }
      );

      await expect(
        preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
      ).resolves.toMatchObject({ allowed: true });

      expect(mocks.writes).toContainEqual({
        table: "billing_usage_periods",
        operation: "update",
        values: {
          plan: newPlan,
          included_sms_parts: newCap,
          updated_at: expect.any(String),
        },
      });
    }
  );

  it("enforces a downgraded partner cap against already-recorded usage", async () => {
    setBusiness({ billing_mode: "invoiced", partner_plan: "sms_only" });
    setNoSubscription();
    queueResults(
      "billing_usage_periods",
      {
        data: usagePeriod({
          plan: "full",
          included_sms_parts: 2500,
          inbound_sms_parts: 250,
          outbound_sms_parts: 250,
        }),
        error: null,
      },
      {
        data: usagePeriod({
          plan: "sms_only",
          included_sms_parts: 500,
          inbound_sms_parts: 250,
          outbound_sms_parts: 250,
        }),
        error: null,
      }
    );

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "usage_limit_reached",
    });
  });

  it.each([
    ["invoiced", null],
    ["comped", "enterprise"],
    ["stripe", "sms_only"],
    ["manual", null],
  ])(
    "fails closed on malformed partner billing state %s/%s",
    async (billingMode, partnerPlan) => {
      setBusiness({
        billing_mode: billingMode,
        partner_plan: partnerPlan,
      });
      setNoSubscription();

      await expect(
        preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
      ).rejects.toThrow("malformed partner billing values");
    }
  );

  it("gives an active subscription precedence over a lower partner plan", async () => {
    setBusiness({
      billing_mode: "invoiced",
      partner_plan: "sms_only",
      billing_pilot: true,
      billing_comped: true,
      billing_exempt: true,
    });
    setSubscription({ plan: "full", status: "active" });
    setUsagePeriod({
      plan: "full",
      included_sms_parts: 2500,
      inbound_sms_parts: 250,
      outbound_sms_parts: 250,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("uses a valid subscription before examining malformed partner state", async () => {
    setBusiness({ billing_mode: "invoiced", partner_plan: null });
    setSubscription({ plan: "full", status: "active" });
    setUsagePeriod({ plan: "full", included_sms_parts: 2500 });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: true });
  });

  it.each(["billing_pilot", "billing_comped", "billing_exempt"] as const)(
    "keeps Stripe-mode legacy %s access active and unlimited",
    async (flag) => {
      setBusiness({
        billing_mode: "stripe",
        partner_plan: null,
        [flag]: true,
        sms_overage_opt_in: false,
      });
      setNoSubscription();
      setUsagePeriod({
        plan: "full",
        included_sms_parts: 2500,
        inbound_sms_parts: 1250,
        outbound_sms_parts: 1250,
        warning_80_sent_at: "2026-07-20T00:00:00.000Z",
      });

      await expect(
        preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
      ).resolves.toMatchObject({ allowed: true });
    }
  );

  it("keeps the legacy Stripe override upgrade behavior for an existing period", async () => {
    setBusiness({ billing_mode: "stripe", billing_exempt: true });
    setNoSubscription();
    queueResults(
      "billing_usage_periods",
      {
        data: usagePeriod({ plan: "sms_only", included_sms_parts: 500 }),
        error: null,
      },
      {
        data: usagePeriod({ plan: "full", included_sms_parts: 2500 }),
        error: null,
      }
    );

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: true });

    expect(mocks.writes).toContainEqual({
      table: "billing_usage_periods",
      operation: "update",
      values: {
        plan: "full",
        included_sms_parts: 2500,
        updated_at: expect.any(String),
      },
    });
  });

  it("preserves Stripe overage opt-in behavior", async () => {
    setBusiness({ sms_overage_opt_in: true });
    setUsagePeriod({
      plan: "sms_only",
      included_sms_parts: 500,
      inbound_sms_parts: 250,
      outbound_sms_parts: 250,
      warning_80_sent_at: "2026-07-20T00:00:00.000Z",
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: true });
  });

  it("preserves Stripe's existing no-downgrade period behavior", async () => {
    setSubscription({ plan: "sms_only" });
    setUsagePeriod({
      plan: "full",
      included_sms_parts: 2500,
      inbound_sms_parts: 250,
      outbound_sms_parts: 250,
    });

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({ allowed: true });

    expect(
      mocks.writes.some(
        (write) =>
          write.table === "billing_usage_periods" &&
          write.operation === "update" &&
          typeof write.values === "object" &&
          write.values !== null &&
          "included_sms_parts" in write.values
      )
    ).toBe(false);
  });

  it("still blocks Stripe mode with no subscription and no legacy flag", async () => {
    setNoSubscription();

    await expect(
      preflightOutboundSms({ businessId: BUSINESS_ID, text: "Hello" })
    ).resolves.toMatchObject({
      allowed: false,
      reason: "billing_required",
    });
  });
});

describe("recordInboundMessagingUsage", () => {
  it("continues inbound accounting while operations and texting are paused", async () => {
    setBusiness({
      operations_suspended_at: "2026-08-04T12:00:00.000Z",
      texting_paused_at: "2026-08-04T12:01:00.000Z",
    });

    await expect(
      recordInboundMessagingUsage({
        businessId: BUSINESS_ID,
        text: "Stored inbound",
        mediaCount: 0,
        source: "telnyx_webhook",
        providerEventId: "telnyx:paused-inbound",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

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

describe("recordOutboundSmsUsage", () => {
  it("meters provider-accepted work even when a pause lands after sending", async () => {
    setBusiness({
      operations_suspended_at: "2026-08-04T12:00:00.000Z",
      texting_paused_at: "2026-08-04T12:01:00.000Z",
      ai_replies_paused_at: "2026-08-04T12:02:00.000Z",
    });

    await expect(
      recordOutboundSmsUsage({
        businessId: BUSINESS_ID,
        text: "Already accepted",
        source: "manual_dashboard",
        providerMessageId: "provider-message-48",
      }),
    ).resolves.toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});

function setBusiness(overrides: Record<string, unknown>): void {
  mocks.results.set("businesses", {
    data: { ...defaultBusiness, ...overrides },
    error: null,
  });
}

function setSubscription(overrides: Record<string, unknown>): void {
  mocks.results.set("subscriptions", {
    data: { ...defaultSubscription, ...overrides },
    error: null,
  });
}

function setNoSubscription(): void {
  mocks.results.set("subscriptions", { data: null, error: null });
}

function setUsagePeriod(overrides: Record<string, unknown>): void {
  mocks.results.set("billing_usage_periods", {
    data: usagePeriod(overrides),
    error: null,
  });
}

function usagePeriod(overrides: Record<string, unknown>) {
  return { ...defaultUsagePeriod, ...overrides };
}

function queueResults(table: string, ...results: QueryResult[]): void {
  mocks.queuedResults.set(table, results);
}
