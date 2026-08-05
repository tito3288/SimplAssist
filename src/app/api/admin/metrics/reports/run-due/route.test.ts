import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runDueMetricsReports: vi.fn(),
  safeParseSummary: vi.fn(),
}));

vi.mock("@/lib/admin/metricsReportRunner.server", () => ({
  runDueMetricsReports: mocks.runDueMetricsReports,
  metricsReportRunSummarySchema: { safeParse: mocks.safeParseSummary },
}));

import { POST } from "./route";

const SUMMARY = {
  period: "2026-07-01",
  reports: {
    created: 1,
    existing: 0,
    skipped: 0,
    failed: 0,
    remaining: 0,
  },
  deliveries: {
    accepted: 1,
    retryScheduled: 0,
    failed: 0,
    reviewNeeded: 0,
    skipped: 0,
    remaining: 0,
  },
  exhausted: {
    reportBatch: false,
    deliveryBatch: false,
    timeBudget: false,
  },
};

function request(
  authorization = "Bearer metrics-cron-secret",
  body?: Record<string, unknown>,
) {
  return new NextRequest("http://localhost/api/admin/metrics/reports/run-due", {
    method: "POST",
    headers: {
      authorization,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("METRICS_REPORTS_CRON_SECRET", "metrics-cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.runDueMetricsReports.mockResolvedValue(SUMMARY);
  mocks.safeParseSummary.mockImplementation((value: unknown) =>
    JSON.stringify(value) === JSON.stringify(SUMMARY)
      ? { success: true, data: value }
      : { success: false },
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/admin/metrics/reports/run-due", () => {
  it.each([
    ["missing", ""],
    ["wrong", "Bearer wrong-secret"],
    ["wrong scheme", "bearer metrics-cron-secret"],
    ["extra whitespace", "Bearer  metrics-cron-secret"],
  ])("rejects a %s authorization before runner work", async (_label, auth) => {
    const response = await POST(request(auth));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runDueMetricsReports).not.toHaveBeenCalled();
  });

  it("fails closed when the dedicated secret is absent", async () => {
    vi.stubEnv("METRICS_REPORTS_CRON_SECRET", "");

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.runDueMetricsReports).not.toHaveBeenCalled();
  });

  it("does not accept the account-cleanup CRON_SECRET", async () => {
    vi.stubEnv("CRON_SECRET", "shared-cleanup-secret");

    const response = await POST(request("Bearer shared-cleanup-secret"));

    expect(response.status).toBe(401);
    expect(mocks.runDueMetricsReports).not.toHaveBeenCalled();
  });

  it("runs once with no caller-controlled arguments and returns count-only JSON", async () => {
    const response = await POST(
      request("Bearer metrics-cron-secret", {
        period: "1999-01-01",
        deliveryIds: ["attacker-controlled"],
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(SUMMARY);
    expect(mocks.runDueMetricsReports).toHaveBeenCalledOnce();
    expect(mocks.runDueMetricsReports).toHaveBeenCalledWith();
    expect(mocks.safeParseSummary).toHaveBeenCalledWith(SUMMARY);
  });

  it.each([
    ["extra field", { ...SUMMARY, recipient: "admin@example.com" }],
    [
      "malformed count",
      {
        ...SUMMARY,
        deliveries: { ...SUMMARY.deliveries, accepted: -1 },
      },
    ],
  ])(
    "returns a static 500 for a %s in the runner summary",
    async (_label, value) => {
      mocks.runDueMetricsReports.mockResolvedValue(value);

      const response = await POST(request());

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "metrics_report_run_failed",
      });
      expect(console.error).toHaveBeenCalledWith(
        "[metrics-report-runner] run failed",
      );
      expect(console.error).not.toHaveBeenCalledWith(
        expect.stringContaining("admin@example.com"),
      );
    },
  );

  it("returns a safe 500 without logging raw runner errors", async () => {
    mocks.runDueMetricsReports.mockRejectedValue(
      new Error("recipient@example.com frozen payload"),
    );

    const response = await POST(request());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "metrics_report_run_failed",
    });
    expect(console.error).toHaveBeenCalledWith(
      "[metrics-report-runner] run failed",
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.stringContaining("recipient@example.com"),
    );
  });
});
