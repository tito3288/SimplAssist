import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type {
  WebsiteScanClaim,
  WebsiteScanDraft,
  WebsiteScanPage,
} from "./domain";
import type { WebsiteKnowledgeExtractor } from "./extraction";
import { WebsiteCrawlError, type WebsiteCrawlProvider } from "./firecrawlProvider";
import { WebsiteScanProcessor } from "./processor";
import type { WebsiteScanRepository } from "./repository";

const page: WebsiteScanPage = {
  url: "https://example.com/",
  title: "Home",
  markdown: "Acme offers plumbing services.",
  contentHash: createHash("sha256").update("Acme offers plumbing services.").digest("hex"),
  characterCount: 30,
};

function claim(overrides: Partial<WebsiteScanClaim> = {}): WebsiteScanClaim {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    businessId: "22222222-2222-4222-8222-222222222222",
    sourceUrl: "https://example.com",
    claimToken: "33333333-3333-4333-8333-333333333333",
    generation: 2,
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
    ...overrides,
  };
}

function draft(): WebsiteScanDraft {
  return {
    overview: {
      text: "Acme offers plumbing services.",
      sources: [],
      selected: true,
      changeType: "new",
      targetId: null,
      baselineHash: null,
    },
    profilePrefill: {
      business_name: "Acme",
      phone_number: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      business_hours: [],
      sources: {},
    },
    services: [],
    faqs: [],
    knowledge: [],
    questions: [],
    missing: [],
    scanMeta: { pageCount: 1, failedPageCount: 0, generatedAt: "2026-01-01T00:00:00Z" },
  };
}

function dependencies(options: {
  providerJobId?: string | null;
  cancelled?: boolean;
  updateResult?: boolean;
  failedUrls?: string[];
  now?: () => number;
  deadlineMs?: number;
} = {}) {
  const repository = {
    claim: vi.fn(),
    loadBaseline: vi.fn().mockResolvedValue({}),
    heartbeat: vi.fn().mockResolvedValue(true),
    updateProgress: vi.fn().mockResolvedValue(options.updateResult ?? true),
    savePage: vi.fn().mockResolvedValue(true),
    saveFailedPage: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue(true),
    fail: vi.fn().mockResolvedValue(options.cancelled ? false : true),
    isCancellationRequested: vi.fn().mockResolvedValue(options.cancelled ?? false),
  } as unknown as WebsiteScanRepository;
  const provider = {
    start: vi.fn().mockResolvedValue({ jobId: "job-new" }),
    status: vi.fn().mockResolvedValue({
      status: "completed",
      total: 1,
      completed: 1,
      creditsUsed: 1,
      pages: [page],
    }),
    retryFailedPages: vi.fn().mockResolvedValue({
      pages: [],
      failedCount: options.failedUrls?.length ?? 0,
      failedUrls: options.failedUrls ?? [],
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  } as unknown as WebsiteCrawlProvider;
  const extractor = {
    extract: vi.fn().mockResolvedValue(draft()),
  } as unknown as WebsiteKnowledgeExtractor;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const processor = new WebsiteScanProcessor({
    repository,
    provider,
    extractor,
    pollIntervalMs: 0,
    heartbeatIntervalMs: 60_000,
    logger,
    now: options.now,
    deadlineMs: options.deadlineMs,
  });
  return { repository, provider, extractor, processor, logger };
}

describe("durable website scan processor", () => {
  it("persists a new provider job before polling and completes an owner-review draft", async () => {
    const { repository, provider, processor } = dependencies();
    await processor.process(claim());

    expect(provider.start).toHaveBeenCalledWith("https://example.com");
    expect(repository.updateProgress).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: "crawling",
        providerJobId: "job-new",
        providerJobAttempt: 1,
      })
    );
    expect(repository.savePage).toHaveBeenCalledWith(expect.anything(), page, 0);
    expect(repository.complete).toHaveBeenCalledWith(
      expect.anything(),
      "complete",
      expect.objectContaining({ scanMeta: expect.objectContaining({ pageCount: 1 }) })
    );
  });

  it("resumes the exact persisted Firecrawl job after lease takeover", async () => {
    const { provider, processor } = dependencies();
    await processor.process(
      claim({ providerJobId: "job-existing", providerJobAttempt: 1, attemptCount: 2 })
    );

    expect(provider.start).not.toHaveBeenCalled();
    expect(provider.status).toHaveBeenCalledWith("job-existing", "https://example.com");
  });

  it("persists a replacement job when a provider job dies before returning content", async () => {
    const { repository, provider, processor } = dependencies();
    vi.mocked(provider.status)
      .mockResolvedValueOnce({
        status: "failed",
        total: 0,
        completed: 0,
        creditsUsed: 0,
        pages: [],
      })
      .mockResolvedValueOnce({
        status: "completed",
        total: 1,
        completed: 1,
        creditsUsed: 1,
        pages: [page],
      });
    vi.mocked(provider.retryFailedPages)
      .mockResolvedValueOnce({ pages: [], failedCount: 0, failedUrls: [] })
      .mockResolvedValueOnce({ pages: [], failedCount: 0, failedUrls: [] });

    await processor.process(claim({ providerJobId: "job-dead", providerJobAttempt: 1 }));

    expect(provider.start).toHaveBeenCalledOnce();
    expect(repository.updateProgress).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerJobId: "job-new",
        providerJobAttempt: 2,
      })
    );
    expect(repository.complete).toHaveBeenCalled();
  });

  it("never writes completion or failure after losing its fenced lease", async () => {
    const { repository, provider, processor } = dependencies({ updateResult: false });
    await processor.process(claim());

    expect(provider.status).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("cancels the provider when cancellation clears the claim during a heartbeat race", async () => {
    const { repository, provider, processor } = dependencies({ updateResult: false });
    vi.mocked(repository.isCancellationRequested)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await processor.process(
      claim({ providerJobId: "job-existing", providerJobAttempt: 1 })
    );

    expect(provider.cancel).toHaveBeenCalledWith("job-existing");
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).not.toHaveBeenCalled();
  });

  it("best-effort cancels the provider after an owner cancellation", async () => {
    const { repository, provider, processor } = dependencies({ cancelled: true });
    await processor.process(claim({ providerJobId: "job-existing" }));

    expect(provider.cancel).toHaveBeenCalledWith("job-existing");
    expect(repository.complete).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "cancelled", retryable: false })
    );
  });

  it("records failed-page metadata and presents readable partial coverage", async () => {
    const { repository, processor } = dependencies({
      failedUrls: ["https://example.com/pricing"],
    });
    await processor.process(claim());

    expect(repository.saveFailedPage).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com/pricing",
      1,
      "provider_page_failed"
    );
    expect(repository.complete).toHaveBeenCalledWith(
      expect.anything(),
      "partial",
      expect.objectContaining({ scanMeta: expect.objectContaining({ failedPageCount: 1 }) })
    );
  });

  it("keeps the six-minute deadline across an automatic lease reclaim", async () => {
    const startedAt = "2026-01-01T00:00:00.000Z";
    const { repository, provider, processor } = dependencies({
      now: () => Date.parse(startedAt) + 6 * 60_000 + 1,
    });
    await processor.process(claim({ startedAt, attemptCount: 2, providerJobId: "job-existing" }));

    expect(provider.status).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "scan_deadline_exceeded", retryable: false })
    );
  });

  it("does not automatically retry when an in-flight operation consumes the total deadline", async () => {
    const { repository, provider, processor } = dependencies({ deadlineMs: 5 });
    vi.mocked(provider.start).mockImplementation(
      () => new Promise<{ jobId: string }>(() => undefined)
    );

    await processor.process(claim());

    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "provider_start_timeout", retryable: false })
    );
  });

  it("terminally fails a permanent provider start rejection with safe diagnostics", async () => {
    const { repository, provider, processor, logger } = dependencies();
    vi.mocked(provider.start).mockRejectedValue(
      new WebsiteCrawlError(
        "provider_start_rejected",
        "The website crawl could not be started",
        false,
        "start",
        400,
        "ERR_BAD_REQUEST"
      )
    );

    await processor.process(claim());

    expect(provider.status).not.toHaveBeenCalled();
    expect(repository.fail).toHaveBeenCalledOnce();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "provider_start_rejected", retryable: false })
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "provider_start_rejected; attempt=1; provider_attempt=0; operation=start; provider_status=400; provider_code=ERR_BAD_REQUEST"
      )
    );
  });

  it("terminally fails a permanent provider status rejection", async () => {
    const { repository, provider, processor } = dependencies();
    vi.mocked(provider.status).mockRejectedValue(
      new WebsiteCrawlError(
        "provider_status_rejected",
        "The website crawl status could not be checked",
        false,
        "status",
        401,
        "AUTH_REJECTED"
      )
    );

    await processor.process(claim({ providerJobId: "job-existing", providerJobAttempt: 1 }));

    expect(repository.fail).toHaveBeenCalledOnce();
    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "provider_status_rejected", retryable: false })
    );
  });

  it("keeps a transient provider rejection retryable", async () => {
    const { repository, provider, processor } = dependencies();
    vi.mocked(provider.start).mockRejectedValue(
      new WebsiteCrawlError(
        "provider_start_unavailable",
        "The website crawl could not be started",
        true,
        "start",
        429,
        "RATE_LIMITED"
      )
    );

    await processor.process(claim());

    expect(repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: "provider_start_unavailable", retryable: true })
    );
  });
});
