import { describe, expect, it, vi } from "vitest";

import type { WebsiteScanClaim } from "./domain";
import type { WebsiteScanProcessor } from "./processor";
import type { WebsiteScanRepository } from "./repository";
import { runWebsiteScanWorker } from "./worker";

const claim: WebsiteScanClaim = {
  id: "11111111-1111-4111-8111-111111111111",
  businessId: "22222222-2222-4222-8222-222222222222",
  sourceUrl: "https://example.com",
  claimToken: "33333333-3333-4333-8333-333333333333",
  generation: 1,
  attemptCount: 1,
  startedAt: null,
  providerJobId: null,
  providerJobAttempt: 0,
  pagesDiscovered: 0,
  pagesCompleted: 0,
  pagesFailed: 0,
  creditsUsed: 0,
  cancelRequestedAt: null,
  baseline: {},
};

describe("website scan worker loop", () => {
  it("purges expired payloads, claims work, and stops taking jobs during drain", async () => {
    const stop = new AbortController();
    const activeCounts: number[] = [];
    const repository = {
      purgeExpiredPayloads: vi.fn().mockResolvedValue(2),
      claim: vi.fn().mockResolvedValueOnce(claim),
    } as unknown as WebsiteScanRepository;
    const processor = {
      process: vi.fn().mockImplementation(async () => {
        stop.abort();
      }),
    } as unknown as WebsiteScanProcessor;

    await runWebsiteScanWorker({
      repository,
      processor,
      workerId: "worker-test",
      stopClaimingSignal: stop.signal,
      concurrency: 1,
      idlePollMs: 0,
      onActiveCountChanged: (count) => activeCounts.push(count),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(repository.purgeExpiredPayloads).toHaveBeenCalledOnce();
    expect(repository.claim).toHaveBeenCalledWith("worker-test:1", 120);
    expect(processor.process).toHaveBeenCalledWith(claim, undefined);
    expect(activeCounts).toEqual([1, 0]);
  });

  it("continues running when best-effort payload cleanup fails", async () => {
    const stop = new AbortController();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const repository = {
      purgeExpiredPayloads: vi.fn().mockRejectedValue(new Error("database unavailable")),
      claim: vi.fn().mockImplementation(async () => {
        stop.abort();
        return null;
      }),
    } as unknown as WebsiteScanRepository;

    await runWebsiteScanWorker({
      repository,
      processor: { process: vi.fn() } as unknown as WebsiteScanProcessor,
      workerId: "worker-test",
      stopClaimingSignal: stop.signal,
      concurrency: 1,
      idlePollMs: 0,
      logger,
    });

    expect(repository.claim).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("expired payload cleanup failed")
    );
  });
});
