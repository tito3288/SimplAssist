import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

import {
  acquireWidgetTraffic,
  deriveWidgetNetworkKey,
  deriveWidgetRequestKey,
  releaseWidgetTraffic,
  resetWidgetTrafficStateForTests,
  setWidgetTrafficAdapterForTests,
  type WidgetTrafficAdapter,
  type WidgetTrafficAcquireInput,
  type WidgetTrafficLease,
} from "./traffic.server";

const SECRET = "t".repeat(32);
const INPUT: WidgetTrafficAcquireInput = {
  businessId: "00000000-0000-4000-8000-000000000001",
  originHostname: "example.com",
  sessionId: "00000000-0000-4000-8000-000000000002",
  endpoint: "chat",
  networkKey: "n".repeat(43),
  requestKey: "r".repeat(43),
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWidgetTrafficStateForTests();
  setWidgetTrafficAdapterForTests(null);
});

describe("widget traffic controls", () => {
  it("derives opaque stable network keys from the trusted rightmost address", () => {
    const first = deriveWidgetNetworkKey(
      new Request("https://app.test", {
        headers: { "X-Forwarded-For": "198.51.100.1, 203.0.113.9" },
      }),
      SECRET,
    );
    const second = deriveWidgetNetworkKey(
      new Request("https://app.test", {
        headers: { "X-Forwarded-For": "192.0.2.55, 203.0.113.9" },
      }),
      SECRET,
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toContain("203.0.113.9");
  });

  it("puts missing and malformed proxy addresses in the same unknown bucket", () => {
    const missing = deriveWidgetNetworkKey(
      new Request("https://app.test"),
      SECRET,
    );
    const malformed = deriveWidgetNetworkKey(
      new Request("https://app.test", {
        headers: { "X-Forwarded-For": "198.51.100.1, attacker" },
      }),
      SECRET,
    );
    expect(malformed).toBe(missing);
  });

  it("derives deterministic opaque chat request keys", () => {
    const input = {
      businessId: INPUT.businessId,
      sessionId: INPUT.sessionId,
      endpoint: "chat" as const,
      clientMessageId: "00000000-0000-4000-8000-000000000003",
    };
    expect(deriveWidgetRequestKey(input, SECRET)).toBe(
      deriveWidgetRequestKey(input, SECRET),
    );
    expect(deriveWidgetRequestKey(input, SECRET)).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });

  it("requires both local capacity and a valid shared chat lease", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "allowed",
        lease_token: "00000000-0000-4000-8000-000000000004",
      },
      error: null,
    });
    const decision = await acquireWidgetTraffic(INPUT);

    expect(decision.status).toBe("allowed");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_widget_request_capacity",
      expect.objectContaining({
        p_network_key: INPUT.networkKey,
        p_request_key: INPUT.requestKey,
      }),
    );
    if (decision.status === "allowed") {
      mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
      await releaseWidgetTraffic(decision.lease);
      expect(mocks.rpc).toHaveBeenLastCalledWith(
        "release_widget_request_capacity",
        { p_lease_token: "00000000-0000-4000-8000-000000000004" },
      );
    }
  });

  it("uses the same lease requirement for authenticated preview chat", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        status: "allowed",
        lease_token: "00000000-0000-4000-8000-000000000004",
      },
      error: null,
    });
    const decision = await acquireWidgetTraffic({
      ...INPUT,
      endpoint: "preview_chat",
    });

    expect(decision.status).toBe("allowed");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_widget_request_capacity",
      expect.objectContaining({ p_endpoint: "preview_chat" }),
    );
  });

  it("rate-limits preview end without allocating a concurrency lease", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "allowed", lease_token: null },
      error: null,
    });
    const decision = await acquireWidgetTraffic({
      ...INPUT,
      endpoint: "preview_end",
    });

    expect(decision.status).toBe("allowed");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_widget_request_capacity",
      expect.objectContaining({ p_endpoint: "preview_end" }),
    );
  });

  it("applies a low local lead limit without allocating a concurrency lease", async () => {
    const leadInput: WidgetTrafficAcquireInput = {
      ...INPUT,
      endpoint: "lead",
    };
    for (let index = 0; index < 5; index += 1) {
      mocks.rpc.mockResolvedValueOnce({
        data: { status: "allowed", lease_token: null },
        error: null,
      });
      expect(
        await acquireWidgetTraffic({
          ...leadInput,
          requestKey: String(index).padStart(43, "r"),
        }),
      ).toEqual({
        status: "allowed",
        lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
      });
    }

    expect(
      await acquireWidgetTraffic({
        ...leadInput,
        requestKey: "limited".padStart(43, "r"),
      }),
    ).toEqual({ status: "rate_limited", retryAfterSeconds: 60 });
    expect(mocks.rpc).toHaveBeenCalledTimes(5);
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      "acquire_widget_request_capacity",
      expect.objectContaining({ p_endpoint: "lead" }),
    );
  });

  it("uses isolated shared telemetry capacity without allocating a lease", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "allowed", lease_token: null },
      error: null,
    });
    const decision = await acquireWidgetTraffic({
      ...INPUT,
      endpoint: "telemetry",
    });

    expect(decision).toEqual({
      status: "allowed",
      lease: { sharedLeaseToken: null, localConcurrencyKeys: [] },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "acquire_widget_telemetry_capacity",
      {
        p_business_id: INPUT.businessId,
        p_origin_hostname: INPUT.originHostname,
        p_session_id: INPUT.sessionId,
        p_network_key: INPUT.networkKey,
        p_request_key: INPUT.requestKey,
      },
    );
  });

  it("fails closed for adapter errors, malformed results, and a missing chat lease", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    expect(await acquireWidgetTraffic(INPUT)).toEqual({
      status: "unavailable",
    });

    resetWidgetTrafficStateForTests();
    mocks.rpc.mockResolvedValueOnce({ data: { allowed: true }, error: null });
    expect(await acquireWidgetTraffic(INPUT)).toEqual({
      status: "unavailable",
    });

    resetWidgetTrafficStateForTests();
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "allowed", lease_token: null },
      error: null,
    });
    expect(await acquireWidgetTraffic(INPUT)).toEqual({
      status: "unavailable",
    });
  });

  it("returns a generic limited decision without exposing bucket state", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "rate_limited", retry_after_seconds: 17 },
      error: null,
    });
    expect(await acquireWidgetTraffic(INPUT)).toEqual({
      status: "rate_limited",
      retryAfterSeconds: 17,
    });
  });

  it.each(["origin_not_allowed", "widget_inactive"] as const)(
    "preserves the shared %s decision and releases local chat concurrency",
    async (status) => {
      mocks.rpc.mockResolvedValueOnce({ data: { status }, error: null });

      expect(await acquireWidgetTraffic(INPUT)).toEqual({ status });

      mocks.rpc.mockResolvedValueOnce({
        data: {
          status: "allowed",
          lease_token: "00000000-0000-4000-8000-000000000004",
        },
        error: null,
      });
      expect(
        await acquireWidgetTraffic({ ...INPUT, requestKey: "x".repeat(43) }),
      ).toMatchObject({ status: "allowed" });
    },
  );

  it("rejects access decisions carrying unapproved detail", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: { status: "widget_inactive", is_active: false },
      error: null,
    });

    expect(await acquireWidgetTraffic(INPUT)).toEqual({
      status: "unavailable",
    });
  });

  it("holds one local session concurrency slot until release", async () => {
    const pendingAdapter: WidgetTrafficAdapter = {
      acquire: vi.fn(async () => ({
        status: "allowed" as const,
        leaseToken: "00000000-0000-4000-8000-000000000004",
      })),
      release: vi.fn(async () => true),
    };
    setWidgetTrafficAdapterForTests(pendingAdapter);

    const first = await acquireWidgetTraffic(INPUT);
    const second = await acquireWidgetTraffic({
      ...INPUT,
      requestKey: "x".repeat(43),
    });
    expect(first.status).toBe("allowed");
    expect(second).toEqual({
      status: "concurrency_limited",
      retryAfterSeconds: 2,
    });
    expect(pendingAdapter.acquire).toHaveBeenCalledTimes(1);

    if (first.status === "allowed") await releaseWidgetTraffic(first.lease);
    const third = await acquireWidgetTraffic({
      ...INPUT,
      requestKey: "y".repeat(43),
    });
    expect(third.status).toBe("allowed");
  });

  it("releases local capacity and bounds a hung shared release", async () => {
    vi.useFakeTimers();
    try {
      const pendingAdapter: WidgetTrafficAdapter = {
        acquire: vi.fn(async () => ({
          status: "allowed" as const,
          leaseToken: "00000000-0000-4000-8000-000000000004",
        })),
        release: vi.fn(() => new Promise<boolean>(() => undefined)),
      };
      setWidgetTrafficAdapterForTests(pendingAdapter);

      const first = await acquireWidgetTraffic(INPUT);
      expect(first.status).toBe("allowed");
      if (first.status !== "allowed") return;

      const release = releaseWidgetTraffic(first.lease);
      await vi.advanceTimersByTimeAsync(500);
      await expect(release).resolves.toBeUndefined();

      await expect(
        acquireWidgetTraffic({
          ...INPUT,
          requestKey: "after-release".padStart(43, "r"),
        }),
      ).resolves.toMatchObject({ status: "allowed" });
      expect(pendingAdapter.release).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("recovers an abandoned local concurrency slot after five minutes", async () => {
    const pendingAdapter: WidgetTrafficAdapter = {
      acquire: vi.fn(async () => ({
        status: "allowed" as const,
        leaseToken: "00000000-0000-4000-8000-000000000004",
      })),
      release: vi.fn(async () => true),
    };
    setWidgetTrafficAdapterForTests(pendingAdapter);

    const first = await acquireWidgetTraffic(INPUT, 0);
    expect(first.status).toBe("allowed");
    await expect(
      acquireWidgetTraffic(
        { ...INPUT, requestKey: "x".repeat(43) },
        5 * 60_000 - 1,
      ),
    ).resolves.toEqual({
      status: "concurrency_limited",
      retryAfterSeconds: 2,
    });

    await expect(
      acquireWidgetTraffic(
        { ...INPUT, requestKey: "y".repeat(43) },
        5 * 60_000,
      ),
    ).resolves.toMatchObject({ status: "allowed" });
    expect(pendingAdapter.acquire).toHaveBeenCalledTimes(2);
  });

  it("caps local chat concurrency at eight sessions per business", async () => {
    const pendingAdapter: WidgetTrafficAdapter = {
      acquire: vi.fn(async () => ({
        status: "allowed" as const,
        leaseToken: "00000000-0000-4000-8000-000000000004",
      })),
      release: vi.fn(async () => true),
    };
    setWidgetTrafficAdapterForTests(pendingAdapter);

    const leases: WidgetTrafficLease[] = [];
    for (let index = 0; index < 8; index += 1) {
      const decision = await acquireWidgetTraffic({
        ...INPUT,
        sessionId: `session-${index}`,
        requestKey: String(index).padStart(43, "r"),
      });
      expect(decision.status).toBe("allowed");
      if (decision.status === "allowed") leases.push(decision.lease);
    }

    expect(
      await acquireWidgetTraffic({
        ...INPUT,
        sessionId: "session-8",
        requestKey: "limited".padStart(43, "r"),
      }),
    ).toEqual({ status: "concurrency_limited", retryAfterSeconds: 2 });
    expect(pendingAdapter.acquire).toHaveBeenCalledTimes(8);

    for (const lease of leases) await releaseWidgetTraffic(lease);
  });
});
