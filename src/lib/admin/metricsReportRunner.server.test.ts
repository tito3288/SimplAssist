import { beforeEach, describe, expect, it, vi } from "vitest";

const productionMocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  parsePayload: vi.fn((value: unknown) => value),
  render: vi.fn(() => ({
    subject: "Rendered subject",
    text: "Rendered text",
    html: "<p>Rendered HTML</p>",
  })),
  send: vi.fn(async () => ({
    kind: "accepted" as const,
    providerMessageId: "provider-production",
  })),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: { from: productionMocks.from, rpc: productionMocks.rpc },
}));
vi.mock("@/lib/metrics/reportSnapshot", () => ({
  parseMetricsReportPayloadV1: productionMocks.parsePayload,
}));
vi.mock("@/lib/email/metricsReportRenderer", () => ({
  renderMetricsReportEmail: productionMocks.render,
}));
vi.mock("@/lib/email/metricsReportSender", () => ({
  sendMetricsReportEmail: productionMocks.send,
}));

import {
  METRICS_REPORT_BUILD_LIMIT,
  METRICS_REPORT_DELIVERY_LIMIT,
  METRICS_REPORT_PROVIDER_START_SPACING_MS,
  MetricsReportRunnerFatalError,
  createProductionMetricsReportRunnerDependencies,
  metricsReportRunSummarySchema,
  previousMetricsReportPeriodStart,
  runDueMetricsReports,
  type MetricsReportRunnerDependencies,
} from "./metricsReportRunner.server";

const CONFIG_1 = "10000000-0000-4000-a051-000000000001";
const CONFIG_2 = "10000000-0000-4000-a051-000000000002";
const CONFIG_3 = "10000000-0000-4000-a051-000000000003";
const CONFIG_4 = "10000000-0000-4000-a051-000000000004";
const DELIVERY_1 = "20000000-0000-4000-a051-000000000001";
const DELIVERY_2 = "20000000-0000-4000-a051-000000000002";
const REPORT_1 = "30000000-0000-4000-a051-000000000001";
const CLAIM_1 = "40000000-0000-4000-a051-000000000001";
const STARTED_AT = "2026-08-05T12:00:00.000Z";

type Harness = {
  dependencies: MetricsReportRunnerDependencies;
  advance: (milliseconds: number) => void;
  currentTime: () => number;
};

function claimed(deliveryId = DELIVERY_1) {
  return {
    deliveryId,
    reportId: REPORT_1,
    recipient: "admin@example.com",
    snapshotVersion: 1 as const,
    snapshotPayload: { frozen: true },
    attemptCount: 1,
  };
}

function harness(
  overrides: Partial<MetricsReportRunnerDependencies> = {},
): Harness {
  let currentMs = Date.parse(STARTED_AT);
  const advance = (milliseconds: number) => {
    currentMs += milliseconds;
  };

  const dependencies: MetricsReportRunnerDependencies = {
    now: vi.fn(() => new Date(currentMs)),
    sleep: vi.fn(async (milliseconds: number) => {
      advance(milliseconds);
    }),
    randomClaimToken: vi.fn(() => CLAIM_1),
    reconcileExpiredLeases: vi.fn(async () => ({
      reclaimed: 0,
      needsReview: 0,
      remaining: 0,
    })),
    listDueConfigs: vi.fn(async () => ({ ids: [], total: 0 })),
    buildSnapshot: vi.fn(async () => "created" as const),
    listPendingDeliveries: vi.fn(async () => ({ ids: [], total: 0 })),
    claimDelivery: vi.fn(async (deliveryId) => claimed(deliveryId)),
    renderDelivery: vi.fn(() => ({
      subject: "Monthly report",
      text: "Text report",
      html: "<p>HTML report</p>",
    })),
    markSending: vi.fn(async () => true),
    sendDelivery: vi.fn(async () => ({
      kind: "accepted" as const,
      providerMessageId: "resend-message-1",
    })),
    completeDelivery: vi.fn(async () => true),
    releaseDelivery: vi.fn(async () => ({
      status: "pending" as const,
      nextRetryAt: "2026-08-06T00:00:00.000Z",
      attemptCount: 1,
    })),
    markNeedsReview: vi.fn(async () => true),
    ...overrides,
  };
  return { dependencies, advance, currentTime: () => currentMs };
}

function numberedUuid(family: "1" | "2", index: number): string {
  return `${family}0000000-0000-4000-a051-${String(index).padStart(12, "0")}`;
}

function productionQuery(
  result: { data: unknown; error: unknown; count?: number | null },
  calls: Array<[string, ...unknown[]]>,
) {
  const query = {
    select(...args: unknown[]) {
      calls.push(["select", ...args]);
      return query;
    },
    eq(...args: unknown[]) {
      calls.push(["eq", ...args]);
      return query;
    },
    lte(...args: unknown[]) {
      calls.push(["lte", ...args]);
      return query;
    },
    order(...args: unknown[]) {
      calls.push(["order", ...args]);
      return query;
    },
    limit(...args: unknown[]) {
      calls.push(["limit", ...args]);
      return query;
    },
    gt(...args: unknown[]) {
      calls.push(["gt", ...args]);
      return query;
    },
    then(
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
  };
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previousMetricsReportPeriodStart", () => {
  it.each([
    ["2026-08-31T23:59:59.999Z", "2026-07-01"],
    ["2026-01-01T00:00:00.000Z", "2025-12-01"],
    ["2024-03-31T23:00:00-05:00", "2024-03-01"],
  ])("computes the completed UTC month for %s", (now, expected) => {
    expect(previousMetricsReportPeriodStart(new Date(now))).toBe(expected);
  });

  it("rejects an invalid clock", () => {
    expect(() => previousMetricsReportPeriodStart(new Date("invalid"))).toThrow(
      MetricsReportRunnerFatalError,
    );
  });
});

describe("metricsReportRunSummarySchema", () => {
  const validSummary = {
    period: "2026-07-01",
    reports: {
      created: 0,
      existing: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
    },
    deliveries: {
      accepted: 0,
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

  it("accepts only the exact count-only summary", () => {
    expect(metricsReportRunSummarySchema.parse(validSummary)).toEqual(
      validSummary,
    );
  });

  it.each([
    { ...validSummary, recipient: "admin@example.com" },
    {
      ...validSummary,
      reports: { ...validSummary.reports, created: -1 },
    },
    { ...validSummary, period: "2026-07" },
  ])("rejects extra, unsafe or malformed summary data", (value) => {
    expect(metricsReportRunSummarySchema.safeParse(value).success).toBe(false);
  });
});

describe("runDueMetricsReports", () => {
  it("reconciles first, computes the period server-side and queries work in order", async () => {
    const { dependencies } = harness();

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.period).toBe("2026-07-01");
    expect(dependencies.reconcileExpiredLeases).toHaveBeenCalledWith(
      STARTED_AT,
    );
    expect(dependencies.listDueConfigs).toHaveBeenCalledWith(
      "2026-07-01",
      METRICS_REPORT_BUILD_LIMIT,
    );
    expect(dependencies.listPendingDeliveries).toHaveBeenCalledWith(
      STARTED_AT,
      METRICS_REPORT_DELIVERY_LIMIT,
    );
    expect(
      vi.mocked(dependencies.reconcileExpiredLeases).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.listDueConfigs).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(dependencies.listDueConfigs).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.listPendingDeliveries).mock.invocationCallOrder[0],
    );
  });

  it("classifies created, concurrent-existing, not-due and failed builds independently", async () => {
    const { dependencies } = harness({
      listDueConfigs: vi.fn(async () => ({
        ids: [CONFIG_1, CONFIG_2, CONFIG_3, CONFIG_4],
        total: 4,
      })),
      buildSnapshot: vi.fn(async (configId) => {
        if (configId === CONFIG_1) return "created";
        if (configId === CONFIG_2) return "existing";
        if (configId === CONFIG_3) return "not_due";
        throw new Error("private database detail");
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.reports).toEqual({
      created: 1,
      existing: 1,
      skipped: 1,
      failed: 1,
      remaining: 0,
    });
    expect(dependencies.buildSnapshot).toHaveBeenCalledTimes(4);
    expect(dependencies.listPendingDeliveries).toHaveBeenCalledAfter(
      vi.mocked(dependencies.buildSnapshot),
    );
  });

  it("caps snapshot work at 25 and reports the durable remainder", async () => {
    const ids = Array.from(
      { length: METRICS_REPORT_BUILD_LIMIT },
      (_unused, index) => numberedUuid("1", index + 1),
    );
    const { dependencies } = harness({
      listDueConfigs: vi.fn(async () => ({ ids, total: ids.length + 3 })),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.buildSnapshot).toHaveBeenCalledTimes(25);
    expect(summary.reports.remaining).toBe(3);
    expect(summary.exhausted.reportBatch).toBe(true);
  });

  it("stops snapshot creation at the total time budget and still counts pending delivery work", async () => {
    const { dependencies, advance } = harness({
      listDueConfigs: vi.fn(async () => ({
        ids: [CONFIG_1, CONFIG_2, CONFIG_3],
        total: 3,
      })),
      buildSnapshot: vi.fn(async () => {
        advance(10_000);
        return "created" as const;
      }),
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.buildSnapshot).toHaveBeenCalledTimes(2);
    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(summary.reports.remaining).toBe(1);
    expect(summary.deliveries.remaining).toBe(1);
    expect(summary.exhausted.timeBudget).toBe(true);
  });

  it("claims, renders, marks sending, sends, then completes in token order", async () => {
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.accepted).toBe(1);
    expect(dependencies.claimDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      STARTED_AT,
    );
    expect(dependencies.sendDelivery).toHaveBeenCalledWith({
      deliveryId: DELIVERY_1,
      recipient: "admin@example.com",
      message: {
        subject: "Monthly report",
        text: "Text report",
        html: "<p>HTML report</p>",
      },
    });
    expect(dependencies.completeDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "resend-message-1",
      STARTED_AT,
    );
    const ordered = [
      dependencies.claimDelivery,
      dependencies.renderDelivery,
      dependencies.markSending,
      dependencies.sendDelivery,
      dependencies.completeDelivery,
    ].map((mock) => vi.mocked(mock).mock.invocationCallOrder[0]);
    expect(ordered).toEqual([...ordered].sort((left, right) => left - right));
    expect(dependencies.releaseDelivery).not.toHaveBeenCalled();
    expect(dependencies.markNeedsReview).not.toHaveBeenCalled();
  });

  it("resumes a frozen backlog without consulting the config enabled state", async () => {
    const { dependencies } = harness({
      listDueConfigs: vi.fn(async () => ({ ids: [], total: 0 })),
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.accepted).toBe(1);
    expect(dependencies.claimDelivery).toHaveBeenCalledOnce();
  });

  it.each([
    ["pending", 2, "retryScheduled"],
    ["failed", 3, "failed"],
  ] as const)(
    "records a definite no-send release ending in %s",
    async (status, attemptCount, summaryKey) => {
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        sendDelivery: vi.fn(async () => ({
          kind: "definite_no_send" as const,
          errorCode: "provider_rejected",
        })),
        releaseDelivery: vi.fn(async () => ({
          status,
          nextRetryAt: status === "pending" ? "2026-08-06T00:00:00.000Z" : null,
          attemptCount,
        })),
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries[summaryKey]).toBe(1);
      expect(dependencies.releaseDelivery).toHaveBeenCalledWith(
        DELIVERY_1,
        CLAIM_1,
        "provider_rejected",
        STARTED_AT,
      );
      expect(dependencies.completeDelivery).not.toHaveBeenCalled();
    },
  );

  it("releases a render failure before crossing the provider-start boundary", async () => {
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
      renderDelivery: vi.fn(() => {
        throw new Error("snapshot content");
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.retryScheduled).toBe(1);
    expect(dependencies.releaseDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "render_failed",
      STARTED_AT,
    );
    expect(dependencies.markSending).not.toHaveBeenCalled();
    expect(dependencies.sendDelivery).not.toHaveBeenCalled();
  });

  it.each(["ambiguous", "throws", "malformed"] as const)(
    "moves a %s provider outcome to review and never retries it",
    async (outcome) => {
      const sendDelivery = vi.fn(async () => {
        if (outcome === "throws") throw new Error("provider private detail");
        if (outcome === "malformed") {
          return { kind: "accepted", providerMessageId: "" } as never;
        }
        return { kind: "ambiguous" as const };
      });
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        sendDelivery,
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries.reviewNeeded).toBe(1);
      expect(dependencies.markNeedsReview).toHaveBeenCalledWith(
        DELIVERY_1,
        CLAIM_1,
        "provider_outcome_unknown",
      );
      expect(dependencies.releaseDelivery).not.toHaveBeenCalled();
    },
  );

  it.each(["false", "throws"] as const)(
    "counts an ambiguous provider result as skipped when review transition %s",
    async (transition) => {
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        sendDelivery: vi.fn(async () => ({ kind: "ambiguous" as const })),
        markNeedsReview: vi.fn(async () => {
          if (transition === "throws") throw new Error("database detail");
          return false;
        }),
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries.reviewNeeded).toBe(0);
      expect(summary.deliveries.skipped).toBe(1);
      expect(dependencies.releaseDelivery).not.toHaveBeenCalled();
    },
  );

  it.each(["false", "throws"] as const)(
    "marks review when accepted completion %s",
    async (outcome) => {
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        completeDelivery: vi.fn(async () => {
          if (outcome === "throws") throw new Error("database detail");
          return false;
        }),
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries.reviewNeeded).toBe(1);
      expect(dependencies.markNeedsReview).toHaveBeenCalledWith(
        DELIVERY_1,
        CLAIM_1,
        "completion_persist_failed",
      );
    },
  );

  it.each(["false", "throws"] as const)(
    "counts failed accepted-completion review transition %s as skipped",
    async (transition) => {
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        completeDelivery: vi.fn(async () => false),
        markNeedsReview: vi.fn(async () => {
          if (transition === "throws") throw new Error("database detail");
          return false;
        }),
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries.reviewNeeded).toBe(0);
      expect(summary.deliveries.skipped).toBe(1);
    },
  );

  it("falls back to review if a proven-no-send release cannot be persisted", async () => {
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
      sendDelivery: vi.fn(async () => ({
        kind: "definite_no_send" as const,
        errorCode: "provider_rejected",
      })),
      releaseDelivery: vi.fn(async () => {
        throw new Error("private database error");
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.reviewNeeded).toBe(1);
    expect(dependencies.markNeedsReview).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "delivery_transition_failed",
    );
  });

  it.each(["not_claimed", "claim_error", "lost_sending_token"] as const)(
    "skips %s without calling the provider",
    async (outcome) => {
      const { dependencies } = harness({
        listPendingDeliveries: vi.fn(async () => ({
          ids: [DELIVERY_1],
          total: 1,
        })),
        claimDelivery: vi.fn(async () => {
          if (outcome === "claim_error") throw new Error("database detail");
          return outcome === "not_claimed" ? null : claimed();
        }),
        markSending: vi.fn(async () => outcome !== "lost_sending_token"),
      });

      const summary = await runDueMetricsReports(dependencies);

      expect(summary.deliveries.skipped).toBe(1);
      expect(dependencies.sendDelivery).not.toHaveBeenCalled();
    },
  );

  it("releases a thrown sending transition because no provider call occurred", async () => {
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
      markSending: vi.fn(async () => {
        throw new Error("transition response lost");
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.retryScheduled).toBe(1);
    expect(dependencies.releaseDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "sending_transition_failed",
      STARTED_AT,
    );
    expect(dependencies.sendDelivery).not.toHaveBeenCalled();
  });

  it("does not claim when fewer than sixteen seconds remain", async () => {
    const { dependencies, advance } = harness({
      listPendingDeliveries: vi.fn(async () => {
        advance(4_001);
        return { ids: [DELIVERY_1], total: 1 };
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.claimDelivery).not.toHaveBeenCalled();
    expect(summary.deliveries.remaining).toBe(1);
    expect(summary.exhausted.timeBudget).toBe(true);
  });

  it("releases a claim if rendering consumes the provider margin", async () => {
    const { dependencies, advance } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1, DELIVERY_2],
        total: 2,
      })),
      renderDelivery: vi.fn((claim) => {
        if (claim.deliveryId === DELIVERY_1) advance(4_001);
        return {
          subject: "Monthly report",
          text: "Text report",
          html: "<p>HTML report</p>",
        };
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.claimDelivery).toHaveBeenCalledTimes(1);
    expect(dependencies.releaseDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "runner_budget_exhausted",
      "2026-08-05T12:00:04.001Z",
    );
    expect(summary.deliveries.retryScheduled).toBe(1);
    expect(summary.deliveries.remaining).toBe(1);
    expect(summary.exhausted.timeBudget).toBe(true);
  });

  it("releases a sending row when the provider margin expires during the transition", async () => {
    const { dependencies, advance } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
      markSending: vi.fn(async () => {
        advance(4_001);
        return true;
      }),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.markSending).toHaveBeenCalledOnce();
    expect(dependencies.sendDelivery).not.toHaveBeenCalled();
    expect(dependencies.releaseDelivery).toHaveBeenCalledWith(
      DELIVERY_1,
      CLAIM_1,
      "runner_budget_exhausted",
      "2026-08-05T12:00:04.001Z",
    );
    expect(summary.deliveries.retryScheduled).toBe(1);
    expect(summary.exhausted.timeBudget).toBe(true);
  });

  it("keeps at least 500ms between sequential provider starts", async () => {
    const { dependencies, currentTime } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1, DELIVERY_2],
        total: 2,
      })),
    });
    const providerStarts: number[] = [];
    vi.mocked(dependencies.sendDelivery).mockImplementation(async () => {
      providerStarts.push(currentTime());
      return {
        kind: "accepted",
        providerMessageId: `provider-${providerStarts.length}`,
      };
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.accepted).toBe(2);
    expect(providerStarts[1] - providerStarts[0]).toBeGreaterThanOrEqual(
      METRICS_REPORT_PROVIDER_START_SPACING_MS,
    );
    expect(dependencies.sleep).toHaveBeenCalledWith(
      METRICS_REPORT_PROVIDER_START_SPACING_MS,
    );
  });

  it("reports reconciliation review work and unreconciled durable leases", async () => {
    const { dependencies } = harness({
      reconcileExpiredLeases: vi.fn(async () => ({
        reclaimed: 2,
        needsReview: 3,
        remaining: 4,
      })),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(summary.deliveries.reviewNeeded).toBe(3);
    expect(summary.deliveries.remaining).toBe(4);
    expect(summary.exhausted.deliveryBatch).toBe(true);
  });

  it("caps pending candidates at 20 and reports the remaining backlog", async () => {
    const ids = Array.from(
      { length: METRICS_REPORT_DELIVERY_LIMIT },
      (_unused, index) => numberedUuid("2", index + 1),
    );
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids,
        total: ids.length + 7,
      })),
      // Isolate the hard item cap from the independently tested wall-clock
      // spacing/budget behavior.
      sleep: vi.fn(async () => undefined),
    });

    const summary = await runDueMetricsReports(dependencies);

    expect(dependencies.claimDelivery).toHaveBeenCalledTimes(20);
    expect(summary.deliveries.accepted).toBe(20);
    expect(summary.deliveries.remaining).toBe(7);
    expect(summary.exhausted.deliveryBatch).toBe(true);
  });

  it.each(["reconcile", "due_query", "pending_query"] as const)(
    "treats a fatal %s failure as a safe run failure",
    async (failure) => {
      const { dependencies } = harness({
        reconcileExpiredLeases: vi.fn(async () => {
          if (failure === "reconcile") throw new Error("raw detail");
          return { reclaimed: 0, needsReview: 0, remaining: 0 };
        }),
        listDueConfigs: vi.fn(async () => {
          if (failure === "due_query") throw new Error("raw detail");
          return { ids: [], total: 0 };
        }),
        listPendingDeliveries: vi.fn(async () => {
          if (failure === "pending_query") throw new Error("raw detail");
          return { ids: [], total: 0 };
        }),
      });

      await expect(runDueMetricsReports(dependencies)).rejects.toEqual(
        new MetricsReportRunnerFatalError(),
      );
    },
  );

  it("rejects a malformed candidate count before doing item work", async () => {
    const { dependencies } = harness({
      listDueConfigs: vi.fn(async () => ({ ids: [CONFIG_1], total: 0 })),
    });

    await expect(runDueMetricsReports(dependencies)).rejects.toBeInstanceOf(
      MetricsReportRunnerFatalError,
    );
    expect(dependencies.buildSnapshot).not.toHaveBeenCalled();
  });

  it("overlapping invocations cannot send a delivery whose second claim loses", async () => {
    let claimAvailable = true;
    const claimDelivery = vi.fn(async () => {
      if (!claimAvailable) return null;
      claimAvailable = false;
      return claimed();
    });
    const sendDelivery = vi.fn(async () => ({
      kind: "accepted" as const,
      providerMessageId: "provider-once",
    }));
    const { dependencies } = harness({
      listPendingDeliveries: vi.fn(async () => ({
        ids: [DELIVERY_1],
        total: 1,
      })),
      claimDelivery,
      sendDelivery,
    });

    const first = await runDueMetricsReports(dependencies);
    const second = await runDueMetricsReports(dependencies);

    expect(first.deliveries.accepted).toBe(1);
    expect(second.deliveries.skipped).toBe(1);
    expect(sendDelivery).toHaveBeenCalledOnce();
  });
});

describe("production metrics report runner adapter", () => {
  it("queries the oldest eligible pending ledger rows with an exact remaining count", async () => {
    const calls: Array<[string, ...unknown[]]> = [];
    productionMocks.from.mockImplementation((table: string) => {
      expect(table).toBe("metrics_report_deliveries");
      return productionQuery(
        {
          data: [{ id: DELIVERY_1 }, { id: DELIVERY_2 }],
          error: null,
          count: 7,
        },
        calls,
      );
    });
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();

    const pending = await dependencies.listPendingDeliveries(
      STARTED_AT,
      METRICS_REPORT_DELIVERY_LIMIT,
    );

    expect(pending).toEqual({ ids: [DELIVERY_1, DELIVERY_2], total: 7 });
    expect(calls).toEqual([
      ["select", "id", { count: "exact" }],
      ["eq", "status", "pending"],
      ["lte", "retry_after", STARTED_AT],
      ["order", "retry_after", { ascending: true }],
      ["order", "created_at", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["limit", METRICS_REPORT_DELIVERY_LIMIT],
    ]);
  });

  it("derives due configs from enabled/start-gated configs lacking a period report", async () => {
    const configCalls: Array<[string, ...unknown[]]> = [];
    const reportCalls: Array<[string, ...unknown[]]> = [];
    let configPage = 0;
    let reportPage = 0;
    productionMocks.from.mockImplementation((table: string) => {
      if (table === "metrics_report_configs") {
        return productionQuery(
          {
            data:
              configPage++ === 0 ? [{ id: CONFIG_1 }, { id: CONFIG_2 }] : [],
            error: null,
          },
          configCalls,
        );
      }
      if (table === "metrics_reports") {
        return productionQuery(
          {
            data: reportPage++ === 0 ? [{ config_id: CONFIG_2 }] : [],
            error: null,
          },
          reportCalls,
        );
      }
      throw new Error("unexpected table");
    });
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();

    const due = await dependencies.listDueConfigs(
      "2026-07-01",
      METRICS_REPORT_BUILD_LIMIT,
    );

    expect(due).toEqual({ ids: [CONFIG_1], total: 1 });
    expect(configCalls).toEqual([
      ["select", "id"],
      ["eq", "enabled", true],
      ["lte", "reporting_starts_on", "2026-07-01"],
      ["order", "id", { ascending: true }],
      ["limit", 500],
      ["select", "id"],
      ["eq", "enabled", true],
      ["lte", "reporting_starts_on", "2026-07-01"],
      ["order", "id", { ascending: true }],
      ["limit", 500],
      ["gt", "id", CONFIG_2],
    ]);
    expect(reportCalls).toEqual([
      ["select", "config_id"],
      ["eq", "period_start", "2026-07-01"],
      ["order", "config_id", { ascending: true }],
      ["limit", 500],
      ["select", "config_id"],
      ["eq", "period_start", "2026-07-01"],
      ["order", "config_id", { ascending: true }],
      ["limit", 500],
      ["gt", "config_id", CONFIG_2],
    ]);
  });

  it("continues keyset pagination through a server cap below the requested page size", async () => {
    const pages = [
      [{ id: CONFIG_1 }, { id: CONFIG_2 }],
      [{ id: CONFIG_3 }, { id: CONFIG_4 }],
      [],
    ];
    let configPage = 0;
    const configCalls: Array<[string, ...unknown[]]> = [];
    productionMocks.from.mockImplementation((table: string) => {
      if (table === "metrics_report_configs") {
        return productionQuery(
          { data: pages[configPage++] ?? [], error: null },
          configCalls,
        );
      }
      if (table === "metrics_reports") {
        return productionQuery({ data: [], error: null }, []);
      }
      throw new Error("unexpected table");
    });
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();

    const due = await dependencies.listDueConfigs(
      "2026-07-01",
      METRICS_REPORT_BUILD_LIMIT,
    );

    expect(due).toEqual({
      ids: [CONFIG_1, CONFIG_2, CONFIG_3, CONFIG_4],
      total: 4,
    });
    expect(configPage).toBe(3);
    expect(configCalls).toContainEqual(["gt", "id", CONFIG_2]);
    expect(configCalls).toContainEqual(["gt", "id", CONFIG_4]);
  });

  it("uses the exact 051 RPC signatures and strictly maps their results", async () => {
    productionMocks.rpc.mockImplementation(
      async (name: string, args: Record<string, unknown>) => {
        if (name === "reconcile_expired_metrics_report_delivery_leases_v1") {
          return {
            data: { reclaimed: 1, needs_review: 2, remaining: 3 },
            error: null,
          };
        }
        if (name === "build_metrics_report_snapshot_v1") {
          return {
            data: [{ report_id: REPORT_1, outcome: "created" }],
            error: null,
          };
        }
        if (name === "claim_metrics_report_delivery_v1") {
          return {
            data: [
              {
                delivery_id: DELIVERY_1,
                report_id: REPORT_1,
                recipient: "admin@example.com",
                snapshot_version: 1,
                snapshot_payload: { frozen: true },
                attempt_count: 1,
              },
            ],
            error: null,
          };
        }
        if (name === "release_metrics_report_delivery_v1") {
          return {
            data: [
              {
                delivery_status: "pending",
                next_retry_at: "2026-08-06T00:00:00.000Z",
                attempt_count: 1,
              },
            ],
            error: null,
          };
        }
        expect(args).toBeTypeOf("object");
        return { data: true, error: null };
      },
    );
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();

    await expect(
      dependencies.reconcileExpiredLeases(STARTED_AT),
    ).resolves.toEqual({ reclaimed: 1, needsReview: 2, remaining: 3 });
    await expect(
      dependencies.buildSnapshot(CONFIG_1, "2026-07-01"),
    ).resolves.toBe("created");
    await expect(
      dependencies.claimDelivery(DELIVERY_1, CLAIM_1, STARTED_AT),
    ).resolves.toMatchObject({
      deliveryId: DELIVERY_1,
      recipient: "admin@example.com",
      snapshotVersion: 1,
    });
    await expect(
      dependencies.markSending(DELIVERY_1, CLAIM_1, STARTED_AT),
    ).resolves.toBe(true);
    await expect(
      dependencies.completeDelivery(
        DELIVERY_1,
        CLAIM_1,
        "provider-production",
        STARTED_AT,
      ),
    ).resolves.toBe(true);
    await expect(
      dependencies.releaseDelivery(
        DELIVERY_1,
        CLAIM_1,
        "provider_rejected",
        STARTED_AT,
      ),
    ).resolves.toMatchObject({ status: "pending", attemptCount: 1 });
    await expect(
      dependencies.markNeedsReview(
        DELIVERY_1,
        CLAIM_1,
        "provider_outcome_unknown",
      ),
    ).resolves.toBe(true);

    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "reconcile_expired_metrics_report_delivery_leases_v1",
      { p_limit: 500, p_now: STARTED_AT },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "build_metrics_report_snapshot_v1",
      { p_config_id: CONFIG_1, p_period_start: "2026-07-01" },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "claim_metrics_report_delivery_v1",
      {
        p_delivery_id: DELIVERY_1,
        p_claim_token: CLAIM_1,
        p_now: STARTED_AT,
      },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "mark_metrics_report_delivery_sending_v1",
      {
        p_delivery_id: DELIVERY_1,
        p_claim_token: CLAIM_1,
        p_now: STARTED_AT,
      },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "complete_metrics_report_delivery_v1",
      {
        p_delivery_id: DELIVERY_1,
        p_claim_token: CLAIM_1,
        p_provider_message_id: "provider-production",
        p_accepted_at: STARTED_AT,
      },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "release_metrics_report_delivery_v1",
      {
        p_delivery_id: DELIVERY_1,
        p_claim_token: CLAIM_1,
        p_error_code: "provider_rejected",
        p_now: STARTED_AT,
      },
    );
    expect(productionMocks.rpc).toHaveBeenCalledWith(
      "mark_metrics_report_delivery_needs_review_v1",
      {
        p_delivery_id: DELIVERY_1,
        p_claim_token: CLAIM_1,
        p_error_code: "provider_outcome_unknown",
      },
    );
  });

  it("rejects a claim response that echoes a different delivery identity", async () => {
    productionMocks.rpc.mockResolvedValue({
      data: [
        {
          delivery_id: DELIVERY_2,
          report_id: REPORT_1,
          recipient: "admin@example.com",
          snapshot_version: 1,
          snapshot_payload: { frozen: true },
          attempt_count: 1,
        },
      ],
      error: null,
    });
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();

    await expect(
      dependencies.claimDelivery(DELIVERY_1, CLAIM_1, STARTED_AT),
    ).rejects.toThrow("delivery_claim_failed");
  });

  it("passes parsed content while the frozen recipient overrides any runtime message to field", async () => {
    const dependencies =
      await createProductionMetricsReportRunnerDependencies();
    const claim = claimed();

    const message = dependencies.renderDelivery(claim);
    const forgedMessage = { ...message, to: "attacker@example.com" };
    await dependencies.sendDelivery({
      deliveryId: claim.deliveryId,
      recipient: claim.recipient,
      message: forgedMessage,
    });

    expect(productionMocks.parsePayload).toHaveBeenCalledWith(
      claim.snapshotPayload,
    );
    expect(productionMocks.render).toHaveBeenCalledWith(claim.snapshotPayload, {
      test: false,
    });
    expect(productionMocks.send).toHaveBeenCalledWith({
      deliveryId: DELIVERY_1,
      message: {
        to: "admin@example.com",
        subject: "Rendered subject",
        text: "Rendered text",
        html: "<p>Rendered HTML</p>",
      },
    });
  });
});
