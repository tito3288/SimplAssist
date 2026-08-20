import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc },
}));

import {
  acquireWidgetIngressTraffic,
  resetWidgetIngressStateForTests,
  setWidgetIngressAdapterForTests,
  type WidgetIngressAdapter,
} from "./ingressTraffic.server";

const INPUT = { endpoint: "chat", networkKey: "n".repeat(43) } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetWidgetIngressStateForTests();
  setWidgetIngressAdapterForTests(null);
  rpc.mockResolvedValue({ data: { status: "allowed" }, error: null });
});

describe("widget ingress traffic", () => {
  it("calls the service-only shared adapter without a business identifier", async () => {
    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "allowed",
    });

    expect(rpc).toHaveBeenCalledWith("acquire_widget_ingress_capacity", {
      p_endpoint: "chat",
      p_network_key: "n".repeat(43),
    });
  });

  it("uses the isolated telemetry ingress RPC", async () => {
    await expect(
      acquireWidgetIngressTraffic(
        { endpoint: "telemetry", networkKey: "t".repeat(43) },
        1_000,
      ),
    ).resolves.toEqual({ status: "allowed" });

    expect(rpc).toHaveBeenCalledWith(
      "acquire_widget_telemetry_ingress_capacity",
      { p_network_key: "t".repeat(43) },
    );
  });

  it("fails closed on shared errors, throws, and malformed decisions", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "db" } });
    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "unavailable",
    });

    resetWidgetIngressStateForTests();
    rpc.mockRejectedValueOnce(new Error("network"));
    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "unavailable",
    });

    resetWidgetIngressStateForTests();
    rpc.mockResolvedValueOnce({
      data: { status: "allowed", quota: 1 },
      error: null,
    });
    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "unavailable",
    });

    resetWidgetIngressStateForTests();
    rpc.mockResolvedValueOnce({
      data: {
        status: "rate_limited",
        retry_after_seconds: 5,
        remaining: 0,
      },
      error: null,
    });
    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("preserves a generic shared rate decision", async () => {
    rpc.mockResolvedValueOnce({
      data: { status: "rate_limited", retry_after_seconds: 17 },
      error: null,
    });

    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "rate_limited",
      retryAfterSeconds: 17,
    });
  });

  it("applies the local per-network chat limit before another shared call", async () => {
    for (let index = 0; index < 60; index += 1) {
      await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
        status: "allowed",
      });
    }

    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "rate_limited",
      retryAfterSeconds: 59,
    });
    expect(rpc).toHaveBeenCalledTimes(60);
  });

  it("applies a business-independent local global limit across rotating networks", async () => {
    const adapter: WidgetIngressAdapter = {
      acquire: vi.fn(async () => ({ status: "allowed" as const })),
    };
    setWidgetIngressAdapterForTests(adapter);

    for (let index = 0; index < 1_000; index += 1) {
      await expect(
        acquireWidgetIngressTraffic(
          { endpoint: "lead", networkKey: String(index).padStart(43, "x") },
          30_000,
        ),
      ).resolves.toEqual({ status: "allowed" });
    }
    await expect(
      acquireWidgetIngressTraffic(
        { endpoint: "lead", networkKey: "z".repeat(43) },
        30_000,
      ),
    ).resolves.toEqual({
      status: "rate_limited",
      retryAfterSeconds: 30,
    });
    expect(adapter.acquire).toHaveBeenCalledTimes(1_000);
  });

  it("starts fresh in the next fixed minute", async () => {
    for (let index = 0; index < 60; index += 1) {
      await acquireWidgetIngressTraffic(INPUT, 59_999);
    }
    await expect(acquireWidgetIngressTraffic(INPUT, 60_000)).resolves.toEqual({
      status: "allowed",
    });
    expect(rpc).toHaveBeenCalledTimes(61);
  });

  it("fails closed when a custom adapter throws", async () => {
    setWidgetIngressAdapterForTests({
      acquire: vi.fn(async () => {
        throw new Error("adapter");
      }),
    });

    await expect(acquireWidgetIngressTraffic(INPUT, 1_000)).resolves.toEqual({
      status: "unavailable",
    });
  });
});
