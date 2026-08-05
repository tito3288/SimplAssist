import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  class TestSendError extends Error {
    constructor(
      readonly code: "config_not_found" | "preview_failed" | "invalid_snapshot",
      readonly status: 404 | 500,
    ) {
      super(code);
    }
  }

  return {
    TestSendError,
    getAdminUser: vi.fn(),
    sendAdminMetricsReportTest: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/auth", () => ({
  getAdminUser: mocks.getAdminUser,
}));
vi.mock("@/lib/admin/metricsReportTestSend.server", () => ({
  AdminMetricsReportTestSendError: mocks.TestSendError,
  sendAdminMetricsReportTest: mocks.sendAdminMetricsReportTest,
}));

import { POST } from "./route";

const ADMIN_ID = "10000000-0000-4000-a000-000000000001";
const CONFIG_ID = "20000000-0000-4000-a000-000000000001";

function request(
  body: unknown = {
    configId: CONFIG_ID,
    email: "test@example.com",
  },
  options: {
    host?: string | null;
    origin?: string | null;
    contentType?: string | null;
    fetchSite?: string | null;
    rawBody?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  if (options.host !== null) {
    headers.set("host", options.host ?? "simplassist.com");
  }
  if (options.origin !== null) {
    headers.set("origin", options.origin ?? "https://simplassist.com");
  }
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.fetchSite !== null) {
    headers.set("sec-fetch-site", options.fetchSite ?? "same-origin");
  }

  return new NextRequest(
    "https://simplassist.com/api/admin/metrics/reports/test-send",
    {
      method: "POST",
      headers,
      body: options.rawBody ?? JSON.stringify(body),
    },
  );
}

function privateResponse(response: Response): void {
  expect(response.headers.get("cache-control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("access-control-allow-origin")).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://simplassist.com");
  mocks.getAdminUser.mockResolvedValue({ id: ADMIN_ID, email: null });
  mocks.sendAdminMetricsReportTest.mockResolvedValue({ outcome: "accepted" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/metrics/reports/test-send", () => {
  it("authenticates before Host, Origin, content type, body, or service work", async () => {
    mocks.getAdminUser.mockResolvedValue(null);
    const json = vi.fn().mockRejectedValue(new Error("must not parse"));
    const untrusted = {
      headers: new Headers({
        host: "attacker.example",
        origin: "https://attacker.example",
        "content-type": "text/plain",
        "sec-fetch-site": "cross-site",
      }),
      json,
    } as unknown as NextRequest;

    const response = await POST(untrusted);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.sendAdminMetricsReportTest).not.toHaveBeenCalled();
    privateResponse(response);
  });

  it.each([
    [{ host: "attacker.example" }, 404, "Not found"],
    [{ origin: null }, 403, "origin_not_allowed"],
    [{ contentType: "text/plain" }, 400, "invalid_request"],
  ] as const)(
    "rejects an invalid request boundary before parsing JSON: %j",
    async (options, status, error) => {
      const invalidRequest = request(undefined, {
        ...options,
        rawBody: "{",
      });
      const response = await POST(invalidRequest);

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error });
      expect(invalidRequest.bodyUsed).toBe(false);
      expect(mocks.sendAdminMetricsReportTest).not.toHaveBeenCalled();
      privateResponse(response);
    },
  );

  it("rejects malformed JSON and a strict request-shape matrix", async () => {
    const malformed = await POST(request(undefined, { rawBody: "{" }));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_request" });

    const invalidBodies = [
      null,
      [],
      {},
      { configId: "not-a-uuid", email: "test@example.com" },
      { configId: CONFIG_ID, email: "not-an-email" },
      { configId: CONFIG_ID, email: "test@example.com", period: "2026-07" },
      { configId: CONFIG_ID, email: "test@example.com", recipients: [] },
    ];

    for (const body of invalidBodies) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(mocks.sendAdminMetricsReportTest).not.toHaveBeenCalled();
  });

  it("normalizes one recipient and returns only the honest outcome", async () => {
    const response = await POST(
      request({
        configId: CONFIG_ID.toUpperCase(),
        email: "  Bryan+Metrics@Example.COM ",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "accepted" });
    expect(mocks.sendAdminMetricsReportTest).toHaveBeenCalledWith({
      configId: CONFIG_ID,
      email: "bryan+metrics@example.com",
    });
    privateResponse(response);
  });

  it.each(["accepted", "failed", "needs_review"] as const)(
    "passes through the safe %s result without provider details",
    async (outcome) => {
      mocks.sendAdminMetricsReportTest.mockResolvedValue({ outcome });

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ outcome });
    },
  );

  it.each([
    null,
    {},
    { outcome: "delivered" },
    { outcome: "accepted", providerMessageId: "must-not-escape" },
  ])("rejects a malformed or expansive service result: %j", async (result) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendAdminMetricsReportTest.mockResolvedValue(result);

    const response = await POST(request());

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: "test_send_failed" });
    expect(log).toHaveBeenCalledWith(
      "[admin:metrics-report-test-send] invalid service result",
    );
    expect(JSON.stringify(body)).not.toContain("must-not-escape");
  });

  it.each([
    ["config_not_found", 404],
    ["preview_failed", 500],
    ["invalid_snapshot", 500],
  ] as const)("maps safe service error %s", async (code, status) => {
    mocks.sendAdminMetricsReportTest.mockRejectedValue(
      new mocks.TestSendError(code, status),
    );

    const response = await POST(request());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it("logs no recipient or raw provider error for an unknown failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendAdminMetricsReportTest.mockRejectedValue(
      new Error("provider leaked bryan@example.com secret-token"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "test_send_failed" });
    expect(log).toHaveBeenCalledWith(
      "[admin:metrics-report-test-send] request failed",
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain("bryan@example.com");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
  });
});
