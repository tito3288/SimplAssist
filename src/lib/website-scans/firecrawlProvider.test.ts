import { describe, expect, it, vi } from "vitest";

import type Firecrawl from "@mendable/firecrawl-js";
import type { CrawlJob, Document } from "@mendable/firecrawl-js";

import {
  isAllowedPageUrl,
  FirecrawlWebsiteProvider,
  WebsiteCrawlError,
  normalizeDocument,
  normalizeJob,
  normalizeUrl,
  prepareWebsiteScanPages,
} from "./firecrawlProvider";

describe("richer-scan Firecrawl normalization", () => {
  it("starts an asynchronous, same-domain 12-page v2 crawl", async () => {
    const startCrawl = vi.fn().mockResolvedValue({ id: "job-1", url: "status" });
    const provider = new FirecrawlWebsiteProvider({
      client: { startCrawl } as unknown as Firecrawl,
    });
    await expect(provider.start("https://8.8.8.8")).resolves.toEqual({ jobId: "job-1" });
    expect(startCrawl).toHaveBeenCalledWith(
      "https://8.8.8.8/",
      expect.objectContaining({
        limit: 12,
        maxDiscoveryDepth: 2,
        sitemap: "include",
        ignoreQueryParameters: true,
        deduplicateSimilarURLs: true,
        regexOnFullURL: false,
        allowExternalLinks: false,
        allowSubdomains: false,
        scrapeOptions: expect.objectContaining({
          formats: ["markdown"],
          onlyMainContent: true,
        }),
      })
    );
    const options = startCrawl.mock.calls[0]?.[1];
    expect(options.excludePaths).toEqual(
      expect.arrayContaining(["(^|/)login(/|$)", "(^|/)wp-login\\.php(/|$)"])
    );
    expect(options.excludePaths.every((pattern: string) => {
      new RegExp(pattern);
      return true;
    })).toBe(true);
    const isExcluded = (path: string) =>
      options.excludePaths.some((pattern: string) => new RegExp(pattern).test(path));
    expect(isExcluded("/login")).toBe(true);
    expect(isExcluded("/login/reset")).toBe(true);
    expect(isExcluded("/company/blog/news-item")).toBe(true);
    expect(isExcluded("/catalogin")).toBe(false);
    expect(isExcluded("/products/blog-post")).toBe(false);
  });

  it.each([
    { status: 400, expectedCode: "provider_start_rejected", retryable: false },
    { status: 409, expectedCode: "provider_start_rejected", retryable: false },
    { status: 429, expectedCode: "provider_start_unavailable", retryable: true },
    { status: 503, expectedCode: "provider_start_unavailable", retryable: true },
    { status: 501, expectedCode: "provider_start_rejected", retryable: false },
    { status: null, expectedCode: "provider_start_unavailable", retryable: true },
  ])("normalizes a start failure with status $status", async ({ status, expectedCode, retryable }) => {
    const failure = Object.assign(new Error("provider detail must remain private"), {
      ...(status === null ? {} : { status }),
      code: "ERR_PROVIDER",
    });
    const provider = new FirecrawlWebsiteProvider({
      client: { startCrawl: vi.fn().mockRejectedValue(failure) } as unknown as Firecrawl,
    });

    await expect(provider.start("https://8.8.8.8")).rejects.toMatchObject({
      name: "WebsiteCrawlError",
      code: expectedCode,
      retryable,
      operation: "start",
      httpStatus: status,
      providerCode: "ERR_PROVIDER",
      message: "The website crawl could not be started",
    });
  });

  it("normalizes a permanent status rejection without exposing provider details", async () => {
    const provider = new FirecrawlWebsiteProvider({
      client: {
        getCrawlStatus: vi.fn().mockRejectedValue(
          Object.assign(new Error("secret provider detail"), {
            statusCode: 401,
            code: "AUTH_REJECTED",
          })
        ),
      } as unknown as Firecrawl,
    });

    await expect(provider.status("job-1", "https://example.com")).rejects.toEqual(
      new WebsiteCrawlError(
        "provider_status_rejected",
        "The website crawl status could not be checked",
        false,
        "status",
        401,
        "AUTH_REJECTED"
      )
    );
  });

  it("reports an SDK-thrown HTTP 200 crawl failure as failed job progress", async () => {
    const provider = new FirecrawlWebsiteProvider({
      client: {
        getCrawlStatus: vi.fn().mockRejectedValue(
          Object.assign(new Error("provider detail must remain private"), {
            status: 200,
          })
        ),
      } as unknown as Firecrawl,
    });

    await expect(provider.status("job-dead", "https://example.com")).resolves.toEqual({
      status: "failed",
      total: 0,
      completed: 0,
      creditsUsed: 0,
      pages: [],
    });
  });

  it("retries each failed page only once", async () => {
    const getCrawlErrors = vi.fn().mockResolvedValue({
      errors: [{ id: "error", url: "https://8.8.8.8/services", error: "timeout" }],
      robotsBlocked: [],
    });
    const scrape = vi.fn().mockResolvedValue({
      markdown: "Drain cleaning",
      metadata: { sourceURL: "https://8.8.8.8/services" },
    });
    const provider = new FirecrawlWebsiteProvider({
      client: { getCrawlErrors, scrape } as unknown as Firecrawl,
    });
    const result = await provider.retryFailedPages("job-1", "https://8.8.8.8", new Set());
    expect(scrape).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      failedCount: 0,
      failedUrls: [],
      pages: [{ url: "https://8.8.8.8/services", markdown: "Drain cleaning" }],
    });
  });

  it("keeps readable crawl recovery possible when error lookup is unavailable", async () => {
    const provider = new FirecrawlWebsiteProvider({
      client: {
        getCrawlErrors: vi.fn().mockRejectedValue(new Error("temporary provider error")),
      } as unknown as Firecrawl,
    });
    await expect(
      provider.retryFailedPages("job-1", "https://8.8.8.8", new Set())
    ).resolves.toEqual({ pages: [], failedCount: 1, failedUrls: [] });
  });

  it("accepts the canonical www host but rejects external and subdomain pages", () => {
    expect(isAllowedPageUrl("https://www.example.com/services", "https://example.com")).toBe(true);
    expect(isAllowedPageUrl("https://book.example.com/services", "https://example.com")).toBe(false);
    expect(isAllowedPageUrl("https://evil.example.net/services", "https://example.com")).toBe(false);
    expect(
      isAllowedPageUrl(
        "https://user:secret@example.com/services",
        "https://example.com"
      )
    ).toBe(false);
  });

  it("normalizes URLs and caps a page at 25,000 characters", () => {
    const page = normalizeDocument(
      {
        markdown: "x".repeat(30_000),
        metadata: { sourceURL: "http://EXAMPLE.com/services/?utm_source=test#top", title: " Services " },
      } as Document,
      "http://example.com"
    );
    expect(page).toMatchObject({
      url: "https://example.com/services",
      title: "Services",
      characterCount: 25_000,
    });
    expect(page?.markdown).toHaveLength(25_000);
  });

  it("counts and caps astral Unicode the same way PostgreSQL char_length does", () => {
    const page = normalizeDocument(
      {
        markdown: "😀".repeat(25_001),
        metadata: { sourceURL: "https://example.com/unicode" },
      } as Document,
      "https://example.com"
    );
    expect(page?.characterCount).toBe(25_000);
    expect(Array.from(page?.markdown ?? "")).toHaveLength(25_000);
    expect(page?.markdown.endsWith("😀")).toBe(true);
  });

  it("deduplicates content and caps combined extraction input at 120,000 characters", () => {
    const pages = Array.from({ length: 12 }, (_, index) => {
      const markdown = `${index}:` + "x".repeat(24_998);
      return normalizeDocument(
        { markdown, metadata: { sourceURL: `https://example.com/page-${index}` } } as Document,
        "https://example.com"
      )!;
    });
    pages.push({ ...pages[0], url: "https://example.com/duplicate" });

    const prepared = prepareWebsiteScanPages(pages);
    expect(prepared).toHaveLength(5);
    expect(prepared.reduce((sum, page) => sum + page.characterCount, 0)).toBe(120_000);
  });

  it("drops unusable documents and reports bounded provider progress", () => {
    const job = {
      id: "job-1",
      status: "completed",
      total: 50,
      completed: 50,
      creditsUsed: 7,
      data: [
        { markdown: "Valid", metadata: { sourceURL: "https://example.com/" } },
        { markdown: "External", metadata: { sourceURL: "https://other.test/" } },
        { markdown: "", metadata: { sourceURL: "https://example.com/empty" } },
      ],
    } as CrawlJob;
    expect(normalizeJob(job, "https://example.com")).toMatchObject({
      status: "completed",
      total: 12,
      completed: 12,
      creditsUsed: 7,
      pages: [{ url: "https://example.com/", markdown: "Valid" }],
    });
  });

  it("drops content when Firecrawl reports a cross-domain redirect", () => {
    expect(
      normalizeDocument(
        {
          markdown: "Redirected content",
          metadata: {
            sourceURL: "https://example.com/services",
            url: "https://other.test/services",
          },
        } as Document,
        "https://example.com"
      )
    ).toBeNull();
  });

  it("removes query strings, fragments, default ports, and trailing slashes", () => {
    expect(normalizeUrl("http://Example.com:80/services/?x=1#top")).toBe(
      "https://example.com/services"
    );
  });
});
