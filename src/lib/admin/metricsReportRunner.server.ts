import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";

export const METRICS_REPORT_RUN_BUDGET_MS = 20_000;
export const METRICS_REPORT_PROVIDER_START_MARGIN_MS = 16_000;
export const METRICS_REPORT_PROVIDER_START_SPACING_MS = 500;
export const METRICS_REPORT_BUILD_LIMIT = 25;
export const METRICS_REPORT_DELIVERY_LIMIT = 20;
export const METRICS_REPORT_RECONCILE_LIMIT = 500;
const QUERY_PAGE_SIZE = 500;

const canonicalUuidSchema = z
  .string()
  .uuid()
  .refine((value) => value === value.toLowerCase());
const finiteTimestampSchema = z.string().datetime({ offset: true });
const safeErrorCodeSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
  .max(64);
const safeCountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const reconcileResultSchema = z
  .object({
    reclaimed: safeCountSchema,
    needs_review: safeCountSchema,
    remaining: safeCountSchema,
  })
  .strict();
const buildResultSchema = z
  .array(
    z
      .object({
        report_id: canonicalUuidSchema.nullable(),
        outcome: z.enum(["created", "existing", "not_due"]),
      })
      .strict()
      .superRefine((result, context) => {
        if ((result.outcome === "not_due") !== (result.report_id === null)) {
          context.addIssue({
            code: "custom",
            message: "Snapshot build outcome is inconsistent",
          });
        }
      }),
  )
  .length(1);
const claimResultSchema = z
  .array(
    z
      .object({
        delivery_id: canonicalUuidSchema,
        report_id: canonicalUuidSchema,
        recipient: z.string().min(1).max(254),
        snapshot_version: z.literal(1),
        snapshot_payload: z.unknown(),
        attempt_count: z.number().int().min(1).max(3),
      })
      .strict(),
  )
  .max(1);
const releaseResultSchema = z
  .array(
    z
      .object({
        delivery_status: z.enum(["pending", "failed"]),
        next_retry_at: finiteTimestampSchema.nullable(),
        attempt_count: z.number().int().min(1).max(3),
      })
      .strict()
      .superRefine((result, context) => {
        if (
          (result.delivery_status === "pending" &&
            result.next_retry_at === null) ||
          (result.delivery_status === "failed" && result.next_retry_at !== null)
        ) {
          context.addIssue({
            code: "custom",
            message: "Delivery release outcome is inconsistent",
          });
        }
      }),
  )
  .max(1);
const candidateRowSchema = z.object({ id: canonicalUuidSchema }).strict();
const reportConfigRowSchema = z.object({ id: canonicalUuidSchema }).strict();
const existingReportRowSchema = z
  .object({ config_id: canonicalUuidSchema })
  .strict();
const emailMessageSchema = z
  .object({
    subject: z.string().min(1),
    text: z.string().min(1),
    html: z.string().min(1),
  })
  .strict();
const senderResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("accepted"),
      providerMessageId: z.string().trim().min(1).max(255),
    })
    .strict(),
  z
    .object({
      kind: z.literal("definite_no_send"),
      errorCode: safeErrorCodeSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ambiguous"),
      errorCode: safeErrorCodeSchema.optional(),
    })
    .strict(),
]);

type QueryResult = { data: unknown; error: unknown; count?: number | null };
type CandidateBatch = { ids: string[]; total: number };
type ReconcileResult = {
  reclaimed: number;
  needsReview: number;
  remaining: number;
};
type BuildOutcome = "created" | "existing" | "not_due";
type ClaimedDelivery = {
  deliveryId: string;
  reportId: string;
  recipient: string;
  snapshotVersion: 1;
  snapshotPayload: unknown;
  attemptCount: number;
};
type ReleaseOutcome = {
  status: "pending" | "failed";
  nextRetryAt: string | null;
  attemptCount: number;
} | null;
type EmailMessage = z.infer<typeof emailMessageSchema>;
type SenderResult = z.infer<typeof senderResultSchema>;

export interface MetricsReportRunnerDependencies {
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  randomClaimToken: () => string;
  reconcileExpiredLeases: (now: string) => Promise<ReconcileResult>;
  listDueConfigs: (
    periodStart: string,
    limit: number,
  ) => Promise<CandidateBatch>;
  buildSnapshot: (
    configId: string,
    periodStart: string,
  ) => Promise<BuildOutcome>;
  listPendingDeliveries: (
    now: string,
    limit: number,
  ) => Promise<CandidateBatch>;
  claimDelivery: (
    deliveryId: string,
    claimToken: string,
    now: string,
  ) => Promise<ClaimedDelivery | null>;
  renderDelivery: (claim: ClaimedDelivery) => EmailMessage;
  markSending: (
    deliveryId: string,
    claimToken: string,
    now: string,
  ) => Promise<boolean>;
  sendDelivery: (input: {
    deliveryId: string;
    recipient: string;
    message: EmailMessage;
  }) => Promise<SenderResult>;
  completeDelivery: (
    deliveryId: string,
    claimToken: string,
    providerMessageId: string,
    acceptedAt: string,
  ) => Promise<boolean>;
  releaseDelivery: (
    deliveryId: string,
    claimToken: string,
    errorCode: string,
    now: string,
  ) => Promise<ReleaseOutcome>;
  markNeedsReview: (
    deliveryId: string,
    claimToken: string,
    errorCode: string,
  ) => Promise<boolean>;
}

export const metricsReportRunSummarySchema = z
  .object({
    period: z.string().regex(/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])-01$/),
    reports: z
      .object({
        created: safeCountSchema,
        existing: safeCountSchema,
        skipped: safeCountSchema,
        failed: safeCountSchema,
        remaining: safeCountSchema,
      })
      .strict(),
    deliveries: z
      .object({
        accepted: safeCountSchema,
        retryScheduled: safeCountSchema,
        failed: safeCountSchema,
        reviewNeeded: safeCountSchema,
        skipped: safeCountSchema,
        remaining: safeCountSchema,
      })
      .strict(),
    exhausted: z
      .object({
        reportBatch: z.boolean(),
        deliveryBatch: z.boolean(),
        timeBudget: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type MetricsReportRunSummary = z.infer<
  typeof metricsReportRunSummarySchema
>;

export class MetricsReportRunnerFatalError extends Error {
  constructor() {
    super("metrics_report_run_failed");
    this.name = "MetricsReportRunnerFatalError";
  }
}

/** Returns the first UTC date of the most recently completed month. */
export function previousMetricsReportPeriodStart(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new MetricsReportRunnerFatalError();
  }
  const period = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  return `${period.getUTCFullYear()}-${String(period.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export async function runDueMetricsReports(
  dependencies?: MetricsReportRunnerDependencies,
): Promise<MetricsReportRunSummary> {
  let runner = dependencies;
  if (!runner) {
    try {
      runner = await createProductionMetricsReportRunnerDependencies();
    } catch {
      throw new MetricsReportRunnerFatalError();
    }
  }

  const startedAt = runner.now();
  const startedAtMs = startedAt.getTime();
  const period = previousMetricsReportPeriodStart(startedAt);
  const summary: MetricsReportRunSummary = {
    period,
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

  const elapsed = () => runner.now().getTime() - startedAtMs;
  const remainingBudget = () => METRICS_REPORT_RUN_BUDGET_MS - elapsed();

  let reconciliation: ReconcileResult;
  try {
    reconciliation = await runner.reconcileExpiredLeases(
      runner.now().toISOString(),
    );
  } catch {
    throw new MetricsReportRunnerFatalError();
  }
  summary.deliveries.reviewNeeded += reconciliation.needsReview;

  let due: CandidateBatch;
  try {
    due = validateCandidateBatch(
      await runner.listDueConfigs(period, METRICS_REPORT_BUILD_LIMIT),
      METRICS_REPORT_BUILD_LIMIT,
    );
  } catch {
    throw new MetricsReportRunnerFatalError();
  }
  summary.exhausted.reportBatch = due.total > METRICS_REPORT_BUILD_LIMIT;

  let reportCandidatesProcessed = 0;
  for (const configId of due.ids) {
    if (elapsed() >= METRICS_REPORT_RUN_BUDGET_MS) {
      summary.exhausted.timeBudget = true;
      break;
    }
    reportCandidatesProcessed += 1;
    try {
      const outcome = await runner.buildSnapshot(configId, period);
      if (outcome === "created") summary.reports.created += 1;
      else if (outcome === "existing") summary.reports.existing += 1;
      else summary.reports.skipped += 1;
    } catch {
      summary.reports.failed += 1;
    }
  }
  summary.reports.remaining = Math.max(
    due.total - reportCandidatesProcessed,
    0,
  );

  let pending: CandidateBatch;
  try {
    pending = validateCandidateBatch(
      await runner.listPendingDeliveries(
        runner.now().toISOString(),
        METRICS_REPORT_DELIVERY_LIMIT,
      ),
      METRICS_REPORT_DELIVERY_LIMIT,
    );
  } catch {
    throw new MetricsReportRunnerFatalError();
  }
  summary.exhausted.deliveryBatch =
    pending.total > METRICS_REPORT_DELIVERY_LIMIT ||
    reconciliation.remaining > 0;

  let deliveryCandidatesProcessed = 0;
  let lastProviderStartedAtMs: number | null = null;
  for (const deliveryId of pending.ids) {
    const spacingDelay =
      lastProviderStartedAtMs === null
        ? 0
        : Math.max(
            0,
            METRICS_REPORT_PROVIDER_START_SPACING_MS -
              (runner.now().getTime() - lastProviderStartedAtMs),
          );
    if (
      remainingBudget() <
      METRICS_REPORT_PROVIDER_START_MARGIN_MS + spacingDelay
    ) {
      summary.exhausted.timeBudget = true;
      break;
    }
    if (spacingDelay > 0) await runner.sleep(spacingDelay);
    if (remainingBudget() < METRICS_REPORT_PROVIDER_START_MARGIN_MS) {
      summary.exhausted.timeBudget = true;
      break;
    }

    deliveryCandidatesProcessed += 1;
    const claimToken = runner.randomClaimToken();
    let claim: ClaimedDelivery | null;
    try {
      claim = await runner.claimDelivery(
        deliveryId,
        claimToken,
        runner.now().toISOString(),
      );
    } catch {
      summary.deliveries.skipped += 1;
      continue;
    }
    if (!claim) {
      summary.deliveries.skipped += 1;
      continue;
    }

    let message: EmailMessage;
    try {
      message = emailMessageSchema.parse(runner.renderDelivery(claim));
    } catch {
      await settleProvenNoSend(
        runner,
        claim,
        claimToken,
        "render_failed",
        summary,
      );
      continue;
    }

    if (remainingBudget() < METRICS_REPORT_PROVIDER_START_MARGIN_MS) {
      summary.exhausted.timeBudget = true;
      await settleProvenNoSend(
        runner,
        claim,
        claimToken,
        "runner_budget_exhausted",
        summary,
      );
      break;
    }

    let markedSending = false;
    try {
      markedSending = await runner.markSending(
        claim.deliveryId,
        claimToken,
        runner.now().toISOString(),
      );
    } catch {
      await settleProvenNoSend(
        runner,
        claim,
        claimToken,
        "sending_transition_failed",
        summary,
      );
      continue;
    }
    if (!markedSending) {
      summary.deliveries.skipped += 1;
      continue;
    }

    const providerStartedAtMs = runner.now().getTime();
    if (
      METRICS_REPORT_RUN_BUDGET_MS - (providerStartedAtMs - startedAtMs) <
      METRICS_REPORT_PROVIDER_START_MARGIN_MS
    ) {
      summary.exhausted.timeBudget = true;
      await settleProvenNoSend(
        runner,
        claim,
        claimToken,
        "runner_budget_exhausted",
        summary,
      );
      break;
    }

    lastProviderStartedAtMs = providerStartedAtMs;
    let sendResult: SenderResult;
    try {
      const rawResult = await runner.sendDelivery({
        deliveryId: claim.deliveryId,
        recipient: claim.recipient,
        message,
      });
      const parsed = senderResultSchema.safeParse(rawResult);
      sendResult = parsed.success
        ? parsed.data
        : { kind: "ambiguous", errorCode: "provider_outcome_unknown" };
    } catch {
      sendResult = {
        kind: "ambiguous",
        errorCode: "provider_outcome_unknown",
      };
    }

    if (sendResult.kind === "definite_no_send") {
      await settleProvenNoSend(
        runner,
        claim,
        claimToken,
        sendResult.errorCode,
        summary,
      );
      continue;
    }

    if (sendResult.kind === "ambiguous") {
      await settleNeedsReview(
        runner,
        claim,
        claimToken,
        sendResult.errorCode ?? "provider_outcome_unknown",
        summary,
      );
      continue;
    }

    let completed = false;
    try {
      completed = await runner.completeDelivery(
        claim.deliveryId,
        claimToken,
        sendResult.providerMessageId,
        runner.now().toISOString(),
      );
    } catch {
      completed = false;
    }
    if (completed) {
      summary.deliveries.accepted += 1;
    } else {
      await settleNeedsReview(
        runner,
        claim,
        claimToken,
        "completion_persist_failed",
        summary,
      );
    }
  }

  summary.deliveries.remaining =
    reconciliation.remaining +
    Math.max(pending.total - deliveryCandidatesProcessed, 0);
  return summary;
}

async function settleProvenNoSend(
  runner: MetricsReportRunnerDependencies,
  claim: ClaimedDelivery,
  claimToken: string,
  errorCode: string,
  summary: MetricsReportRunSummary,
): Promise<void> {
  try {
    const released = await runner.releaseDelivery(
      claim.deliveryId,
      claimToken,
      safeErrorCode(errorCode, "provider_no_send"),
      runner.now().toISOString(),
    );
    if (released?.status === "pending") {
      summary.deliveries.retryScheduled += 1;
      return;
    }
    if (released?.status === "failed") {
      summary.deliveries.failed += 1;
      return;
    }
  } catch {
    // A token-owned review transition below preserves any row whose release
    // failed before committing. A lost response may instead leave it pending.
  }

  try {
    if (
      await runner.markNeedsReview(
        claim.deliveryId,
        claimToken,
        "delivery_transition_failed",
      )
    ) {
      summary.deliveries.reviewNeeded += 1;
      return;
    }
  } catch {
    // The lease remains authoritative; a later reconciliation is fail-safe.
  }
  summary.deliveries.skipped += 1;
}

async function settleNeedsReview(
  runner: MetricsReportRunnerDependencies,
  claim: ClaimedDelivery,
  claimToken: string,
  errorCode: string,
  summary: MetricsReportRunSummary,
): Promise<void> {
  let marked = false;
  try {
    marked = await runner.markNeedsReview(
      claim.deliveryId,
      claimToken,
      safeErrorCode(errorCode, "provider_outcome_unknown"),
    );
  } catch {
    // A sending lease that cannot be transitioned here is reconciled into
    // needs_review after expiry; it must never be automatically retried.
  }
  if (marked) summary.deliveries.reviewNeeded += 1;
  else summary.deliveries.skipped += 1;
}

function safeErrorCode(value: string, fallback: string): string {
  return safeErrorCodeSchema.safeParse(value).success ? value : fallback;
}

function validateCandidateBatch(
  batch: CandidateBatch,
  limit: number,
): CandidateBatch {
  if (
    !Number.isSafeInteger(batch.total) ||
    batch.total < 0 ||
    batch.ids.length > limit ||
    batch.total < batch.ids.length ||
    new Set(batch.ids).size !== batch.ids.length ||
    batch.ids.some((id) => !canonicalUuidSchema.safeParse(id).success)
  ) {
    throw new MetricsReportRunnerFatalError();
  }
  return batch;
}

export async function createProductionMetricsReportRunnerDependencies(): Promise<MetricsReportRunnerDependencies> {
  const [adminModule, snapshotModule, rendererModule, senderModule] =
    await Promise.all([
      import("@/lib/supabase/admin"),
      import("@/lib/metrics/reportSnapshot"),
      import("@/lib/email/metricsReportRenderer"),
      import("@/lib/email/metricsReportSender"),
    ]);
  const { supabaseAdmin } = adminModule;

  return {
    now: () => new Date(),
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    randomClaimToken: randomUUID,
    async reconcileExpiredLeases(now) {
      const result = await supabaseAdmin.rpc(
        "reconcile_expired_metrics_report_delivery_leases_v1",
        { p_limit: METRICS_REPORT_RECONCILE_LIMIT, p_now: now },
      );
      if (result.error) throw new MetricsReportRunnerFatalError();
      const parsed = reconcileResultSchema.safeParse(result.data);
      if (!parsed.success) throw new MetricsReportRunnerFatalError();
      return {
        reclaimed: parsed.data.reclaimed,
        needsReview: parsed.data.needs_review,
        remaining: parsed.data.remaining,
      };
    },
    async listDueConfigs(periodStart, limit) {
      const [configIds, existingConfigIds] = await Promise.all([
        loadAllKeysetRows(reportConfigRowSchema, "id", async (afterId) => {
          let query = supabaseAdmin
            .from("metrics_report_configs")
            .select("id")
            .eq("enabled", true)
            .lte("reporting_starts_on", periodStart)
            .order("id", { ascending: true })
            .limit(QUERY_PAGE_SIZE);
          if (afterId !== null) query = query.gt("id", afterId);
          return await query;
        }),
        loadAllKeysetRows(
          existingReportRowSchema,
          "config_id",
          async (afterId) => {
            let query = supabaseAdmin
              .from("metrics_reports")
              .select("config_id")
              .eq("period_start", periodStart)
              .order("config_id", { ascending: true })
              .limit(QUERY_PAGE_SIZE);
            if (afterId !== null) query = query.gt("config_id", afterId);
            return await query;
          },
        ),
      ]);
      const existing = new Set(
        existingConfigIds.map((report) => report.config_id),
      );
      const dueIds = configIds
        .map((config) => config.id)
        .filter((configId) => !existing.has(configId));
      return { ids: dueIds.slice(0, limit), total: dueIds.length };
    },
    async buildSnapshot(configId, periodStart) {
      const result = await supabaseAdmin.rpc(
        "build_metrics_report_snapshot_v1",
        { p_config_id: configId, p_period_start: periodStart },
      );
      if (result.error) throw new Error("snapshot_build_failed");
      const parsed = buildResultSchema.safeParse(result.data);
      if (!parsed.success) throw new Error("snapshot_build_failed");
      return parsed.data[0].outcome;
    },
    async listPendingDeliveries(now, limit) {
      const result = await supabaseAdmin
        .from("metrics_report_deliveries")
        .select("id", { count: "exact" })
        .eq("status", "pending")
        .lte("retry_after", now)
        .order("retry_after", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(limit);
      if (result.error || result.count === null) {
        throw new MetricsReportRunnerFatalError();
      }
      const parsed = z.array(candidateRowSchema).safeParse(result.data);
      if (!parsed.success) throw new MetricsReportRunnerFatalError();
      return {
        ids: parsed.data.map((delivery) => delivery.id),
        total: result.count,
      };
    },
    async claimDelivery(deliveryId, claimToken, now) {
      const result = await supabaseAdmin.rpc(
        "claim_metrics_report_delivery_v1",
        {
          p_delivery_id: deliveryId,
          p_claim_token: claimToken,
          p_now: now,
        },
      );
      if (result.error) throw new Error("delivery_claim_failed");
      const parsed = claimResultSchema.safeParse(result.data);
      if (!parsed.success) throw new Error("delivery_claim_failed");
      const claim = parsed.data[0];
      if (claim && claim.delivery_id !== deliveryId) {
        throw new Error("delivery_claim_failed");
      }
      return claim
        ? {
            deliveryId: claim.delivery_id,
            reportId: claim.report_id,
            recipient: claim.recipient,
            snapshotVersion: claim.snapshot_version,
            snapshotPayload: claim.snapshot_payload,
            attemptCount: claim.attempt_count,
          }
        : null;
    },
    renderDelivery(claim) {
      const payload = snapshotModule.parseMetricsReportPayloadV1(
        claim.snapshotPayload,
      );
      return rendererModule.renderMetricsReportEmail(payload, { test: false });
    },
    async markSending(deliveryId, claimToken, now) {
      return await booleanRpc(
        supabaseAdmin,
        "mark_metrics_report_delivery_sending_v1",
        {
          p_delivery_id: deliveryId,
          p_claim_token: claimToken,
          p_now: now,
        },
      );
    },
    async sendDelivery({ deliveryId, recipient, message }) {
      return await senderModule.sendMetricsReportEmail({
        deliveryId,
        message: {
          to: recipient,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
      });
    },
    async completeDelivery(
      deliveryId,
      claimToken,
      providerMessageId,
      acceptedAt,
    ) {
      return await booleanRpc(
        supabaseAdmin,
        "complete_metrics_report_delivery_v1",
        {
          p_delivery_id: deliveryId,
          p_claim_token: claimToken,
          p_provider_message_id: providerMessageId,
          p_accepted_at: acceptedAt,
        },
      );
    },
    async releaseDelivery(deliveryId, claimToken, errorCode, now) {
      const result = await supabaseAdmin.rpc(
        "release_metrics_report_delivery_v1",
        {
          p_delivery_id: deliveryId,
          p_claim_token: claimToken,
          p_error_code: errorCode,
          p_now: now,
        },
      );
      if (result.error) throw new Error("delivery_release_failed");
      const parsed = releaseResultSchema.safeParse(result.data);
      if (!parsed.success) throw new Error("delivery_release_failed");
      const release = parsed.data[0];
      return release
        ? {
            status: release.delivery_status,
            nextRetryAt: release.next_retry_at,
            attemptCount: release.attempt_count,
          }
        : null;
    },
    async markNeedsReview(deliveryId, claimToken, errorCode) {
      return await booleanRpc(
        supabaseAdmin,
        "mark_metrics_report_delivery_needs_review_v1",
        {
          p_delivery_id: deliveryId,
          p_claim_token: claimToken,
          p_error_code: errorCode,
        },
      );
    },
  };
}

async function booleanRpc(
  client: typeof import("@/lib/supabase/admin").supabaseAdmin,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const result = await client.rpc(name, args);
  if (result.error || typeof result.data !== "boolean") {
    throw new Error("delivery_transition_failed");
  }
  return result.data;
}

async function loadAllKeysetRows<T extends Record<string, unknown>>(
  schema: z.ZodType<T>,
  key: keyof T & string,
  loadPage: (afterId: string | null) => Promise<QueryResult>,
): Promise<T[]> {
  const rows: T[] = [];
  let afterId: string | null = null;
  for (;;) {
    const result = await loadPage(afterId);
    if (result.error) throw new MetricsReportRunnerFatalError();
    const parsed = z.array(schema).safeParse(result.data);
    if (!parsed.success || parsed.data.length > QUERY_PAGE_SIZE) {
      throw new MetricsReportRunnerFatalError();
    }
    for (const row of parsed.data) {
      const rowId = row[key];
      if (typeof rowId !== "string" || (afterId !== null && rowId <= afterId)) {
        throw new MetricsReportRunnerFatalError();
      }
      rows.push(row);
      afterId = rowId;
    }
    if (parsed.data.length === 0) return rows;
  }
}
