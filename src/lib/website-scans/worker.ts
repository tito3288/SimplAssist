import type { WebsiteScanRepository } from "./repository";
import type { WebsiteScanProcessor } from "./processor";

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_IDLE_POLL_MS = 2_000;

export interface WebsiteScanWorkerOptions {
  repository: WebsiteScanRepository;
  processor: WebsiteScanProcessor;
  workerId: string;
  stopClaimingSignal: AbortSignal;
  abortJobsSignal?: AbortSignal;
  concurrency?: number;
  idlePollMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  onActiveCountChanged?: (count: number) => void;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export async function runWebsiteScanWorker(options: WebsiteScanWorkerOptions): Promise<void> {
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("Website scan worker concurrency must be between 1 and 8");
  }
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const logger = options.logger ?? console;
  let activeCount = 0;

  const purge = async () => {
    try {
      const removed = await options.repository.purgeExpiredPayloads();
      if (removed > 0) logger.info(`[website-scan] purged ${removed} expired page payloads`);
    } catch (error) {
      logger.warn(
        `[website-scan] expired payload cleanup failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
  };
  // Cleanup is best-effort maintenance and must never delay job claims during
  // a deployment or database hiccup.
  void purge();
  const purgeTimer = setInterval(() => void purge(), 60 * 60_000);
  purgeTimer.unref?.();

  const updateActive = (delta: number) => {
    activeCount += delta;
    options.onActiveCountChanged?.(activeCount);
  };

  const lane = async (laneIndex: number) => {
    const laneWorkerId = `${options.workerId}:${laneIndex}`;
    while (!options.stopClaimingSignal.aborted) {
      try {
        const claim = await options.repository.claim(laneWorkerId, 120);
        if (!claim) {
          await interruptibleSleep(options.stopClaimingSignal, options.idlePollMs ?? DEFAULT_IDLE_POLL_MS, sleep);
          continue;
        }
        updateActive(1);
        try {
          await options.processor.process(claim, options.abortJobsSignal);
        } finally {
          updateActive(-1);
        }
      } catch (error) {
        logger.error(
          `[website-scan] worker lane ${laneIndex} error: ${error instanceof Error ? error.message : "unknown error"}`
        );
        await interruptibleSleep(options.stopClaimingSignal, options.idlePollMs ?? DEFAULT_IDLE_POLL_MS, sleep);
      }
    }
  };

  logger.info(`[website-scan] worker ${options.workerId} started with concurrency ${concurrency}`);
  try {
    await Promise.all(
      Array.from({ length: concurrency }, (_, index) => lane(index + 1))
    );
  } finally {
    clearInterval(purgeTimer);
  }
  logger.info(`[website-scan] worker ${options.workerId} stopped`);
}

async function interruptibleSleep(
  signal: AbortSignal,
  milliseconds: number,
  sleep: (milliseconds: number) => Promise<void>
): Promise<void> {
  if (signal.aborted) return;
  await Promise.race([
    sleep(milliseconds),
    new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
  ]);
}
