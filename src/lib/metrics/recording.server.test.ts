import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import { recordBusinessMetricEventBestEffort } from "./recording.server";

const BUSINESS_ID = "10000000-0000-4000-a000-000000000001";
const OCCURRED_AT = new Date("2026-08-05T16:30:00.000Z");
const SOURCE_KEY = `missed-call:${"a".repeat(64)}`;

function record(
  overrides: Partial<
    Parameters<typeof recordBusinessMetricEventBestEffort>[0]
  > = {},
): void {
  recordBusinessMetricEventBestEffort({
    businessId: BUSINESS_ID,
    metricKey: "missed_call_caught",
    quantity: 1,
    occurredAt: OCCURRED_AT,
    sourceKey: SOURCE_KEY,
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.rpc.mockResolvedValue({ data: true, error: null });
});

describe("recordBusinessMetricEventBestEffort", () => {
  it("sends the exact content-free RPC argument set", async () => {
    record();

    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_business_metric_event_v1",
      {
        p_business_id: BUSINESS_ID,
        p_metric_key: "missed_call_caught",
        p_quantity: 1,
        p_occurred_at: "2026-08-05T16:30:00.000Z",
        p_source_key: SOURCE_KEY,
        p_origin: null,
      },
    );

    const rpcArgs = mocks.rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(rpcArgs)).toEqual([
      "p_business_id",
      "p_metric_key",
      "p_quantity",
      "p_occurred_at",
      "p_source_key",
      "p_origin",
    ]);
    expect(JSON.stringify(rpcArgs)).not.toMatch(
      /partner_id|message|content|metadata|phone|prompt|token/i,
    );

    await vi.waitFor(() => expect(console.error).not.toHaveBeenCalled());
  });

  it("passes a dashboard booking origin without any attribution argument", () => {
    const bookingSource = `dashboard-booking:${"b".repeat(64)}`;
    record({
      metricKey: "booking_confirmed",
      sourceKey: bookingSource,
      origin: "dashboard",
    });

    expect(mocks.rpc).toHaveBeenCalledWith(
      "record_business_metric_event_v1",
      expect.objectContaining({
        p_metric_key: "booking_confirmed",
        p_source_key: bookingSource,
        p_origin: "dashboard",
      }),
    );
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_partner_id_at_event",
    );
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty("p_attribution");
    expect(mocks.rpc.mock.calls[0]?.[1]).not.toHaveProperty(
      "p_definition_version",
    );
  });

  it("returns immediately without awaiting the RPC", () => {
    mocks.rpc.mockReturnValue(new Promise(() => undefined));

    expect(record()).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("swallows a synchronous RPC throw and logs only safe identifiers", () => {
    mocks.rpc.mockImplementation(() => {
      throw new Error("secret provider payload and phone +15551234567");
    });

    expect(() => record()).not.toThrow();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "[metrics] Metric recording failed:",
      {
        businessId: BUSINESS_ID,
        metricKey: "missed_call_caught",
      },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "+15551234567",
    );
  });

  it("swallows a rejected RPC without retrying", async () => {
    mocks.rpc.mockRejectedValue(
      new Error("secret message content and session token"),
    );

    expect(() => record()).not.toThrow();
    await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "[metrics] Metric recording failed:",
      {
        businessId: BUSINESS_ID,
        metricKey: "missed_call_caught",
      },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(
      /secret message|session token/i,
    );
  });

  it("swallows a Supabase RPC error without retrying", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });

    record();

    await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledWith(
      "[metrics] Metric recording failed:",
      {
        businessId: BUSINESS_ID,
        metricKey: "missed_call_caught",
      },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(
      "private database detail",
    );
  });

  it.each([null, undefined, {}, { data: null, error: null }])(
    "treats malformed RPC response %# as a swallowed failure",
    async (response) => {
      mocks.rpc.mockResolvedValue(response);

      record();

      await vi.waitFor(() => expect(console.error).toHaveBeenCalledOnce());
      expect(mocks.rpc).toHaveBeenCalledOnce();
    },
  );

  it("swallows serialization failures before calling the RPC", () => {
    record({ occurredAt: new Date("invalid") });

    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[metrics] Metric recording failed:",
      {
        businessId: BUSINESS_ID,
        metricKey: "missed_call_caught",
      },
    );
  });

  it("accepts the idempotent duplicate response as success", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    record();

    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(console.error).not.toHaveBeenCalled();
  });
});
