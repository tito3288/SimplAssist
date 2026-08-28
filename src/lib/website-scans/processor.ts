import {
  SCAN_DEADLINE_MS,
  SCAN_LEASE_SECONDS,
  type WebsiteScanClaim,
  type WebsiteScanPage,
} from "./domain";
import {
  prepareWebsiteScanPages,
  WebsiteCrawlError,
  type WebsiteCrawlProvider,
} from "./firecrawlProvider";
import {
  WebsiteExtractionError,
  type WebsiteKnowledgeExtractor,
} from "./extraction";
import {
  WebsiteScanLeaseLostError,
  type WebsiteScanProgressUpdate,
  type WebsiteScanRepository,
} from "./repository";

const POLL_INTERVAL_MS = 2_000;
const HEARTBEAT_INTERVAL_MS = 30_000;

export interface WebsiteScanProcessorOptions {
  repository: WebsiteScanRepository;
  provider: WebsiteCrawlProvider;
  extractor: WebsiteKnowledgeExtractor;
  deadlineMs?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  leaseSeconds?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export class WebsiteScanProcessor {
  private readonly repository: WebsiteScanRepository;
  private readonly provider: WebsiteCrawlProvider;
  private readonly extractor: WebsiteKnowledgeExtractor;
  private readonly deadlineMs: number;
  private readonly pollIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly leaseSeconds: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  constructor(options: WebsiteScanProcessorOptions) {
    this.repository = options.repository;
    this.provider = options.provider;
    this.extractor = options.extractor;
    this.deadlineMs = options.deadlineMs ?? SCAN_DEADLINE_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.leaseSeconds = options.leaseSeconds ?? SCAN_LEASE_SECONDS;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.logger = options.logger ?? console;
  }

  async process(claim: WebsiteScanClaim, shutdownSignal?: AbortSignal): Promise<void> {
    const persistedStart = claim.startedAt ? Date.parse(claim.startedAt) : Number.NaN;
    const deadline =
      (Number.isFinite(persistedStart) ? persistedStart : this.now()) + this.deadlineMs;
    const heartbeat = new ClaimHeartbeat(
      this.repository,
      claim,
      this.leaseSeconds,
      this.heartbeatIntervalMs
    );
    heartbeat.start();

    let providerJobId = claim.providerJobId;
    let providerJobAttempt = claim.providerJobAttempt;
    try {
      this.assertRunning(claim, deadline, heartbeat, shutdownSignal);
      if (claim.cancelRequestedAt || (await this.repository.isCancellationRequested(claim))) {
        throw new WebsiteScanCancelledError();
      }

      const baseline = await this.repository.loadBaseline(claim);
      if (!providerJobId) {
        await this.persistProgress(claim, {
          status: "discovering",
          providerJobId: null,
          providerJobAttempt,
          pagesDiscovered: 0,
          pagesCompleted: 0,
          pagesFailed: 0,
          creditsUsed: 0,
        });
        const started = await this.beforeDeadline(
          this.provider.start(claim.sourceUrl),
          deadline,
          "provider_start_timeout"
        );
        providerJobId = started.jobId;
        providerJobAttempt += 1;
        await this.persistProgress(claim, {
          status: "crawling",
          providerJobId,
          providerJobAttempt,
          pagesDiscovered: 0,
          pagesCompleted: 0,
          pagesFailed: 0,
          creditsUsed: 0,
        });
      }

      let pages: WebsiteScanPage[] = [];
      let failedUrls: string[] = [];
      let failedCount = 0;
      let jobFailed = false;
      let total = claim.pagesDiscovered;
      let creditsUsed = claim.creditsUsed;
      providerAttempts: while (true) {
        const pageMap = new Map<string, WebsiteScanPage>();
        jobFailed = false;
        while (true) {
          this.assertRunning(claim, deadline, heartbeat, shutdownSignal);
          if (await this.repository.isCancellationRequested(claim)) {
            throw new WebsiteScanCancelledError();
          }

          const progress = await this.beforeDeadline(
            this.provider.status(providerJobId, claim.sourceUrl),
            deadline,
            "provider_status_timeout"
          );
          total = progress.total;
          creditsUsed = progress.creditsUsed;
          for (const page of progress.pages) pageMap.set(page.url, page);
          await this.persistProgress(claim, {
            status: "crawling",
            providerJobId,
            providerJobAttempt,
            pagesDiscovered: total,
            pagesCompleted: progress.completed,
            pagesFailed: 0,
            creditsUsed,
          });

          if (progress.status === "completed") break;
          if (progress.status === "failed") {
            jobFailed = true;
            break;
          }
          if (progress.status === "cancelled") {
            throw new WebsiteCrawlError(
              "provider_cancelled",
              "The website crawl was interrupted",
              true
            );
          }
          await this.sleep(this.pollIntervalMs);
        }

        this.assertRunning(claim, deadline, heartbeat, shutdownSignal);
        const retried = await this.beforeDeadline(
          this.provider.retryFailedPages(providerJobId, claim.sourceUrl, new Set(pageMap.keys())),
          deadline,
          "provider_retry_timeout"
        );
        for (const page of retried.pages) pageMap.set(page.url, page);
        pages = prepareWebsiteScanPages(Array.from(pageMap.values()));
        failedUrls = retried.failedUrls;
        failedCount = retried.failedCount;

        // A provider job can fail before producing any page. Start and persist
        // a replacement job (up to three provider attempts) so a lease takeover
        // can resume that exact replacement instead of polling a dead job.
        if (pages.length === 0 && jobFailed && providerJobAttempt < 3) {
          const replacement = await this.beforeDeadline(
            this.provider.start(claim.sourceUrl),
            deadline,
            "provider_restart_timeout"
          );
          providerJobId = replacement.jobId;
          providerJobAttempt += 1;
          await this.persistProgress(claim, {
            status: "crawling",
            providerJobId,
            providerJobAttempt,
            pagesDiscovered: 0,
            pagesCompleted: 0,
            pagesFailed: 0,
            creditsUsed,
          });
          continue providerAttempts;
        }
        break;
      }

      await this.persistPages(claim, pages);
      await Promise.all(
        failedUrls.map((url, index) =>
          this.assertLease(
            claim,
            this.repository.saveFailedPage(claim, url, pages.length + index, "provider_page_failed")
          )
        )
      );

      if (pages.length === 0) {
        throw new WebsiteCrawlError(
          "insufficient_content",
          "No readable public website content was found",
          false
        );
      }

      await this.persistProgress(claim, {
        status: "extracting",
        providerJobId,
        providerJobAttempt,
        pagesDiscovered: total,
        pagesCompleted: pages.length,
        pagesFailed: failedCount,
        creditsUsed,
      });
      const draft = await this.beforeDeadline(
        this.extractor.extract(pages, baseline),
        deadline,
        "extraction_timeout"
      );
      draft.scanMeta.failedPageCount = failedCount;
      this.assertRunning(claim, deadline, heartbeat, shutdownSignal);
      if (await this.repository.isCancellationRequested(claim)) {
        throw new WebsiteScanCancelledError();
      }

      const coverage =
        jobFailed || failedCount > 0 || (total > 0 && pages.length < total)
          ? "partial"
          : "complete";
      await this.assertLease(claim, this.repository.complete(claim, coverage, draft));
      this.logger.info(`[website-scan] scan ${claim.id} ready for owner review (${coverage})`);
    } catch (error) {
      if (error instanceof WorkerShutdownError) {
        this.logger.warn(`[website-scan] relinquishing scan ${claim.id}: ${error.message}`);
        return;
      }
      if (error instanceof WebsiteScanLeaseLostError) {
        // Owner cancellation clears the DB claim immediately. Distinguish that
        // expected token mismatch from a true worker takeover so a known
        // Firecrawl job is still cancelled and stops consuming credits.
        try {
          if (providerJobId && (await this.repository.isCancellationRequested(claim))) {
            await this.provider.cancel(providerJobId);
          }
        } catch {
          // A new claimant owns the row; it will resume the persisted job.
        }
        this.logger.warn(`[website-scan] relinquishing scan ${claim.id}: ${error.message}`);
        return;
      }
      if (error instanceof WebsiteScanCancelledError) {
        if (providerJobId) await this.provider.cancel(providerJobId);
        await this.finishFailure(claim, {
          code: "cancelled",
          message: "The website scan was cancelled",
          retryable: false,
        });
        return;
      }
      const failure = classifyFailure(error);
      this.logger.error(`[website-scan] scan ${claim.id} failed (${failure.code})`);
      await this.finishFailure(claim, failure);
    } finally {
      await heartbeat.stop();
    }
  }

  private assertRunning(
    claim: WebsiteScanClaim,
    deadline: number,
    heartbeat: ClaimHeartbeat,
    shutdownSignal?: AbortSignal
  ): void {
    if (shutdownSignal?.aborted) throw new WorkerShutdownError();
    heartbeat.throwIfFailed();
    if (this.now() >= deadline) {
      throw new WebsiteCrawlError(
        "scan_deadline_exceeded",
        "The website scan took too long",
        false
      );
    }
    if (!claim.claimToken) throw new WebsiteScanLeaseLostError(claim.id);
  }

  private async beforeDeadline<T>(promise: Promise<T>, deadline: number, code: string): Promise<T> {
    const remaining = deadline - this.now();
    if (remaining <= 0) {
      throw new WebsiteCrawlError(code, "The website scan took too long", false);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new WebsiteCrawlError(code, "The website scan took too long", false)),
            remaining
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async persistPages(claim: WebsiteScanClaim, pages: WebsiteScanPage[]): Promise<void> {
    for (let index = 0; index < pages.length; index += 1) {
      await this.assertLease(claim, this.repository.savePage(claim, pages[index], index));
    }
  }

  private async persistProgress(claim: WebsiteScanClaim, progress: WebsiteScanProgressUpdate) {
    await this.assertLease(claim, this.repository.updateProgress(claim, progress));
  }

  private async assertLease(claim: WebsiteScanClaim, result: Promise<boolean>): Promise<void> {
    if (!(await result)) throw new WebsiteScanLeaseLostError(claim.id);
  }

  private async finishFailure(
    claim: WebsiteScanClaim,
    failure: { code: string; message: string; retryable: boolean }
  ): Promise<void> {
    try {
      await this.assertLease(claim, this.repository.fail(claim, failure));
    } catch (error) {
      if (!(error instanceof WebsiteScanLeaseLostError)) throw error;
    }
  }
}

class ClaimHeartbeat {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private failure: Error | undefined;

  constructor(
    private readonly repository: WebsiteScanRepository,
    private readonly claim: WebsiteScanClaim,
    private readonly leaseSeconds: number,
    private readonly intervalMs: number
  ) {}

  start() {
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.beat().finally(() => {
        this.inFlight = undefined;
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.inFlight?.catch(() => undefined);
  }

  throwIfFailed() {
    if (this.failure) throw this.failure;
  }

  private async beat() {
    try {
      if (!(await this.repository.heartbeat(this.claim, this.leaseSeconds))) {
        this.failure = new WebsiteScanLeaseLostError(this.claim.id);
      }
    } catch (error) {
      this.failure = error instanceof Error ? error : new Error("Website scan heartbeat failed");
    }
  }
}

class WebsiteScanCancelledError extends Error {
  constructor() {
    super("Website scan cancelled");
    this.name = "WebsiteScanCancelledError";
  }
}

class WorkerShutdownError extends Error {
  constructor() {
    super("Worker is shutting down");
    this.name = "WorkerShutdownError";
  }
}

function classifyFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (error instanceof WebsiteCrawlError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof WebsiteExtractionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.code !== "insufficient_content" && error.code !== "unsupported_extraction",
    };
  }
  return {
    code: "unexpected_worker_error",
    message: "The scanner encountered a temporary internal error",
    retryable: true,
  };
}
